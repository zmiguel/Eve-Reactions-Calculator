import { getCoreDb, latestPrices, marketHubs, structureLinks } from '@reactions/db';
import type { HubPrice } from '@reactions/engine';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { SessionUser } from './session.ts';

export interface HubInfo {
	hubId: string;
	name: string;
	kind: string;
	regionId: number;
	systemId: number;
	locationId: number;
	/** True for the user's own (unshared or not yet approved) structure markets. */
	private: boolean;
}

export const FALLBACK_HUB = 'jita';

/**
 * Enabled public hubs (by sort order), then — for a logged-in user — enabled private structure hubs the
 * user has linked. Other users' private hubs are never returned.
 */
export async function getAccessibleHubs(env: Pick<Env, 'DB'>, user: SessionUser | null): Promise<HubInfo[]> {
	const db = getCoreDb(env.DB);
	const columns = {
		hubId: marketHubs.hubId,
		name: marketHubs.name,
		kind: marketHubs.kind,
		regionId: marketHubs.regionId,
		systemId: marketHubs.systemId,
		locationId: marketHubs.locationId
	};
	const publicHubs = await db
		.select(columns)
		.from(marketHubs)
		.where(and(eq(marketHubs.enabled, true), eq(marketHubs.visibility, 'public')))
		.orderBy(asc(marketHubs.sortOrder), asc(marketHubs.name));
	const result: HubInfo[] = publicHubs.map((h) => ({ ...h, private: false }));
	if (!user) return result;
	const privateHubs = await db
		.selectDistinct(columns)
		.from(marketHubs)
		.innerJoin(structureLinks, eq(structureLinks.structureId, marketHubs.locationId))
		.where(
			and(
				eq(structureLinks.userId, user.userId),
				eq(marketHubs.enabled, true),
				eq(marketHubs.visibility, 'private')
			)
		)
		.orderBy(asc(marketHubs.name));
	return [...result, ...privateHubs.map((h) => ({ ...h, private: true }))];
}

/** `latest_prices` (with listed volumes) of the given hubs from D1 (private hubs never enter KV). */
export async function getHubPrices(
	env: Pick<Env, 'DB'>,
	hubIds: string[]
): Promise<Record<string, Record<number, HubPrice>>> {
	const result: Record<string, Record<number, HubPrice>> = {};
	if (hubIds.length === 0) return result;
	const rows = await getCoreDb(env.DB)
		.select({
			hubId: latestPrices.hubId,
			typeId: latestPrices.typeId,
			buy: latestPrices.buyMax,
			sell: latestPrices.sellMin,
			buyVolume: latestPrices.buyVolume,
			sellVolume: latestPrices.sellVolume
		})
		.from(latestPrices)
		.where(inArray(latestPrices.hubId, hubIds));
	for (const { hubId, typeId, ...price } of rows) (result[hubId] ??= {})[typeId] = price;
	return result;
}
