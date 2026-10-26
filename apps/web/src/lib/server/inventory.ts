import {
	characters,
	getCoreDb,
	inventoryItems,
	inventoryLocations,
	inventorySelection,
	inventorySourceReaders,
	inventorySources,
	systems,
	type InventorySourceRow
} from '@reactions/db';
import { inventoryRole, stockUnitValue, type CalcContext, type Dataset } from '@reactions/engine';
import { hasFeature, type FetchFn, type InventoryBucket } from '@reactions/eve';
import { and, asc, count, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { formatUtc } from '#lib/format.js';
import type {
	ConnectionFeature,
	InventoryAddGroup,
	InventoryAddOption,
	InventoryAllowLink,
	InventoryBucketView,
	InventoryFormulaView,
	InventoryMaterialView,
	InventoryPageData,
	InventoryPlaceView,
	InventoryRole,
	InventorySourcePlacesView,
	InventorySourceStatus,
	InventorySummaryView
} from '#lib/inventory/types.js';
import type { CharacterRow } from './auth/accounts.ts';
import { handOverPreferredReader } from './auth/accounts.ts';
import { lookUpAffiliations } from './affiliations.ts';
import { getDataset } from './data.ts';
import type { UpdaterApi, UpdaterNotice } from './updater.ts';

/** Connections one account may add. */
export const INVENTORY_SOURCE_LIMIT = 10;
/** A `running` sync older than this did not finish (the updater's `INVENTORY_RUN_STALE_MINUTES`). */
export const INVENTORY_RUN_STALE_MINUTES = 15;
/** A `running` tracking sync older than this did not finish (the updater's `TRACKING_RUN_STALE_MINUTES`). */
export const TRACKING_RUN_STALE_MINUTES = 15;
/** `last_error` of a sync that stayed `running` too long (the updater's `STALE_SYNC_ERROR`). */
export const STALE_SYNC_ERROR = 'sync did not finish';

export type InventorySourceKind = 'character' | 'corporation';
/** A connection's two switches. */
export type ConnectionSwitch = 'inventory' | 'tracking';

/** Buckets in display order. */
export const INVENTORY_BUCKETS: readonly InventoryBucket[] = [
	'hangar',
	'div1',
	'div2',
	'div3',
	'div4',
	'div5',
	'div6',
	'div7',
	'deliveries',
	'jobs'
];

export function isInventoryBucket(value: string): value is InventoryBucket {
	return (INVENTORY_BUCKETS as readonly string[]).includes(value);
}

/** The feature a switch needs, per connection kind. */
export const SWITCH_FEATURES: Record<ConnectionSwitch, Record<InventorySourceKind, ConnectionFeature>> = {
	inventory: { character: 'assets', corporation: 'corp_assets' },
	tracking: { character: 'tracking', corporation: 'corp_tracking' }
};

/** A character can use `feature`: a working token with the feature's scopes. */
export function canRead(
	character: Pick<CharacterRow, 'scopes' | 'tokenStatus'>,
	feature: ConnectionFeature
): boolean {
	return character.tokenStatus === 'ok' && hasFeature(character.scopes, feature);
}

/** A character can read a connection of `kind` with at least one of its switches. */
function canConnect(
	character: Pick<CharacterRow, 'scopes' | 'tokenStatus'>,
	kind: InventorySourceKind
): boolean {
	return (
		canRead(character, SWITCH_FEATURES.inventory[kind]) || canRead(character, SWITCH_FEATURES.tracking[kind])
	);
}

/** "Allow" link granting `feature` to `character`, back to `/account/connections`. */
export function connectionAllowLink(
	character: Pick<CharacterRow, 'characterId' | 'name'>,
	feature: ConnectionFeature
): InventoryAllowLink {
	return {
		characterId: character.characterId,
		characterName: character.name,
		feature,
		href: `/auth/login?purpose=feature&feature=${feature}&characterId=${character.characterId}&returnTo=%2Faccount%2Fconnections`
	};
}

export type InventorySourceListing = InventorySourceRow & { characterName: string };

/**
 * The account's connections (oldest first) with the name of the character reading them. An inventory
 * or tracking sync `running` for more than `INVENTORY_RUN_STALE_MINUTES` / `TRACKING_RUN_STALE_MINUTES`
 * is marked `error` ("sync did not finish") first, the rule the updater applies.
 */
export async function listSources(
	env: Env,
	userId: string,
	now = Date.now()
): Promise<InventorySourceListing[]> {
	const db = getCoreDb(env.DB);
	const rows = await db
		.select({ source: inventorySources, characterName: characters.name })
		.from(inventorySources)
		.innerJoin(characters, eq(characters.characterId, inventorySources.characterId))
		.where(eq(inventorySources.userId, userId))
		.orderBy(asc(inventorySources.createdAt), asc(inventorySources.sourceId));
	const sources = rows.map((r) => r.source);
	const staleBefore = now - INVENTORY_RUN_STALE_MINUTES * 60_000;
	const stale = sources.filter(
		(s) => s.status === 'running' && (s.syncStartedAt === null || s.syncStartedAt <= staleBefore)
	);
	if (stale.length > 0) {
		await db
			.update(inventorySources)
			.set({ status: 'error', lastError: STALE_SYNC_ERROR })
			.where(
				and(
					inArray(
						inventorySources.sourceId,
						stale.map((s) => s.sourceId)
					),
					eq(inventorySources.status, 'running'),
					or(isNull(inventorySources.syncStartedAt), lte(inventorySources.syncStartedAt, staleBefore))
				)
			);
		for (const source of stale) Object.assign(source, { status: 'error', lastError: STALE_SYNC_ERROR });
	}
	const trackingStaleBefore = now - TRACKING_RUN_STALE_MINUTES * 60_000;
	const staleTracking = sources.filter(
		(s) =>
			s.trackingStatus === 'running' &&
			(s.trackingStartedAt === null || s.trackingStartedAt <= trackingStaleBefore)
	);
	if (staleTracking.length > 0) {
		await db
			.update(inventorySources)
			.set({ trackingStatus: 'error', trackingLastError: STALE_SYNC_ERROR })
			.where(
				and(
					inArray(
						inventorySources.sourceId,
						staleTracking.map((s) => s.sourceId)
					),
					eq(inventorySources.trackingStatus, 'running'),
					or(
						isNull(inventorySources.trackingStartedAt),
						lte(inventorySources.trackingStartedAt, trackingStaleBefore)
					)
				)
			);
		for (const source of staleTracking) {
			Object.assign(source, { trackingStatus: 'error', trackingLastError: STALE_SYNC_ERROR });
		}
	}
	return rows.map((r) => ({ ...r.source, characterName: r.characterName }));
}

/** The account's source `sourceId`, or undefined when it has no such source. */
export async function getSource(
	env: Env,
	userId: string,
	sourceId: number
): Promise<InventorySourceRow | undefined> {
	const [row] = await getCoreDb(env.DB)
		.select()
		.from(inventorySources)
		.where(and(eq(inventorySources.sourceId, sourceId), eq(inventorySources.userId, userId)));
	return row;
}

const esiUnavailable = 'EVE Online did not answer. Try again later.';

/** The character's corporation id and name are known. */
const hasCorporation = (
	c: CharacterRow
): c is CharacterRow & { corporationId: number; corporationName: string } =>
	c.corporationId !== null && Boolean(c.corporationName);

/**
 * `rows` with the corporation (and alliance) of those that can read a corporation connection but have
 * no corporation name filled in by {@link lookUpAffiliations} (stored on `characters`). Characters ESI
 * does not answer for (all of them when ESI fails) stay without a corporation.
 */
export async function resolveCorporations(
	env: Env,
	fetch: FetchFn,
	rows: readonly CharacterRow[],
	now: number
): Promise<CharacterRow[]> {
	const missing = rows.filter((c) => canConnect(c, 'corporation') && !hasCorporation(c));
	if (missing.length === 0) return [...rows];
	const found = await lookUpAffiliations(
		env,
		fetch,
		missing.map((c) => c.characterId),
		now
	);
	return rows.map((c) => ({ ...c, ...found.get(c.characterId) }));
}

/**
 * Adds character `?3` of account `?1` to the reader pool of the account's source of corporation `?2`
 * (no row when either is not the account's, or it is in the pool already).
 */
const JOIN_POOL_SQL = `
	INSERT INTO inventory_source_readers (source_id, character_id, created_at)
	SELECT s.source_id, c.character_id, ?4
	FROM inventory_sources s JOIN characters c ON c.user_id = s.user_id
	WHERE s.user_id = ?1 AND s.kind = 'corporation' AND s.owner_id = ?2 AND c.character_id = ?3
	ON CONFLICT DO NOTHING`;

export type AddSourceOutcome =
	| {
			ok: true;
			joined?: undefined;
			sourceId: number;
			ownerName: string;
			/** The switches the new connection starts with: each one whose feature the reader has. */
			inventory: boolean;
			tracking: boolean;
	  }
	/** The corporation is already a connection: the character joined its reader pool (no sync started). */
	| { ok: true; joined: true; message: string }
	| { ok: false; joined?: undefined; message: string; allow?: InventoryAllowLink };

/**
 * Adds the character (`character`) or the corporation of `character` as a connection: Inventory on when
 * the character has the (corporation) assets feature, Profit tracking on when it has the (corporation)
 * tracking feature, each sync `pending`; at least one of them is needed. Stays within
 * `INVENTORY_SOURCE_LIMIT`; a personal owner already on the account is refused. A corporation comes from
 * the character's affiliation columns, else from public ESI; the new connection's reader pool starts
 * with `character`. A corporation the account already has (only this account's connections count) gets
 * `character` added to its pool instead.
 */
export async function addSource(
	env: Env,
	fetch: FetchFn,
	userId: string,
	character: CharacterRow,
	kind: InventorySourceKind,
	now = Date.now()
): Promise<AddSourceOutcome> {
	if (character.userId !== userId) return { ok: false, message: 'Pick one of your characters.' };
	const inventory = canRead(character, SWITCH_FEATURES.inventory[kind]);
	const tracking = canRead(character, SWITCH_FEATURES.tracking[kind]);
	if (!inventory && !tracking) {
		return {
			ok: false,
			message:
				kind === 'character'
					? `Allow personal assets or profit tracking for ${character.name} first.`
					: `Allow corporation assets or corporation profit tracking for ${character.name} first.`,
			allow: connectionAllowLink(character, SWITCH_FEATURES.inventory[kind])
		};
	}
	const db = getCoreDb(env.DB);
	let owner = { id: character.characterId, name: character.name };
	let existing = false;
	if (kind === 'corporation') {
		const [resolved] = await resolveCorporations(env, fetch, [character], now);
		if (!hasCorporation(resolved)) return { ok: false, message: esiUnavailable };
		owner = { id: resolved.corporationId, name: resolved.corporationName };
		const [source] = await db
			.select({ sourceId: inventorySources.sourceId })
			.from(inventorySources)
			.where(
				and(
					eq(inventorySources.userId, userId),
					eq(inventorySources.kind, 'corporation'),
					eq(inventorySources.ownerId, owner.id)
				)
			);
		existing = source !== undefined;
	}
	if (!existing) {
		const [{ sources }] = await db
			.select({ sources: count() })
			.from(inventorySources)
			.where(eq(inventorySources.userId, userId));
		if (sources >= INVENTORY_SOURCE_LIMIT) {
			return { ok: false, message: `You can add up to ${INVENTORY_SOURCE_LIMIT} connections.` };
		}
	}

	const insert = env.DB.prepare(
		`INSERT INTO inventory_sources (user_id, character_id, kind, owner_id, owner_name, status, created_at,
			inventory_enabled, tracking_enabled, tracking_status)
		VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, CASE WHEN ?8 = 1 THEN 'pending' END)
		ON CONFLICT DO NOTHING RETURNING source_id`
	).bind(userId, character.characterId, kind, owner.id, owner.name, now, Number(inventory), Number(tracking));
	const switches = { ownerName: owner.name, inventory, tracking };
	if (kind === 'character') {
		const row = await insert.first<{ source_id: number }>();
		if (!row) return { ok: false, message: 'This connection is already on your list.' };
		return { ok: true, sourceId: row.source_id, ...switches };
	}
	// The source (unless the account has it already) and its pool row in one transaction.
	const join = env.DB.prepare(JOIN_POOL_SQL).bind(userId, owner.id, character.characterId, now);
	let pooled: number;
	if (existing) pooled = (await join.run()).meta.changes;
	else {
		const [inserted, joined] = await env.DB.batch([insert, join]);
		const row = inserted?.results[0] as { source_id: number } | undefined;
		if (row) return { ok: true, sourceId: row.source_id, ...switches };
		pooled = joined?.meta.changes ?? 0;
	}
	if (pooled > 0) {
		return {
			ok: true,
			joined: true,
			message: `${character.name} will also be used to read ${owner.name}.`
		};
	}
	return { ok: false, message: `${character.name} already reads ${owner.name}.` };
}

export type RemoveReaderOutcome =
	{ ok: true; message: string } | { ok: false; status: 400 | 404; message: string };

/**
 * Takes character `characterId` out of the reader pool of the account's corporation source `sourceId`.
 * The last pool member stays (the user removes the source instead); removing the preferred reader hands
 * the source to another pool member first (`handOverPreferredReader`).
 */
export async function removeReader(
	env: Env,
	userId: string,
	sourceId: number,
	characterId: number
): Promise<RemoveReaderOutcome> {
	const source = await getSource(env, userId, sourceId);
	if (!source || source.kind !== 'corporation') {
		return { ok: false, status: 404, message: 'That connection is not on your list.' };
	}
	const pool = await poolsOf(env, userId, [sourceId]);
	const reader = pool.find((r) => r.characterId === characterId);
	if (!reader)
		return { ok: false, status: 400, message: `That character does not read ${source.ownerName}.` };
	if (pool.length === 1) {
		return {
			ok: false,
			status: 400,
			message: `${reader.name} is the only character reading ${source.ownerName}. Remove the connection instead.`
		};
	}
	// Hand-over and delete in one transaction; the delete keeps the last member and the preferred reader.
	const [, removed] = await env.DB.batch([
		handOverPreferredReader(env, userId, characterId, sourceId),
		env.DB.prepare(
			`DELETE FROM inventory_source_readers
			WHERE source_id = ?1 AND character_id = ?2
				AND EXISTS (SELECT 1 FROM inventory_sources s
					WHERE s.source_id = ?1 AND s.user_id = ?3 AND s.character_id <> ?2)
				AND (SELECT count(*) FROM inventory_source_readers WHERE source_id = ?1) > 1`
		).bind(sourceId, characterId, userId)
	]);
	if ((removed.meta.changes ?? 0) === 0) {
		return { ok: false, status: 400, message: `${reader.name} is still needed to read ${source.ownerName}.` };
	}
	return { ok: true, message: `${reader.name} no longer reads ${source.ownerName}.` };
}

export interface PoolMember {
	sourceId: number;
	characterId: number;
	name: string;
}

/** Reader pools of the account's sources `sourceIds` (only its own characters), in the order added. */
export function poolsOf(env: Env, userId: string, sourceIds: number[]): Promise<PoolMember[]> {
	return getCoreDb(env.DB)
		.select({
			sourceId: inventorySourceReaders.sourceId,
			characterId: inventorySourceReaders.characterId,
			name: characters.name
		})
		.from(inventorySourceReaders)
		.innerJoin(inventorySources, eq(inventorySources.sourceId, inventorySourceReaders.sourceId))
		.innerJoin(characters, eq(characters.characterId, inventorySourceReaders.characterId))
		.where(
			and(
				inArray(inventorySourceReaders.sourceId, sourceIds),
				eq(inventorySources.userId, userId),
				eq(characters.userId, userId)
			)
		)
		.orderBy(asc(inventorySourceReaders.createdAt), asc(inventorySourceReaders.characterId));
}

/** Deletes the account's source with its places, items and selection. `false` when there is no such source. */
export async function removeSource(env: Env, userId: string, sourceId: number): Promise<boolean> {
	const deleted = await getCoreDb(env.DB)
		.delete(inventorySources)
		.where(and(eq(inventorySources.sourceId, sourceId), eq(inventorySources.userId, userId)))
		.returning({ sourceId: inventorySources.sourceId });
	return deleted.length > 0;
}

export interface InventoryPlaceKey {
	locationId: number;
	bucket: InventoryBucket;
}

export type SelectionChoice = { mode: 'all' | 'none' } | { places: InventoryPlaceKey[] };

/** Rows per selection insert: 3 bound values each, under D1's 100 bound parameters. */
const SELECTION_CHUNK = 30;

const placeKey = (p: { locationId: number; bucket: string }) => `${p.locationId}:${p.bucket}`;

/**
 * Replaces the selection of the account's source `sourceId`. Only buckets holding items of the source
 * or already selected can be chosen (`all` = every one of them); anything else is `invalid` and nothing
 * is written. `missing` when the account has no such source.
 */
export async function saveSelection(
	env: Env,
	userId: string,
	sourceId: number,
	choice: SelectionChoice
): Promise<'saved' | 'missing' | 'invalid'> {
	if (!(await getSource(env, userId, sourceId))) return 'missing';
	const db = getCoreDb(env.DB);
	const [present, selected] = await Promise.all([
		db
			.selectDistinct({ locationId: inventoryItems.locationId, bucket: inventoryItems.bucket })
			.from(inventoryItems)
			.where(eq(inventoryItems.sourceId, sourceId)),
		db
			.select({ locationId: inventorySelection.locationId, bucket: inventorySelection.bucket })
			.from(inventorySelection)
			.where(eq(inventorySelection.sourceId, sourceId))
	]);
	const allowed = new Map([...present, ...selected].map((p) => [placeKey(p), p]));
	let chosen: { locationId: number; bucket: string }[];
	if ('mode' in choice) chosen = choice.mode === 'all' ? [...allowed.values()] : [];
	else {
		if (choice.places.some((p) => !allowed.has(placeKey(p)))) return 'invalid';
		chosen = [...new Map(choice.places.map((p) => [placeKey(p), p])).values()];
	}
	const rows = chosen.map((p) => ({ sourceId, locationId: p.locationId, bucket: p.bucket }));
	const inserts = [];
	for (let start = 0; start < rows.length; start += SELECTION_CHUNK) {
		inserts.push(db.insert(inventorySelection).values(rows.slice(start, start + SELECTION_CHUNK)));
	}
	await db.batch([
		db.delete(inventorySelection).where(eq(inventorySelection.sourceId, sourceId)),
		...inserts
	]);
	return 'saved';
}

/** Statuses whose stored items count: synced, or failed after an earlier sync kept the data. */
const USABLE_STATUSES = ['ok', 'error'];

const isFormula = (dataset: Dataset | null, typeId: number) =>
	dataset !== null && inventoryRole(dataset, typeId) === 'formula';

export interface UserInventorySource {
	sourceId: number;
	ownerName: string;
	kind: InventorySourceKind;
	status: InventorySourceStatus;
	lastSyncedAt: number | null;
	dataAsOf: number | null;
}

export interface UserInventory {
	/** Type id → quantity of everything that is not a formula. */
	stock: Record<number, number>;
	/** Reaction blueprint type id → count. */
	formulas: Record<number, number>;
	/** The `ok`/`error` connections with Inventory on the sums come from. */
	sources: UserInventorySource[];
	/** Oldest `last_synced_at` of those sources; null when none has synced. */
	oldestSyncAt: number | null;
}

/**
 * What the account has in its selected places: the items of the selected (source, location, bucket)
 * of its `ok` and `error` connections with Inventory on, summed per type and split into formulas
 * (reaction blueprints) and stock.
 */
export async function getUserInventory(env: Env, userId: string): Promise<UserInventory> {
	const db = getCoreDb(env.DB);
	const usable = and(
		eq(inventorySources.userId, userId),
		eq(inventorySources.inventoryEnabled, true),
		inArray(inventorySources.status, USABLE_STATUSES)
	);
	const [dataset, sources, items] = await Promise.all([
		getDataset(env),
		db
			.select({
				sourceId: inventorySources.sourceId,
				ownerName: inventorySources.ownerName,
				kind: inventorySources.kind,
				status: inventorySources.status,
				lastSyncedAt: inventorySources.lastSyncedAt,
				dataAsOf: inventorySources.dataAsOf
			})
			.from(inventorySources)
			.where(usable)
			.orderBy(asc(inventorySources.createdAt), asc(inventorySources.sourceId)),
		db
			.select({ typeId: inventoryItems.typeId, quantity: inventoryItems.quantity })
			.from(inventoryItems)
			.innerJoin(
				inventorySelection,
				and(
					eq(inventorySelection.sourceId, inventoryItems.sourceId),
					eq(inventorySelection.locationId, inventoryItems.locationId),
					eq(inventorySelection.bucket, inventoryItems.bucket)
				)
			)
			.innerJoin(inventorySources, eq(inventorySources.sourceId, inventoryItems.sourceId))
			.where(usable)
	]);
	const stock: Record<number, number> = {};
	const formulas: Record<number, number> = {};
	for (const { typeId, quantity } of items) {
		const into = isFormula(dataset, typeId) ? formulas : stock;
		into[typeId] = (into[typeId] ?? 0) + quantity;
	}
	const synced = sources.flatMap((s) => (s.lastSyncedAt === null ? [] : [s.lastSyncedAt]));
	return {
		stock,
		formulas,
		sources: sources.map((s) => ({
			...s,
			kind: s.kind as InventorySourceKind,
			status: s.status as InventorySourceStatus
		})),
		oldestSyncAt: synced.length > 0 ? Math.min(...synced) : null
	};
}

export interface SyncRequest {
	started: boolean;
	notice: UpdaterNotice;
}

export const SYNC_UNAVAILABLE = 'The sync could not be started right now. Try again later.';

/** `14:05 UTC` (the date too when it is not `now`'s UTC day). */
function utcTime(ms: number, now: number): string {
	const text = formatUtc(ms);
	return text.slice(0, 10) === formatUtc(now).slice(0, 10) ? text.slice(11) : text;
}

/** "ESI has no newer data for <owner> before <time> UTC." (`utcTime`). */
export function notBeforeNotice(ownerName: string, until: number, now: number): SyncRequest {
	return {
		started: false,
		notice: { ok: false, text: `ESI has no newer data for ${ownerName} before ${utcTime(until, now)}.` }
	};
}

/**
 * Asks the updater to sync the inventory of `source` now (`UPDATER.triggerInventorySync`). A connection
 * with Inventory off is refused with a notice. Before its `dataExpiresAt` (ESI `Expires` of the last
 * sync) ESI has nothing newer and must not be asked again: a notice, without calling the updater (the
 * updater refuses too, `notBefore`). A sync already running, a missing binding or an updater that does
 * not answer become notices instead of a 500.
 */
export async function requestInventorySync(
	env: Env,
	source: Pick<InventorySourceRow, 'sourceId' | 'ownerName' | 'dataExpiresAt' | 'inventoryEnabled'>,
	now = Date.now()
): Promise<SyncRequest> {
	if (!source.inventoryEnabled) {
		return {
			started: false,
			notice: { ok: false, text: `Inventory is off for ${source.ownerName}. Switch it on first.` }
		};
	}
	if (source.dataExpiresAt !== null && source.dataExpiresAt > now) {
		return notBeforeNotice(source.ownerName, source.dataExpiresAt, now);
	}
	// `wrangler types` declares the binding as an untyped `Service`; its RPC surface is `UpdaterApi`.
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	if (!updater) {
		console.error('UPDATER binding missing: inventory sync not started');
		return { started: false, notice: { ok: false, text: SYNC_UNAVAILABLE } };
	}
	try {
		const result = await updater.triggerInventorySync(source.sourceId);
		if ('busy' in result) {
			return { started: false, notice: { ok: false, text: 'A sync of this inventory is already running.' } };
		}
		if ('notBefore' in result) return notBeforeNotice(source.ownerName, result.notBefore, now);
		return { started: true, notice: { ok: true, text: 'Sync started.' } };
	} catch (e) {
		console.error('UPDATER.triggerInventorySync failed', e);
		return { started: false, notice: { ok: false, text: SYNC_UNAVAILABLE } };
	}
}

/** "Hangar", "Deliveries", "Industry jobs", the corporation division name or "Division N". */
export function bucketLabel(bucket: InventoryBucket, divisionNames: Record<string, string>): string {
	if (bucket === 'hangar') return 'Hangar';
	if (bucket === 'deliveries') return 'Deliveries';
	if (bucket === 'jobs') return 'Industry jobs';
	const division = bucket.slice(3);
	return divisionNames[division] ?? `Division ${division}`;
}

/** `{"1":"Moon goo"}` division names (hangar `division_names_json` or wallet `wallet_names_json`); bad JSON → {}. */
export function parseDivisionNames(json: string | null): Record<string, string> {
	if (!json) return {};
	try {
		const parsed: unknown = JSON.parse(json);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
		);
	} catch {
		return {};
	}
}

/** Display name of a place: its name, else "Structure <id>" ("Station <id>" for an unnamed station). */
export function placeName(place: Pick<InventoryPlaceView, 'locationId' | 'kind' | 'name'>): string {
	if (place.name) return place.name;
	return place.kind === 'station' ? `Station ${place.locationId}` : `Structure ${place.locationId}`;
}

interface StoredItem {
	sourceId: number;
	locationId: number;
	bucket: InventoryBucket;
	typeId: number;
	quantity: number;
}

/** Places of one source: every location holding items or a selected bucket, by name (unnamed last). */
function sourcePlaces(
	source: InventorySourceListing,
	items: readonly StoredItem[],
	selected: ReadonlySet<string>,
	locations: ReadonlyMap<string, { kind: string; name: string | null; systemName: string | null }>,
	dataset: Dataset | null
): InventoryPlaceView[] {
	const divisions = parseDivisionNames(source.divisionNamesJson);
	const buckets = new Map<number, Map<InventoryBucket, { formulas: number; materials: number }>>();
	const bucketOf = (locationId: number, bucket: InventoryBucket) => {
		let place = buckets.get(locationId);
		if (!place) buckets.set(locationId, (place = new Map()));
		let counts = place.get(bucket);
		if (!counts) place.set(bucket, (counts = { formulas: 0, materials: 0 }));
		return counts;
	};
	// One row per (location, bucket, type): counting rows counts distinct types.
	for (const item of items) {
		const counts = bucketOf(item.locationId, item.bucket);
		if (isFormula(dataset, item.typeId)) counts.formulas++;
		else counts.materials++;
	}
	const prefix = `${source.sourceId}:`;
	for (const key of selected) {
		if (!key.startsWith(prefix)) continue;
		const [, locationId, bucket] = key.split(':');
		if (isInventoryBucket(bucket)) bucketOf(Number(locationId), bucket);
	}
	const places = [...buckets].map(([locationId, place]): InventoryPlaceView => {
		const location = locations.get(`${source.sourceId}:${locationId}`);
		const kind = location?.kind;
		return {
			locationId,
			kind: kind === 'station' || kind === 'structure' ? kind : 'unknown',
			name: location?.name ?? null,
			systemName: location?.systemName ?? null,
			buckets: [...place]
				.sort(([a], [b]) => INVENTORY_BUCKETS.indexOf(a) - INVENTORY_BUCKETS.indexOf(b))
				.map(([bucket, counts]): InventoryBucketView => ({
					bucket,
					label: bucketLabel(bucket, divisions),
					selected: selected.has(`${source.sourceId}:${locationId}:${bucket}`),
					...counts
				}))
		};
	});
	return places.sort(
		(a, b) =>
			Number(a.name === null) - Number(b.name === null) ||
			(a.name ?? '').localeCompare(b.name ?? '') ||
			a.locationId - b.locationId
	);
}

const MATERIAL_ROLES: readonly InventoryRole[] = ['fuel', 'raw', 'intermediate', 'product'];

/** Per type: the remaining quantity and its total cost over the user's ledger lots (profit tracking). */
type PaidByType = ReadonlyMap<number, { remaining: number; cost: number }>;

/** "What you have": the selected items of `ok`/`error` sources, formulas and materials by role. */
function summarize(
	sources: readonly InventorySourceListing[],
	places: ReadonlyMap<number, InventoryPlaceView[]>,
	items: readonly StoredItem[],
	selected: ReadonlySet<string>,
	ctx: CalcContext | null,
	dataset: Dataset | null,
	paidByType: PaidByType | null = null
): InventorySummaryView {
	const materials: Record<InventoryRole, InventoryMaterialView[]> = {
		fuel: [],
		raw: [],
		intermediate: [],
		product: []
	};
	const showPaid = paidByType !== null;
	if (sources.length === 0) return { formulas: [], materials, totalValue: 0, showPaid, empty: 'no_sources' };

	const usable = new Set(sources.filter((s) => USABLE_STATUSES.includes(s.status)).map((s) => s.sourceId));
	const placeLabel = (item: StoredItem) => {
		const place = places.get(item.sourceId)?.find((p) => p.locationId === item.locationId);
		const label = place?.buckets.find((b) => b.bucket === item.bucket)?.label ?? item.bucket;
		return `${placeName(place ?? { locationId: item.locationId, kind: 'unknown', name: null })} · ${label}`;
	};
	const formulaTotals = new Map<number, { count: number; places: Set<string> }>();
	const materialTotals = new Map<number, number>();
	for (const item of items) {
		if (!usable.has(item.sourceId)) continue;
		if (!selected.has(`${item.sourceId}:${item.locationId}:${item.bucket}`)) continue;
		if (isFormula(dataset, item.typeId)) {
			const total = formulaTotals.get(item.typeId) ?? { count: 0, places: new Set<string>() };
			total.count += item.quantity;
			total.places.add(placeLabel(item));
			formulaTotals.set(item.typeId, total);
		} else materialTotals.set(item.typeId, (materialTotals.get(item.typeId) ?? 0) + item.quantity);
	}

	const formulaNames = new Map(dataset?.reactions.map((r) => [r.blueprintTypeId, r.formulaName]));
	const typeName = (typeId: number) => dataset?.types[typeId]?.name ?? `Type ${typeId}`;
	const formulas: InventoryFormulaView[] = [...formulaTotals]
		.map(([blueprintTypeId, total]) => ({
			blueprintTypeId,
			name: formulaNames.get(blueprintTypeId) ?? typeName(blueprintTypeId),
			count: total.count,
			places: [...total.places].sort()
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	let totalValue = 0;
	for (const [typeId, quantity] of materialTotals) {
		const role = dataset && inventoryRole(dataset, typeId);
		if (!role || role === 'formula') continue;
		const unitValue = ctx ? stockUnitValue(ctx, typeId) : null;
		const value = unitValue === null ? null : unitValue * quantity;
		if (value !== null) totalValue += value;
		const lots = paidByType?.get(typeId);
		const paid =
			lots && lots.remaining > 0
				? { unitCost: lots.cost / lots.remaining, covered: Math.min(lots.remaining, quantity) }
				: null;
		materials[role].push({ typeId, name: typeName(typeId), quantity, unitValue, value, paid });
	}
	for (const role of MATERIAL_ROLES) materials[role].sort((a, b) => a.name.localeCompare(b.name));
	const empty = formulas.length === 0 && MATERIAL_ROLES.every((r) => materials[r].length === 0);
	return { formulas, materials, totalValue, showPaid, empty: empty ? 'no_selection' : null };
}

/**
 * "Add a connection" groups. Characters: those with Personal assets or Profit tracking that are not a
 * connection yet. Corporations: "<Corporation> via <Character>" for every character with Corporation
 * assets or Corporation profit tracking that is not in the pool of the account's connection for its
 * corporation (choosing it joins that pool, or adds the corporation); a character whose corporation
 * could not be looked up is listed disabled. With `full` (connection limit reached) only pool joins are
 * offered.
 */
export function connectionAddGroups(
	rows: readonly CharacterRow[],
	sources: readonly InventorySourceListing[],
	pools: readonly PoolMember[],
	full: boolean
): InventoryAddGroup[] {
	const personal = new Set(sources.filter((s) => s.kind === 'character').map((s) => s.ownerId));
	const corporations = new Map(
		sources.filter((s) => s.kind === 'corporation').map((s) => [s.ownerId, s.sourceId])
	);
	const pooled = new Set(pools.map((p) => `${p.sourceId}:${p.characterId}`));
	const personalOptions: InventoryAddOption[] = [];
	const corporationOptions: InventoryAddOption[] = [];
	const unknown: InventoryAddOption[] = [];
	for (const c of rows) {
		if (!full && canConnect(c, 'character') && !personal.has(c.characterId)) {
			personalOptions.push({ value: `character:${c.characterId}`, label: c.name });
		}
		if (!canConnect(c, 'corporation')) continue;
		const value = `corporation:${c.characterId}`;
		if (!hasCorporation(c)) {
			unknown.push({ value, label: `${c.name} (corporation unknown)`, disabled: true });
			continue;
		}
		const sourceId = corporations.get(c.corporationId);
		if (sourceId === undefined ? full : pooled.has(`${sourceId}:${c.characterId}`)) continue;
		corporationOptions.push({ value, label: `${c.corporationName} via ${c.name}` });
	}
	corporationOptions.push(...unknown);
	const groups: InventoryAddGroup[] = [];
	if (personalOptions.length > 0) groups.push({ label: 'Characters', options: personalOptions });
	if (corporationOptions.length > 0) groups.push({ label: 'Corporations', options: corporationOptions });
	return groups;
}

/**
 * `/account/inventory` page data: each connection with Inventory on (stale runs settled) with its
 * places, and "What you have" valued with `stockUnitValue` (`ctx` null: names and quantities only).
 */
export async function inventoryPage(
	env: Env,
	userId: string,
	ctx: CalcContext | null,
	now = Date.now()
): Promise<InventoryPageData> {
	const db = getCoreDb(env.DB);
	const [listed, dataset] = await Promise.all([
		listSources(env, userId, now),
		ctx ? ctx.dataset : getDataset(env)
	]);
	const sources = listed.filter((s) => s.inventoryEnabled);
	const enabled = and(eq(inventorySources.userId, userId), eq(inventorySources.inventoryEnabled, true));
	const [locationRows, itemRows, selectionRows] =
		sources.length === 0
			? [[], [], []]
			: await Promise.all([
					db
						.select({
							sourceId: inventoryLocations.sourceId,
							locationId: inventoryLocations.locationId,
							kind: inventoryLocations.kind,
							name: inventoryLocations.name,
							systemName: systems.name
						})
						.from(inventoryLocations)
						.innerJoin(inventorySources, eq(inventorySources.sourceId, inventoryLocations.sourceId))
						.leftJoin(systems, eq(systems.systemId, inventoryLocations.systemId))
						.where(enabled),
					db
						.select({
							sourceId: inventoryItems.sourceId,
							locationId: inventoryItems.locationId,
							bucket: inventoryItems.bucket,
							typeId: inventoryItems.typeId,
							quantity: inventoryItems.quantity
						})
						.from(inventoryItems)
						.innerJoin(inventorySources, eq(inventorySources.sourceId, inventoryItems.sourceId))
						.where(enabled),
					db
						.select({
							sourceId: inventorySelection.sourceId,
							locationId: inventorySelection.locationId,
							bucket: inventorySelection.bucket
						})
						.from(inventorySelection)
						.innerJoin(inventorySources, eq(inventorySources.sourceId, inventorySelection.sourceId))
						.where(enabled)
				]);
	const items = itemRows.filter((i): i is StoredItem => isInventoryBucket(i.bucket));
	const selected = new Set(selectionRows.map((s) => `${s.sourceId}:${placeKey(s)}`));
	const locations = new Map(locationRows.map((l) => [`${l.sourceId}:${l.locationId}`, l]));

	const places = new Map(
		sources.map((s) => [
			s.sourceId,
			sourcePlaces(
				s,
				items.filter((i) => i.sourceId === s.sourceId),
				selected,
				locations,
				dataset
			)
		])
	);
	const views: InventorySourcePlacesView[] = sources.map((s) => ({
		sourceId: s.sourceId,
		kind: s.kind as InventorySourceKind,
		ownerName: s.ownerName,
		characterName: s.characterName,
		status: s.status as InventorySourceStatus,
		lastSyncedAt: s.lastSyncedAt,
		places: places.get(s.sourceId) ?? []
	}));

	// Profit tracking: remaining FIFO lots per type (the rebuild only keeps tracking-on connections).
	const { results: lotRows } = await env.DB.prepare(
		`SELECT type_id, SUM(remaining) AS remaining, SUM(remaining * unit_cost) AS cost
		FROM ledger_lots WHERE user_id = ? GROUP BY type_id`
	)
		.bind(userId)
		.all<{ type_id: number; remaining: number; cost: number }>();
	const paidByType: PaidByType | null =
		lotRows.length === 0
			? null
			: new Map(lotRows.map((r) => [r.type_id, { remaining: r.remaining, cost: r.cost }]));

	return {
		sources: views,
		summary: summarize(sources, places, items, selected, ctx, dataset, paidByType),
		refreshing: sources.some((s) => s.status === 'running' || s.status === 'pending')
	};
}
