import type { ReactionConstants } from './types.ts';

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
