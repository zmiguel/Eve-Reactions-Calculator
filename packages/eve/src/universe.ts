import { EsiError, type EsiClient } from './esi.ts';
import { isStationId } from './inventory.ts';

export interface SystemInfo {
	systemId: number;
	name: string;
	constellationId: number;
	securityStatus: number;
}

export interface ConstellationInfo {
	constellationId: number;
	name: string;
	regionId: number;
}

export interface RegionInfo {
	regionId: number;
	name: string;
}

/** Public GET; `null` on 404 (no such id), `EsiError` on any other non-200. */
async function getPublic<T>(client: EsiClient, path: string): Promise<T | null> {
	const res = await client.get<T>(path);
	if (res.status === 404) return null;
	if (res.status !== 200 || !res.data) throw new EsiError(res.status, path);
	return res.data;
}

/** `/universe/systems/{id}`. */
export async function fetchSystemInfo(client: EsiClient, systemId: number): Promise<SystemInfo | null> {
	const data = await getPublic<{ name: string; constellation_id: number; security_status: number }>(
		client,
		`/universe/systems/${systemId}`
	);
	return data
		? {
				systemId,
				name: data.name,
				constellationId: data.constellation_id,
				securityStatus: data.security_status
			}
		: null;
}

/** `/universe/constellations/{id}`. */
export async function fetchConstellationInfo(
	client: EsiClient,
	constellationId: number
): Promise<ConstellationInfo | null> {
	const data = await getPublic<{ name: string; region_id: number }>(
		client,
		`/universe/constellations/${constellationId}`
	);
	return data ? { constellationId, name: data.name, regionId: data.region_id } : null;
}

/** `/universe/regions/{id}`. */
export async function fetchRegionInfo(client: EsiClient, regionId: number): Promise<RegionInfo | null> {
	const data = await getPublic<{ name: string }>(client, `/universe/regions/${regionId}`);
	return data ? { regionId, name: data.name } : null;
}

export interface StationInfo {
	stationId: number;
	name: string;
	systemId: number;
}

/** `/universe/stations/{id}`. */
export async function fetchStationInfo(client: EsiClient, stationId: number): Promise<StationInfo | null> {
	const data = await getPublic<{ name: string; system_id: number }>(
		client,
		`/universe/stations/${stationId}`
	);
	return data ? { stationId, name: data.name, systemId: data.system_id } : null;
}

/** What EVE says about an industry job's facility; a refusal keeps its status and `Expires`. */
export type FacilityLookup =
	| {
			ok: true;
			kind: 'station' | 'structure';
			name: string;
			systemId: number;
			/** Station or structure type. */
			typeId: number | null;
			/** ESI `Expires` (unix ms). */
			expiresAt: number | null;
	  }
	| { ok: false; status: number; expiresAt: number | null };

/**
 * Looks up a job's facility: NPC stations (`isStationId`) through public `/universe/stations/{id}`,
 * anything else through `/universe/structures/{id}` with `accessToken` (scope
 * `esi-universe.read_structures.v1`; 403 when the character may not dock). Non-200 is returned, not thrown.
 */
export async function lookUpFacility(
	client: EsiClient,
	facilityId: number,
	accessToken: string
): Promise<FacilityLookup> {
	if (isStationId(facilityId)) {
		const res = await client.get<{ name: string; system_id: number; type_id?: number }>(
			`/universe/stations/${facilityId}`
		);
		if (res.status !== 200 || !res.data) return { ok: false, status: res.status, expiresAt: res.expiresAt };
		return {
			ok: true,
			kind: 'station',
			name: res.data.name,
			systemId: res.data.system_id,
			typeId: res.data.type_id ?? null,
			expiresAt: res.expiresAt
		};
	}
	const res = await client.get<{ name: string; solar_system_id: number; type_id?: number }>(
		`/universe/structures/${facilityId}`,
		{ accessToken }
	);
	if (res.status !== 200 || !res.data) return { ok: false, status: res.status, expiresAt: res.expiresAt };
	return {
		ok: true,
		kind: 'structure',
		name: res.data.name,
		systemId: res.data.solar_system_id,
		typeId: res.data.type_id ?? null,
		expiresAt: res.expiresAt
	};
}

/** Ids per bulk request (`/characters/affiliation`, `/universe/names`; ESI accepts up to 1000). */
export const ESI_BULK_CHUNK = 100;

export interface Affiliation {
	characterId: number;
	corporationId: number;
	allianceId: number | null;
}

/**
 * Outcome of a chunked bulk lookup: what resolved, the chunks ESI refused (status per chunk), and the
 * latest `Expires` of the chunks ESI answered (unix ms; null when none had one).
 */
export interface BulkResult<T> {
	items: T[];
	failedChunks: { ids: number[]; status: number }[];
	expiresAt: number | null;
}

/**
 * Public POST of `ids` in chunks of {@link ESI_BULK_CHUNK}; a non-200 chunk (ESI rejects a whole chunk
 * when one id is invalid) is reported in `failedChunks` and the others still resolve.
 */
async function postChunks<Row, T>(
	client: EsiClient,
	path: string,
	ids: readonly number[],
	map: (row: Row) => T
): Promise<BulkResult<T>> {
	const unique = [...new Set(ids)];
	const result: BulkResult<T> = { items: [], failedChunks: [], expiresAt: null };
	for (let start = 0; start < unique.length; start += ESI_BULK_CHUNK) {
		const chunk = unique.slice(start, start + ESI_BULK_CHUNK);
		const res = await client.post<Row[]>(path, chunk);
		if (res.expiresAt !== null) result.expiresAt = Math.max(result.expiresAt ?? 0, res.expiresAt);
		if (res.status !== 200 || !res.data) result.failedChunks.push({ ids: chunk, status: res.status });
		else result.items.push(...res.data.map(map));
	}
	return result;
}

interface AffiliationRow {
	character_id: number;
	corporation_id: number;
	alliance_id?: number;
}

export interface NamedId {
	id: number;
	name: string;
	category: string;
}

/** `POST /characters/affiliation`: corporation and alliance of each character. */
export function fetchAffiliations(
	client: EsiClient,
	characterIds: readonly number[]
): Promise<BulkResult<Affiliation>> {
	return postChunks(client, '/characters/affiliation', characterIds, (row: AffiliationRow) => ({
		characterId: row.character_id,
		corporationId: row.corporation_id,
		allianceId: row.alliance_id ?? null
	}));
}

/** `POST /universe/names`: names of characters, corporations, alliances and other ids. */
export function fetchNames(client: EsiClient, ids: readonly number[]): Promise<BulkResult<NamedId>> {
	return postChunks(client, '/universe/names', ids, (row: NamedId) => ({
		id: row.id,
		name: row.name,
		category: row.category
	}));
}
