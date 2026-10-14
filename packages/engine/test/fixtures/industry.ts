import type { IndustryBand, IndustryData } from '../../src/types.ts';

/** Industry data with values from the SDE (build 3421648) and Hoboleaks; `TEST_REACTION_STRUCTURE` is made up. */

export const RAITARU = 35825;
export const AZBEL = 35826;
export const SOTIYO = 35827;
export const ATHANOR = 35835;
export const TATARA = 35836;
/** A Citadel: fits engineering rigs but has no role bonus. */
export const FORTIZAR = 35833;
/** Not an EVE type: a refinery with a 1 % reaction role bonus. */
export const TEST_REACTION_STRUCTURE = 90_100;

export const M_SET_AMMUNITION_ME_II = 37159;
export const L_SET_AMMUNITION_ME_II = 37165;
export const L_SET_ADVANCED_COMPONENT_ME_II = 37175;
export const M_SET_COMPOSITE_REACTOR_ME_I = 46486;
export const L_SET_REACTOR_EFFICIENCY_II = 46497;
/** Upwell M3P-RF Outpost Rig: 3 % on every manufacturing product, no security multiplier. */
export const OUTPOST_RIG = 48023;

/** Spike S (Charges, filter 4). */
export const SPIKE_S = 12618;
/** Fusion Thruster (Construction Components, filter 14). */
export const FUSION_THRUSTER = 11532;
/** Methanofullerene (Hybrid Polymers, filter 16). */
export const METHANOFULLERENE = 30306;
/** Pure Standard Mindflood Booster (Biochemical Material, filter 17). */
export const PURE_STANDARD_MINDFLOOD = 25332;
/** Titanium Chromide (Intermediate Materials, filter 18). */
export const TITANIUM_CHROMIDE = 16654;
/** Titanium Carbide (Composite, filter 18). */
export const TITANIUM_CARBIDE = 16671;

const ENGINEERING_SECURITY: Record<IndustryBand, number> = {
	highsec: 1,
	lowsec: 1.9,
	nullsec: 2.1,
	wormhole: 2.1
};
const REACTOR_SECURITY: Record<IndustryBand, number> = { highsec: 1, lowsec: 1, nullsec: 1.1, wormhole: 1.1 };
const ENGINEERING_FITS = [1657, 1404, 1406];

export const industry: IndustryData = {
	filters: [
		{ filterId: 4, name: 'Charges', categoryIds: [8], groupIds: [] },
		{ filterId: 14, name: 'Components', categoryIds: [], groupIds: [332, 334, 716, 964] },
		{ filterId: 15, name: 'Advanced Capital Components', categoryIds: [], groupIds: [913] },
		{ filterId: 16, name: 'Hybrid Reactions', categoryIds: [], groupIds: [974] },
		{ filterId: 17, name: 'Biochemical Reactions', categoryIds: [], groupIds: [712, 4096] },
		{ filterId: 18, name: 'Composite Reactions', categoryIds: [], groupIds: [428, 429, 4932] }
	],
	rigs: [
		{
			typeId: M_SET_AMMUNITION_ME_II,
			name: 'Standup M-Set Ammunition Manufacturing Material Efficiency II',
			rigSize: 2,
			groupId: 1820,
			fitsGroupIds: ENGINEERING_FITS,
			bonuses: [{ activity: 'manufacturing', material: 0.024, filterId: 4 }],
			security: ENGINEERING_SECURITY
		},
		{
			typeId: L_SET_AMMUNITION_ME_II,
			name: 'Standup L-Set Ammunition Manufacturing Efficiency II',
			rigSize: 3,
			groupId: 1851,
			fitsGroupIds: ENGINEERING_FITS,
			bonuses: [{ activity: 'manufacturing', material: 0.024, filterId: 4 }],
			security: ENGINEERING_SECURITY
		},
		{
			typeId: L_SET_ADVANCED_COMPONENT_ME_II,
			name: 'Standup L-Set Advanced Component Manufacturing Efficiency II',
			rigSize: 3,
			groupId: 1860,
			fitsGroupIds: ENGINEERING_FITS,
			bonuses: [
				{ activity: 'manufacturing', material: 0.024, filterId: 14 },
				{ activity: 'manufacturing', material: 0.024, filterId: 15 }
			],
			security: ENGINEERING_SECURITY
		},
		{
			typeId: M_SET_COMPOSITE_REACTOR_ME_I,
			name: 'Standup M-Set Composite Reactor Material Efficiency I',
			rigSize: 2,
			groupId: 1934,
			fitsGroupIds: [1406],
			bonuses: [{ activity: 'reaction', material: 0.02, filterId: 18 }],
			security: REACTOR_SECURITY
		},
		{
			typeId: L_SET_REACTOR_EFFICIENCY_II,
			name: 'Standup L-Set Reactor Efficiency II',
			rigSize: 3,
			groupId: 1939,
			fitsGroupIds: [1406],
			bonuses: [
				{ activity: 'reaction', material: 0.024, filterId: 16 },
				{ activity: 'reaction', material: 0.024, filterId: 18 },
				{ activity: 'reaction', material: 0.024, filterId: 17 }
			],
			security: REACTOR_SECURITY
		},
		{
			typeId: OUTPOST_RIG,
			name: 'Upwell M3P-RF Outpost Rig',
			rigSize: 3,
			groupId: 1984,
			fitsGroupIds: [1657],
			bonuses: [{ activity: 'manufacturing', material: 0.03, filterId: null }],
			security: { highsec: 1, lowsec: 1, nullsec: 1, wormhole: 1 }
		}
	],
	structures: [
		{
			typeId: RAITARU,
			name: 'Raitaru',
			groupId: 1404,
			rigSize: 2,
			rigSlots: 3,
			material: { manufacturing: 0.01 }
		},
		{
			typeId: AZBEL,
			name: 'Azbel',
			groupId: 1404,
			rigSize: 3,
			rigSlots: 3,
			material: { manufacturing: 0.01 }
		},
		{
			typeId: SOTIYO,
			name: 'Sotiyo',
			groupId: 1404,
			rigSize: 4,
			rigSlots: 3,
			material: { manufacturing: 0.01 }
		},
		{ typeId: FORTIZAR, name: 'Fortizar', groupId: 1657, rigSize: 3, rigSlots: 3, material: {} },
		{ typeId: ATHANOR, name: 'Athanor', groupId: 1406, rigSize: 2, rigSlots: 3, material: {} },
		{ typeId: TATARA, name: 'Tatara', groupId: 1406, rigSize: 3, rigSlots: 3, material: {} },
		{
			typeId: TEST_REACTION_STRUCTURE,
			name: 'Test Refinery',
			groupId: 1406,
			rigSize: 3,
			rigSlots: 3,
			material: { reaction: 0.01 }
		}
	],
	productFilters: {
		[SPIKE_S]: [4],
		[FUSION_THRUSTER]: [14],
		[METHANOFULLERENE]: [16],
		[PURE_STANDARD_MINDFLOOD]: [17],
		[TITANIUM_CHROMIDE]: [18],
		[TITANIUM_CARBIDE]: [18]
	}
};
