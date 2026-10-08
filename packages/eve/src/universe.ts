import { EsiError, type EsiClient } from './esi.ts';

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
