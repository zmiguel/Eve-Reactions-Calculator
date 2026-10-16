import { describe, expect, it } from 'vitest';
import {
	inventoryRole,
	inventoryTypeIds,
	isMaterialBlueprint,
	stockUnitValue,
	trackedTypeIds
} from '../src/inventory.ts';
import type { ResolvedProfile } from '../src/settings.ts';
import type { Dataset, Reactor } from '../src/types.ts';
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

describe('trackedTypeIds', () => {
	const OXYGEN_FUEL_BLOCK_BLUEPRINT = 4313;
	const OXYGEN_ISOTOPES = 17887;
	const ROBOTICS = 9848;
	const SPIKE_S_BLUEPRINT = 12619;
	const SPIKE_S = 12618;
	const withBlueprints: Dataset = {
		...dataset,
		manufacturing: [
			{
				blueprintTypeId: OXYGEN_FUEL_BLOCK_BLUEPRINT,
				productTypeId: OXYGEN_FUEL_BLOCK,
				productQuantity: 40,
				makes: 'material',
				materials: [
					{ typeId: OXYGEN_ISOTOPES, quantity: 450 },
					{ typeId: ROBOTICS, quantity: 1 }
				]
			},
			{
				blueprintTypeId: SPIKE_S_BLUEPRINT,
				productTypeId: SPIKE_S,
				productQuantity: 5000,
				materials: [{ typeId: TITANIUM_CARBIDE, quantity: 150 }]
			}
		]
	};

	it('adds the fuel block blueprints and all their materials to the inventory types', () => {
		const tracked = trackedTypeIds(withBlueprints);
		const added = [...tracked]
			.filter((id) => !inventoryTypeIds(withBlueprints).has(id))
			.sort((a, b) => a - b);
		expect(added).toEqual([OXYGEN_FUEL_BLOCK_BLUEPRINT, ROBOTICS, OXYGEN_ISOTOPES]);
		for (const id of inventoryTypeIds(withBlueprints)) expect(tracked.has(id)).toBe(true);
	});

	it('leaves out blueprints that only use reaction products, and their products', () => {
		const tracked = trackedTypeIds(withBlueprints);
		expect(tracked.has(SPIKE_S_BLUEPRINT)).toBe(false);
		expect(tracked.has(SPIKE_S)).toBe(false);
		expect(inventoryTypeIds(withBlueprints).has(OXYGEN_ISOTOPES)).toBe(false);
	});

	it('tells material-making blueprints apart', () => {
		expect(isMaterialBlueprint(withBlueprints, OXYGEN_FUEL_BLOCK_BLUEPRINT)).toBe(true);
		expect(isMaterialBlueprint(withBlueprints, SPIKE_S_BLUEPRINT)).toBe(false);
		expect(isMaterialBlueprint(dataset, OXYGEN_FUEL_BLOCK_BLUEPRINT)).toBe(false);
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
