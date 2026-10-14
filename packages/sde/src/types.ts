import type { Dataset, IndustryActivity, IndustryFilter, Material, TypeInfo } from '@reactions/engine';

/** Localized SDE text (`name`, `description`); only English is used. */
export type SdeText = string | { en?: string };

/** Shapes of the SDE JSONL lines read by the parser (fields not read are omitted). */
export interface SdeMetaLine {
	_key: string;
	buildNumber?: number;
	releaseDate?: string;
}

export interface SdeBlueprintLine {
	_key: number;
	blueprintTypeID?: number;
	maxProductionLimit?: number;
	activities?: {
		reaction?: {
			time?: number;
			materials?: { typeID: number; quantity: number }[];
			products?: { typeID: number; quantity: number }[];
			skills?: { typeID: number; level: number }[];
		};
		manufacturing?: {
			materials?: { typeID: number; quantity: number }[];
			products?: { typeID: number; quantity: number }[];
		};
	};
}

export interface SdeTypeLine {
	_key: number;
	name?: SdeText;
	groupID?: number;
	volume?: number;
	portionSize?: number;
	published?: boolean;
	basePrice?: number;
}

export interface SdeGroupLine {
	_key: number;
	name?: SdeText;
	categoryID?: number;
}

export interface SdeTypeMaterialsLine {
	_key: number;
	materials?: { materialTypeID: number; quantity: number }[];
	randomizedMaterials?: { materialTypeID: number; quantityMin: number; quantityMax: number }[];
}

export interface SdeTypeDogmaLine {
	_key: number;
	dogmaAttributes?: { attributeID: number; value: number }[];
	dogmaEffects?: { effectID: number }[];
}

export interface SdeDogmaAttributeLine {
	_key: number;
	name?: string;
}

export interface SdeDogmaEffectLine {
	_key: number;
	modifierInfo?: {
		domain?: string;
		func?: string;
		modifiedAttributeID?: number;
		modifyingAttributeID?: number;
		operation?: number;
	}[];
}

export interface SdeSolarSystemLine {
	_key: number;
	name?: SdeText;
	regionID: number;
	constellationID: number;
	securityStatus?: number;
}

export interface SdeRegionLine {
	_key: number;
	name?: SdeText;
}

/** Projection of a `blueprints.jsonl` line that has `activities.reaction`. */
export interface RawBlueprint {
	blueprintTypeId: number;
	maxProductionLimit: number;
	time: number;
	materials: Material[];
	products: Material[];
	skills: { typeId: number; level: number }[];
}

/** Projection of a `blueprints.jsonl` line that has `activities.manufacturing`. */
export interface RawManufacturingBlueprint {
	blueprintTypeId: number;
	materials: Material[];
	products: Material[];
}

/** Projection of a `types.jsonl` line. */
export interface RawType {
	typeId: number;
	name: string;
	groupId: number;
	volume: number | null;
	portionSize: number | null;
	published: boolean;
	basePrice: number | null;
}

export interface RawGroup {
	groupId: number;
	name: string;
	categoryId: number;
}

export interface RawTypeMaterials {
	typeId: number;
	materials: { materialTypeId: number; quantity: number }[];
	randomizedMaterials: { materialTypeId: number; quantityMin: number; quantityMax: number }[];
}

export interface RawTypeDogma {
	typeId: number;
	attributes: { attributeId: number; value: number }[];
	effectIds: number[];
}

export interface RawDogmaAttribute {
	attributeId: number;
	name: string;
}

/** A dogma effect with its modifiers of the item's structure (`domain: structureID`, `ItemModifier`). */
export interface RawDogmaEffect {
	effectId: number;
	structureModifiers: { modifiedAttributeId: number; modifyingAttributeId: number; operation: number }[];
}

export interface RawSystem {
	systemId: number;
	name: string;
	regionId: number;
	constellationId: number;
	securityStatus: number;
}

export interface RawRegion {
	regionId: number;
	name: string;
}

/** Everything `readSdeZip` extracts from an SDE archive, before normalization. */
export interface RawSde {
	build: number | null;
	releaseDate: string | null;
	blueprints: RawBlueprint[];
	manufacturing: RawManufacturingBlueprint[];
	types: RawType[];
	groups: RawGroup[];
	typeMaterials: RawTypeMaterials[];
	typeDogma: RawTypeDogma[];
	dogmaAttributes: RawDogmaAttribute[];
	/** Effects that modify the structure an item is fitted to (rig bonuses). */
	dogmaEffects: RawDogmaEffect[];
	systems: RawSystem[];
	regions: RawRegion[];
	/** Wanted file names that were fully read from the archive. */
	files: string[];
}

/** A material bonus source of the game client industry data, for one activity. */
export interface IndustryModifierSource {
	/** Structure dogma attribute the bonus modifies. */
	dogmaAttributeId: number;
	/** Target filter id; null = every product of the activity. */
	filterId: number | null;
}

/**
 * Game client industry data (Hoboleaks `industrymodifiersources.json` and `industrytargetfilters.json`)
 * reduced to what `normalize` reads.
 */
export interface IndustrySources {
	/**
	 * Type id → activity it is listed for → its material bonus sources (empty when it only has time or
	 * cost bonuses for that activity).
	 */
	modifierSources: Map<number, Partial<Record<IndustryActivity, IndustryModifierSource[]>>>;
	filters: IndustryFilter[];
}

export type SystemSecurityBand = 'highsec' | 'lowsec' | 'nullsec' | 'wormhole';

export interface SdeType extends TypeInfo {
	categoryId: number;
	published: boolean;
	basePrice: number | null;
}

export interface SdeSystem {
	systemId: number;
	name: string;
	regionId: number;
	securityStatus: number;
	securityBand: SystemSecurityBand;
}

export interface SdeRegion {
	regionId: number;
	name: string;
}

export interface SdeDataset {
	build: number;
	releaseDate: string;
	dataset: Dataset;
	/** Tracked types only: reaction formulas, their materials and products, reprocess outputs. */
	types: SdeType[];
	regions: SdeRegion[];
	/** All systems with `regionId < 12000000`. */
	systems: SdeSystem[];
	warnings: string[];
}
