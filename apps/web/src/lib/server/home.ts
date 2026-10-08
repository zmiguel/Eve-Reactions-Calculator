import {
	chainFor,
	listReactions,
	producerIndex,
	type CalcContext,
	type Dataset,
	type PriceBook,
	type ReactionResult,
	type ReactionRow,
	type Reactor,
	type Settings,
	type Tier
} from '@reactions/engine';
import type {
	BoardList,
	BuildItem,
	BuildView,
	HomeWindow,
	InputMove,
	ReactorBoard
} from '$lib/components/home/types';
import type { HubInfo } from './hubs.ts';
import { DAY_MS } from './listing.ts';
import type { MarketStat } from './planner.ts';
import { getDailyHubPrices, isoDate } from './prices.ts';

/** Recent days the boards average over (the latest days with data before today, UTC). */
export const HOME_DAYS = 7;
/** A product is listed only when one slot's daily output is at most this share of the region's daily trade. */
export const HOME_MAX_SHARE_PCT = 10;
export const HOME_LIST_SIZE = 10;
export const HOME_INPUT_LIST_SIZE = 10;
/** Input price moves smaller than this (5-day vs 30-day average, in %) are not listed. */
export const HOME_MIN_INPUT_MOVE_PCT = 1;

/**
 * Final products of each reactor (board order), the ones builders sell. Unrefined products hardly trade
 * (their value is reprocessing) and intermediates are built inside the composite chains; both stay on
 * the reactor pages.
 */
export const HOME_TIERS: Record<Reactor, readonly Tier[]> = {
	composite: ['composite'],
	biochemical: [
		'booster_synth',
		'booster_standard',
		'booster_improved',
		'booster_strong',
		'molecular_forged'
	],
	hybrid: ['polymer']
};
const HOME_REACTORS = Object.keys(HOME_TIERS) as Reactor[];

export type MarketStats = Record<number, Record<number, MarketStat>>;

/** Rows of every final product (`HOME_TIERS`), priced with `ctx`. */
export function finalRows(ctx: CalcContext): ReactionRow[] {
	// The boards show no Using unrefined tab: that variant only matters when the setting ranks with it.
	const unrefined = ctx.settings.unrefinedInChains === 'best';
	return HOME_REACTORS.flatMap((reactor) =>
		HOME_TIERS[reactor].flatMap((tier) => listReactions(ctx, { tier }, {}, { unrefined }))
	);
}

/** Hubs the visitor's profiles buy at or sell to. */
export function profileHubs(ctx: CalcContext, hubs: HubInfo[]): HubInfo[] {
	const used = new Set<string>();
	for (const reactor of HOME_REACTORS) {
		const m = ctx.profiles[reactor].market;
		used.add(m.inputHub);
		used.add(m.inputFallbackHub);
		used.add(m.outputHub);
	}
	return hubs.filter((h) => used.has(h.hubId));
}

export interface RecentListings {
	/** `null` when no recent day has prices. */
	window: HomeWindow | null;
	/** Final-product rows of each day, oldest first. */
	days: ReactionRow[][];
}

/**
 * Final-product listings priced with each of the last `HOME_DAYS` UTC days that have daily prices
 * before the day of `asOf` (one extra day is read, as yesterday's rollup lands with the daily run). They
 * use the visitor's profiles with the current cost index and adjusted prices, so only market prices differ.
 */
export async function recentListings(
	env: Pick<Env, 'HISTORY_DB'>,
	ctx: CalcContext,
	hubs: HubInfo[],
	asOf: number
): Promise<RecentListings> {
	const prices = await getDailyHubPrices(
		env,
		isoDate(asOf - (HOME_DAYS + 1) * DAY_MS),
		isoDate(asOf - DAY_MS),
		profileHubs(ctx, hubs),
		ctx.dataset
	);
	const dates = [...prices.keys()].sort().slice(-HOME_DAYS);
	if (dates.length === 0) return { window: null, days: [] };
	const adjusted = ctx.inputPrices.adjusted;
	const days = dates.map((date) => {
		const day = prices.get(date)!;
		const book: PriceBook = { asOf: date, approximate: day.approximate, hubs: day.hubs, adjusted };
		return finalRows({ ...ctx, inputPrices: book, outputPrices: book });
	});
	return {
		window: {
			from: dates[0],
			to: dates[dates.length - 1],
			days: dates.length,
			approximate: dates.some((d) => prices.get(d)!.approximate)
		},
		days
	};
}

/**
 * The result a board view ranks: the full chain where the reaction has one (with its unrefined routes
 * when the visitor's `unrefinedInChains` is `best`, see `chainFor`), else buying the inputs.
 */
function resultFor(row: ReactionRow, view: BuildView, settings: Settings): ReactionResult {
	return view === 'chain' ? (chainFor(row, settings) ?? row.single) : row.single;
}

export interface DailyProfit {
	/** Days with a profit (every price known). */
	days: number;
	profitableDays: number;
	/** Mean profit/slot/day over those days. */
	average: number;
}

/** Per blueprint: profit/slot/day of the `view` result over the given days. */
export function dailyProfits(
	days: ReactionRow[][],
	view: BuildView,
	settings: Settings
): Map<number, DailyProfit> {
	const result = new Map<number, DailyProfit>();
	for (const rows of days)
		for (const row of rows) {
			const profit = resultFor(row, view, settings).totals.profitPerSlotDay;
			if (profit === null) continue;
			const id = row.reaction.blueprintTypeId;
			const p = result.get(id) ?? { days: 0, profitableDays: 0, average: 0 };
			// Running mean: `average` holds the sum until the end.
			p.days++;
			if (profit > 0) p.profitableDays++;
			p.average += profit;
			result.set(id, p);
		}
	for (const p of result.values()) p.average /= p.days;
	return result;
}

export interface MarketCapacity {
	/** Whole slots the region's trade absorbs; `null` without statistics for the region. */
	slots: number | null;
	perSlotDay: number;
	volume: number | null;
}

/**
 * How many slots of `result` the region's trade absorbs: `HOME_MAX_SHARE_PCT` of the lower of its 30-day
 * and 7-day average daily volume over one slot's daily output, for the sold output that fills up first. A
 * type the region never traded has volume 0.
 */
export function marketCapacity(
	result: ReactionResult,
	region: Record<number, MarketStat> | undefined
): MarketCapacity {
	const slotDays = result.totals.slotSeconds / (DAY_MS / 1000);
	let capacity: MarketCapacity | null = null;
	for (const o of result.outputs) {
		if (o.quantity <= 0 || slotDays <= 0) continue;
		const perSlotDay = o.quantity / slotDays;
		if (!region) return { slots: null, perSlotDay, volume: null };
		const s = region[o.typeId];
		const volume = s ? Math.min(s.volume30d, s.volume7d ?? s.volume30d) : 0;
		// The tolerance keeps an exact share (e.g. 10.000000000000002 %) on its whole slot.
		const slots = Math.floor((volume * HOME_MAX_SHARE_PCT) / 100 / perSlotDay + 1e-9);
		if (!capacity || slots < capacity.slots!) capacity = { slots, perSlotDay, volume };
	}
	return capacity ?? { slots: null, perSlotDay: 0, volume: null };
}

/**
 * Final products worth building in one view: profitable on average and on at least half of the days,
 * and the market absorbs at least one slot (unknown capacity does not filter). Highest average first.
 */
export function boardList(
	nowRows: ReactionRow[],
	profits: Map<number, DailyProfit>,
	view: BuildView,
	region: Record<number, MarketStat> | undefined,
	settings: Settings,
	n = HOME_LIST_SIZE
): BoardList {
	const items: BuildItem[] = [];
	let thin = 0;
	for (const row of nowRows) {
		const p = profits.get(row.reaction.blueprintTypeId);
		if (!p || p.average <= 0 || p.profitableDays * 2 < p.days) continue;
		const result = resultFor(row, view, settings);
		const market = marketCapacity(result, region);
		if (market.slots !== null && market.slots < 1) {
			thin++;
			continue;
		}
		items.push({
			blueprintTypeId: row.reaction.blueprintTypeId,
			slug: row.reaction.slug,
			name: row.reaction.name,
			productTypeId: row.reaction.product.typeId,
			variant: result === row.chain || result === row.unrefined ? 'chain' : 'single',
			unrefined: result === row.unrefined,
			unrefinable: row.unrefined !== null,
			chainable: row.chain !== null,
			average: p.average,
			days: p.days,
			profitableDays: p.profitableDays,
			now: result.totals.profitPerSlotDay,
			...market
		});
	}
	items.sort((a, b) => b.average - a.average);
	return { items: items.slice(0, n), thin };
}

/** Boards of every reactor (`HOME_TIERS` order); each judges its market in its output hub's region. */
export function reactorBoards(
	ctx: CalcContext,
	hubs: HubInfo[],
	stats: MarketStats,
	nowRows: ReactionRow[],
	days: ReactionRow[][]
): ReactorBoard[] {
	const regionOf = new Map(hubs.map((h) => [h.hubId, h.regionId]));
	const single = dailyProfits(days, 'single', ctx.settings);
	const chain = dailyProfits(days, 'chain', ctx.settings);
	return HOME_REACTORS.map((reactor) => {
		const rows = nowRows.filter((r) => r.reaction.reactor === reactor);
		const regionId = regionOf.get(ctx.profiles[reactor].market.outputHub);
		const region = regionId === undefined ? undefined : stats[regionId];
		return {
			reactor,
			single: boardList(rows, single, 'single', region, ctx.settings),
			chain: rows.some((r) => r.chain) ? boardList(rows, chain, 'chain', region, ctx.settings) : null
		};
	});
}

/** Materials bought for the full chains of `tiers`: the inputs no reaction produces. */
export function rawInputs(dataset: Dataset, tiers: readonly Tier[]): Set<number> {
	const producers = producerIndex(dataset);
	const raw = new Set<number>();
	const seen = new Set<number>();
	const visit = (typeId: number) => {
		if (seen.has(typeId)) return;
		seen.add(typeId);
		const producer = producers.get(typeId);
		if (!producer) raw.add(typeId);
		else for (const m of producer.materials) visit(m.typeId);
	};
	for (const reaction of dataset.reactions)
		if (tiers.includes(reaction.tier)) for (const m of reaction.materials) visit(m.typeId);
	return raw;
}

/**
 * Raw inputs of the final products whose regional average price moved most: last 5 days against 30
 * days, in the region of each reactor's input hub. Largest rises and largest falls.
 */
export function inputMoves(
	ctx: CalcContext,
	hubs: HubInfo[],
	stats: MarketStats,
	n = HOME_INPUT_LIST_SIZE
): { up: InputMove[]; down: InputMove[] } {
	const regionOf = new Map(hubs.map((h) => [h.hubId, h.regionId]));
	const moves = new Map<string, InputMove>();
	for (const reactor of HOME_REACTORS) {
		const regionId = regionOf.get(ctx.profiles[reactor].market.inputHub);
		const region = regionId === undefined ? undefined : stats[regionId];
		if (!region) continue;
		for (const typeId of rawInputs(ctx.dataset, HOME_TIERS[reactor])) {
			const key = `${regionId}:${typeId}`;
			const known = moves.get(key);
			if (known) {
				known.reactors.push(reactor);
				continue;
			}
			const s = region[typeId];
			if (!s || s.price5d <= 0 || s.price30d <= 0) continue;
			const pct = (s.price5d / s.price30d - 1) * 100;
			if (Math.abs(pct) < HOME_MIN_INPUT_MOVE_PCT) continue;
			moves.set(key, {
				typeId,
				name: ctx.dataset.types[typeId]?.name ?? `Type ${typeId}`,
				price5d: s.price5d,
				price30d: s.price30d,
				pct,
				reactors: [reactor]
			});
		}
	}
	const all = [...moves.values()];
	return {
		up: all
			.filter((m) => m.pct > 0)
			.sort((a, b) => b.pct - a.pct)
			.slice(0, n),
		down: all
			.filter((m) => m.pct < 0)
			.sort((a, b) => a.pct - b.pct)
			.slice(0, n)
	};
}
