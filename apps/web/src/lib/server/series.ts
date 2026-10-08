import { esiMarketHistory, getHistoryDb, priceDaily } from '@reactions/db';
import {
	calculateAllocated,
	producerIndex,
	unrefinedIndex,
	type AllocationOptions,
	type CalcContext,
	type OutputMode,
	type PriceBook,
	type Reaction,
	type View
} from '@reactions/engine';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { isoDate } from './prices.ts';

export const SERIES_RANGES = ['30d', '90d', '1y', 'all'] as const;
export type SeriesRange = (typeof SERIES_RANGES)[number];
export const DEFAULT_SERIES_RANGE: SeriesRange = '30d';

const RANGE_DAYS: Record<SeriesRange, number | null> = { '30d': 30, '90d': 90, '1y': 365, all: null };
const DAY_MS = 86_400_000;

export interface SeriesPoint {
	date: string;
	profitPerSlotDay: number | null;
	/** Gross value of the job's outputs (null when any output lacks a price that day). */
	outputValue: number | null;
	/** Input purchase cost of the job (null when any input lacks a price that day). */
	inputCost: number | null;
	/** Some prices of the day are the region's average trade price (no collected hub prices). */
	approximate: boolean;
}

/** Units of a type traded per day in a region (ESI market history). */
export interface VolumePoint {
	date: string;
	volume: number;
}

/** Detail-page calculation options; pass the current `runs`/`lines` so every day prices the same jobs. */
export interface SeriesOptions extends AllocationOptions {
	view: View;
	outputMode: OutputMode;
	runs?: number;
	now?: number;
	/** Hub id → region id: types without collected hub prices that day use the region's average price. */
	hubRegions?: Record<string, number>;
}

/** First date (YYYY-MM-DD) of `range` counted back from `now`, or null for all history. */
export function seriesStartDate(range: SeriesRange, now: number): string | null {
	const days = RANGE_DAYS[range];
	return days === null ? null : isoDate(now - days * DAY_MS);
}

/**
 * Every type the engine prices for this reaction/view (a chain's unrefined routes and their reprocessed
 * materials included), plus the reactors whose hubs it uses.
 */
function relevantTypes(reaction: Reaction, ctx: CalcContext, opts: SeriesOptions) {
	const producers = producerIndex(ctx.dataset);
	const alternatives = unrefinedIndex(ctx.dataset);
	const types = new Set<number>();
	const reactors = new Set([reaction.reactor]);
	const visit = (r: Reaction, seen: Set<number>) => {
		reactors.add(r.reactor);
		types.add(r.product.typeId);
		for (const m of r.materials) {
			types.add(m.typeId);
			if (opts.view === 'single') continue;
			const alt = alternatives.get(m.typeId);
			for (const o of alt ? (ctx.dataset.reprocess[alt.product.typeId]?.materials ?? []) : [])
				types.add(o.typeId);
			for (const sub of [producers.get(m.typeId), alt])
				if (sub && !seen.has(sub.blueprintTypeId)) visit(sub, new Set(seen).add(sub.blueprintTypeId));
		}
	};
	visit(reaction, new Set([reaction.blueprintTypeId]));
	if (opts.outputMode === 'reprocessed') {
		for (const m of ctx.dataset.reprocess[reaction.product.typeId]?.materials ?? []) types.add(m.typeId);
	}
	const hubs = new Set<string>();
	for (const r of reactors) {
		hubs.add(ctx.profiles[r].market.inputHub);
		hubs.add(ctx.profiles[r].market.outputHub);
	}
	return { types: [...types], hubs: [...hubs] };
}

/**
 * Daily profit history of `reaction` (one bounded query per history table for the whole range).
 * Each day gets a price book of that day's `price_daily` hub averages; types a hub has no collected
 * prices for use the hub region's `esi_market_history` average as buy and sell price (approximate,
 * like `getDailyPriceBook`). Adjusted prices and cost indices stay current; the visitor's settings apply.
 */
export async function getProfitSeries(
	env: Pick<Env, 'HISTORY_DB'>,
	reaction: Reaction,
	ctxBase: CalcContext,
	range: SeriesRange,
	opts: SeriesOptions
): Promise<SeriesPoint[]> {
	const { types, hubs } = relevantTypes(reaction, ctxBase, opts);
	const start = seriesStartDate(range, opts.now ?? Date.now());
	const db = getHistoryDb(env.HISTORY_DB);
	const filters = [inArray(priceDaily.hubId, hubs), inArray(priceDaily.typeId, types)];
	if (start) filters.push(gte(priceDaily.date, start));
	const regionOf = new Map(Object.entries(opts.hubRegions ?? {}));
	const regions = [...new Set(hubs.map((h) => regionOf.get(h)).filter((r) => r !== undefined))];
	const esiFilters = [inArray(esiMarketHistory.regionId, regions), inArray(esiMarketHistory.typeId, types)];
	if (start) esiFilters.push(gte(esiMarketHistory.date, start));
	const [rows, esiRows] = await Promise.all([
		db
			.select({
				date: priceDaily.date,
				hubId: priceDaily.hubId,
				typeId: priceDaily.typeId,
				buy: priceDaily.buyAvg,
				sell: priceDaily.sellAvg
			})
			.from(priceDaily)
			.where(and(...filters)),
		regions.length === 0
			? []
			: db
					.select({
						date: esiMarketHistory.date,
						regionId: esiMarketHistory.regionId,
						typeId: esiMarketHistory.typeId,
						average: esiMarketHistory.average
					})
					.from(esiMarketHistory)
					.where(and(...esiFilters))
	]);

	const byDate = new Map<string, PriceBook['hubs']>();
	for (const r of rows) {
		let book = byDate.get(r.date);
		if (!book) byDate.set(r.date, (book = {}));
		(book[r.hubId] ??= {})[r.typeId] = { buy: r.buy, sell: r.sell };
	}
	const regionalByDate = new Map<string, Map<number, Map<number, number>>>();
	for (const r of esiRows) {
		let day = regionalByDate.get(r.date);
		if (!day) regionalByDate.set(r.date, (day = new Map()));
		let region = day.get(r.regionId);
		if (!region) day.set(r.regionId, (region = new Map()));
		region.set(r.typeId, r.average);
	}
	const dates = [...new Set([...byDate.keys(), ...regionalByDate.keys()])].sort();

	const adjusted = ctxBase.outputPrices.adjusted;
	const points: SeriesPoint[] = [];
	for (const date of dates) {
		const hubBook = byDate.get(date) ?? {};
		let approximate = false;
		const regional = regionalByDate.get(date);
		if (regional)
			for (const hubId of hubs) {
				const averages = regional.get(regionOf.get(hubId) ?? -1);
				if (!averages) continue;
				const prices = (hubBook[hubId] ??= {});
				for (const [typeId, average] of averages) {
					if (prices[typeId]) continue;
					prices[typeId] = { buy: average, sell: average };
					approximate = true;
				}
			}
		const book: PriceBook = { asOf: date, approximate, hubs: hubBook, adjusted };
		const result = calculateAllocated(reaction, { ...ctxBase, inputPrices: book, outputPrices: book }, opts);
		const unpriced = (items: { unitPrice: number | null }[]) => items.some((i) => i.unitPrice === null);
		points.push({
			date,
			profitPerSlotDay: result.totals.profitPerSlotDay,
			outputValue: unpriced(result.outputs) ? null : result.totals.outputValue,
			inputCost: unpriced(result.inputs) ? null : result.totals.inputCost,
			approximate
		});
	}
	return points;
}

/** Daily traded volume of `typeId` in `regionId` over `range` (days without trades are absent). */
export async function getVolumeSeries(
	env: Pick<Env, 'HISTORY_DB'>,
	regionId: number,
	typeId: number,
	range: SeriesRange,
	now: number
): Promise<VolumePoint[]> {
	const start = seriesStartDate(range, now);
	const filters = [eq(esiMarketHistory.regionId, regionId), eq(esiMarketHistory.typeId, typeId)];
	if (start) filters.push(gte(esiMarketHistory.date, start));
	return getHistoryDb(env.HISTORY_DB)
		.select({ date: esiMarketHistory.date, volume: esiMarketHistory.volume })
		.from(esiMarketHistory)
		.where(and(...filters))
		.orderBy(asc(esiMarketHistory.date));
}
