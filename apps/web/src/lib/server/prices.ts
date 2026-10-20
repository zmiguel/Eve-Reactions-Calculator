import {
	adjustedPriceDaily,
	esiMarketHistory,
	getHistoryDb,
	priceDaily,
	priceSnapshots,
	type MarketSnapshot
} from '@reactions/db';
import type { Dataset, HubPrice, PriceBook } from '@reactions/engine';
import { and, eq, gte, inArray, lte, max } from 'drizzle-orm';
import type { HubInfo } from './hubs.ts';

const SNAPSHOT_LOOKBACK_MS = 36 * 3_600_000;
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

async function adjustedFor(env: Pick<Env, 'HISTORY_DB'>, date: string, fallback: Record<number, number>) {
	const rows = await getHistoryDb(env.HISTORY_DB)
		.select({ typeId: adjustedPriceDaily.typeId, price: adjustedPriceDaily.adjustedPrice })
		.from(adjustedPriceDaily)
		.where(eq(adjustedPriceDaily.date, date));
	return rows.length > 0 ? Object.fromEntries(rows.map((r) => [r.typeId, r.price])) : fallback;
}

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
					.where(and(gte(priceDaily.date, from), lte(priceDaily.date, to), inArray(priceDaily.hubId, hubIds)))
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
							gte(esiMarketHistory.date, shiftDate(from, -REGIONAL_CARRY_DAYS)),
							lte(esiMarketHistory.date, to),
							inArray(esiMarketHistory.regionId, regionIds)
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
	const typeIds = Object.keys(dataset.types).map(Number);
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
		adjustedFor(env, date, fallbackAdjusted)
	]);
	const day = days.get(date);
	const book: PriceBook['hubs'] = day?.hubs ?? {};
	for (const hub of hubs) book[hub.hubId] ??= {};
	return { asOf: date, approximate: day?.approximate ?? false, hubs: book, adjusted };
}

/** Prices of the latest refresh snapshot at or before `ts` (90-day table), else the daily book of that day. */
export async function getPriceBookNear(
	env: Pick<Env, 'HISTORY_DB'>,
	ts: number,
	hubs: HubInfo[],
	dataset: Dataset,
	fallbackAdjusted: Record<number, number>
): Promise<PriceBook> {
	const db = getHistoryDb(env.HISTORY_DB);
	const hubIds = hubs.map((h) => h.hubId);
	const [latest] = hubIds.length
		? await db
				.select({ at: max(priceSnapshots.snapshotAt) })
				.from(priceSnapshots)
				.where(
					and(
						lte(priceSnapshots.snapshotAt, ts),
						gte(priceSnapshots.snapshotAt, ts - SNAPSHOT_LOOKBACK_MS),
						inArray(priceSnapshots.hubId, hubIds)
					)
				)
		: [];
	if (!latest?.at) return getDailyPriceBook(env, isoDate(ts), hubs, dataset, fallbackAdjusted);
	const rows = await db
		.select({
			hubId: priceSnapshots.hubId,
			typeId: priceSnapshots.typeId,
			buy: priceSnapshots.buyMax,
			sell: priceSnapshots.sellMin
		})
		.from(priceSnapshots)
		.where(and(eq(priceSnapshots.snapshotAt, latest.at), inArray(priceSnapshots.hubId, hubIds)));
	const book: PriceBook['hubs'] = {};
	for (const r of rows) (book[r.hubId] ??= {})[r.typeId] = { buy: r.buy, sell: r.sell };
	return {
		asOf: new Date(latest.at).toISOString(),
		approximate: false,
		hubs: book,
		adjusted: await adjustedFor(env, isoDate(latest.at), fallbackAdjusted)
	};
}
