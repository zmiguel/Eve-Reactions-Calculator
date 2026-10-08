import { esiMarketHistory, getHistoryDb, priceDaily, priceSnapshots } from '@reactions/db';
import { and, asc, between, eq, gte, lt } from 'drizzle-orm';
import { apiCsv } from '$lib/server/api/csv';
import { publicHubs, requireDataset, requireHub } from '$lib/server/api/data';
import {
	ApiError,
	CACHE_SHORT,
	apiHandler,
	apiJson,
	invalidParam,
	parseQuery,
	requireEnv
} from '$lib/server/api/http';
import {
	HISTORY_COLUMNS,
	MAX_HISTORY_SPAN_DAYS,
	PriceHistoryQuery,
	SNAPSHOT_HISTORY_DAYS
} from '$lib/server/api/schemas';
import { FALLBACK_HUB } from '$lib/server/hubs';
import { DAY_MS } from '$lib/server/listing';
import { isoDate } from '$lib/server/prices';
import type { RequestHandler } from './$types';

const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

interface Point {
	at: string;
	buy: number | null;
	sell: number | null;
	buyVolume: number | null;
	sellVolume: number | null;
	approximate: boolean;
}

export const GET: RequestHandler = apiHandler(async (event) => {
	const q = parseQuery(PriceHistoryQuery.schema, event.url);
	const now = Date.now();
	const today = isoDate(now);
	const to = q.to ?? today;
	const from = q.from ?? isoDate(dayMs(to) - 29 * DAY_MS);
	if (to > today) throw invalidParam('to', `Must not be after ${today}`);
	if (from > to) throw invalidParam('from', 'Must not be after to');
	if ((dayMs(to) - dayMs(from)) / DAY_MS + 1 > MAX_HISTORY_SPAN_DAYS)
		throw invalidParam('from', `At most ${MAX_HISTORY_SPAN_DAYS} days per request`);
	const oldestSnapshotDay = isoDate(now - SNAPSHOT_HISTORY_DAYS * DAY_MS);
	if (q.resolution === 'snapshot' && from < oldestSnapshotDay)
		throw invalidParam(
			'from',
			`resolution=snapshot only covers the last ${SNAPSHOT_HISTORY_DAYS} days (from ≥ ${oldestSnapshotDay})`
		);

	const env = requireEnv(event);
	const [dataset, hubs] = await Promise.all([requireDataset(env), publicHubs(env)]);
	const hub = requireHub(hubs, q.hub ?? FALLBACK_HUB);
	const name = dataset.types[q.type]?.name;
	if (name === undefined) throw new ApiError(404, 'NOT_FOUND', `Unknown type ${q.type}.`);

	const db = getHistoryDb(env.HISTORY_DB);
	let points: Point[];
	if (q.resolution === 'snapshot') {
		const rows = await db
			.select({
				at: priceSnapshots.snapshotAt,
				buy: priceSnapshots.buyMax,
				sell: priceSnapshots.sellMin,
				buyVolume: priceSnapshots.buyVolume,
				sellVolume: priceSnapshots.sellVolume
			})
			.from(priceSnapshots)
			.where(
				and(
					eq(priceSnapshots.hubId, hub.hubId),
					eq(priceSnapshots.typeId, q.type),
					gte(priceSnapshots.snapshotAt, dayMs(from)),
					lt(priceSnapshots.snapshotAt, dayMs(to) + DAY_MS)
				)
			)
			.orderBy(asc(priceSnapshots.snapshotAt));
		points = rows.map((r) => ({ ...r, at: new Date(r.at).toISOString(), approximate: false }));
	} else {
		const [daily, regional] = await Promise.all([
			db
				.select({ date: priceDaily.date, buy: priceDaily.buyAvg, sell: priceDaily.sellAvg })
				.from(priceDaily)
				.where(
					and(
						eq(priceDaily.hubId, hub.hubId),
						eq(priceDaily.typeId, q.type),
						between(priceDaily.date, from, to)
					)
				),
			db
				.select({ date: esiMarketHistory.date, average: esiMarketHistory.average })
				.from(esiMarketHistory)
				.where(
					and(
						eq(esiMarketHistory.regionId, hub.regionId),
						eq(esiMarketHistory.typeId, q.type),
						between(esiMarketHistory.date, from, to)
					)
				)
		]);
		// Hub daily averages first; days without them use the region's ESI average as buy and sell.
		const byDate = new Map<string, Point>();
		for (const r of regional)
			byDate.set(r.date, {
				at: r.date,
				buy: r.average,
				sell: r.average,
				buyVolume: null,
				sellVolume: null,
				approximate: true
			});
		for (const r of daily)
			byDate.set(r.date, {
				at: r.date,
				buy: r.buy,
				sell: r.sell,
				buyVolume: null,
				sellVolume: null,
				approximate: false
			});
		points = [...byDate.values()].sort((a, b) => a.at.localeCompare(b.at));
	}
	if (q.format === 'csv') return apiCsv(HISTORY_COLUMNS, points, CACHE_SHORT);
	return apiJson(
		{ hub: hub.hubId, typeId: q.type, name, resolution: q.resolution, from, to, points },
		CACHE_SHORT
	);
});
