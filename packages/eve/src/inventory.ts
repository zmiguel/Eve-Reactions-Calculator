import type { AssetRow } from './assets.ts';

/** Hangar buckets of `resolveInventory`, plus `jobs` for formulas installed in reaction jobs (`jobsInventory`). */
export type InventoryBucket =
	'hangar' | 'deliveries' | 'jobs' | 'div1' | 'div2' | 'div3' | 'div4' | 'div5' | 'div6' | 'div7';

export interface InventoryLocation {
	locationId: number;
	kind: 'station' | 'structure';
}

export interface InventoryItem {
	locationId: number;
	bucket: InventoryBucket;
	typeId: number;
	quantity: number;
}

export interface ResolvedInventory {
	locations: InventoryLocation[];
	items: InventoryItem[];
}

const MAX_HOPS = 10;

const BUCKET_BY_FLAG: Record<string, InventoryBucket> = {
	Hangar: 'hangar',
	Deliveries: 'deliveries',
	CorpDeliveries: 'deliveries',
	CorpSAG1: 'div1',
	CorpSAG2: 'div2',
	CorpSAG3: 'div3',
	CorpSAG4: 'div4',
	CorpSAG5: 'div5',
	CorpSAG6: 'div6',
	CorpSAG7: 'div7'
};

/** Flags an item may sit under on its way to a station or structure; anything else (ship holds, fittings, asset safety) is dropped. */
const WALKABLE_FLAGS = new Set([
	...Object.keys(BUCKET_BY_FLAG),
	'Unlocked',
	'Locked',
	'AutoFit',
	'OfficeFolder'
]);

export function isStationId(id: number): boolean {
	return id >= 60_000_000 && id <= 63_999_999;
}

type Root = InventoryLocation & { bucket: InventoryBucket };

function resolveRoot(row: AssetRow, byId: ReadonlyMap<number, AssetRow>): Root | null {
	let bucket: InventoryBucket | null = null;
	let current = row;
	for (let hop = 0; hop <= MAX_HOPS; hop++) {
		const flag = current.locationFlag;
		if (!WALKABLE_FLAGS.has(flag)) return null;
		bucket = BUCKET_BY_FLAG[flag] ?? bucket;
		const locationId = current.locationId;
		const at = (kind: InventoryLocation['kind'], id: number): Root | null =>
			bucket ? { locationId: id, kind, bucket } : null;
		if (isStationId(locationId)) return at('station', locationId);
		if (flag === 'OfficeFolder') return at('structure', locationId);
		const parent = byId.get(locationId);
		if (!parent) return at('structure', locationId);
		if (parent.locationType === 'solar_system') return at('structure', parent.itemId);
		current = parent;
	}
	return null;
}

/**
 * Reduces raw asset rows to the `relevant` types per station/structure and hangar bucket: walks each
 * row up its containers to the station or structure, keeps the hangar flag closest to that root and
 * sums quantities per (location, bucket, type). Pure; output sorted by location, bucket, type.
 */
export function resolveInventory(
	rows: readonly AssetRow[],
	relevant: ReadonlySet<number>
): ResolvedInventory {
	const byId = new Map(rows.map((r) => [r.itemId, r]));
	const locations = new Map<number, InventoryLocation>();
	const items = new Map<string, InventoryItem>();
	for (const row of rows) {
		if (!relevant.has(row.typeId)) continue;
		const root = resolveRoot(row, byId);
		if (!root) continue;
		if (!locations.has(root.locationId))
			locations.set(root.locationId, { locationId: root.locationId, kind: root.kind });
		const key = `${root.locationId}:${root.bucket}:${row.typeId}`;
		const item = items.get(key);
		if (item) item.quantity += row.quantity;
		else
			items.set(key, {
				locationId: root.locationId,
				bucket: root.bucket,
				typeId: row.typeId,
				quantity: row.quantity
			});
	}
	return {
		locations: [...locations.values()].sort((a, b) => a.locationId - b.locationId),
		items: [...items.values()].sort(
			(a, b) =>
				a.locationId - b.locationId ||
				(a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0) ||
				a.typeId - b.typeId
		)
	};
}

/** A structure in an owner's assets with the rigs fitted in its `RigSlot0`–`RigSlot7`. */
export interface FittedStructure {
	structureId: number;
	/** Structure type; null when the rigs sit in an item that is not one of the structure types asked for. */
	typeId: number | null;
	/** The structure's solar system; null as for `typeId`. */
	systemId: number | null;
	/** Fitted rig type ids among the rigs asked for, sorted. */
	rigs: number[];
}

const RIG_SLOT = /^RigSlot[0-7]$/;

/**
 * Structures in corporation assets and their fitted rigs of `rigTypeIds`. An owned Upwell structure is
 * an asset in space (`location_type` `solar_system`, `item_id` = structure id) and its rigs are assets
 * located in it with a `RigSlot*` flag, so a structure of `structureTypeIds` is returned even without
 * such a rig (`rigs: []`: the owner's assets show it has none). Pure; sorted by structure id.
 */
export function fittedStructures(
	rows: readonly AssetRow[],
	structureTypeIds: ReadonlySet<number>,
	rigTypeIds: ReadonlySet<number>
): FittedStructure[] {
	const structures = new Map<number, FittedStructure>();
	for (const row of rows)
		if (row.locationType === 'solar_system' && structureTypeIds.has(row.typeId))
			structures.set(row.itemId, {
				structureId: row.itemId,
				typeId: row.typeId,
				systemId: row.locationId,
				rigs: []
			});
	for (const row of rows) {
		if (!RIG_SLOT.test(row.locationFlag) || !rigTypeIds.has(row.typeId)) continue;
		let structure = structures.get(row.locationId);
		if (!structure) {
			structure = { structureId: row.locationId, typeId: null, systemId: null, rigs: [] };
			structures.set(row.locationId, structure);
		}
		structure.rigs.push(row.typeId);
	}
	const list = [...structures.values()].sort((a, b) => a.structureId - b.structureId);
	for (const s of list) s.rigs.sort((a, b) => a - b);
	return list;
}
