import { adjustedPrices, getCoreDb, jobRuns, latestPrices, MARKET_KV_KEY, marketHubs } from '@reactions/db';
import type { JobKind, MarketSnapshot } from '@reactions/db';
import { and, asc, desc, eq, ne } from 'drizzle-orm';

/**
 * Writes KV `market:v1` from enabled public hubs, their latest prices, adjusted prices and the
 * update times of cost indices / adjusted prices. Private structure hubs never enter KV.
 * An update time is the start of the latest run of that kind that did not fail: those runs stamp
 * `updated_at` with their start, and the guarded upserts leave unchanged rows' `updated_at` alone, so
 * `MAX(updated_at)` would scan the table and give the last change instead of the last refresh. A run
 * still `running` counts: its writer publishes before recording its result.
 */
export async function publishMarketSnapshot(env: Env, now: number = Date.now()): Promise<MarketSnapshot> {
	const db = getCoreDb(env.DB);
	const publicHub = and(eq(marketHubs.enabled, true), eq(marketHubs.visibility, 'public'));
	const lastRun = (kind: JobKind) =>
		db
			.select({ at: jobRuns.startedAt })
			.from(jobRuns)
			.where(and(eq(jobRuns.kind, kind), ne(jobRuns.status, 'failed')))
			.orderBy(desc(jobRuns.startedAt))
			.limit(1);
	const [hubs, prices, adjusted, [costRun], [adjustedRun]] = await db.batch([
		db
			.select({
				hubId: marketHubs.hubId,
				name: marketHubs.name,
				kind: marketHubs.kind,
				regionId: marketHubs.regionId
			})
			.from(marketHubs)
			.where(publicHub)
			.orderBy(asc(marketHubs.sortOrder), asc(marketHubs.hubId)),
		db
			.select({
				hubId: latestPrices.hubId,
				typeId: latestPrices.typeId,
				buy: latestPrices.buyMax,
				sell: latestPrices.sellMin,
				buyVolume: latestPrices.buyVolume,
				sellVolume: latestPrices.sellVolume,
				observedAt: latestPrices.observedAt
			})
			.from(latestPrices)
			.innerJoin(marketHubs, eq(marketHubs.hubId, latestPrices.hubId))
			.where(publicHub),
		db.select({ typeId: adjustedPrices.typeId, price: adjustedPrices.adjustedPrice }).from(adjustedPrices),
		lastRun('cost_indices'),
		lastRun('adjusted_prices')
	]);

	const snapshot: MarketSnapshot = {
		snapshotAt: 0,
		hubs,
		prices: Object.fromEntries(hubs.map((h) => [h.hubId, {}])),
		adjusted: Object.fromEntries(adjusted.map((a) => [a.typeId, a.price])),
		costIndicesUpdatedAt: costRun?.at ?? 0,
		adjustedUpdatedAt: adjustedRun?.at ?? 0
	};
	for (const p of prices) {
		snapshot.prices[p.hubId]![p.typeId] = [p.buy, p.sell, p.buyVolume, p.sellVolume];
		if (p.observedAt > snapshot.snapshotAt) snapshot.snapshotAt = p.observedAt;
	}
	if (prices.length === 0) snapshot.snapshotAt = now;
	await env.CACHE.put(MARKET_KV_KEY, JSON.stringify(snapshot));
	return snapshot;
}
