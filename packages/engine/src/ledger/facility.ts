import { materialModifier, type EfficiencyProfile } from '../formulas.ts';
import type { RigLevel } from '../settings.ts';
import type {
	IndustryActivity,
	IndustryBand,
	IndustryData,
	ReactionConstants,
	SecurityBand
} from '../types.ts';
import type { TrackingSettings } from './types.ts';

/** What EVE tells about a job's facility (null = EVE could not tell). */
export interface FacilityFromEve {
	/** Structure type id (0 = NPC station or other). */
	typeId: number | null;
	/** Installed rig type ids, from corporation assets. */
	rigs: number[] | null;
	band: IndustryBand | null;
}

/** A facility as the ledger sees it: EVE's values win; settings fill nulls. */
export interface ResolvedFacility {
	/** Structure type id; 0 = NPC station or other (no bonus); null = unknown. */
	structureTypeId: number | null;
	/** Installed rig type ids; null = unknown. */
	rigs: number[] | null;
	/** Security band of the facility's system; null = unknown. */
	band: IndustryBand | null;
}

/**
 * Stored rig type ids (`rigs_json`, a JSON array) → the ids; null when absent, unreadable or not
 * every entry is a positive safe integer (the rigs then count as unknown).
 */
export function parseRigIds(json: string | null): number[] | null {
	if (json === null) return null;
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) && value.every((v) => Number.isSafeInteger(v) && v > 0)
			? (value as number[])
			: null;
	} catch {
		return null;
	}
}

export function resolveFacility(
	eve: FacilityFromEve | null,
	setting: TrackingSettings['facilities'][string] | undefined
): ResolvedFacility {
	return {
		structureTypeId: eve?.typeId ?? setting?.structureTypeId ?? null,
		rigs: eve?.rigs ?? setting?.rigs ?? null,
		band: eve?.band ?? null
	};
}

export interface MaterialBonusPart {
	kind: 'structure' | 'rig';
	typeId: number;
	name: string;
	/** Reduction fraction after security (0.0504 = 5.04 %). */
	reduction: number;
}

/**
 * Facility material multiplier for one product: the structure's role bonus for the activity × every
 * installed rig bonus of the activity whose filter matches the product (or that has no filter), each
 * scaled by the rig's security multiplier for the facility's band (null = highsec). Unknown structure
 * or rig types and `rigs: null` add nothing.
 */
export function facilityMaterialBonus(
	industry: IndustryData | undefined,
	activity: IndustryActivity,
	productTypeId: number,
	facility: ResolvedFacility
): { multiplier: number; parts: MaterialBonusPart[] } {
	const parts: MaterialBonusPart[] = [];
	if (industry) {
		const structure =
			facility.structureTypeId === null
				? undefined
				: industry.structures.find((s) => s.typeId === facility.structureTypeId);
		const role = structure?.material[activity];
		if (structure && role) {
			parts.push({ kind: 'structure', typeId: structure.typeId, name: structure.name, reduction: role });
		}
		const filters = industry.productFilters[productTypeId] ?? [];
		const band = facility.band ?? 'highsec';
		for (const rigTypeId of facility.rigs ?? []) {
			const rig = industry.rigs.find((r) => r.typeId === rigTypeId);
			if (!rig) continue;
			for (const bonus of rig.bonuses) {
				if (bonus.activity !== activity) continue;
				if (bonus.filterId !== null && !filters.includes(bonus.filterId)) continue;
				parts.push({
					kind: 'rig',
					typeId: rig.typeId,
					name: rig.name,
					reduction: bonus.material * rig.security[band]
				});
			}
		}
	}
	return { multiplier: parts.reduce((m, p) => m * (1 - p.reduction), 1), parts };
}

/**
 * Material multiplier of a manufacturing job: blueprint ME × the facility bonus for its product
 * (`rigs: null` = no rigs, `structureTypeId: null` = no structure bonus, band null = highsec).
 */
export function manufacturingMaterialModifier(
	me: number,
	industry: IndustryData | undefined,
	productTypeId: number,
	facility: ResolvedFacility
): number {
	return (
		(1 - me / 100) * facilityMaterialBonus(industry, 'manufacturing', productTypeId, facility).multiplier
	);
}

/**
 * Where a reaction job's material bonus comes from: `facility` = the structure and rigs are known
 * (`facilityMaterialBonus`); `profile` = the structure is unknown (or the dataset has no industry data),
 * so the account reactor profile's ME rig applies; `structure_profile_rig` = the structure is known but
 * its rigs are not, so its role bonus and the profile's ME rig apply.
 */
export type ReactionBonusSource = 'facility' | 'profile' | 'structure_profile_rig';

export interface ReactionMaterialBonus {
	multiplier: number;
	source: ReactionBonusSource;
	/** Structure and rig parts (`facility`), or the structure part (`structure_profile_rig`). */
	parts: MaterialBonusPart[];
	/** The profile's ME rig and its reduction after security (sources other than `facility`). */
	profileRig: { meRig: RigLevel; reduction: number } | null;
}

/**
 * Material bonus of a reaction job. Rigs are scaled with the facility's band when known; reactions
 * cannot run in highsec, so an unknown or highsec band means the account profile's band.
 */
export function jobMaterialBonus(
	industry: IndustryData | undefined,
	productTypeId: number,
	facility: ResolvedFacility,
	fallback: EfficiencyProfile,
	constants: ReactionConstants
): ReactionMaterialBonus {
	const band: SecurityBand =
		facility.band === null || facility.band === 'highsec' ? fallback.securityBand : facility.band;
	if (industry && facility.structureTypeId !== null && facility.rigs !== null) {
		const { multiplier, parts } = facilityMaterialBonus(industry, 'reaction', productTypeId, {
			...facility,
			band
		});
		return { multiplier, source: 'facility', parts, profileRig: null };
	}
	const rigMultiplier = materialModifier({ ...fallback, securityBand: band }, constants);
	const profileRig = { meRig: fallback.meRig, reduction: 1 - rigMultiplier };
	if (!industry || facility.structureTypeId === null) {
		return { multiplier: rigMultiplier, source: 'profile', parts: [], profileRig };
	}
	const structure = facilityMaterialBonus(industry, 'reaction', productTypeId, { ...facility, rigs: [] });
	return {
		multiplier: structure.multiplier * rigMultiplier,
		source: 'structure_profile_rig',
		parts: structure.parts,
		profileRig
	};
}

/** `jobMaterialBonus(...).multiplier`: the `LedgerJob.materialModifier` of a reaction job. */
export function jobMaterialModifier(
	industry: IndustryData | undefined,
	productTypeId: number,
	facility: ResolvedFacility,
	fallback: EfficiencyProfile,
	constants: ReactionConstants
): number {
	return jobMaterialBonus(industry, productTypeId, facility, fallback, constants).multiplier;
}
