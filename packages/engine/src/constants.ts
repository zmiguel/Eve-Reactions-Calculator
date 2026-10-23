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

/** SDE group "Moon Materials" (the raw materials moon mining yields). */
export const MOON_MATERIAL_GROUP_ID = 427;

/**
 * Rarity class of each raw moon material (R4 to R64, from the moon ore that yields it). The SDE has
 * no attribute for it; the SDE import warns `UNCLASSIFIED_MOON_MATERIAL:<typeId>` for a type of
 * {@link MOON_MATERIAL_GROUP_ID} missing here.
 */
export const MOON_MATERIAL_CLASS: Readonly<Record<number, 4 | 8 | 16 | 32 | 64>> = {
	16633: 4, // Hydrocarbons
	16634: 4, // Atmospheric Gases
	16635: 4, // Evaporite Deposits
	16636: 4, // Silicates
	16637: 8, // Tungsten
	16638: 8, // Titanium
	16639: 8, // Scandium
	16640: 8, // Cobalt
	16641: 16, // Chromium
	16642: 16, // Vanadium
	16643: 16, // Cadmium
	16644: 16, // Platinum
	16646: 32, // Mercury
	16647: 32, // Caesium
	16648: 32, // Hafnium
	16649: 32, // Technetium
	16650: 64, // Dysprosium
	16651: 64, // Neodymium
	16652: 64, // Promethium
	16653: 64 // Thulium
};

type OrderDataset = Pick<Dataset, 'types' | 'reactions'>;

interface ReactionRoles {
	produced: ReadonlySet<number>;
	consumed: ReadonlySet<number>;
}

const rolesCache = new WeakMap<Dataset['reactions'], ReactionRoles>();

function reactionRoles(dataset: OrderDataset): ReactionRoles {
	let roles = rolesCache.get(dataset.reactions);
	if (!roles) {
		const produced = new Set<number>();
		const consumed = new Set<number>();
		for (const r of dataset.reactions) {
			produced.add(r.product.typeId);
			for (const m of r.materials) consumed.add(m.typeId);
		}
		roles = { produced, consumed };
		rolesCache.set(dataset.reactions, roles);
	}
	return roles;
}

/**
 * Position of a type in material lists: fuel blocks (0), raw moon materials by class (R4 = 1 … R64 = 5),
 * other raw materials (6), intermediates (7: made by a reaction and used by another), anything else (8).
 */
function materialRank(dataset: OrderDataset, typeId: number): number {
	if (isFuelBlock(dataset, typeId)) return 0;
	const moonClass = MOON_MATERIAL_CLASS[typeId];
	if (moonClass !== undefined) return 1 + Math.log2(moonClass) - 2;
	const { produced, consumed } = reactionRoles(dataset);
	if (!produced.has(typeId)) return 6;
	return consumed.has(typeId) ? 7 : 8;
}

/** Compares two types in the {@link sortMaterials} order. */
export function compareMaterials(dataset: OrderDataset, a: number, b: number): number {
	const rank = materialRank(dataset, a) - materialRank(dataset, b);
	if (rank !== 0) return rank;
	const byName = (dataset.types[a]?.name ?? String(a)).localeCompare(dataset.types[b]?.name ?? String(b));
	return byName !== 0 ? byName : a - b;
}

/**
 * Material list order shown everywhere: fuel blocks first, then raw moon materials by class (R4, R8,
 * R16, R32, R64), then other raw materials, intermediates and anything else, each by name.
 */
export function sortMaterials<T extends { typeId: number }>(items: readonly T[], dataset: OrderDataset): T[] {
	return [...items].sort((a, b) => compareMaterials(dataset, a.typeId, b.typeId));
}
