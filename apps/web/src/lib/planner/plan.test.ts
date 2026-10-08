import { planReactions, type PlanInput } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { dataset, priceBook } from '../../../../../packages/engine/test/fixtures/dataset';
import { plannerData } from '../../test/planner';
import {
	FILL_SCOPES,
	FILL_SCOPE_IDS,
	buildBuyItems,
	dailyVolumes,
	fillOptions,
	hubDailyVolumes,
	inputMarket,
	inputVolumes,
	plannerContext,
	productVolumes,
	targetFootprint,
	volumeTypes
} from './plan';

const CRYSTALLINE_CARBONIDE = 46205;
const TITANIUM_CARBIDE = 46204;
const CARBON_POLYMERS = 16659;
const CRYSTALLITE_ALLOY = 16655;

const data = plannerData();
const input = (overrides: Partial<PlanInput> = {}): PlanInput => ({
	ctx: plannerContext(data, 7),
	totalSlots: 150,
	targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 }],
	buyInsteadOfBuild: [],
	stock: {},
	ownedFormulas: {},
	dailyVolumes: {},
	...overrides
});

describe('plannerContext', () => {
	it('uses the local cycle length and current prices for inputs and outputs', () => {
		const ctx = plannerContext(data, 3.5);
		expect(ctx.settings.cycleDays).toBe(3.5);
		expect(ctx.settings.mode).toBe(data.settings.mode);
		expect(ctx.inputPrices).toBe(data.prices);
		expect(ctx.outputPrices).toBe(data.prices);
	});

	it('prices inputs with the historical book when one is loaded', () => {
		const old = priceBook();
		const historical = plannerData({ inputPrices: old, inputsDaysAgo: 14 });
		const ctx = plannerContext(historical, 7);
		expect(ctx.inputPrices).toBe(old);
		expect(ctx.outputPrices).toBe(historical.prices);
	});
});

describe('productVolumes / dailyVolumes', () => {
	it('takes each product’s market from the region of its reactor’s output hub', () => {
		const volumes = { 10000002: { 16670: 900_000, 30306: 50 }, 10000043: { 16670: 1_234 } };
		const forge = productVolumes(plannerData({ volumes }));
		expect(forge[16670]).toEqual({ regionName: 'The Forge', volume: 900_000 });
		expect(forge[16659]).toEqual({ regionName: 'The Forge', volume: null });
		expect(dailyVolumes(forge)).toEqual({ 16670: 900_000, 30306: 50 });

		const amarr = {
			...data.profiles.composite,
			market: { ...data.profiles.composite.market, outputHub: 'amarr' }
		};
		const perReactor = productVolumes(
			plannerData({ volumes, profiles: { ...data.profiles, composite: amarr } })
		);
		expect(perReactor[16670]).toEqual({ regionName: 'Domain', volume: 1_234 });
		expect(perReactor[30306]).toEqual({ regionName: 'The Forge', volume: 50 });
		expect(dailyVolumes(perReactor)).toEqual({ 16670: 1_234, 30306: 50 });
	});

	it('leaves out products without statistics or a known output hub', () => {
		expect(dailyVolumes(productVolumes(plannerData({ volumes: {} })))).toEqual({});
		expect(productVolumes(plannerData({ hubs: [] }))).toEqual({});
		const unnamed = plannerData({
			hubs: [
				{
					hubId: 'jita',
					name: 'Jita 4-4',
					regionId: 10000002,
					regionName: null,
					private: false,
					structure: false
				}
			]
		});
		expect(productVolumes(unnamed)[16670].regionName).toBe('Region 10000002');
	});
});

describe('input volumes', () => {
	const structure = {
		hubId: 'structure-1',
		name: 'Seed Market',
		regionId: 10000043,
		regionName: 'Domain',
		private: true,
		structure: true
	};
	const withInputHub = (hubId: string, fallback = 'jita') =>
		Object.fromEntries(
			Object.entries(data.profiles).map(([reactor, p]) => [
				reactor,
				{ ...p, market: { ...p.market, inputHub: hubId, inputFallbackHub: fallback } }
			])
		) as typeof data.profiles;

	it('volumeTypes covers products and inputs only', () => {
		const types = volumeTypes(dataset);
		expect(types.has(16670)).toBe(true);
		expect(types.has(16640)).toBe(true);
		expect(types.has(46205)).toBe(false);
	});

	it('takes each input’s market from the region of the consuming reaction’s input hub', () => {
		const volumes = { 10000002: { 16640: 700 }, 10000043: { 16640: 70 } };
		expect(inputVolumes(plannerData({ volumes }))[16640]).toEqual({ regionName: 'The Forge', volume: 700 });
		const atStructure = plannerData({
			volumes,
			hubs: [...data.hubs, structure],
			profiles: withInputHub('structure-1')
		});
		expect(inputVolumes(atStructure)[16640]).toEqual({ regionName: 'Domain', volume: 70 });
		expect(inputVolumes(atStructure)[16633]).toEqual({ regionName: 'Domain', volume: null });
		expect(hubDailyVolumes(atStructure)).toEqual({
			jita: { 16640: 700 },
			amarr: { 16640: 70 },
			'structure-1': { 16640: 70 }
		});
	});

	it('inputMarket names the shared input and fallback hubs', () => {
		expect(inputMarket(data)).toEqual({ name: 'Jita 4-4', fallbackName: 'Jita 4-4', structure: false });
		const atStructure = plannerData({
			hubs: [...data.hubs, structure],
			profiles: withInputHub('structure-1', 'amarr')
		});
		expect(inputMarket(atStructure)).toEqual({ name: 'Seed Market', fallbackName: 'Amarr', structure: true });
		const mixed = plannerData({
			profiles: { ...data.profiles, hybrid: withInputHub('amarr').hybrid }
		});
		expect(inputMarket(mixed)).toBeNull();
	});
});

describe('fillOptions', () => {
	const picks = (scope: (typeof FILL_SCOPE_IDS)[number]) => {
		const allowed = fillOptions(scope, 10).allowed;
		return allowed ? dataset.reactions.filter(allowed).map((r) => r.tier) : null;
	};

	it('maps every scope to engine options with the volume cap', () => {
		expect(FILL_SCOPE_IDS.map((id) => FILL_SCOPES[id].label)).toEqual([
			'All',
			'Composite chains',
			'Composites, buying intermediates',
			'Intermediates',
			'Biochemical: Strong / Improved boosters',
			'Molecular-Forged',
			'Hybrid polymers'
		]);
		expect(fillOptions('all', 10)).toEqual({ maxVolumeSharePct: 10, buyIntermediates: false });
		expect(new Set(picks('composite_chains'))).toEqual(new Set(['composite']));
		expect(fillOptions('composite_buy', 25)).toMatchObject({ maxVolumeSharePct: 25, buyIntermediates: true });
		expect(new Set(picks('composite_buy'))).toEqual(new Set(['composite']));
		expect(new Set(picks('intermediates'))).toEqual(new Set(['intermediate']));
		expect(new Set(picks('boosters'))).toEqual(new Set(['booster_strong', 'booster_improved']));
		expect(picks('molecular_forged')).toEqual([]);
		expect(new Set(picks('polymers'))).toEqual(new Set(['polymer']));
	});
});

describe('buildBuyItems', () => {
	it('lists every intermediate the plan builds, by name', () => {
		const plan = planReactions(input());
		expect(buildBuyItems(plan, [], data.dataset)).toEqual([
			{ typeId: CARBON_POLYMERS, name: 'Carbon Polymers', buy: false },
			{ typeId: CRYSTALLITE_ALLOY, name: 'Crystallite Alloy', buy: false }
		]);
	});

	it('keeps bought intermediates listed while a planned reaction consumes them', () => {
		const buy = [CARBON_POLYMERS];
		const plan = planReactions(input({ buyInsteadOfBuild: buy }));
		expect(buildBuyItems(plan, buy, data.dataset)).toEqual([
			{ typeId: CARBON_POLYMERS, name: 'Carbon Polymers', buy: true },
			{ typeId: CRYSTALLITE_ALLOY, name: 'Crystallite Alloy', buy: false }
		]);

		const other = planReactions(input({ targets: [{ blueprintTypeId: TITANIUM_CARBIDE, lines: 1 }] }));
		expect(buildBuyItems(other, buy, data.dataset).map((i) => i.name)).toEqual([
			'Silicon Diborite',
			'Titanium Chromide'
		]);
	});
});

describe('targetFootprint', () => {
	it('counts the slots of one line and of all lines of a target on its own', () => {
		expect(targetFootprint(input(), { blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 })).toEqual({
			perLine: 3,
			total: 4,
			finalSlots: 2,
			unitsPerLine: 1_260_000
		});
		expect(targetFootprint(input(), { blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1 })).toMatchObject({
			perLine: 3,
			total: 3,
			finalSlots: 1
		});
	});

	it('plans quantity targets: 35,280,000 Crystalline Carbonide = 28 final slots, 56 in total', () => {
		expect(
			targetFootprint(input(), { blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 35_280_000 })
		).toEqual({ perLine: 3, total: 56, finalSlots: 28, unitsPerLine: 1_260_000 });
	});

	it('follows the build/buy choices', () => {
		const bought = input({ buyInsteadOfBuild: [CARBON_POLYMERS, CRYSTALLITE_ALLOY] });
		expect(targetFootprint(bought, { blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 })).toMatchObject({
			perLine: 1,
			total: 2,
			finalSlots: 2
		});
	});
});
