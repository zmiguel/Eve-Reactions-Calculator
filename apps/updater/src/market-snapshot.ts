import {
	adjustedPrices,
	costIndices,
	getCoreDb,
	latestPrices,
	MARKET_KV_KEY,
	marketHubs
} from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { and, asc, eq, max } from 'drizzle-orm';

/**
 * Writes KV `market:v1` from enabled public hubs, their latest prices, adjusted prices and the
 * update times of cost indices / adjusted prices. Private structure hubs never enter KV.
 */
export async function publishMarketSnapshot(env: Env, now: number = Date.now()): Promise<MarketSnapshot> {
	const db = getCoreDb(env.DB);
	const publicHub = and(eq(marketHubs.enabled, true), eq(marketHubs.visibility, 'public'));
	const [hubs, prices, adjusted, [costMax], [adjustedMax]] = await db.batch([
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
		db.select({ at: max(costIndices.updatedAt) }).from(costIndices),
		db.select({ at: max(adjustedPrices.updatedAt) }).from(adjustedPrices)
	]);

	const snapshot: MarketSnapshot = {
		snapshotAt: 0,
		hubs,
		prices: Object.fromEntries(hubs.map((h) => [h.hubId, {}])),
		adjusted: Object.fromEntries(adjusted.map((a) => [a.typeId, a.price])),
		costIndicesUpdatedAt: costMax?.at ?? 0,
		adjustedUpdatedAt: adjustedMax?.at ?? 0
	};
	for (const p of prices) {
		snapshot.prices[p.hubId]![p.typeId] = [p.buy, p.sell, p.buyVolume, p.sellVolume];
		if (p.observedAt > snapshot.snapshotAt) snapshot.snapshotAt = p.observedAt;
	}
	if (prices.length === 0) snapshot.snapshotAt = now;
	await env.CACHE.put(MARKET_KV_KEY, JSON.stringify(snapshot));
	return snapshot;
}
