/** Inventory rows for `web-unit` tests: sources, places, items and selection written straight to D1. */
import { inventoryRole, inventoryTypeIds, type Dataset, type InventoryRole } from '@reactions/engine';
import { ESI_FEATURES, formatScopes } from '@reactions/eve';
import type { FakeD1 } from './fakes.ts';
import { NOW } from './fixtures.ts';

/** Gives a stored character a working token with the scopes of `features`. */
export function grantInventory(db: FakeD1, characterId: number, features: ('assets' | 'corp_assets')[]) {
	db.sqlite
		.prepare(
			"UPDATE characters SET scopes = ?, refresh_token_enc = 'enc', token_status = 'ok' WHERE character_id = ?"
		)
		.run(formatScopes(features.flatMap((f) => ESI_FEATURES[f])), characterId);
}

export interface SourceFixture {
	userId: string;
	characterId: number;
	kind?: 'character' | 'corporation';
	ownerId?: number;
	ownerName?: string;
	status?: string;
	divisionNames?: Record<string, string>;
	syncStartedAt?: number | null;
	lastSyncedAt?: number | null;
	dataAsOf?: number | null;
	dataExpiresAt?: number | null;
	createdAt?: number;
}

/** Inserts a source (`ok`, personal by default; a corporation's reader joins its pool); returns its id. */
export function insertSource(db: FakeD1, source: SourceFixture): number {
	const kind = source.kind ?? 'character';
	const row = db.sqlite
		.prepare(
			`INSERT INTO inventory_sources (user_id, character_id, kind, owner_id, owner_name, division_names_json,
				status, sync_started_at, last_synced_at, data_as_of, data_expires_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING source_id`
		)
		.get(
			source.userId,
			source.characterId,
			kind,
			source.ownerId ?? source.characterId,
			source.ownerName ?? `Owner ${source.ownerId ?? source.characterId}`,
			source.divisionNames ? JSON.stringify(source.divisionNames) : null,
			source.status ?? 'ok',
			source.syncStartedAt ?? null,
			source.lastSyncedAt === undefined ? NOW - 3_600_000 : source.lastSyncedAt,
			source.dataAsOf === undefined ? NOW - 4_000_000 : source.dataAsOf,
			source.dataExpiresAt ?? null,
			source.createdAt ?? NOW
		) as { source_id: number };
	if (kind === 'corporation') addReader(db, row.source_id, source.characterId, source.createdAt ?? NOW);
	return row.source_id;
}

/** Adds `characterId` to the reader pool of corporation source `sourceId`. */
export function addReader(db: FakeD1, sourceId: number, characterId: number, createdAt = NOW) {
	db.sqlite
		.prepare('INSERT INTO inventory_source_readers (source_id, character_id, created_at) VALUES (?, ?, ?)')
		.run(sourceId, characterId, createdAt);
}

/** Pool of `sourceId`: character ids in the order they were added. */
export function poolOf(db: FakeD1, sourceId: number): number[] {
	return db
		.rows<{
			character_id: number;
		}>(
			'SELECT character_id FROM inventory_source_readers WHERE source_id = ? ORDER BY created_at, character_id',
			sourceId
		)
		.map((r) => r.character_id);
}

export function insertLocation(
	db: FakeD1,
	sourceId: number,
	locationId: number,
	place: { kind?: 'station' | 'structure' | 'unknown'; name?: string | null; systemId?: number | null } = {}
) {
	db.sqlite
		.prepare(
			'INSERT INTO inventory_locations (source_id, location_id, kind, name, system_id) VALUES (?, ?, ?, ?, ?)'
		)
		.run(sourceId, locationId, place.kind ?? 'station', place.name ?? null, place.systemId ?? null);
}

export function insertItems(
	db: FakeD1,
	sourceId: number,
	locationId: number,
	bucket: string,
	items: Record<number, number>
) {
	const insert = db.sqlite.prepare(
		'INSERT INTO inventory_items (source_id, location_id, bucket, type_id, quantity) VALUES (?, ?, ?, ?, ?)'
	);
	for (const [typeId, quantity] of Object.entries(items))
		insert.run(sourceId, locationId, bucket, Number(typeId), quantity);
}

export function selectBucket(db: FakeD1, sourceId: number, locationId: number, bucket: string) {
	db.sqlite
		.prepare('INSERT INTO inventory_selection (source_id, location_id, bucket) VALUES (?, ?, ?)')
		.run(sourceId, locationId, bucket);
}

export const selection = (db: FakeD1, sourceId: number) =>
	db
		.rows<{ location_id: number; bucket: string }>(
			'SELECT location_id, bucket FROM inventory_selection WHERE source_id = ? ORDER BY location_id, bucket',
			sourceId
		)
		.map((r) => `${r.location_id}:${r.bucket}`);

/** The lowest type id of each inventory role in `dataset`. */
export function typesByRole(dataset: Dataset): Record<InventoryRole, number> {
	const found: Partial<Record<InventoryRole, number>> = {};
	for (const typeId of [...inventoryTypeIds(dataset)].sort((a, b) => a - b)) {
		const role = inventoryRole(dataset, typeId);
		if (role && found[role] === undefined) found[role] = typeId;
	}
	return found as Record<InventoryRole, number>;
}
