import { costIndices, getCoreDb, regions, systems } from '@reactions/db';
import { fetchConstellationInfo, fetchRegionInfo, fetchSystemInfo, type EsiClient } from '@reactions/eve';
import { MAX_REGION_ID_EXCLUSIVE, securityBand } from '@reactions/sde';
import { and, asc, eq, gte, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { SystemSummary } from '$lib/settings/fields';

const lowerName = sql`lower(${systems.name})`;

function selectSystems(env: Pick<Env, 'DB'>, where: SQL | undefined) {
	return getCoreDb(env.DB)
		.select({
			id: systems.systemId,
			name: systems.name,
			regionName: regions.name,
			securityBand: systems.securityBand,
			securityStatus: systems.securityStatus,
			reactionCostIndex: costIndices.reaction
		})
		.from(systems)
		.leftJoin(regions, eq(regions.regionId, systems.regionId))
		.leftJoin(costIndices, eq(costIndices.systemId, systems.systemId))
		.where(where);
}

/**
 * Case-insensitive name prefix search, sorted by name. The prefix is matched as the range
 * `[prefix, prefix-with-last-char-incremented)` on `lower(name)` so the `systems_name_lower_idx`
 * expression index is used (SQLite's LIKE optimisation does not apply to expression indexes).
 */
export function searchSystems(
	env: Pick<Env, 'DB'>,
	opts: { q: string; limit: number; reactionsOnly: boolean }
): Promise<SystemSummary[]> {
	const from = opts.q.toLowerCase();
	const to = from.slice(0, -1) + String.fromCharCode(from.charCodeAt(from.length - 1) + 1);
	return selectSystems(
		env,
		and(
			gte(lowerName, from),
			lt(lowerName, to),
			opts.reactionsOnly ? ne(systems.securityBand, 'highsec') : undefined
		)
	)
		.orderBy(asc(systems.name))
		.limit(opts.limit);
}

export async function getSystemsByIds(
	env: Pick<Env, 'DB'>,
	ids: number[]
): Promise<Map<number, SystemSummary>> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return new Map();
	const rows = await selectSystems(env, inArray(systems.systemId, unique));
	return new Map(rows.map((r) => [r.id, r]));
}

/** Exact, case-insensitive name match. */
export async function getSystemByName(env: Pick<Env, 'DB'>, name: string): Promise<SystemSummary | null> {
	const [row] = await selectSystems(env, eq(lowerName, name.trim().toLowerCase())).limit(1);
	return row ?? null;
}

export interface KnownSystem {
	systemId: number;
	name: string;
	regionId: number;
	regionName: string | null;
}

export type EnsureSystemResult = { ok: true; system: KnownSystem } | { ok: false; message: string };

export const SYSTEM_LOOKUP_FAILED = 'Could not look up that solar system in EVE Online. Try again later.';
export const SYSTEM_UNKNOWN = 'EVE Online does not know that solar system.';
export const SYSTEM_UNSUPPORTED = 'Markets in that kind of space are not supported.';

/**
 * The `systems` row of `systemId`. A system missing from D1 (local seed, SDE behind the game) is read
 * from public ESI (system → constellation → region) and upserted into `regions` and `systems` with the
 * SDE banding; the next SDE sync overwrites it. Regions ≥ `MAX_REGION_ID_EXCLUSIVE` (Abyssal and other
 * special space) are refused, as the SDE import skips them.
 */
export async function ensureSystem(
	env: Pick<Env, 'DB'>,
	client: EsiClient,
	systemId: number
): Promise<EnsureSystemResult> {
	const db = getCoreDb(env.DB);
	const [row] = await db
		.select({
			systemId: systems.systemId,
			name: systems.name,
			regionId: systems.regionId,
			regionName: regions.name
		})
		.from(systems)
		.leftJoin(regions, eq(regions.regionId, systems.regionId))
		.where(eq(systems.systemId, systemId));
	if (row) return { ok: true, system: row };

	let system, constellation, region;
	try {
		system = await fetchSystemInfo(client, systemId);
		constellation = system && (await fetchConstellationInfo(client, system.constellationId));
		region = constellation && (await fetchRegionInfo(client, constellation.regionId));
	} catch {
		return { ok: false, message: SYSTEM_LOOKUP_FAILED };
	}
	if (!system || !constellation || !region) return { ok: false, message: SYSTEM_UNKNOWN };
	if (region.regionId >= MAX_REGION_ID_EXCLUSIVE) return { ok: false, message: SYSTEM_UNSUPPORTED };

	const values = {
		systemId,
		name: system.name,
		regionId: region.regionId,
		securityStatus: system.securityStatus,
		securityBand: securityBand(region.regionId, system.securityStatus)
	};
	await db.batch([
		db
			.insert(regions)
			.values({ regionId: region.regionId, name: region.name })
			.onConflictDoUpdate({ target: regions.regionId, set: { name: region.name } }),
		db.insert(systems).values(values).onConflictDoUpdate({ target: systems.systemId, set: values })
	]);
	return {
		ok: true,
		system: { systemId, name: system.name, regionId: region.regionId, regionName: region.name }
	};
}
