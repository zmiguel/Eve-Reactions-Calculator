import type { IndustryActivity, IndustryBand, RigLevel } from '@reactions/engine';

/**
 * Facilities of the user's tracked jobs as the `/account/tracking` Facilities section shows them, and
 * the pure choice helpers its editor and the save action share.
 */

/** Value of the structure select for "NPC station or other (no bonus)" (`TrackingSettings` 0). */
export const NO_STRUCTURE = 0;

/**
 * Rig select values: `RIG_NOT_SET` (all slots = nothing stored, EVE's or the reactor settings' rigs
 * apply) and `NO_RIG` (an empty slot); any other value is a rig type id.
 */
export const RIG_NOT_SET = '';
export const NO_RIG = 'none';

/** A structure the user can pick for a facility. */
export interface FacilityStructureChoice {
	typeId: number;
	name: string;
	groupId: number;
	rigSize: number;
	/** Rig slots; 0 = no rig data (the dataset has no industry data yet). */
	rigSlots: number;
}

/** A rig with a material bonus for manufacturing or reactions. */
export interface FacilityRigChoice {
	typeId: number;
	name: string;
	rigSize: number;
	/** Rig kind: a structure holds at most one rig per group (T1 and T2 of a rig share it). */
	groupId: number;
	fitsGroupIds: number[];
	/** Activities it gives a material bonus to. */
	activities: IndustryActivity[];
}

/** The resulting material bonus of a facility for a kind of its job products. */
export interface FacilityBonusLine {
	activity: IndustryActivity;
	/** Product kind (industry target filter name, e.g. "Composite Reactions"). */
	label: string;
	/** Material reduction as a fraction (0.042 = 4.2 % fewer materials). */
	reduction: number;
	/** Computed with the reactor settings (what is not known of the facility comes from them). */
	fromReactorSettings: boolean;
}

export interface FacilityView {
	/** `facility_id` as a string, the key of `TrackingSettings.facilities`. */
	facilityId: string;
	/** Null when no name is known ("Unknown structure"). */
	name: string | null;
	systemName: string | null;
	band: IndustryBand | null;
	/** Tracked jobs here per activity. */
	jobs: Record<IndustryActivity, number>;
	/** The structure EVE told (`typeId` 0 = NPC station); null when it could not be looked up. */
	detectedStructure: { typeId: number; name: string } | null;
	/**
	 * Rigs read from corporation assets: names of those with a material bonus and the count of the
	 * others; null when they could not be read.
	 */
	detectedRigs: { names: string[]; others: number; readAt: number | null } | null;
	/**
	 * Structures relevant to the jobs here: the select's choices when EVE could not tell the structure,
	 * else the rig data of the detected one (when it is one of them).
	 */
	structures: FacilityStructureChoice[];
	/** The stored settings of this facility (null = not set). */
	setting: { structureTypeId: number | null; rigs: number[] | null };
	/** What EVE could not tell and is not set yet (nor taken from the reactor settings). */
	needs: { structure: boolean; rigs: boolean };
	/** Material bonus per kind of product made here. */
	bonus: FacilityBonusLine[];
	/** Reaction jobs here use the ME rig of the account reactor settings (structure or rigs unknown). */
	reactionProfile: boolean;
	/**
	 * The facility is in the system of the reactor settings of every reactor its reaction jobs use: what
	 * is not known of it comes from those settings (`structure`/`meRig` null when they differ).
	 */
	reactorDefault: { structure: string | null; meRig: RigLevel | null } | null;
}

export interface FacilitiesData {
	list: FacilityView[];
	/** Rigs fitting at least one listed structure choice; empty without industry data. */
	rigs: FacilityRigChoice[];
	/** Rig and structure bonus data is in the dataset. */
	industryAvailable: boolean;
	/** Facilities with `needs.structure` or `needs.rigs`. */
	needsInput: number;
}

export const BAND_NAMES: Record<IndustryBand, string> = {
	highsec: 'highsec',
	lowsec: 'lowsec',
	nullsec: 'nullsec',
	wormhole: 'wormhole space'
};

export const activitiesOf = (jobs: Record<IndustryActivity, number>): IndustryActivity[] =>
	(['reaction', 'manufacturing'] as const).filter((a) => jobs[a] > 0);

/** Whether `rig` can be fitted to `structure` (same rig size, structure group listed). */
export const rigFits = (
	rig: Pick<FacilityRigChoice, 'rigSize' | 'fitsGroupIds'>,
	structure: Pick<FacilityStructureChoice, 'rigSize' | 'groupId'>
): boolean => rig.rigSize === structure.rigSize && rig.fitsGroupIds.includes(structure.groupId);

/** Rigs of `rigs` fitting `structure` with a bonus for one of `activities`, by name. */
export function rigChoicesFor(
	rigs: readonly FacilityRigChoice[],
	structure: FacilityStructureChoice | undefined,
	activities: readonly IndustryActivity[]
): FacilityRigChoice[] {
	if (!structure || structure.rigSlots === 0) return [];
	return rigs.filter((r) => rigFits(r, structure) && r.activities.some((a) => activities.includes(a)));
}
