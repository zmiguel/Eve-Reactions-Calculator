import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import {
	characters,
	DATASET_KV_KEY,
	getCoreDb,
	inventorySourceReaders,
	inventorySources
} from '@reactions/db';
import { inventoryTypeIds } from '@reactions/engine';
import type { Dataset } from '@reactions/engine';
import {
	ERROR_INTERNAL,
	fetchAffiliations,
	fetchCharacterAssets,
	fetchCharacterIndustryJobs,
	fetchCorporationAssets,
	fetchCorporationDivisions,
	fetchCorporationIndustryJobs,
	fetchStationInfo,
	fetchStructureInfo,
	hasFeature,
	jobsInventory,
	resolveInventory,
	TOKEN_ERROR_REVOKED,
	userFacingError
} from '@reactions/eve';
import type {
	AssetPage,
	AssetRow,
	EsiClient,
	HangarDivisionNames,
	IndustryJobPage,
	IndustryJobRow,
	InventoryLocation,
	ResolvedInventory
} from '@reactions/eve';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
	ESI_CONCURRENCY,
	INVENTORY_MAX_PAGES,
	INVENTORY_PAGES_PER_STEP,
	INVENTORY_JOBS_KEY,
	INVENTORY_STAGING_KEY,
	INVENTORY_STAGING_PREFIX,
	STEP_CONFIG
} from '../config.ts';
import { writeAffiliations } from '../cron/affiliations.ts';
import { esiClient } from '../http.ts';
import { claimInventorySource, failInventorySync } from '../inventory.ts';
import { errorMessage } from '../jobs.ts';
import { forEachConcurrent } from '../pool.ts';
import { jsonInsertSql } from '../prices.ts';
import { StepTracker } from '../progress.ts';
import { refreshCharacterToken } from '../tokens.ts';
import type { AccessTokenResult, StoredToken } from '../tokens.ts';

export interface InventorySyncParams {
	sourceId: number;
	trigger: 'manual' | 'daily';
}

/** A sync that ended before writing: `busy` (another sync holds the source), `denied`, `error`. */
export interface InventorySyncEnded {
	ok: false;
	status: 'busy' | 'denied' | 'error';
	message: string;
}

export interface InventoryStaged {
	/** The character whose token read asset page 1; every later step reads with it. */
	readerId: number;
	/** Staged asset pages. */
	pages: number;
	/** Staged industry job pages (0 when the jobs were not readable). */
	jobPages: number;
	/**
	 * Kept as the source's `last_error` on success, or null: why readers before `readerId` were
	 * skipped and why the industry jobs were not readable, joined with `; `.
	 */
	note: string | null;
	lastModified: number | null;
	/** ESI `Expires` of asset page 1 (unix ms). */
	expiresAt: number | null;
}

export type InventoryPrepared = ({ ok: true } & InventoryStaged) | InventorySyncEnded;

export interface NamedLocation {
	locationId: number;
	kind: 'station' | 'structure' | 'unknown';
	name: string | null;
	systemId: number | null;
}

export interface InventoryNames {
	/** Every location that had no name before this sync, looked up now (still `null` when that failed). */
	locations: NamedLocation[];
	/** Corporation hangar division names; `null` keeps the stored ones (personal source, or not readable). */
	divisions: HangarDivisionNames | null;
}

export interface InventoryWritten {
	ok: true;
	locations: number;
	items: number;
	/** Locations no longer in the assets and not selected, deleted. */
	removedLocations: number;
}

export type InventorySyncResult = InventoryWritten | InventorySyncEnded;

/** An inventory source (`inventory_sources` columns). */
interface SyncSource {
	sourceId: number;
	userId: string;
	/** 'character' | 'corporation' */
	kind: string;
	ownerId: number;
	ownerName: string;
	runId: string | null;
	/** The preferred reading character (the one that last read the assets). */
	characterId: number;
}

/** A character that may read a source (`characters` columns of the token). */
interface Reader extends StoredToken {
	name: string;
	scopes: string;
	tokenStatus: string;
}

const ITEMS_SQL = jsonInsertSql('inventory_items', [
	'source_id',
	'location_id',
	'bucket',
	'type_id',
	'quantity'
]);

/** Named locations keep their stored kind, name and system; unnamed ones take this sync's lookup. */
const LOCATIONS_SQL = jsonInsertSql(
	'inventory_locations',
	['source_id', 'location_id', 'kind', 'name', 'system_id'],
	`ON CONFLICT (source_id, location_id) DO UPDATE SET
		kind = CASE WHEN inventory_locations.name IS NULL THEN excluded.kind ELSE inventory_locations.kind END,
		name = COALESCE(inventory_locations.name, excluded.name),
		system_id = COALESCE(inventory_locations.system_id, excluded.system_id)`
);

/** Locations of source `?1` that are not in the assets (`?2`, JSON array of ids) and have no selection. */
const REMOVE_LOCATIONS_SQL = `
	DELETE FROM inventory_locations
	WHERE source_id = ?1 AND location_id NOT IN (SELECT value FROM json_each(?2))
		AND NOT EXISTS (
			SELECT 1 FROM inventory_selection s
			WHERE s.source_id = ?1 AND s.location_id = inventory_locations.location_id
		)`;

/** `character_id` becomes the reader unless it left the corporation source's pool during the sync. */
const FINISH_SQL = `
	UPDATE inventory_sources SET status = 'ok', last_error = ?7, last_synced_at = ?3, data_as_of = ?4,
		item_count = ?5, division_names_json = COALESCE(?6, division_names_json),
		character_id = CASE WHEN kind <> 'corporation' OR EXISTS (
			SELECT 1 FROM inventory_source_readers WHERE source_id = ?1 AND character_id = ?8
		) THEN ?8 ELSE character_id END,
		data_expires_at = ?9
	WHERE source_id = ?1 AND run_id = ?2`;

const READER_COLUMNS = {
	characterId: characters.characterId,
	name: characters.name,
	scopes: characters.scopes,
	refreshTokenEnc: characters.refreshTokenEnc,
	ssoClientId: characters.ssoClientId,
	tokenStatus: characters.tokenStatus
};

function loadSource(env: Env, sourceId: number): Promise<SyncSource | undefined> {
	return getCoreDb(env.DB)
		.select({
			sourceId: inventorySources.sourceId,
			userId: inventorySources.userId,
			kind: inventorySources.kind,
			ownerId: inventorySources.ownerId,
			ownerName: inventorySources.ownerName,
			runId: inventorySources.runId,
			characterId: inventorySources.characterId
		})
		.from(inventorySources)
		.where(eq(inventorySources.sourceId, sourceId))
		.get();
}

/** Character `characterId` of the source's account; any other character stops the run. */
async function loadReader(env: Env, source: SyncSource, characterId: number): Promise<Reader> {
	const reader = await getCoreDb(env.DB)
		.select(READER_COLUMNS)
		.from(characters)
		.where(and(eq(characters.characterId, characterId), eq(characters.userId, source.userId)))
		.get();
	if (!reader) throw new NonRetryableError(`reading character ${characterId} was removed`);
	return reader;
}

/**
 * The corporation source's reader pool (`inventory_source_readers`, only characters of the source's
 * account): the preferred reader (`character_id`) first, then in the order they were added. `notes` say
 * why pool members without Corporation assets are left out.
 */
async function corporationReaders(
	env: Env,
	source: SyncSource
): Promise<{ readers: Reader[]; notes: string[] }> {
	const pool = await getCoreDb(env.DB)
		.select(READER_COLUMNS)
		.from(inventorySourceReaders)
		.innerJoin(characters, eq(characters.characterId, inventorySourceReaders.characterId))
		.where(and(eq(inventorySourceReaders.sourceId, source.sourceId), eq(characters.userId, source.userId)))
		.orderBy(
			sql`${characters.characterId} = ${source.characterId} DESC`,
			asc(inventorySourceReaders.createdAt),
			asc(characters.characterId)
		)
		.all();
	const notes: string[] = [];
	if (pool.length === 0) notes.push('no character is set to read it');
	const readers = pool.filter((c) => {
		if (hasFeature(c.scopes, 'corp_assets')) return true;
		notes.push(`${c.name} has not allowed Corporation assets`);
		return false;
	});
	return { readers, notes };
}

/** The source while run `runId` holds it; a removed or superseded source stops the run. */
async function ownedSource(env: Env, sourceId: number, runId: string): Promise<SyncSource> {
	const source = await loadSource(env, sourceId);
	if (!source) throw new NonRetryableError(`inventory source ${sourceId} does not exist`);
	if (source.runId !== runId)
		throw new NonRetryableError(`inventory source ${sourceId} is synced by ${source.runId} now`);
	return source;
}

/** The source while run `runId` holds it plus a fresh access token of reader `readerId` (`prepare`'s pick). */
async function ownedReader(
	env: Env,
	sourceId: number,
	runId: string,
	readerId: number
): Promise<{ source: SyncSource; reader: Reader; token: string }> {
	const source = await ownedSource(env, sourceId, runId);
	const reader = await loadReader(env, source, readerId);
	return { source, reader, token: await accessToken(env, source, reader, runId) };
}

/** User-facing failure of an ESI request a step gives up on (`what`: e.g. `assets page 2`). */
const esiFailure = (status: number, what: string) =>
	`ESI answered HTTP ${status} for ${what}; the next sync tries again.`;

/**
 * The user-facing sentences steps throw on purpose ({@link esiFailure}, no reader left, a token refresh
 * EVE did not answer), found in the workflow's error message, which may wrap them.
 */
const SYNC_FAILURE =
	/ESI answered HTTP \d{3} for [a-z0-9 ]+; the next sync tries again\.|No character can read .+|EVE Online (?:did not answer|answered HTTP \d{3}); it will be retried\./;

/** `last_error` of a failed sync: a sentence a step threw on purpose, else a generic one (cause logged). */
function syncFailureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const sentence = SYNC_FAILURE.exec(message)?.[0];
	if (sentence) return userFacingError(sentence);
	console.error(`[inventory] sync failed: ${errorMessage(error)}`);
	return ERROR_INTERNAL;
}

/** Records how run `runId` ended (`denied` deletes the source's items) and returns that outcome. */
async function endSync(
	env: Env,
	source: SyncSource,
	runId: string,
	status: 'denied' | 'error',
	message: string
): Promise<InventorySyncEnded> {
	const update = env.DB.prepare(
		`UPDATE inventory_sources SET status = ?3, last_error = ?4,
			item_count = CASE WHEN ?3 = 'denied' THEN 0 ELSE item_count END
		WHERE source_id = ?1 AND run_id = ?2`
	).bind(source.sourceId, runId, status, message);
	if (status === 'denied')
		await env.DB.batch([
			env.DB.prepare('DELETE FROM inventory_items WHERE source_id = ?').bind(source.sourceId),
			update
		]);
	else await update.run();
	return { ok: false, status, message };
}

/**
 * A fresh access token of `reader`; a character already `token_status <> 'ok'` is invalid without asking
 * SSO.
 */
function readerToken(env: Env, reader: Reader): Promise<AccessTokenResult> {
	if (reader.tokenStatus === 'ok') return refreshCharacterToken(env, reader);
	return Promise.resolve({ ok: false, invalid: true, message: TOKEN_ERROR_REVOKED });
}

/**
 * A fresh access token of the reading character. A token that can no longer be refreshed ends the
 * sync as `error` (`NonRetryableError`); other refresh failures throw so the step retries.
 */
async function accessToken(env: Env, source: SyncSource, reader: Reader, runId: string): Promise<string> {
	const token = await readerToken(env, reader);
	if (token.ok) return token.accessToken;
	if (!token.invalid) throw new Error(token.message);
	const message = `${reader.name}: ${token.message}`;
	await endSync(env, source, runId, 'error', message);
	throw new NonRetryableError(message);
}

/** Rows of the `pages` staged objects `key(1)`…`key(pages)`. */
async function readStaged<T>(env: Env, pages: number, key: (page: number) => string): Promise<T[]> {
	const rows: T[] = [];
	for (let page = 1; page <= pages; page++) {
		const object = await env.ARCHIVE.get(key(page));
		if (!object) throw new Error(`R2 object ${key(page)} missing`);
		rows.push(...(await object.json<T[]>()));
	}
	return rows;
}

/**
 * The staged assets (`resolveInventory`) plus the formulas held in the staged industry jobs
 * (`jobsInventory`, bucket `jobs`), as one inventory sorted by location, bucket, type.
 */
async function resolveStaged(env: Env, runId: string, staged: InventoryStaged): Promise<ResolvedInventory> {
	const relevant = await relevantTypeIds(env);
	const assets = resolveInventory(
		await readStaged<AssetRow>(env, staged.pages, (p) => INVENTORY_STAGING_KEY(runId, p)),
		relevant
	);
	const jobs = jobsInventory(
		await readStaged<IndustryJobRow>(env, staged.jobPages, (p) => INVENTORY_JOBS_KEY(runId, p)),
		relevant
	);
	const locations = new Map(assets.locations.map((l) => [l.locationId, l]));
	for (const l of jobs.locations) if (!locations.has(l.locationId)) locations.set(l.locationId, l);
	return {
		locations: [...locations.values()].sort((a, b) => a.locationId - b.locationId),
		items: [...assets.items, ...jobs.items].sort(
			(a, b) =>
				a.locationId - b.locationId ||
				(a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0) ||
				a.typeId - b.typeId
		)
	};
}

function fetchJobPage(
	client: EsiClient,
	source: SyncSource,
	token: string,
	page: number
): Promise<IndustryJobPage> {
	return source.kind === 'corporation'
		? fetchCorporationIndustryJobs(client, source.ownerId, token, page)
		: fetchCharacterIndustryJobs(client, source.ownerId, token);
}

/** Deletes every staged page of run `runId`. */
async function deleteStaging(env: Env, runId: string): Promise<void> {
	const listed = await env.ARCHIVE.list({ prefix: INVENTORY_STAGING_PREFIX(runId) });
	if (listed.objects.length > 0) await env.ARCHIVE.delete(listed.objects.map((o) => o.key));
}

/** Types worth storing: `inventoryTypeIds` of the published dataset (KV `dataset:v1`). */
async function relevantTypeIds(env: Env): Promise<ReadonlySet<number>> {
	const dataset = await env.CACHE.get<Dataset>(DATASET_KV_KEY, 'json');
	if (!dataset) throw new Error(`no SDE dataset published yet (KV ${DATASET_KV_KEY})`);
	return inventoryTypeIds(dataset);
}

/** Asset page 1 read by `reader`; `notes` say why earlier readers were skipped. */
interface FirstPage {
	reader: Reader;
	token: string;
	page: Extract<AssetPage, { ok: true }>;
	notes: string[];
}

/** Personal source: page 1 read by the character itself. */
async function readPersonalPage(
	env: Env,
	client: EsiClient,
	source: SyncSource,
	runId: string
): Promise<FirstPage | InventorySyncEnded> {
	const reader = await loadReader(env, source, source.characterId);
	if (!hasFeature(reader.scopes, 'assets'))
		return endSync(env, source, runId, 'denied', `${reader.name} has not allowed Personal assets`);
	const token = await accessToken(env, source, reader, runId);
	const page = await fetchCharacterAssets(client, source.ownerId, token, 1);
	if (page.ok) return { reader, token, page, notes: [] };
	if (page.status === 403)
		return endSync(env, source, runId, 'denied', `${reader.name} no longer allows reading its assets`);
	throw new Error(esiFailure(page.status, 'assets page 1'));
}

/**
 * Corporation source: tries the source's reader pool (`corporationReaders`) in order and keeps the
 * first whose asset page 1 succeeds. One bulk `/characters/affiliation` call looks up every pool
 * member's corporation (stored on `characters`); a reader is skipped, with a note, when it is not in
 * the corporation (it left; no ESI asset call), its token is invalid or cannot be refreshed, or the
 * assets answer 403 (no Director role). No reader left: `denied` with every note, or a thrown error
 * (step retried, then `error` keeping the items) when a token refresh failed for a reason other than
 * an invalid token. Characters outside the pool are never used.
 */
async function readCorporationPage(
	env: Env,
	client: EsiClient,
	source: SyncSource,
	runId: string,
	now: number
): Promise<FirstPage | InventorySyncEnded> {
	const { readers, notes } = await corporationReaders(env, source);
	const members = new Set<number>();
	if (readers.length > 0) {
		const affiliations = await fetchAffiliations(
			client,
			readers.map((r) => r.characterId)
		);
		const refused = affiliations.failedChunks[0];
		if (refused) throw new Error(esiFailure(refused.status, 'the corporation lookup'));
		await writeAffiliations(
			env,
			affiliations.items.map((a) => ({
				id: a.characterId,
				c: a.corporationId,
				cn: a.corporationId === source.ownerId ? source.ownerName : null,
				a: a.allianceId,
				an: null
			})),
			now
		);
		for (const a of affiliations.items) if (a.corporationId === source.ownerId) members.add(a.characterId);
	}
	let retry = false;
	for (const reader of readers) {
		if (!members.has(reader.characterId)) {
			notes.push(`${reader.name} is not in the corporation`);
			continue;
		}
		const token = await readerToken(env, reader);
		if (!token.ok) {
			notes.push(
				token.invalid
					? `${reader.name} has an invalid token`
					: `${reader.name}'s token could not be refreshed`
			);
			retry ||= !token.invalid;
			continue;
		}
		const page = await fetchCorporationAssets(client, source.ownerId, token.accessToken, 1);
		if (page.ok) return { reader, token: token.accessToken, page, notes };
		if (page.status !== 403) throw new Error(esiFailure(page.status, 'assets page 1'));
		notes.push(`${reader.name} needs the Director role`);
	}
	const message = `No character can read ${source.ownerName}: ${notes.join('; ')}`;
	if (retry) throw new Error(message);
	return endSync(env, source, runId, 'denied', message);
}

/**
 * Step `prepare`: takes the source (claim, when the trigger did not), picks the reader (personal: the
 * character; corporation: `readCorporationPage`), reads page 1 of the assets and of the industry jobs
 * and stages them in R2. Assets 403 of every reader ends the sync as `denied` and deletes the items;
 * more than `INVENTORY_MAX_PAGES` asset pages ends it as `error`. Jobs 403 (corporation reader without
 * the Factory Manager role) skips the jobs with a note; no other reader is tried for them. Other job
 * failures throw like asset pages.
 */
export async function prepareInventorySync(
	env: Env,
	sourceId: number,
	runId: string,
	now: number
): Promise<InventoryPrepared> {
	let source = await loadSource(env, sourceId);
	if (!source) throw new NonRetryableError(`inventory source ${sourceId} does not exist`);
	if (source.runId !== runId) {
		const claim = await claimInventorySource(env, sourceId, runId, now, false);
		if (claim === 'missing') throw new NonRetryableError(`inventory source ${sourceId} does not exist`);
		if (claim !== 'claimed')
			return { ok: false, status: 'busy', message: `${source.runId} is still running` };
		source = await ownedSource(env, sourceId, runId);
	}
	const corporation = source.kind === 'corporation';
	const client = esiClient(env);
	const first = corporation
		? await readCorporationPage(env, client, source, runId, now)
		: await readPersonalPage(env, client, source, runId);
	if ('ok' in first) return first;
	const { reader, token, page, notes } = first;
	if (page.pages > INVENTORY_MAX_PAGES)
		return endSync(
			env,
			source,
			runId,
			'error',
			`too many assets (${page.pages} pages, the limit is ${INVENTORY_MAX_PAGES})`
		);
	await env.ARCHIVE.put(INVENTORY_STAGING_KEY(runId, 1), JSON.stringify(page.items));
	const jobs = await fetchJobPage(client, source, token, 1);
	let jobPages = 0;
	if (jobs.ok) {
		await env.ARCHIVE.put(INVENTORY_JOBS_KEY(runId, 1), JSON.stringify(jobs.items));
		jobPages = Math.min(jobs.pages, INVENTORY_MAX_PAGES);
	} else {
		if (jobs.status !== 403) throw new Error(esiFailure(jobs.status, 'industry jobs page 1'));
		notes.push(
			corporation
				? `Industry jobs not readable: ${reader.name} needs the Factory Manager role`
				: 'Industry jobs not readable'
		);
	}
	return {
		ok: true,
		readerId: reader.characterId,
		pages: page.pages,
		jobPages,
		note: notes.length > 0 ? notes.join('; ') : null,
		lastModified: page.lastModified,
		expiresAt: page.expiresAt
	};
}

/** Step `pages-<k>`: asset pages `from`–`to` with a fresh access token of the reader, staged in R2. */
export async function stageInventoryPages(
	env: Env,
	sourceId: number,
	runId: string,
	readerId: number,
	from: number,
	to: number
): Promise<{ pages: number; rows: number }> {
	const { source, token } = await ownedReader(env, sourceId, runId, readerId);
	const client = esiClient(env);
	const fetchPage = source.kind === 'corporation' ? fetchCorporationAssets : fetchCharacterAssets;
	const pages = Array.from({ length: to - from + 1 }, (_, i) => from + i);
	let rows = 0;
	await forEachConcurrent(pages, ESI_CONCURRENCY, async (page) => {
		const result = await fetchPage(client, source.ownerId, token, page);
		if (!result.ok) throw new Error(esiFailure(result.status, `assets page ${page}`));
		await env.ARCHIVE.put(INVENTORY_STAGING_KEY(runId, page), JSON.stringify(result.items));
		rows += result.items.length;
	});
	return { pages: pages.length, rows };
}

/** Step `jobs`: corporation industry job pages 2–`pages` with a fresh access token of the reader, staged in R2. */
export async function stageInventoryJobPages(
	env: Env,
	sourceId: number,
	runId: string,
	readerId: number,
	pages: number
): Promise<{ pages: number; rows: number }> {
	const { source, token } = await ownedReader(env, sourceId, runId, readerId);
	const client = esiClient(env);
	const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2);
	let rows = 0;
	await forEachConcurrent(rest, ESI_CONCURRENCY, async (page) => {
		const result = await fetchJobPage(client, source, token, page);
		if (!result.ok) throw new Error(esiFailure(result.status, `industry jobs page ${page}`));
		await env.ARCHIVE.put(INVENTORY_JOBS_KEY(runId, page), JSON.stringify(result.items));
		rows += result.items.length;
	});
	return { pages: rest.length, rows };
}

async function lookUpLocation(
	client: EsiClient,
	location: InventoryLocation,
	token: string | null
): Promise<NamedLocation> {
	const { locationId } = location;
	try {
		if (location.kind === 'station') {
			const station = await fetchStationInfo(client, locationId);
			return {
				locationId,
				kind: 'station',
				name: station?.name ?? null,
				systemId: station?.systemId ?? null
			};
		}
		const structure = await fetchStructureInfo(client, locationId, token!);
		return structure
			? { locationId, kind: 'structure', name: structure.name, systemId: structure.solarSystemId }
			: { locationId, kind: 'unknown', name: null, systemId: null };
	} catch (error) {
		console.error(`[inventory] location ${locationId}: ${errorMessage(error)}`);
		return { locationId, kind: location.kind, name: null, systemId: null };
	}
}

/**
 * Step `names`: looks up the locations of the staged assets and jobs that have no name yet (stations
 * through public ESI, structures with the reader's token: no docking access → `unknown`) and, for
 * corporations, the hangar division names. A failed lookup leaves the location unnamed (tried again next
 * sync); failed division names keep the stored ones.
 */
export async function nameInventoryLocations(
	env: Env,
	sourceId: number,
	runId: string,
	staged: InventoryStaged
): Promise<InventoryNames> {
	const source = await ownedSource(env, sourceId, runId);
	const { locations } = await resolveStaged(env, runId, staged);
	const { results } = await env.DB.prepare(
		'SELECT location_id FROM inventory_locations WHERE source_id = ? AND name IS NOT NULL'
	)
		.bind(sourceId)
		.all<{ location_id: number }>();
	const named = new Set(results.map((r) => r.location_id));
	const unnamed = locations.filter((l) => !named.has(l.locationId));
	const corporation = source.kind === 'corporation';
	const token =
		corporation || unnamed.some((l) => l.kind === 'structure')
			? await accessToken(env, source, await loadReader(env, source, staged.readerId), runId)
			: null;
	const client = esiClient(env);
	const looked: NamedLocation[] = [];
	await forEachConcurrent(unnamed, ESI_CONCURRENCY, async (location) => {
		looked.push(await lookUpLocation(client, location, token));
	});
	let divisions: HangarDivisionNames | null = null;
	if (corporation) {
		try {
			divisions = await fetchCorporationDivisions(client, source.ownerId, token!);
		} catch (error) {
			console.error(`[inventory] divisions of ${source.ownerId}: ${errorMessage(error)}`);
		}
	}
	return { locations: looked.sort((a, b) => a.locationId - b.locationId), divisions };
}

/**
 * Step `write`: resolves the staged assets and jobs and, in one transaction, replaces the source's
 * items, upserts its locations, deletes locations that are gone and unselected (selected ones stay with
 * their selections) and marks the source `ok` (`last_error` = the prepare note, if any) with the reader
 * as its preferred `character_id` and the ESI `Expires` of page 1; then deletes the staged pages.
 */
export async function writeInventory(
	env: Env,
	sourceId: number,
	runId: string,
	prepared: InventoryStaged,
	names: InventoryNames,
	now: number
): Promise<InventoryWritten> {
	await ownedSource(env, sourceId, runId);
	const resolved = await resolveStaged(env, runId, prepared);
	const looked = new Map(names.locations.map((l) => [l.locationId, l]));
	const locationRows = resolved.locations.map(({ locationId, kind }) => {
		const found = looked.get(locationId);
		return [sourceId, locationId, found?.kind ?? kind, found?.name ?? null, found?.systemId ?? null];
	});
	const itemRows = resolved.items.map((i) => [sourceId, i.locationId, i.bucket, i.typeId, i.quantity]);
	const divisions = names.divisions && JSON.stringify(names.divisions);
	const results = await env.DB.batch([
		env.DB.prepare('DELETE FROM inventory_items WHERE source_id = ?').bind(sourceId),
		env.DB.prepare(ITEMS_SQL).bind(JSON.stringify(itemRows)),
		env.DB.prepare(LOCATIONS_SQL).bind(JSON.stringify(locationRows)),
		env.DB.prepare(REMOVE_LOCATIONS_SQL).bind(
			sourceId,
			JSON.stringify(resolved.locations.map((l) => l.locationId))
		),
		env.DB.prepare(FINISH_SQL).bind(
			sourceId,
			runId,
			now,
			prepared.lastModified,
			itemRows.length,
			divisions,
			prepared.note,
			prepared.readerId,
			prepared.expiresAt
		)
	]);
	await deleteStaging(env, runId);
	return {
		ok: true,
		locations: locationRows.length,
		items: itemRows.length,
		removedLocations: results[3]!.meta.changes
	};
}

/**
 * Reads one inventory source from ESI: instance `inventory-<sourceId>-<date>` (daily pass) or
 * `inventory-<sourceId>-manual-<ms>`. Asset and industry job pages travel through R2
 * (`inventory-staging/<instanceId>/`), step results are counts and names only. Any failure ends the
 * sync as `error` with the previous items kept. Not a `job_runs` row: the outcome lives on the source.
 */
export class InventorySyncWorkflow extends WorkflowEntrypoint<Env, InventorySyncParams> {
	override async run(
		event: Readonly<WorkflowEvent<InventorySyncParams>>,
		step: WorkflowStep
	): Promise<InventorySyncResult> {
		const { sourceId } = event.payload;
		const runId = event.instanceId;
		const env = this.env;
		const steps = new StepTracker(env, step, runId);
		try {
			const prepared = await steps.do('prepare', STEP_CONFIG, () =>
				prepareInventorySync(env, sourceId, runId, Date.now())
			);
			if (!prepared.ok) return prepared;
			const pageSteps = Math.ceil((prepared.pages - 1) / INVENTORY_PAGES_PER_STEP);
			const jobSteps = prepared.jobPages > 1 ? 1 : 0;
			// prepare + one step per INVENTORY_PAGES_PER_STEP further pages + jobs (more job pages) + names, write
			steps.total = 1 + pageSteps + jobSteps + 2;
			for (let k = 1; k <= pageSteps; k++) {
				const from = 2 + (k - 1) * INVENTORY_PAGES_PER_STEP;
				const to = Math.min(prepared.pages, from + INVENTORY_PAGES_PER_STEP - 1);
				await steps.do(`pages-${k}`, STEP_CONFIG, () =>
					stageInventoryPages(env, sourceId, runId, prepared.readerId, from, to)
				);
			}
			if (jobSteps)
				await steps.do('jobs', STEP_CONFIG, () =>
					stageInventoryJobPages(env, sourceId, runId, prepared.readerId, prepared.jobPages)
				);
			const names = await steps.do('names', STEP_CONFIG, () =>
				nameInventoryLocations(env, sourceId, runId, prepared)
			);
			return await steps.do('write', STEP_CONFIG, () =>
				writeInventory(env, sourceId, runId, prepared, names, Date.now())
			);
		} catch (error) {
			await failInventorySync(env, sourceId, runId, syncFailureMessage(error));
			try {
				await deleteStaging(env, runId);
			} catch (cleanup) {
				console.error(`[${runId}] staging cleanup: ${errorMessage(cleanup)}`);
			}
			throw error;
		}
	}
}
