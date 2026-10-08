import { describe, expect, it } from 'vitest';
import { calculateReaction, type CalcContext, type ReactionResult } from '../src/calculate.ts';
import { planReactions, type PlanInput } from '../src/planner.ts';
import type { HubPrice } from '../src/types.ts';
import { byId, makeCtx } from './fixtures/context.ts';
import { jitaPrices, priceBook } from './fixtures/dataset.ts';

/** A structure market listing a few inputs of Caesarium Cadmide / Titanium Carbide. */
const local = (overrides: Record<number, Partial<HubPrice>> = {}): Record<number, HubPrice> => {
	const base: Record<number, HubPrice> = {
		4312: { buy: 20000, sell: 21000, buyVolume: 50, sellVolume: 1000 },
		16643: { buy: 1000, sell: 1100, buyVolume: 0, sellVolume: 5000 },
		16647: { buy: 1000, sell: 1100, buyVolume: 0, sellVolume: 20000 }
	};
	for (const [id, o] of Object.entries(overrides)) base[Number(id)] = { ...base[Number(id)], ...o };
	return base;
};

const ctxWith = (
	market: Partial<CalcContext['profiles']['composite']['market']> = {},
	hub: Record<number, HubPrice> = local(),
	shipping = false
) =>
	makeCtx({
		profile: {
			market: { inputHub: 'local', ...market },
			...(shipping ? { shipping: { input: { enabled: true, iskPerM3: 500, collateralPct: 1 } } } : {})
		},
		inputPrices: priceBook({ jita: jitaPrices, local: hub }),
		outputPrices: priceBook()
	});

const single = (ctx: CalcContext) =>
	calculateReaction(byId(46166), ctx, { view: 'single', outputMode: 'product' });
const chain = (ctx: CalcContext) =>
	calculateReaction(byId(46204), ctx, { view: 'chain', outputMode: 'product' });
const input = (r: ReactionResult, typeId: number) => r.inputs.find((i) => i.typeId === typeId)!;

describe('no split', () => {
	it('when the input hub lists enough: priced at the input hub, availability reported', () => {
		const r = single(ctxWith({}, local({ 16643: { sellVolume: 12268 } })));
		expect(r.warnings).not.toContain('INPUT_VOLUME_SHORT');
		expect(
			r.inputs.map((i) => [i.typeId, i.quantity, i.unitPrice, i.availableAtInputHub, i.sources])
		).toEqual([
			[4312, 614, 20000, 1000, undefined],
			[16643, 12268, 1000, 12268, undefined],
			[16647, 12268, 1000, 20000, undefined]
		]);
		expect(r.totals.inputCost).toBe(614 * 20000 + 2 * 12268 * 1000);
	});

	it('when the listed volume is unknown (historical books): no availability, no warning', () => {
		const unknown: Record<number, HubPrice> = {
			4312: { buy: 20000, sell: 21000 },
			16643: { buy: 1000, sell: 1100 },
			16647: { buy: 1000, sell: 1100 }
		};
		const r = single(ctxWith({}, unknown));
		expect(r.warnings).not.toContain('INPUT_VOLUME_SHORT');
		expect(r.inputs.map((i) => [i.typeId, i.availableAtInputHub, i.sources])).toEqual([
			[4312, null, undefined],
			[16643, null, undefined],
			[16647, null, undefined]
		]);
		expect(r.totals.inputCost).toBe(614 * 20000 + 2 * 12268 * 1000);
	});

	it('for contracts: priced at the input hub, no availability', () => {
		const r = single(ctxWith({ inputMethod: 'contract', inputContractBasis: 'buy' }));
		expect(r.warnings).not.toContain('INPUT_VOLUME_SHORT');
		expect(r.inputs.every((i) => !('availableAtInputHub' in i) && i.sources === undefined)).toBe(true);
		expect(r.totals.inputCost).toBe(614 * 20000 + 2 * 12268 * 1000);
	});

	it('when the fallback is the input hub', () => {
		const r = single(ctxWith({ inputFallbackHub: 'local' }));
		expect(r.warnings).not.toContain('INPUT_VOLUME_SHORT');
		expect(input(r, 16643)).toMatchObject({
			unitPrice: 1000,
			total: 12268 * 1000,
			availableAtInputHub: 5000
		});
		expect(input(r, 16643).sources).toBeUndefined();
	});
});

describe('split (Caesarium Cadmide, buy orders, 5,000 Cadmium listed)', () => {
	const r = single(ctxWith({}, local(), true));
	const cadmium = input(r, 16643);

	it('buys the listed units locally and the rest at Jita with broker fees per market', () => {
		expect(r.warnings).toContain('INPUT_VOLUME_SHORT');
		expect(cadmium.availableAtInputHub).toBe(5000);
		expect(cadmium.sources).toEqual([
			{ hubId: 'local', quantity: 5000, unitPrice: 1000, total: 5_000_000, fees: 75_000 },
			{ hubId: 'jita', quantity: 7268, unitPrice: 900, total: 6_541_200, fees: 98_118 }
		]);
		expect(cadmium.quantity).toBe(12268);
		expect(cadmium.total).toBeCloseTo(11_541_200, 4);
		expect(cadmium.unitPrice).toBeCloseTo(11_541_200 / 12268, 8);
		expect(cadmium.fees).toBeCloseTo(173_118, 4);
	});

	it('applies input shipping to every bought unit, collateral at each market price', () => {
		// 12,268 × 0.05 m³ × 500 + 1 % of (5,000 × 1,000 + 7,268 × 900)
		expect(cadmium.shipping).toBeCloseTo(306_700 + 115_412, 4);
	});

	it('uses the split prices in the totals', () => {
		const inputCost = 614 * 20000 + 11_541_200 + 12268 * 1000;
		expect(r.totals.inputCost).toBeCloseTo(inputCost, 4);
		expect(r.totals.inputFees).toBeCloseTo(inputCost * 0.015, 4);
		expect(r.missingPrices).toEqual([]);
	});

	it('instant purchases take sell prices without fees', () => {
		const instant = input(single(ctxWith({ inputMethod: 'instant' })), 16643);
		expect(instant.sources).toEqual([
			{ hubId: 'local', quantity: 5000, unitPrice: 1100, total: 5_500_000, fees: 0 },
			{ hubId: 'jita', quantity: 7268, unitPrice: 1000, total: 7_268_000, fees: 0 }
		]);
		expect(instant.total).toBeCloseTo(12_768_000, 4);
	});

	it('nothing listed: everything from the fallback hub', () => {
		const none = input(single(ctxWith({}, local({ 16643: { sellVolume: 0 } }))), 16643);
		expect(none.sources).toEqual([
			{ hubId: 'jita', quantity: 12268, unitPrice: 900, total: 12268 * 900, fees: 12268 * 900 * 0.015 }
		]);
		expect(none.unitPrice).toBeCloseTo(900, 10);
	});

	it('a fallback hub without a price leaves the profit unknown', () => {
		const missing = single(ctxWith({ inputFallbackHub: 'amarr' }));
		expect(missing.missingPrices).toEqual([16643]);
		expect(missing.totals.profit).toBeNull();
		expect(missing.warnings).toContain('INPUT_VOLUME_SHORT');
		expect(input(missing, 16643)).toMatchObject({ unitPrice: null, total: 0, fees: 0 });
		expect(input(missing, 16643).sources).toEqual([
			{ hubId: 'local', quantity: 5000, unitPrice: 1000, total: 5_000_000, fees: 75_000 },
			{ hubId: 'amarr', quantity: 7268, unitPrice: null, total: 0, fees: 0 }
		]);
	});
});

describe('chain-wide availability (Titanium Carbide, 1,000 Oxygen Fuel Blocks listed)', () => {
	// The top job needs 614 blocks and each intermediate job 302: 1,218 in total.
	const r = chain(ctxWith({}, local(), true));
	const root = r.chain!;
	const nodes = [root, ...root.children];
	const lines = nodes.flatMap((n) =>
		n.materials.flatMap((m) => (m.source === 'buy' && m.typeId === 4312 ? [m] : []))
	);
	const blended = (1000 * 20000 + 218 * 18000) / 1218;

	it('allocates the listed units once over the whole chain', () => {
		const blocks = input(r, 4312);
		expect(blocks.quantity).toBe(1218);
		expect(blocks.sources).toEqual([
			{ hubId: 'local', quantity: 1000, unitPrice: 20000, total: 20_000_000, fees: 300_000 },
			{ hubId: 'jita', quantity: 218, unitPrice: 18000, total: 3_924_000, fees: 58_860 }
		]);
		expect(blocks.total).toBeCloseTo(23_924_000, 4);
		expect(r.warnings).toContain('INPUT_VOLUME_SHORT');
	});

	it('prices every step line at the same blended unit price', () => {
		expect(lines.map((l) => l.quantity)).toEqual([614, 302, 302]);
		for (const l of lines) {
			expect(l.unitPrice).toBeCloseTo(blended, 8);
			expect(l.total).toBeCloseTo(l.quantity * blended, 4);
			expect(l.fees).toBeCloseTo(l.quantity * blended * 0.015, 4);
		}
	});

	it('step subtotals still add up to the totals', () => {
		const sum = (k: 'purchaseCost' | 'purchaseFees' | 'purchaseShipping' | 'total') =>
			nodes.reduce((a, n) => a + n.subtotal[k], 0);
		expect(sum('purchaseCost')).toBeCloseTo(r.totals.inputCost, 4);
		expect(sum('purchaseFees')).toBeCloseTo(r.totals.inputFees, 4);
		expect(sum('purchaseShipping')).toBeCloseTo(r.totals.inputShipping, 4);
		expect(sum('total')).toBeCloseTo(r.totals.totalCost, 4);
	});

	it('types the input hub does not price at all keep the old behaviour (Jita-only types missing)', () => {
		// Titanium etc. are not listed at the structure: no entry means unknown volume and no price.
		expect(r.missingPrices).toEqual([16635, 16636, 16638, 16641]);
	});
});

describe('planner', () => {
	const plan = (ctx: CalcContext, overrides: Partial<PlanInput> = {}) =>
		planReactions({
			ctx,
			totalSlots: 150,
			targets: [{ blueprintTypeId: 46204, lines: 1 }],
			buyInsteadOfBuild: [],
			stock: {},
			ownedFormulas: {},
			dailyVolumes: {},
			...overrides
		});

	it('shares the listed units across every reaction of the plan', () => {
		const p = plan(ctxWith());
		const blocks = p.purchasesPerCycle.find((i) => i.typeId === 4312)!;
		expect(blocks.quantity).toBe(1218);
		expect(blocks.availableAtInputHub).toBe(1000);
		expect(blocks.sources?.map((s) => [s.hubId, s.quantity])).toEqual([
			['local', 1000],
			['jita', 218]
		]);
		expect(blocks.total).toBeCloseTo(23_924_000, 4);
		expect(p.warnings).toContain('INPUT_VOLUME_SHORT');
	});

	it('initial purchases are split over their own (larger) quantity', () => {
		const p = plan(ctxWith());
		// Two cycles of intermediate blocks (2 × 604) plus one of the top job (614).
		const blocks = p.initialPurchases.find((i) => i.typeId === 4312)!;
		expect(blocks.quantity).toBe(1822);
		expect(blocks.sources?.map((s) => [s.hubId, s.quantity])).toEqual([
			['local', 1000],
			['jita', 822]
		]);
	});

	it('purchase volume share against the input hub region (market purchases only)', () => {
		const volumes = { inputDailyVolumes: { local: { 4312: 870 } } };
		const share = plan(ctxWith(), volumes).purchasesPerCycle.find((i) => i.typeId === 4312)!;
		// 1,218 per 7-day cycle = 174 per day = 20 % of 870.
		expect(share.dailyVolumeSharePct).toBeCloseTo(20, 10);
		expect(
			plan(ctxWith(), volumes).purchasesPerCycle.find((i) => i.typeId === 16638)!.dailyVolumeSharePct
		).toBeNull();
		const contract = plan(ctxWith({ inputMethod: 'contract' }), volumes);
		expect(contract.purchasesPerCycle.find((i) => i.typeId === 4312)!.dailyVolumeSharePct).toBeNull();
		expect(contract.warnings).not.toContain('INPUT_VOLUME_SHORT');
	});

	it('enough volume: no split and no warning', () => {
		const p = plan(ctxWith({}, local({ 4312: { sellVolume: 5000 } })));
		expect(p.purchasesPerCycle.find((i) => i.typeId === 4312)!.sources).toBeUndefined();
		expect(p.warnings).not.toContain('INPUT_VOLUME_SHORT');
	});
});
