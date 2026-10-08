import {
	DEFAULT_SETTINGS,
	listReactions,
	type CalcContext,
	type ReactionResult,
	type ReactionRow,
	type ResolvedProfile
} from '@reactions/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSde, marketFor } from '../../test/fixtures';
import {
	boardList,
	dailyProfits,
	finalRows,
	HOME_LIST_SIZE,
	HOME_MAX_SHARE_PCT,
	HOME_MIN_INPUT_MOVE_PCT,
	inputMoves,
	marketCapacity,
	rawInputs
} from './home';
import type { HubInfo } from './hubs';
import type { MarketStat } from './planner';
import { buildPriceBook } from './prices';

const JITA_REGION = 10000002;
let ctx: CalcContext;
let rows: ReactionRow[];

const profile = (): ResolvedProfile => ({
	...DEFAULT_SETTINGS.shared,
	securityBand: 'lowsec',
	costIndex: 0.0412,
	systemName: 'Ignoitton',
	costIndexMissing: false
});

const hubs: HubInfo[] = [
	{
		hubId: 'jita',
		name: 'Jita 4-4',
		kind: 'station',
		regionId: JITA_REGION,
		systemId: 30000142,
		locationId: 60003760,
		private: false
	}
];

beforeAll(async () => {
	const sde = await loadSde();
	const book = buildPriceBook(marketFor(sde));
	ctx = {
		dataset: sde.dataset,
		profiles: { composite: profile(), biochemical: profile(), hybrid: profile() },
		settings: DEFAULT_SETTINGS,
		inputPrices: book,
		outputPrices: book
	};
	rows = listReactions(ctx, { tier: 'composite' });
});

const withProfit = (result: ReactionResult, profitPerSlotDay: number | null): ReactionResult => ({
	...result,
	totals: { ...result.totals, profitPerSlotDay }
});

/** `row` with the given buy-inputs and full-chain profits/slot/day. */
const day = (row: ReactionRow, single: number | null, chain: number | null = single): ReactionRow => ({
	...row,
	single: withProfit(row.single, single),
	chain: row.chain ? withProfit(row.chain, chain) : null
});

const typeId = (name: string) =>
	Number(Object.values(ctx.dataset.types).find((t) => t.name === name)!.typeId);

const perSlotDay = (result: ReactionResult) =>
	result.outputs[0].quantity / (result.totals.slotSeconds / 86_400);

/** Region statistics where one slot of `result` is `pct`% of the daily volume. */
const shareStat = (result: ReactionResult, pct: number): MarketStat => {
	const volume = (perSlotDay(result) * 100) / pct;
	return { volume30d: volume, volume7d: volume, price5d: 1, price30d: 1 };
};

describe('finalRows', () => {
	it('lists only final products: composites, boosters, molecular-forged and polymers', async () => {
		const tiers = new Set(finalRows(ctx).map((r) => r.reaction.tier));
		expect([...tiers].sort()).toEqual([
			'booster_improved',
			'booster_standard',
			'booster_strong',
			'booster_synth',
			'composite',
			'molecular_forged',
			'polymer'
		]);
	});
});

describe('dailyProfits', () => {
	it('averages each view over the days with a profit and counts the profitable ones', () => {
		const [a] = rows;
		const days = [[day(a, 10, 40)], [day(a, -4, 20)], [day(a, null, -30)], [day(a, 6, 50)]];
		expect(dailyProfits(days, 'single', DEFAULT_SETTINGS).get(a.reaction.blueprintTypeId)).toEqual({
			days: 3,
			profitableDays: 2,
			average: 4
		});
		expect(dailyProfits(days, 'chain', DEFAULT_SETTINGS).get(a.reaction.blueprintTypeId)).toEqual({
			days: 4,
			profitableDays: 3,
			average: 20
		});
	});

	it('uses buying the inputs for the chain view of a reaction without a chain', () => {
		const polymer = listReactions(ctx, { tier: 'polymer' })[0];
		expect(polymer.chain).toBeNull();
		const profits = dailyProfits([[day(polymer, 7)]], 'chain', DEFAULT_SETTINGS);
		expect(profits.get(polymer.reaction.blueprintTypeId)?.average).toBe(7);
	});
});

describe('marketCapacity', () => {
	it('takes the lower of the 30-day and 7-day volume, 0 for an untraded type, null without statistics', () => {
		const result = rows[0].single;
		const product = result.outputs[0].typeId;
		const perDay = perSlotDay(result);
		const ten = (perDay * 100) / HOME_MAX_SHARE_PCT;
		expect(
			marketCapacity(result, {
				[product]: { volume30d: 50 * ten, volume7d: 3 * ten, price5d: 1, price30d: 1 }
			})
		).toEqual({ slots: 3, perSlotDay: perDay, volume: 3 * ten });
		expect(
			marketCapacity(result, { [product]: { volume30d: 2 * ten, volume7d: null, price5d: 1, price30d: 1 } })
				.slots
		).toBe(2);
		expect(marketCapacity(result, {}).slots).toBe(0);
		expect(marketCapacity(result, undefined)).toEqual({ slots: null, perSlotDay: perDay, volume: null });
	});
});

describe('boardList', () => {
	it('keeps products profitable on average and on at least half of the days, best average first', () => {
		const [steady, half, mostlyLosing, negative, best] = rows;
		const days = [
			[day(steady, 5), day(half, 30), day(mostlyLosing, 90), day(negative, -1), day(best, 8)],
			[day(steady, 5), day(half, -1), day(mostlyLosing, -1), day(negative, -1), day(best, 8)],
			[day(steady, 5), day(half, 30), day(mostlyLosing, -1), day(negative, 1), day(best, 8)],
			[day(steady, 5), day(half, -1), day(mostlyLosing, -1), day(negative, -1), day(best, 8)]
		];
		const list = boardList(
			[steady, half, mostlyLosing, negative, best],
			dailyProfits(days, 'single', DEFAULT_SETTINGS),
			'single',
			undefined,
			DEFAULT_SETTINGS
		);
		expect(list.items.map((i) => [i.slug, i.average, i.profitableDays, i.days])).toEqual([
			[half.reaction.slug, 14.5, 2, 4],
			[best.reaction.slug, 8, 4, 4],
			[steady.reaction.slug, 5, 4, 4]
		]);
		expect(list.thin).toBe(0);
		expect(list.items[0]).toMatchObject({
			slots: null,
			volume: null,
			now: half.single.totals.profitPerSlotDay
		});
	});

	it('leaves out products one slot would flood and counts them', () => {
		const [liquid, edge, thin, untraded] = rows;
		const region = {
			[liquid.single.outputs[0].typeId]: shareStat(liquid.single, 1),
			[edge.single.outputs[0].typeId]: shareStat(edge.single, HOME_MAX_SHARE_PCT),
			[thin.single.outputs[0].typeId]: shareStat(thin.single, HOME_MAX_SHARE_PCT * 1.01)
		};
		const four = [liquid, edge, thin, untraded];
		const list = boardList(
			four,
			dailyProfits([four.map((r) => day(r, 1))], 'single', DEFAULT_SETTINGS),
			'single',
			region,
			DEFAULT_SETTINGS
		);
		expect(list.items.map((i) => [i.slug, i.slots])).toEqual([
			[liquid.reaction.slug, 10],
			[edge.reaction.slug, 1]
		]);
		expect(list.thin).toBe(2);
	});

	it('ranks full chains with their own numbers and marks reactions without a chain', () => {
		const [composite] = rows;
		const polymer = listReactions(ctx, { tier: 'polymer' })[0];
		const profits = dailyProfits([[day(composite, 1, 9), day(polymer, 4)]], 'chain', DEFAULT_SETTINGS);
		const list = boardList([composite, polymer], profits, 'chain', undefined, DEFAULT_SETTINGS);
		expect(list.items.map((i) => [i.slug, i.variant, i.chainable, i.average])).toEqual([
			[composite.reaction.slug, 'chain', true, 9],
			[polymer.reaction.slug, 'single', false, 4]
		]);
		expect(list.items[0].now).toBe(composite.chain!.totals.profitPerSlotDay);
	});

	it('ranks the full chain with its unrefined routes only when the setting asks for them', () => {
		const fermionic = rows.find((r) => r.reaction.slug === 'fermionic-condensates')!;
		const routed = { ...fermionic, unrefined: withProfit(fermionic.chain!, 50) };
		const days = [[{ ...day(fermionic, 1, 3), unrefined: routed.unrefined }]];
		const best = { ...DEFAULT_SETTINGS, unrefinedInChains: 'best' as const };
		const off = boardList(
			[routed],
			dailyProfits(days, 'chain', DEFAULT_SETTINGS),
			'chain',
			undefined,
			DEFAULT_SETTINGS
		);
		expect(off.items.map((i) => [i.average, i.unrefined, i.unrefinable])).toEqual([[3, false, true]]);
		const on = boardList([routed], dailyProfits(days, 'chain', best), 'chain', undefined, best);
		expect(on.items.map((i) => [i.average, i.variant, i.unrefined])).toEqual([[50, 'chain', true]]);
	});

	it(`lists at most ${HOME_LIST_SIZE} products`, () => {
		const list = boardList(
			rows,
			dailyProfits([rows.map((r) => day(r, 1))], 'single', DEFAULT_SETTINGS),
			'single',
			undefined,
			DEFAULT_SETTINGS
		);
		expect(list.items).toHaveLength(HOME_LIST_SIZE);
	});
});

describe('input prices', () => {
	it('collects the raw materials of the full chains, not the intermediates built in them', () => {
		const composite = rawInputs(ctx.dataset, ['composite']);
		expect(composite.has(typeId('Hydrocarbons'))).toBe(true);
		expect(composite.has(typeId('Nitrogen Fuel Block'))).toBe(true);
		expect(composite.has(typeId('Titanium Chromide'))).toBe(false);
		expect(rawInputs(ctx.dataset, ['polymer']).has(typeId('Hydrocarbons'))).toBe(false);
	});

	it('lists the largest 5-day vs 30-day moves in the input hub region, ignoring small ones', () => {
		const stat = (price5d: number, price30d: number): MarketStat => ({
			volume30d: 1,
			volume7d: 1,
			price5d,
			price30d
		});
		const stats = {
			[JITA_REGION]: {
				[typeId('Hydrocarbons')]: stat(120, 100),
				[typeId('Vanadium')]: stat(105, 100),
				[typeId('Evaporite Deposits')]: stat(80, 100),
				[typeId('Tritanium')]: stat(3, 4),
				[typeId('Silicates')]: stat(100 + HOME_MIN_INPUT_MOVE_PCT / 2, 100),
				// An intermediate: built in the chains, not bought.
				[typeId('Titanium Chromide')]: stat(200, 100)
			}
		};
		const moves = inputMoves(ctx, hubs, stats);
		const pct = (n: number) => Number(n.toFixed(6));
		expect(moves.up.map((m) => [m.name, pct(m.pct)])).toEqual([
			['Hydrocarbons', 20],
			['Vanadium', 5]
		]);
		expect(moves.down.map((m) => [m.name, pct(m.pct), m.reactors])).toEqual([
			['Tritanium', -25, ['biochemical', 'hybrid']],
			['Evaporite Deposits', -20, ['composite']]
		]);
		expect(inputMoves(ctx, hubs, {})).toEqual({ up: [], down: [] });
	});
});
