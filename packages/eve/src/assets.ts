import { EsiError, type EsiClient } from './esi.ts';

/** One row of `/characters/{id}/assets` or `/corporations/{id}/assets`. */
export interface AssetRow {
	itemId: number;
	typeId: number;
	quantity: number;
	locationId: number;
	locationType: 'station' | 'solar_system' | 'item' | 'other';
	locationFlag: string;
	isSingleton: boolean;
	isBlueprintCopy?: boolean;
}

interface EsiAssetRow {
	item_id: number;
	type_id: number;
	quantity: number;
	location_id: number;
	location_type: AssetRow['locationType'];
	location_flag: string;
	is_singleton: boolean;
	is_blueprint_copy?: boolean;
}

export type AssetPage =
	| { ok: true; items: AssetRow[]; pages: number; lastModified: number | null; expiresAt: number | null }
	| { ok: false; status: number; retryAfter: number | null };

function mapAsset(row: EsiAssetRow): AssetRow {
	const asset: AssetRow = {
		itemId: row.item_id,
		typeId: row.type_id,
		quantity: row.quantity,
		locationId: row.location_id,
		locationType: row.location_type,
		locationFlag: row.location_flag,
		isSingleton: row.is_singleton
	};
	if (row.is_blueprint_copy != null) asset.isBlueprintCopy = row.is_blueprint_copy;
	return asset;
}

async function fetchAssetPage(
	client: EsiClient,
	path: string,
	accessToken: string,
	page: number
): Promise<AssetPage> {
	const res = await client.get<EsiAssetRow[]>(`${path}?page=${page}`, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return {
		ok: true,
		items: (res.data ?? []).map(mapAsset),
		pages: res.pages,
		lastModified: res.lastModified,
		expiresAt: res.expiresAt
	};
}

/** One page of `/characters/{id}/assets` (scope `esi-assets.read_assets.v1`). Non-2XX is returned, not thrown. */
export function fetchCharacterAssets(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	page: number
): Promise<AssetPage> {
	return fetchAssetPage(client, `/characters/${characterId}/assets`, accessToken, page);
}

/** One page of `/corporations/{id}/assets` (scope `esi-assets.read_corporation_assets.v1`, Director). */
export function fetchCorporationAssets(
	client: EsiClient,
	corporationId: number,
	accessToken: string,
	page: number
): Promise<AssetPage> {
	return fetchAssetPage(client, `/corporations/${corporationId}/assets`, accessToken, page);
}

export type HangarDivision = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type HangarDivisionNames = Partial<Record<HangarDivision, string>>;

/** Named hangar divisions of `/corporations/{id}/divisions`; `null` when the character may not read them. */
export async function fetchCorporationDivisions(
	client: EsiClient,
	corporationId: number,
	accessToken: string
): Promise<HangarDivisionNames | null> {
	const path = `/corporations/${corporationId}/divisions`;
	const res = await client.get<{ hangar?: { division?: number; name?: string }[] }>(path, { accessToken });
	if (res.status === 401 || res.status === 403) return null;
	if (res.status !== 200 || !res.data) throw new EsiError(res.status, path);
	const names: HangarDivisionNames = {};
	for (const { division, name } of res.data.hangar ?? []) {
		if (!name || division == null || division < 1 || division > 7) continue;
		names[division as HangarDivision] = name;
	}
	return names;
}
