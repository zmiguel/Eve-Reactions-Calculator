/** SDE archive entries the parser reads; every other entry is skipped without inflating it. */
export const SDE_FILES = [
	'_sde.jsonl',
	'blueprints.jsonl',
	'types.jsonl',
	'groups.jsonl',
	'typeMaterials.jsonl',
	'typeDogma.jsonl',
	'dogmaAttributes.jsonl',
	'dogmaEffects.jsonl',
	'mapSolarSystems.jsonl',
	'mapRegions.jsonl'
] as const;

export type SdeFile = (typeof SDE_FILES)[number];

export const ATHANOR_TYPE_ID = 35835;
export const TATARA_TYPE_ID = 35836;
export const REACTIONS_SKILL_ID = 45746;
/** Standup L-Set Reactor Efficiency I / II: carry both rig bonuses and the security modifiers. */
export const L_SET_RIG_T1_TYPE_ID = 46496;
export const L_SET_RIG_T2_TYPE_ID = 46497;

/** Structures (Athanor, Tatara), reaction skills and reactor rigs whose dogma provides the constants. */
export const DOGMA_TYPE_IDS: readonly number[] = [
	ATHANOR_TYPE_ID,
	TATARA_TYPE_ID,
	REACTIONS_SKILL_ID,
	45748,
	45749,
	...Array.from({ length: 14 }, (_, i) => 46484 + i)
];

/**
 * Dogma attributes of the industry data. A `typeDogma.jsonl` line with `rigSize` (structures, rigs,
 * ships) keeps its rig size and rig slots even when its type is not otherwise read.
 */
export const RIG_SIZE_ATTRIBUTE_ID = 1547;
/** Rig slots of a structure. */
export const UPGRADE_SLOTS_LEFT_ATTRIBUTE_ID = 1154;
/** Rig bonus multipliers by security band (absent = 1, the dogma default). */
export const HI_SEC_MODIFIER_ATTRIBUTE_ID = 2355;
export const LOW_SEC_MODIFIER_ATTRIBUTE_ID = 2356;
export const NULL_SEC_MODIFIER_ATTRIBUTE_ID = 2357;
/** Name of the `canFitShipGroupNN` dogma attributes (structure groups a rig fits). */
export const CAN_FIT_SHIP_GROUP_ATTRIBUTE = /^canFitShipGroup\d+$/;
/** Dogma modifier operations of rig bonuses: `PostMul` (value is a multiplier), `PostPercent` (signed %). */
export const DOGMA_OPERATION_POST_MUL = 4;
export const DOGMA_OPERATION_POST_PERCENT = 6;
/** SDE categories of industry bonus sources. */
export const STRUCTURE_CATEGORY_ID = 65;
export const STRUCTURE_MODULE_CATEGORY_ID = 66;

/** Systems in regions at or above this id are not part of known space (abyssal, void, etc.). */
export const MAX_REGION_ID_EXCLUSIVE = 12000000;
export const WORMHOLE_REGION_ID_MIN = 11000000;
