import { describe, expect, it } from 'vitest';
import { inventoryRole, inventoryTypeIds, stockUnitValue } from '../src/inventory.ts';
import type { ResolvedProfile } from '../src/settings.ts';
import type { Reactor } from '../src/types.ts';
import { makeCtx, resolved } from './fixtures/context.ts';
import { dataset, jitaPrices, priceBook } from './fixtures/dataset.ts';

const CAESARIUM_CADMIDE_FORMULA = 46166;
const OXYGEN_FUEL_BLOCK = 4312;
const TITANIUM = 16638;
const TITANIUM_CHROMIDE = 16654;
const TITANIUM_CARBIDE = 16671;
const UNREFINED_HEXITE = 32825;
const HEXITE = 16665; // only reached by reprocessing Unrefined Hexite
const TRITANIUM = 34; // only reached by reprocessing Unrefined Tritanium (Prismaticite tier)
const RIFTER = 587; // a ship: no reaction uses it

describe('inventoryTypeIds', () => {
	it('holds formulas, fuel blocks, materials and products', () => {
		const ids = inventoryTypeIds(dataset);
		for (const id of [
			CAESARIUM_CADMIDE_FORMULA,
			OXYGEN_FUEL_BLOCK,
			TITANIUM,
			TITANIUM_CHROMIDE,
			TITANIUM_CARBIDE
		]) {
			expect(ids.has(id)).toBe(true);
		}
	});

	it('holds the reprocessed outputs of unrefined products', () => {
		const ids = inventoryTypeIds(dataset);
		expect(ids.has(HEXITE)).toBe(true);
		expect(ids.has(TRITANIUM)).toBe(true);
	});

	it('leaves out types no reaction touches', () => {
		expect(inventoryTypeIds(dataset).has(RIFTER)).toBe(false);
	});
});

describe('inventoryRole', () => {
	it.each([
		[CAESARIUM_CADMIDE_FORMULA, 'formula'],
		[OXYGEN_FUEL_BLOCK, 'fuel'],
		[TITANIUM, 'raw'],
		[HEXITE, 'raw'],
		[TITANIUM_CHROMIDE, 'intermediate'],
		[TITANIUM_CARBIDE, 'product'],
		[UNREFINED_HEXITE, 'product'],
		[RIFTER, null]
	] as const)('type %i is %s', (typeId, role) => {
		expect(inventoryRole(dataset, typeId)).toBe(role);
	});
});

describe('stockUnitValue', () => {
	const market = {
		outputHub: 'jita',
		outputMethod: 'sell_order',
		brokerFeePct: 3,
		salesTaxPct: 4,
		outputPricePct: 100
	} as const;
	const off = { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 };

	it('values a product at its output price net of broker fee and sales tax', () => {
		const ctx = makeCtx({ profile: { market, shipping: { output: off } } });
		expect(stockUnitValue(ctx, TITANIUM_CARBIDE)).toBeCloseTo(1650 * 0.93, 6);
		expect(stockUnitValue(ctx, TITANIUM_CHROMIDE)).toBeCloseTo(66000 * 0.93, 6);
	});

	it('values an input-only type with the profile of the first reaction consuming it', () => {
		const consumer = dataset.reactions
			.filter((r) => r.materials.some((m) => m.typeId === OXYGEN_FUEL_BLOCK))
			.sort((a, b) => a.blueprintTypeId - b.blueprintTypeId)[0];
		const elsewhere = resolved({ market: { ...market, outputHub: 'nowhere' } });
		const profiles: Record<Reactor, ResolvedProfile> = {
			biochemical: elsewhere,
			composite: elsewhere,
			hybrid: elsewhere
		};
		profiles[consumer.reactor] = resolved({
			market: { ...market, outputMethod: 'instant' },
			shipping: { output: off }
		});
		const ctx = makeCtx({ profiles });
		expect(stockUnitValue(ctx, OXYGEN_FUEL_BLOCK)).toBeCloseTo(18000 * 0.96, 6);
	});

	it('deducts output shipping when it is on', () => {
		const ctx = makeCtx({
			profile: {
				market,
				shipping: { output: { enabled: true, iskPerM3: 1000, collateralPct: 1, discountPct: 0 } }
			}
		});
		// 0.2 m3 × 1000 ISK + 1 % collateral of 66000.
		expect(stockUnitValue(ctx, TITANIUM_CHROMIDE)).toBeCloseTo(66000 * 0.93 - 200 - 660, 6);
	});

	it('is null without a price', () => {
		const prices = { ...jitaPrices };
		delete prices[TITANIUM_CARBIDE];
		const ctx = makeCtx({ profile: { market }, outputPrices: priceBook({ jita: prices }) });
		expect(stockUnitValue(ctx, TITANIUM_CARBIDE)).toBeNull();
	});

	it('is null for a type no reaction makes or consumes', () => {
		expect(stockUnitValue(makeCtx({ profile: { market } }), RIFTER)).toBeNull();
	});
});
