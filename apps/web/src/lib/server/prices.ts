import {
	adjustedPriceDaily,
	esiMarketHistory,
	getHistoryDb,
	priceDaily,
	type MarketSnapshot
} from '@reactions/db';
import type { Dataset, HubPrice, PriceBook } from '@reactions/engine';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { HubInfo } from './hubs.ts';

/**
 * How far back a `price_snapshots` row still prices its (hub, type) pair. The updater stores a pair at
 * the first refresh of each UTC day and afterwards only when its prices change, so a pair's price at
 * any time is its latest row at or before it within this window.
 */
export const SNAPSHOT_LOOKBACK_MS = 36 * 3_600_000;
const DAY_MS = 86_400_000;

export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Days a regional ESI average stands in for the days after it without trades (ESI history lists only
 * days with trades), like the ledger's reference prices (`REFERENCE_LOOKBACK_DAYS`).
 */
export const REGIONAL_CARRY_DAYS = 7;

/** `date` (YYYY-MM-DD) moved by `days`. */
export const shiftDate = (date: string, days: number) => isoDate(Date.parse(date) + days * DAY_MS);

export interface RegionalRow {
	date: string;
	regionId: number;
	typeId: number;
	average: number;
}

/**
 * Regional ESI averages for each of `dates`, by date, region and type: a type without trades that day
 * takes its latest average of the {@link REGIONAL_CARRY_DAYS} days before (query the rows from that
 * many days before the first date).
 */
export function regionalAveragesByDate(
	rows: readonly RegionalRow[],
	dates: readonly string[]
): Map<string, Map<number, Map<number, number>>> {
	const series = new Map<string, RegionalRow[]>();
	for (const r of rows) {
		const key = `${r.regionId}:${r.typeId}`;
		const list = series.get(key);
		if (list) list.push(r);
		else series.set(key, [r]);
	}
	const sortedDates = [...dates].sort();
	const result = new Map<string, Map<number, Map<number, number>>>();
	for (const list of series.values()) {
		list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		let next = 0;
		for (const date of sortedDates) {
			while (next < list.length && list[next].date <= date) next++;
			const latest = list[next - 1];
			if (!latest || latest.date < shiftDate(date, -REGIONAL_CARRY_DAYS)) continue;
			let regions = result.get(date);
			if (!regions) result.set(date, (regions = new Map()));
			let types = regions.get(latest.regionId);
			if (!types) regions.set(latest.regionId, (types = new Map()));
			types.set(latest.typeId, latest.average);
		}
	}
	return result;
}

/**
 * Current prices: public hubs from the KV snapshot plus D1 prices of the visitor's private hubs, with
 * the units currently listed on each side (input market depth).
 */
export function buildPriceBook(
	market: MarketSnapshot,
	extraHubs: Record<string, Record<number, HubPrice>> = {}
): PriceBook {
	const hubs: PriceBook['hubs'] = {};
	for (const [hubId, prices] of Object.entries(market.prices)) {
		const book: Record<number, HubPrice> = {};
		for (const [typeId, [buy, sell, buyVolume, sellVolume]] of Object.entries(prices))
			book[Number(typeId)] = { buy, sell, buyVolume, sellVolume };
		hubs[hubId] = book;
	}
	return {
		asOf: new Date(market.snapshotAt).toISOString(),
		approximate: false,
		hubs: { ...hubs, ...extraHubs },
		adjusted: market.adjusted
	};
}

/**
 * Adjusted prices of `date` for `typeIds`. The type list lets SQLite use the table's key
 * (`type_id`, `date`); by date alone it reads the whole table.
 */
async function adjustedFor(
	env: Pick<Env, 'HISTORY_DB'>,
	date: string,
	typeIds: readonly number[],
	fallback: Record<number, number>
) {
	const rows = await getHistoryDb(env.HISTORY_DB)
		.select({ typeId: adjustedPriceDaily.typeId, price: adjustedPriceDaily.adjustedPrice })
		.from(adjustedPriceDaily)
		.where(and(inJson(adjustedPriceDaily.typeId, typeIds), eq(adjustedPriceDaily.date, date)));
	return rows.length > 0 ? Object.fromEntries(rows.map((r) => [r.typeId, r.price])) : fallback;
}

const datasetTypeIds = (dataset: Dataset) => Object.keys(dataset.types).map(Number);

/** `column IN (<ids>)` with the ids as one JSON parameter (any number of them). */
const inJson = (column: SQLiteColumn, ids: readonly number[]) =>
	sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`;

/** Hub prices of one day (`PriceBook.hubs`) and which of them came from the regional ESI average. */
export interface DailyHubPrices {
	hubs: PriceBook['hubs'];
	approximate: boolean;
	/** Hub id → types priced with the regional average that day. */
	regional: Map<string, Set<number>>;
}

/**
 * Daily average prices of every day in `from`..`to` (YYYY-MM-DD) that has any data, by date. Hub/type
 * pairs without a `price_daily` row fall back to the ESI daily average of the hub's region (as both buy
 * and sell; a day without trades carries the latest average of the 7 days before) and mark the day
 * approximate.
 */
export async function getDailyHubPrices(
	env: Pick<Env, 'HISTORY_DB'>,
	from: string,
	to: string,
	hubs: HubInfo[],
	dataset: Dataset
): Promise<Map<string, DailyHubPrices>> {
	const db = getHistoryDb(env.HISTORY_DB);
	const hubIds = hubs.map((h) => h.hubId);
	const regionIds = [...new Set(hubs.map((h) => h.regionId))];
	const [daily, esi] = await Promise.all([
		hubIds.length
			? db
					.select({
						date: priceDaily.date,
						hubId: priceDaily.hubId,
						typeId: priceDaily.typeId,
						buy: priceDaily.buyAvg,
						sell: priceDaily.sellAvg
					})
					.from(priceDaily)
					.where(
						and(
							inArray(priceDaily.hubId, hubIds),
							// Like the ESI query: the type list lets SQLite use the key (hub, type, date) for the
							// date range; without it every day of the hubs is read.
							inJson(priceDaily.typeId, datasetTypeIds(dataset)),
							gte(priceDaily.date, from),
							lte(priceDaily.date, to)
						)
					)
			: [],
		regionIds.length
			? db
					.select({
						date: esiMarketHistory.date,
						regionId: esiMarketHistory.regionId,
						typeId: esiMarketHistory.typeId,
						average: esiMarketHistory.average
					})
					.from(esiMarketHistory)
					.where(
						and(
							inArray(esiMarketHistory.regionId, regionIds),
							// The type list lets SQLite use the key (region, type, date) for the date range;
							// without it every row of the regions is read.
							inJson(esiMarketHistory.typeId, datasetTypeIds(dataset)),
							gte(esiMarketHistory.date, shiftDate(from, -REGIONAL_CARRY_DAYS)),
							lte(esiMarketHistory.date, to)
						)
					)
			: []
	]);
	const books = new Map<string, PriceBook['hubs']>();
	const bookOf = (date: string) => {
		let book = books.get(date);
		if (!book) books.set(date, (book = {}));
		return book;
	};
	for (const r of daily) (bookOf(r.date)[r.hubId] ??= {})[r.typeId] = { buy: r.buy, sell: r.sell };
	for (const r of esi) if (r.date >= from) bookOf(r.date);
	const esiByDay = regionalAveragesByDate(esi, [...books.keys()]);
	const typeIds = datasetTypeIds(dataset);
	const result = new Map<string, DailyHubPrices>();
	for (const [date, book] of books) {
		const filled = new Map<string, Set<number>>();
		for (const hub of hubs) {
			const prices = (book[hub.hubId] ??= {});
			const regional = esiByDay.get(date)?.get(hub.regionId);
			if (!regional) continue;
			for (const typeId of typeIds) {
				const average = prices[typeId] ? undefined : regional.get(typeId);
				if (average === undefined) continue;
				prices[typeId] = { buy: average, sell: average };
				let types = filled.get(hub.hubId);
				if (!types) filled.set(hub.hubId, (types = new Set()));
				types.add(typeId);
			}
		}
		result.set(date, { hubs: book, approximate: filled.size > 0, regional: filled });
	}
	return result;
}

/**
 * Daily average prices for `date` (YYYY-MM-DD), see {@link getDailyHubPrices}; every hub has an entry,
 * empty when the day has no data.
 */
export async function getDailyPriceBook(
	env: Pick<Env, 'HISTORY_DB'>,
	date: string,
	hubs: HubInfo[],
	dataset: Dataset,
	fallbackAdjusted: Record<number, number>
): Promise<PriceBook> {
	const [days, adjusted] = await Promise.all([
		getDailyHubPrices(env, date, date, hubs, dataset),
		adjustedFor(env, date, datasetTypeIds(dataset), fallbackAdjusted)
	]);
	const day = days.get(date);
	const book: PriceBook['hubs'] = day?.hubs ?? {};
	for (const hub of hubs) book[hub.hubId] ??= {};
	return { asOf: date, approximate: day?.approximate ?? false, hubs: book, adjusted };
}

/**
 * Each (hub, type) pair's latest `price_snapshots` row at or before `?4` and not before `?3`. CROSS JOIN
 * fixes the join order so every pair is two key lookups (its newest time in the window, then the row).
 */
const AS_OF_SQL = `SELECT s.hub_id AS hubId, s.type_id AS typeId, s.snapshot_at AS at, s.buy_max AS buy, s.sell_min AS sell
	FROM json_each(?1) h CROSS JOIN json_each(?2) t CROSS JOIN price_snapshots s
	WHERE s.hub_id = h.value AND s.type_id = t.value AND s.snapshot_at = (
		SELECT max(m.snapshot_at) FROM price_snapshots m
		WHERE m.hub_id = h.value AND m.type_id = t.value AND m.snapshot_at >= ?3 AND m.snapshot_at <= ?4)`;

/**
 * Refresh prices of `typeIds` at `hubs` as of `ts`: each pair's latest snapshot row at or before `ts`
 * (within {@link SNAPSHOT_LOOKBACK_MS}; 90-day table), dated by the newest row found. Without any row,
 * the daily book of that day.
 */
export async function getPriceBookNear(
	env: Pick<Env, 'HISTORY_DB'>,
	ts: number,
	hubs: HubInfo[],
	typeIds: readonly number[],
	dataset: Dataset,
	fallbackAdjusted: Record<number, number>
): Promise<PriceBook> {
	const hubIds = hubs.map((h) => h.hubId);
	const { results: rows } =
		hubIds.length && typeIds.length
			? await env.HISTORY_DB.prepare(AS_OF_SQL)
					.bind(JSON.stringify(hubIds), JSON.stringify(typeIds), ts - SNAPSHOT_LOOKBACK_MS, ts)
					.all<{ hubId: string; typeId: number; at: number; buy: number | null; sell: number | null }>()
			: { results: [] };
	if (rows.length === 0) return getDailyPriceBook(env, isoDate(ts), hubs, dataset, fallbackAdjusted);
	const book: PriceBook['hubs'] = {};
	let asOf = 0;
	for (const r of rows) {
		(book[r.hubId] ??= {})[r.typeId] = { buy: r.buy, sell: r.sell };
		if (r.at > asOf) asOf = r.at;
	}
	return {
		asOf: new Date(asOf).toISOString(),
		approximate: false,
		hubs: book,
		adjusted: await adjustedFor(env, isoDate(asOf), typeIds, fallbackAdjusted)
	};
}
