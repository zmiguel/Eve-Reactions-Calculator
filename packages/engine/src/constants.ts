import type { Dataset, ReactionConstants } from './types.ts';

export const DEFAULT_CONSTANTS: ReactionConstants = {
	skillTimeBonusPerLevel: 0.04,
	structureTimeMultiplier: { athanor: 1, tatara: 0.75 },
	rig: {
		none: { me: 0, te: 0 },
		t1: { me: 0.02, te: 0.2 },
		t2: { me: 0.024, te: 0.24 }
	},
	securityModifier: { lowsec: 1.0, nullsec: 1.1, wormhole: 1.1 }
};

/** SDE group "Fuel Block" (Nitrogen, Hydrogen, Helium and Oxygen Fuel Blocks). */
export const FUEL_BLOCK_GROUP_ID = 1136;

export function isFuelBlock(dataset: Pick<Dataset, 'types'>, typeId: number): boolean {
	return dataset.types[typeId]?.groupId === FUEL_BLOCK_GROUP_ID;
}

/** Material list order shown everywhere: fuel blocks first, otherwise unchanged. */
export function fuelFirst<T extends { typeId: number }>(
	items: readonly T[],
	dataset: Pick<Dataset, 'types'>
): T[] {
	return [
		...items.filter((i) => isFuelBlock(dataset, i.typeId)),
		...items.filter((i) => !isFuelBlock(dataset, i.typeId))
	];
}
