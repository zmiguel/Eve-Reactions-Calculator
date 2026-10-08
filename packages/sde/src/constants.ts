/** SDE archive entries the parser reads; every other entry is skipped without inflating it. */
export const SDE_FILES = [
	'_sde.jsonl',
	'blueprints.jsonl',
	'types.jsonl',
	'groups.jsonl',
	'typeMaterials.jsonl',
	'typeDogma.jsonl',
	'dogmaAttributes.jsonl',
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

/** Systems in regions at or above this id are not part of known space (abyssal, void, etc.). */
export const MAX_REGION_ID_EXCLUSIVE = 12000000;
export const WORMHOLE_REGION_ID_MIN = 11000000;
