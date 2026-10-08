import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTANTS as C } from '../src/constants.ts';
import {
	eiv,
	inputUnitPrice,
	jobCost,
	materialModifier,
	outputUnitPrice,
	requiredQuantity,
	runTimeSeconds,
	runsPerCycle,
	runsPerCycleDetail,
	shippingCost,
	timeModifier
} from '../src/formulas.ts';
import { DEFAULT_SETTINGS, type MarketSettings, type ShippingSettings } from '../src/settings.ts';
import { byId, resolved } from './fixtures/context.ts';

const market = (overrides: Partial<MarketSettings> = {}): MarketSettings => ({
	...DEFAULT_SETTINGS.shared.market,
	...overrides
});

describe('material modifier', () => {
	it('matches the spreadsheet for every rig/security combination', () => {
		expect(materialModifier(resolved({ meRig: 't2', securityBand: 'nullsec' }), C)).toBeCloseTo(0.9736, 10);
		expect(materialModifier(resolved({ meRig: 't2', securityBand: 'lowsec' }), C)).toBeCloseTo(0.976, 10);
		expect(materialModifier(resolved({ meRig: 't1', securityBand: 'nullsec' }), C)).toBeCloseTo(0.978, 10);
		expect(materialModifier(resolved({ meRig: 'none', securityBand: 'nullsec' }), C)).toBe(1);
		expect(materialModifier(resolved({ meRig: 't2', securityBand: 'wormhole' }), C)).toBeCloseTo(0.9736, 10);
	});
});

describe('time', () => {
	it('Reactions V, Tatara, T2 nullsec = 44.16 %', () => {
		expect(timeModifier(resolved(), C)).toBeCloseTo(0.4416, 10);
	});

	it('Athanor without rigs at Reactions I', () => {
		expect(timeModifier(resolved({ structure: 'athanor', teRig: 'none', reactionsSkill: 1 }), C)).toBeCloseTo(
			0.96,
			10
		);
	});

	it('10800 s base → 4769.28 s and 126 runs per 7-day cycle', () => {
		const r = byId(46166);
		expect(runTimeSeconds(r, resolved(), C)).toBeCloseTo(4769.28, 6);
		expect(runsPerCycle(r, resolved(), 7, C)).toBe(126);
	});

	it('clamps runs per cycle to 1 when no run fits and to maxRuns', () => {
		const r = byId(46166);
		expect(runsPerCycleDetail(r, resolved(), 0.01, C)).toEqual({ runs: 1, fits: false, capped: false });
		expect(runsPerCycle({ ...r, maxRuns: 50 }, resolved(), 7, C)).toBe(50);
		// 126 runs would fit in 7 days; a 100-run formula (Molecular-Forged) stops at its per-job maximum.
		expect(runsPerCycleDetail({ ...r, maxRuns: 100 }, resolved(), 7, C)).toEqual({
			runs: 100,
			fits: true,
			capped: true
		});
		expect(runsPerCycleDetail(r, resolved(), 7, C)).toEqual({ runs: 126, fits: true, capped: false });
	});
});

describe('requiredQuantity', () => {
	it.each([
		[1, 200, 0.9736, 195],
		[126, 100, 0.9736, 12268],
		[10, 1, 0.9736, 10],
		[126, 5, 0.9736, 614],
		[1, 100, 1, 100]
	])('runs=%i qty=%i mm=%f → %i', (runs, qty, mm, expected) => {
		expect(requiredQuantity(runs, qty, mm)).toBe(expected);
	});
});

describe('job cost', () => {
	it('EIV × (cost index + facility tax + SCC)', () => {
		const adjusted = { 4312: 500, 16643: 1000, 16647: 2000 };
		const estimate = eiv(byId(46166), 1, adjusted);
		expect(estimate).toEqual({ value: 302_500, missing: [] });
		const cost = jobCost(estimate.value, resolved({ costIndex: 0.05, facilityTaxPct: 1, sccPct: 4 }));
		expect(cost.systemCost).toBeCloseTo(15_125, 6);
		expect(cost.facilityTax).toBeCloseTo(3_025, 6);
		expect(cost.scc).toBeCloseTo(12_100, 6);
		expect(cost.total).toBeCloseTo(30_250, 6);
	});

	it('reports materials without adjusted price and values them at 0', () => {
		expect(eiv(byId(46166), 2, { 4312: 500 })).toEqual({ value: 5000, missing: [16643, 16647] });
	});
});

describe('unit prices', () => {
	const hp = { buy: 100, sell: 120 };

	it('input methods: buy order pays broker, instant buys at sell, contract uses basis', () => {
		expect(inputUnitPrice(hp, market({ inputMethod: 'buy_order', brokerFeePct: 1.5 }))).toEqual({
			price: 100,
			fee: 1.5
		});
		expect(inputUnitPrice(hp, market({ inputMethod: 'instant' }))).toEqual({ price: 120, fee: 0 });
		expect(inputUnitPrice(hp, market({ inputMethod: 'contract', inputContractBasis: 'buy' }))).toEqual({
			price: 100,
			fee: 0
		});
		expect(inputUnitPrice(hp, market({ inputMethod: 'contract', inputContractBasis: 'sell' }))).toEqual({
			price: 120,
			fee: 0
		});
		expect(inputUnitPrice(hp, market({ inputMethod: 'contract', inputContractBasis: 'split' }))).toEqual({
			price: 110,
			fee: 0
		});
	});

	it('output methods: sell order pays broker + tax, instant pays tax, contract is free', () => {
		const m = { brokerFeePct: 1.5, salesTaxPct: 3.6 };
		const sellOrder = outputUnitPrice(hp, market({ outputMethod: 'sell_order', ...m }))!;
		expect(sellOrder.price).toBe(120);
		expect(sellOrder.fee).toBeCloseTo(6.12, 10);
		const instant = outputUnitPrice(hp, market({ outputMethod: 'instant', ...m }))!;
		expect(instant.price).toBe(100);
		expect(instant.fee).toBeCloseTo(3.6, 10);
		expect(outputUnitPrice(hp, market({ outputMethod: 'contract', outputContractBasis: 'buy' }))).toEqual({
			price: 100,
			fee: 0
		});
		expect(outputUnitPrice(hp, market({ outputMethod: 'contract', outputContractBasis: 'sell' }))).toEqual({
			price: 120,
			fee: 0
		});
		expect(outputUnitPrice(hp, market({ outputMethod: 'contract', outputContractBasis: 'split' }))).toEqual({
			price: 110,
			fee: 0
		});
	});

	it('applies the price percentage before computing fees', () => {
		const input = inputUnitPrice(hp, market({ inputPricePct: 90, brokerFeePct: 2 }))!;
		expect(input.price).toBeCloseTo(90, 10);
		expect(input.fee).toBeCloseTo(1.8, 10);
		const output = outputUnitPrice(hp, market({ outputPricePct: 110, brokerFeePct: 1, salesTaxPct: 4 }))!;
		expect(output.price).toBeCloseTo(132, 10);
		expect(output.fee).toBeCloseTo(6.6, 10);
	});

	it('returns null when the needed side or the hub entry is missing', () => {
		expect(inputUnitPrice({ buy: null, sell: 5 }, market())).toBeNull();
		expect(
			inputUnitPrice({ buy: 5, sell: null }, market({ inputMethod: 'contract', inputContractBasis: 'split' }))
		).toBeNull();
		expect(outputUnitPrice({ buy: 5, sell: null }, market())).toBeNull();
		expect(inputUnitPrice(undefined, market())).toBeNull();
	});
});

describe('shipping', () => {
	const ship = (overrides: Partial<ShippingSettings> = {}): ShippingSettings => ({
		enabled: true,
		iskPerM3: 500,
		collateralPct: 1,
		discountPct: 0,
		...overrides
	});
	const full = 100 * 0.2 * 500 + 100 * 1000 * 0.01;

	it('charges volume and collateral only when enabled', () => {
		expect(shippingCost(100, 0.2, 1000, ship())).toBeCloseTo(full, 8);
		expect(shippingCost(100, 0.2, 1000, ship({ enabled: false }))).toBe(0);
		expect(shippingCost(100, 0.2, 1000, ship({ enabled: false, discountPct: 25 }))).toBe(0);
	});

	it('applies the discount to the whole price (volume and collateral)', () => {
		expect(shippingCost(100, 0.2, 1000, ship({ discountPct: 25 }))).toBeCloseTo(full * 0.75, 8);
		expect(shippingCost(100, 0.2, 1000, ship({ iskPerM3: 0, discountPct: 10 }))).toBeCloseTo(900, 8);
		expect(shippingCost(100, 0.2, 1000, ship({ collateralPct: 0, discountPct: 10 }))).toBeCloseTo(9000, 8);
		expect(shippingCost(100, 0.2, 1000, ship({ discountPct: 100 }))).toBe(0);
		expect(shippingCost(100, 0.2, 1000, ship({ discountPct: 0 }))).toBeCloseTo(full, 8);
	});
});
