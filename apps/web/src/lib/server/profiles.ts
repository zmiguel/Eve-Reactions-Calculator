import { costIndices, getCoreDb, systems } from '@reactions/db';
import {
	REACTORS,
	profileFor,
	type Reactor,
	type ResolvedProfile,
	type SecurityBand,
	type Settings
} from '@reactions/engine';
import { inArray } from 'drizzle-orm';
import { FALLBACK_HUB } from './hubs.ts';

export interface SystemInfo {
	systemId: number;
	name: string;
	regionId: number;
	securityStatus: number;
	securityBand: string;
	reactionCostIndex: number | null;
}

export async function getSystems(env: Pick<Env, 'DB'>, ids: number[]): Promise<Map<number, SystemInfo>> {
	const unique = [...new Set(ids)];
	const result = new Map<number, SystemInfo>();
	if (unique.length === 0) return result;
	const db = getCoreDb(env.DB);
	const [rows, indices] = await Promise.all([
		db.select().from(systems).where(inArray(systems.systemId, unique)),
		db.select().from(costIndices).where(inArray(costIndices.systemId, unique))
	]);
	const indexBySystem = new Map(indices.map((c) => [c.systemId, c.reaction]));
	for (const s of rows)
		result.set(s.systemId, { ...s, reactionCostIndex: indexBySystem.get(s.systemId) ?? null });
	return result;
}

/** Reactions are impossible in highsec; such a system is computed with the lowsec modifier. */
function engineBand(band: string | undefined): SecurityBand {
	return band === 'nullsec' || band === 'wormhole' ? band : 'lowsec';
}

export interface ResolvedProfiles {
	profiles: Record<Reactor, ResolvedProfile>;
	/** `HUB_UNAVAILABLE` when a profile referenced a hub the visitor cannot use (replaced by Jita). */
	warnings: string[];
}

export async function resolveProfiles(
	env: Pick<Env, 'DB'>,
	settings: Settings,
	accessibleHubIds: ReadonlySet<string>
): Promise<ResolvedProfiles> {
	const warnings = new Set<string>();
	const systemInfo = await getSystems(
		env,
		REACTORS.map((r) => profileFor(settings, r).systemId)
	);
	const profiles = {} as Record<Reactor, ResolvedProfile>;
	for (const reactor of REACTORS) {
		const p = profileFor(settings, reactor);
		const system = systemInfo.get(p.systemId);
		const fromIndex = system?.reactionCostIndex ?? null;
		const market = { ...p.market };
		for (const side of ['inputHub', 'inputFallbackHub', 'outputHub'] as const) {
			if (!accessibleHubIds.has(market[side])) {
				market[side] = FALLBACK_HUB;
				warnings.add('HUB_UNAVAILABLE');
			}
		}
		profiles[reactor] = {
			...p,
			market,
			securityBand: engineBand(system?.securityBand),
			costIndex: p.costIndexOverridePct !== null ? p.costIndexOverridePct / 100 : (fromIndex ?? 0),
			systemName: system?.name ?? `System ${p.systemId}`,
			costIndexMissing: p.costIndexOverridePct === null && fromIndex === null
		};
	}
	return { profiles, warnings: [...warnings] };
}
