import { parseRigIds, type FacilityFromEve, type IndustryBand } from '@reactions/engine';

/**
 * What is known of the facilities of a user's tracked jobs: the tracking sync's lookup
 * (`tracked_facilities`) with the user's synced places (`inventory_locations`) filling in name and
 * system. The ledger (updater) resolves a job's facility the same way ({@link facilityEve}).
 */
export interface FacilityPlace {
	facilityId: number;
	/** `tracked_facilities.kind`; null without a lookup row. */
	kind: 'structure' | 'station' | 'unknown' | null;
	name: string | null;
	systemId: number | null;
	systemName: string | null;
	band: IndustryBand | null;
	/** Structure or station type id from the lookup; null when unknown. */
	typeId: number | null;
	/** Installed rig type ids read from corporation assets; null = not read. */
	rigs: number[] | null;
	rigsReadAt: number | null;
}

const BANDS: Record<string, true> = { highsec: true, lowsec: true, nullsec: true, wormhole: true };
const KINDS: Record<string, true> = { structure: true, station: true, unknown: true };

/**
 * Every facility of the user's tracked jobs (any connection) by facility id: looked-up values first,
 * then the user's own places (lowest connection first) for the name and the system.
 */
export async function facilityPlaces(
	env: Pick<Env, 'DB'>,
	userId: string
): Promise<Map<number, FacilityPlace>> {
	const [lookups, places] = await Promise.all([
		env.DB.prepare(
			`SELECT facility_id, kind, name, system_id, type_id, rigs_json, rigs_read_at
			FROM tracked_facilities WHERE user_id = ?1`
		)
			.bind(userId)
			.all<{
				facility_id: number;
				kind: string;
				name: string | null;
				system_id: number | null;
				type_id: number | null;
				rigs_json: string | null;
				rigs_read_at: number | null;
			}>(),
		env.DB.prepare(
			`SELECT l.location_id, l.name, l.system_id FROM inventory_locations l
			JOIN inventory_sources s ON s.source_id = l.source_id
			WHERE s.user_id = ?1
				AND l.location_id IN (SELECT DISTINCT facility_id FROM tracked_jobs WHERE user_id = ?1)
			ORDER BY l.location_id, l.source_id`
		)
			.bind(userId)
			.all<{ location_id: number; name: string | null; system_id: number | null }>()
	]);
	const result = new Map<number, FacilityPlace>();
	for (const r of lookups.results) {
		result.set(r.facility_id, {
			facilityId: r.facility_id,
			kind: KINDS[r.kind] ? (r.kind as FacilityPlace['kind']) : 'unknown',
			name: r.name,
			systemId: r.system_id,
			systemName: null,
			band: null,
			typeId: r.type_id,
			rigs: parseRigIds(r.rigs_json),
			rigsReadAt: r.rigs_read_at
		});
	}
	for (const p of places.results) {
		let place = result.get(p.location_id);
		if (!place) {
			place = {
				facilityId: p.location_id,
				kind: null,
				name: null,
				systemId: null,
				systemName: null,
				band: null,
				typeId: null,
				rigs: null,
				rigsReadAt: null
			};
			result.set(p.location_id, place);
		}
		place.name ??= p.name;
		place.systemId ??= p.system_id;
	}
	const systemIds = [
		...new Set([...result.values()].flatMap((p) => (p.systemId === null ? [] : [p.systemId])))
	];
	if (systemIds.length) {
		const { results } = await env.DB.prepare(
			`SELECT system_id, name, security_band FROM systems WHERE system_id IN (${systemIds.map(() => '?').join(', ')})`
		)
			.bind(...systemIds)
			.all<{ system_id: number; name: string; security_band: string }>();
		const systems = new Map(results.map((s) => [s.system_id, s]));
		for (const place of result.values()) {
			const system = place.systemId === null ? undefined : systems.get(place.systemId);
			if (!system) continue;
			place.systemName = system.name;
			place.band = BANDS[system.security_band] ? (system.security_band as IndustryBand) : null;
		}
	}
	return result;
}

/**
 * What EVE tells of a facility, as the ledger passes it to `resolveFacility`: an NPC station is type 0
 * (no structure bonus); null when nothing is known.
 */
export function facilityEve(place: FacilityPlace | undefined): FacilityFromEve | null {
	if (!place || (place.kind === null && place.band === null)) return null;
	return {
		typeId: place.kind === 'station' ? 0 : place.typeId,
		rigs: place.rigs,
		band: place.band
	};
}
