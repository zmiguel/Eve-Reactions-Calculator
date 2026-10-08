import {
	characters,
	getCoreDb,
	getHistoryDb,
	latestPrices,
	marketHubs,
	priceDaily,
	priceSnapshots,
	regions,
	structureLinks,
	systems,
	type CoreDb
} from '@reactions/db';
import {
	EsiError,
	createEsiClient,
	fetchStructureInfo,
	hasFeature,
	searchStructures,
	type FetchFn
} from '@reactions/eve';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { CharacterRow } from './auth/accounts.ts';
import { getAccessToken } from './auth/tokens.ts';
import { ensureSystem } from './systems.ts';
import { userAgent } from './user-agent.ts';

/** Structure markets one account may link. */
export const STRUCTURE_LINK_LIMIT = 5;
/** Search hits looked up with `/universe/structures/{id}` (one ESI request each). */
export const STRUCTURE_SEARCH_LIMIT = 20;
/** `last_error` of a public structure hub whose last contributor left. */
export const NO_CONTRIBUTOR = 'NO_CONTRIBUTOR';

export const NO_ACCESS = 'This character cannot see that market';
export const NO_STRUCTURE = 'This character cannot see that structure.';
export const NEEDS_FEATURE = 'Enable structure markets for this character first.';

export const structureHubId = (structureId: number) => `structure-${structureId}`;

/** A character can search and read structure markets: a working token with every structure scope. */
export function canUseStructures(character: Pick<CharacterRow, 'scopes' | 'tokenStatus'>): boolean {
	return character.tokenStatus === 'ok' && hasFeature(character.scopes, 'structures');
}

/** Hub back to private, unshared, once no link of the structure asks for sharing any more. */
async function unshareWithoutSharers(db: CoreDb, structureId: number): Promise<boolean> {
	const [sharing] = await db
		.select({ n: count() })
		.from(structureLinks)
		.where(and(eq(structureLinks.structureId, structureId), eq(structureLinks.shareRequested, true)));
	if (sharing!.n > 0) return false;
	await db
		.update(marketHubs)
		.set({ visibility: 'private', shareStatus: 'none' })
		.where(and(eq(marketHubs.hubId, structureHubId(structureId)), eq(marketHubs.kind, 'structure')));
	return true;
}

export type CleanupResult = 'missing' | 'deleted' | 'disabled' | 'unshared' | 'shared';

/**
 * Brings a structure hub in line with its remaining links:
 * - none left, private hub → hub row, its `latest_prices` and its history rows are deleted;
 * - none left, public hub → disabled with `last_error='NO_CONTRIBUTOR'` (admins decide what happens);
 * - links left but none shares → private and unshared (as switching sharing off).
 */
export async function cleanupStructureHub(env: Env, structureId: number): Promise<CleanupResult> {
	const db = getCoreDb(env.DB);
	const hubId = structureHubId(structureId);
	const [hub] = await db
		.select({ visibility: marketHubs.visibility })
		.from(marketHubs)
		.where(and(eq(marketHubs.hubId, hubId), eq(marketHubs.kind, 'structure')));
	if (!hub) return 'missing';
	const [links] = await db
		.select({ n: count() })
		.from(structureLinks)
		.where(eq(structureLinks.structureId, structureId));
	if (links!.n > 0) return (await unshareWithoutSharers(db, structureId)) ? 'unshared' : 'shared';
	if (hub.visibility === 'public') {
		await db
			.update(marketHubs)
			.set({ enabled: false, lastError: NO_CONTRIBUTOR })
			.where(eq(marketHubs.hubId, hubId));
		return 'disabled';
	}
	await deleteStructureHub(env, structureId);
	return 'deleted';
}

/**
 * Deletes a structure hub with everything that points at it: its `structure_links`, its `latest_prices`
 * and its history rows. Accounts that had linked it fall back as for any hub that is gone.
 */
export async function deleteStructureHub(env: Env, structureId: number): Promise<void> {
	const db = getCoreDb(env.DB);
	const hubId = structureHubId(structureId);
	await db.batch([
		db.delete(structureLinks).where(eq(structureLinks.structureId, structureId)),
		db.delete(latestPrices).where(eq(latestPrices.hubId, hubId)),
		db.delete(marketHubs).where(and(eq(marketHubs.hubId, hubId), eq(marketHubs.kind, 'structure')))
	]);
	const history = getHistoryDb(env.HISTORY_DB);
	await history.batch([
		history.delete(priceSnapshots).where(eq(priceSnapshots.hubId, hubId)),
		history.delete(priceDaily).where(eq(priceDaily.hubId, hubId))
	]);
}

/**
 * Called after structure links were deleted (link removed, character removed or transferred, account
 * deleted) with the structure ids those links pointed at.
 */
export async function releaseStructureHubs(env: Env, structureIds: readonly number[]): Promise<void> {
	for (const structureId of new Set(structureIds)) await cleanupStructureHub(env, structureId);
}

export interface StructureLinkView {
	structureId: number;
	hubId: string;
	name: string;
	systemName: string | null;
	regionName: string | null;
	visibility: 'public' | 'private';
	shareStatus: 'none' | 'pending' | 'approved' | 'rejected';
	enabled: boolean;
	lastSuccessAt: number | null;
	lastError: string | null;
	accessStatus: 'ok' | 'denied';
	shareRequested: boolean;
	characterId: number;
	characterName: string;
}

/** The account's structure links with their hub state, by hub name. */
export async function listStructureLinks(env: Env, userId: string): Promise<StructureLinkView[]> {
	const rows = await getCoreDb(env.DB)
		.select({
			structureId: structureLinks.structureId,
			hubId: marketHubs.hubId,
			name: marketHubs.name,
			systemName: systems.name,
			regionName: regions.name,
			visibility: marketHubs.visibility,
			shareStatus: marketHubs.shareStatus,
			enabled: marketHubs.enabled,
			lastSuccessAt: marketHubs.lastSuccessAt,
			lastError: marketHubs.lastError,
			accessStatus: structureLinks.accessStatus,
			shareRequested: structureLinks.shareRequested,
			characterId: characters.characterId,
			characterName: characters.name
		})
		.from(structureLinks)
		.innerJoin(characters, eq(characters.characterId, structureLinks.characterId))
		.leftJoin(
			marketHubs,
			and(eq(marketHubs.locationId, structureLinks.structureId), eq(marketHubs.kind, 'structure'))
		)
		.leftJoin(systems, eq(systems.systemId, marketHubs.systemId))
		.leftJoin(regions, eq(regions.regionId, systems.regionId))
		.where(eq(structureLinks.userId, userId))
		.orderBy(asc(marketHubs.name), asc(structureLinks.structureId));
	return rows.map((r) => ({
		...r,
		hubId: r.hubId ?? structureHubId(r.structureId),
		name: r.name ?? `Structure ${r.structureId}`,
		visibility: (r.visibility ?? 'private') as StructureLinkView['visibility'],
		shareStatus: (r.shareStatus ?? 'none') as StructureLinkView['shareStatus'],
		enabled: r.enabled ?? false,
		accessStatus: r.accessStatus as StructureLinkView['accessStatus']
	}));
}

export interface StructureSearchResult {
	structureId: number;
	name: string;
	systemName: string | null;
	regionName: string | null;
	/** Already on the account's list. */
	linked: boolean;
}

export type SearchOutcome = { ok: true; results: StructureSearchResult[] } | { ok: false; message: string };

const esiFailure = (e: unknown) =>
	e instanceof EsiError
		? `EVE Online answered HTTP ${e.status}. Try again later.`
		: 'EVE Online did not answer.';

/**
 * Structures matching `text` that `character` can see: ESI search, then `/universe/structures/{id}`
 * for the first `STRUCTURE_SEARCH_LIMIT` hits (hits the character cannot open are dropped). A 403 from
 * the search counts as no results.
 */
export async function searchUserStructures(
	env: Env,
	fetch: FetchFn,
	userId: string,
	character: CharacterRow,
	text: string
): Promise<SearchOutcome> {
	if (!canUseStructures(character)) return { ok: false, message: NEEDS_FEATURE };
	const token = await getAccessToken(env, character, fetch);
	if (!token.ok) return { ok: false, message: token.message };
	const client = createEsiClient({ fetch, userAgent: userAgent(env) });
	let ids: number[];
	try {
		ids = await searchStructures(client, character.characterId, text, token.accessToken);
	} catch (e) {
		if (e instanceof EsiError && e.status === 403) return { ok: true, results: [] };
		return { ok: false, message: esiFailure(e) };
	}
	const infos = await Promise.all(
		ids.slice(0, STRUCTURE_SEARCH_LIMIT).map(async (structureId) => {
			const info = await fetchStructureInfo(client, structureId, token.accessToken).catch(() => null);
			return info ? { structureId, ...info } : null;
		})
	);
	const found = infos.filter((i) => i !== null);
	if (found.length === 0) return { ok: true, results: [] };
	const systemIds = [...new Set(found.map((f) => f.solarSystemId))];
	const [places, linked] = await Promise.all([
		Promise.all(systemIds.map((systemId) => ensureSystem(env, client, systemId))),
		getCoreDb(env.DB)
			.select({ structureId: structureLinks.structureId })
			.from(structureLinks)
			.where(eq(structureLinks.userId, userId))
	]);
	const place = new Map(places.flatMap((p) => (p.ok ? [[p.system.systemId, p.system] as const] : [])));
	const linkedIds = new Set(linked.map((l) => l.structureId));
	return {
		ok: true,
		results: found
			.map((f) => ({
				structureId: f.structureId,
				name: f.name,
				systemName: place.get(f.solarSystemId)?.name ?? null,
				regionName: place.get(f.solarSystemId)?.regionName ?? null,
				linked: linkedIds.has(f.structureId)
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}

export type AddOutcome = { ok: true; hubId: string; name: string } | { ok: false; message: string };

/**
 * Links a structure market to the account after checking that `character` can read it (first page of
 * `/markets/structures/{id}`). Creates the hub as a private structure hub when absent; re-enables a
 * disabled one (e.g. `NO_CONTRIBUTOR`). Nothing is written when a check fails.
 */
export async function addStructureLink(
	env: Env,
	fetch: FetchFn,
	userId: string,
	character: CharacterRow,
	structureId: number,
	now = Date.now()
): Promise<AddOutcome> {
	if (!canUseStructures(character)) return { ok: false, message: NEEDS_FEATURE };
	const db = getCoreDb(env.DB);
	const links = await db
		.select({ structureId: structureLinks.structureId })
		.from(structureLinks)
		.where(eq(structureLinks.userId, userId));
	if (links.some((l) => l.structureId === structureId)) {
		return { ok: false, message: 'This market is already on your list.' };
	}
	if (links.length >= STRUCTURE_LINK_LIMIT) {
		return { ok: false, message: `You can link up to ${STRUCTURE_LINK_LIMIT} markets.` };
	}

	const token = await getAccessToken(env, character, fetch);
	if (!token.ok) return { ok: false, message: token.message };
	const client = createEsiClient({ fetch, userAgent: userAgent(env) });
	let info;
	try {
		info = await fetchStructureInfo(client, structureId, token.accessToken);
	} catch (e) {
		return { ok: false, message: esiFailure(e) };
	}
	if (!info) return { ok: false, message: NO_STRUCTURE };
	// Same first request as `fetchStructureOrders`; one page is enough to prove access.
	let probe;
	try {
		probe = await client.get(`/markets/structures/${structureId}?page=1`, { accessToken: token.accessToken });
	} catch (e) {
		return { ok: false, message: esiFailure(e) };
	}
	if (probe.status === 403) return { ok: false, message: NO_ACCESS };
	if (probe.status < 200 || probe.status >= 300) {
		return { ok: false, message: `EVE Online answered HTTP ${probe.status} for that market.` };
	}

	const place = await ensureSystem(env, client, info.solarSystemId);
	if (!place.ok) return { ok: false, message: place.message };
	const system = place.system;

	const hubId = structureHubId(structureId);
	const [hub] = await db
		.select({ enabled: marketHubs.enabled })
		.from(marketHubs)
		.where(eq(marketHubs.hubId, hubId));
	const link = db.insert(structureLinks).values({
		userId,
		structureId,
		characterId: character.characterId,
		shareRequested: false,
		accessStatus: 'ok',
		createdAt: now
	});
	if (!hub) {
		await db.batch([
			db.insert(marketHubs).values({
				hubId,
				name: info.name,
				kind: 'structure',
				regionId: system.regionId,
				systemId: info.solarSystemId,
				locationId: structureId,
				fuzzworkLocationId: structureId,
				visibility: 'private',
				shareStatus: 'none',
				enabled: true,
				sortOrder: 100,
				createdAt: now
			}),
			link
		]);
	} else if (!hub.enabled) {
		await db.batch([
			db.update(marketHubs).set({ enabled: true, lastError: null }).where(eq(marketHubs.hubId, hubId)),
			link
		]);
	} else {
		await link;
	}
	return { ok: true, hubId, name: info.name };
}

/**
 * The account's "Allow everyone to use this market" switch. On: the hub goes to review unless it is
 * already approved. Off: the hub returns to private once no link of the structure asks for sharing.
 * `false` when the account has no such link.
 */
export async function setStructureSharing(
	env: Env,
	userId: string,
	structureId: number,
	share: boolean
): Promise<boolean> {
	const db = getCoreDb(env.DB);
	const updated = await db
		.update(structureLinks)
		.set({ shareRequested: share })
		.where(and(eq(structureLinks.userId, userId), eq(structureLinks.structureId, structureId)))
		.returning({ structureId: structureLinks.structureId });
	if (updated.length === 0) return false;
	if (share) {
		await db
			.update(marketHubs)
			.set({ shareStatus: 'pending' })
			.where(
				and(
					eq(marketHubs.hubId, structureHubId(structureId)),
					eq(marketHubs.kind, 'structure'),
					inArray(marketHubs.shareStatus, ['none', 'rejected'])
				)
			);
	} else {
		await unshareWithoutSharers(db, structureId);
	}
	return true;
}

/** Deletes the account's link and cleans up the hub. `false` when there was no such link. */
export async function removeStructureLink(env: Env, userId: string, structureId: number): Promise<boolean> {
	const removed = await getCoreDb(env.DB)
		.delete(structureLinks)
		.where(and(eq(structureLinks.userId, userId), eq(structureLinks.structureId, structureId)))
		.returning({ structureId: structureLinks.structureId });
	if (removed.length === 0) return false;
	await cleanupStructureHub(env, structureId);
	return true;
}
