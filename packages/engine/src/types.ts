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

/**
 * A manufacturing blueprint profit tracking follows. Without `makes`: it uses at least one reaction
 * product (reaction output goes into manufacturing jobs) and `materials` lists only its reaction-product
 * materials. With `makes: 'material'`: its product is a reaction material (the fuel blocks), so its jobs
 * feed reactions, and `materials` lists every material. Quantities per run at base (ME 0, no structure
 * bonus). A blueprint that makes a reaction material counts as `material` even if it also uses a
 * reaction product.
 */
export interface ManufacturingBlueprint {
	blueprintTypeId: number;
	/** Blueprint name. Optional: datasets published before it lack it. */
	name?: string;
	productTypeId: number;
	/** Product name (for blueprints without `makes` the product is not in `Dataset.types`). Optional as `name`. */
	productName?: string;
	productQuantity: number;
	/** `material`: the product is a reaction material; absent = the blueprint uses reaction products. */
	makes?: 'material';
	materials: Material[];
}

/**
 * Names of a manufacturing blueprint and its product from `Dataset.manufacturing` (falling back to
 * `types`, then to the ids for datasets published before the names existed).
 */
export function manufacturingNames(
	dataset: Pick<Dataset, 'manufacturing' | 'types'> | null,
	blueprintTypeId: number
): { blueprint: string; productTypeId: number | null; product: string | null } {
	const bp = dataset?.manufacturing?.find((b) => b.blueprintTypeId === blueprintTypeId);
	const productTypeId = bp?.productTypeId ?? null;
	const product =
		bp?.productName ?? (productTypeId === null ? null : (dataset?.types[productTypeId]?.name ?? null));
	const blueprint =
		bp?.name ??
		dataset?.types[blueprintTypeId]?.name ??
		(product ? `${product} Blueprint` : `Blueprint ${blueprintTypeId}`);
	return { blueprint, productTypeId, product };
}

/** Security band of an industry facility's system, as the rig multipliers name it. */
export type IndustryBand = 'highsec' | 'lowsec' | 'nullsec' | 'wormhole';

/** Activities whose material bonuses profit tracking applies. */
export type IndustryActivity = 'manufacturing' | 'reaction';

/**
 * Which products a bonus applies to (game client industry target filter): a product matches when its
 * category or its group is listed.
 */
export interface IndustryFilter {
	filterId: number;
	name: string;
	categoryIds: number[];
	groupIds: number[];
}

/** A structure rig with a material bonus for manufacturing or reactions. */
export interface IndustryRig {
	typeId: number;
	name: string;
	/** Dogma `rigSize` (the structure must have the same). */
	rigSize: number;
	/**
	 * Rig group: one rig kind (its T1, T2 and faction variants). A structure fits at most one rig per
	 * group (dogma `maxGroupFitted` 1).
	 */
	groupId: number;
	/** Structure groups it fits (dogma `canFitShipGroup*`). */
	fitsGroupIds: number[];
	/** One entry per bonus (an L-Set reactor rig has one per reaction kind). */
	bonuses: {
		activity: IndustryActivity;
		/** Material reduction before the security multiplier, as a fraction (0.02 = 2 %). */
		material: number;
		/** Null = every product of the activity. */
		filterId: number | null;
	}[];
	/** Multiplier of `material` by the facility's band (dogma hi/low/null-sec modifiers; wormhole = nullsec). */
	security: Record<IndustryBand, number>;
}

/** An Upwell structure type that runs manufacturing or reaction jobs. */
export interface IndustryStructure {
	typeId: number;
	name: string;
	groupId: number;
	rigSize: number;
	/** Rig slots (dogma `upgradeSlotsLeft`). */
	rigSlots: number;
	/** Role material reduction per activity as a fraction (Raitaru manufacturing 0.01); absent = none. */
	material: Partial<Record<IndustryActivity, number>>;
}

/**
 * Industry bonus data: SDE dogma joined with the game client's industry modifier sources and target
 * filters (fetched from Hoboleaks at SDE sync).
 */
export interface IndustryData {
	filters: IndustryFilter[];
	rigs: IndustryRig[];
	structures: IndustryStructure[];
	/** Filter ids matching each reaction and manufacturing product (product type id as key). */
	productFilters: Record<number, number[]>;
}

export interface Dataset {
	sdeBuild: number;
	reactions: Reaction[];
	types: Record<number, TypeInfo>;
	reprocess: Record<number, ReprocessEntry>;
	constants: ReactionConstants;
	/**
	 * Manufacturing blueprints using reaction products or making reaction materials (`makes`). Optional
	 * so datasets published before it existed still load (treated as none).
	 */
	manufacturing?: ManufacturingBlueprint[];
	/** Industry bonus data. Optional: datasets published before it existed have none (no rig bonuses known). */
	industry?: IndustryData;
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
