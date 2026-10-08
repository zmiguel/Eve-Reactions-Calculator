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

export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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

/** Hub prices of one day (`PriceBook.hubs`) and whether any of them came from the regional ESI average. */
export interface DailyHubPrices {
	hubs: PriceBook['hubs'];
	approximate: boolean;
}

/**
 * Daily average prices of every day in `from`..`to` (YYYY-MM-DD) that has any data, by date. Hub/type
 * pairs without a `price_daily` row fall back to the ESI daily average of the hub's region (as both buy
 * and sell) and mark the day approximate.
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
							gte(esiMarketHistory.date, from),
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
	const esiByDay = new Map<string, Map<number, Map<number, number>>>();
	for (const r of esi) {
		bookOf(r.date);
		let regions = esiByDay.get(r.date);
		if (!regions) esiByDay.set(r.date, (regions = new Map()));
		let types = regions.get(r.regionId);
		if (!types) regions.set(r.regionId, (types = new Map()));
		types.set(r.typeId, r.average);
	}
	const typeIds = Object.keys(dataset.types).map(Number);
	const result = new Map<string, DailyHubPrices>();
	for (const [date, book] of books) {
		let approximate = false;
		for (const hub of hubs) {
			const prices = (book[hub.hubId] ??= {});
			const regional = esiByDay.get(date)?.get(hub.regionId);
			if (!regional) continue;
			for (const typeId of typeIds) {
				const average = prices[typeId] ? undefined : regional.get(typeId);
				if (average === undefined) continue;
				prices[typeId] = { buy: average, sell: average };
				approximate = true;
			}
		}
		result.set(date, { hubs: book, approximate });
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
