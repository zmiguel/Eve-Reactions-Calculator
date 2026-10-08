export type Reactor = 'biochemical' | 'composite' | 'hybrid';

export type Tier =
	| 'intermediate'
	| 'composite'
	| 'unrefined'
	| 'unrefined_mineral'
	| 'polymer'
	| 'booster_synth'
	| 'booster_standard'
	| 'booster_improved'
	| 'booster_strong'
	| 'molecular_forged'
	| 'other';

export type SecurityBand = 'lowsec' | 'nullsec' | 'wormhole';

export interface Material {
	typeId: number;
	quantity: number;
}

export interface Reaction {
	blueprintTypeId: number;
	slug: string;
	/** Product name. */
	name: string;
	formulaName: string;
	reactor: Reactor;
	tier: Tier;
	baseTimeSeconds: number;
	maxRuns: number;
	requiredSkillLevel: number;
	product: Material;
	materials: Material[];
}

export interface TypeInfo {
	typeId: number;
	name: string;
	volume: number;
	portionSize: number;
	groupId: number;
}

export interface ReprocessMaterial {
	typeId: number;
	quantity: number | null;
	quantityMin: number | null;
	quantityMax: number | null;
}

export interface ReprocessEntry {
	typeId: number;
	portionSize: number;
	materials: ReprocessMaterial[];
}

export interface RigBonus {
	me: number;
	te: number;
}

export interface ReactionConstants {
	skillTimeBonusPerLevel: number;
	structureTimeMultiplier: { athanor: number; tatara: number };
	rig: { none: RigBonus; t1: RigBonus; t2: RigBonus };
	securityModifier: Record<SecurityBand, number>;
}

export interface Dataset {
	sdeBuild: number;
	reactions: Reaction[];
	types: Record<number, TypeInfo>;
	reprocess: Record<number, ReprocessEntry>;
	constants: ReactionConstants;
}

export interface HubPrice {
	buy: number | null;
	sell: number | null;
	/** Units listed on buy orders at the hub; absent when unknown (historical books). */
	buyVolume?: number;
	/** Units listed on sell orders at the hub; absent when unknown (historical books). */
	sellVolume?: number;
}

export interface PriceBook {
	asOf: string;
	approximate: boolean;
	hubs: Record<string, Record<number, HubPrice>>;
	adjusted: Record<number, number>;
}
