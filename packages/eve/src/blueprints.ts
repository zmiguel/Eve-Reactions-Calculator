import type { EsiClient, EsiFailure } from './esi.ts';

/**
 * One row of `/characters/{id}/blueprints` or `/corporations/{id}/blueprints`. Blueprints installed in
 * an industry job are listed too (location: the job's facility). `runs` is -1 for an original;
 * `quantity` is -1 for a single original, -2 for a copy, or the stack size of unpacked originals.
 */
export interface Blueprint {
	itemId: number;
	typeId: number;
	locationId: number;
	materialEfficiency: number;
	timeEfficiency: number;
	runs: number;
	quantity: number;
}

interface EsiBlueprint {
	item_id: number;
	type_id: number;
	location_id: number;
	location_flag: string;
	material_efficiency: number;
	time_efficiency: number;
	runs: number;
	quantity: number;
}

export type BlueprintPage =
	{ ok: true; items: Blueprint[]; pages: number; expiresAt: number | null } | EsiFailure;

async function fetchBlueprintPage(
	client: EsiClient,
	path: string,
	accessToken: string,
	page: number
): Promise<BlueprintPage> {
	const res = await client.get<EsiBlueprint[]>(`${path}?page=${page}`, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return {
		ok: true,
		items: (res.data ?? []).map((row) => ({
			itemId: row.item_id,
			typeId: row.type_id,
			locationId: row.location_id,
			materialEfficiency: row.material_efficiency,
			timeEfficiency: row.time_efficiency,
			runs: row.runs,
			quantity: row.quantity
		})),
		pages: res.pages,
		expiresAt: res.expiresAt
	};
}

/** One page of `/characters/{id}/blueprints` (scope `esi-characters.read_blueprints.v1`). Non-2XX is returned, not thrown. */
export function fetchCharacterBlueprints(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	page: number
): Promise<BlueprintPage> {
	return fetchBlueprintPage(client, `/characters/${characterId}/blueprints`, accessToken, page);
}

/** One page of `/corporations/{id}/blueprints` (scope `esi-corporations.read_blueprints.v1`; the reader needs the Director role, else 403). */
export function fetchCorporationBlueprints(
	client: EsiClient,
	corporationId: number,
	accessToken: string,
	page: number
): Promise<BlueprintPage> {
	return fetchBlueprintPage(client, `/corporations/${corporationId}/blueprints`, accessToken, page);
}
