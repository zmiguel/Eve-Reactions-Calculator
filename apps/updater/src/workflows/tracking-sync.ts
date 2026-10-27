import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { characters, getCoreDb, inventorySourceReaders, inventorySources } from '@reactions/db';
import { trackedTypeIds } from '@reactions/engine';
import {
	collectWalletTransactions,
	ERROR_INTERNAL,
	fetchAffiliations,
	fetchCharacterBlueprints,
	fetchCharacterContractItems,
	fetchCharacterContracts,
	fetchCharacterIndustryJobs,
	fetchCharacterOrderHistory,
	fetchCharacterOrders,
	fetchCharacterWalletJournal,
	fetchCharacterWalletTransactions,
	fetchCorporationBlueprints,
	fetchCorporationContractItems,
	fetchCorporationContracts,
	fetchCorporationIndustryJobs,
	fetchCorporationOrderHistory,
	fetchCorporationOrders,
	fetchCorporationWalletJournal,
	fetchCorporationWalletTransactions,
	fetchJaniceAppraisal,
	hasFeature,
	isEsiDowntime,
	isStationId,
	isTrackedJournalRefType,
	lookUpFacility,
	parseJaniceCodes,
	MANUFACTURING_ACTIVITY_ID,
	REACTION_ACTIVITY_IDS,
	TOKEN_ERROR_REVOKED,
	userFacingError
} from '@reactions/eve';
import type {
	Blueprint,
	Contract,
	ContractItem,
	EsiClient,
	EsiFailure,
	IndustryJobRow,
	OwnMarketOrder,
	WalletJournalEntry,
	WalletTransaction
} from '@reactions/eve';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
	ESI_CONCURRENCY,
	FACILITY_RECHECK_DAYS,
	FACILITY_RETRY_MIN_DAYS,
	JANICE_RETRY_MAX_DAYS,
	JANICE_RETRY_MIN_HOURS,
	STEP_CONFIG,
	TRACKING_CONTRACT_ITEMS_PER_STEP,
	TRACKING_FACILITY_LOOKUPS_PER_SYNC,
	TRACKING_JANICE_PER_STEP,
	TRACKING_MAX_PAGES,
	TRACKING_RUN_STALE_MINUTES,
	TRACKING_TX_MAX_PAGES
} from '../config.ts';
import { writeAffiliations } from '../cron/affiliations.ts';
import { esiClient, httpFetch, userAgent } from '../http.ts';
import { errorMessage } from '../jobs.ts';
import { forEachConcurrent } from '../pool.ts';
import { markLedgerDirty, rebuildLedger } from '../ledger.ts';
import { jsonInsertSql } from '../prices.ts';
import { StepTracker } from '../progress.ts';
import { refreshCharacterToken } from '../tokens.ts';
import type { AccessTokenResult, StoredToken } from '../tokens.ts';
import { claimTrackingSource, dueStreams, failTrackingSync, trackingStreamNames } from '../tracking.ts';
import { publishedDataset } from './inventory-sync.ts';

export interface TrackingSyncParams {
	sourceId: number;
	trigger: 'manual' | 'hourly';
}

/**
 * A sync that ended in `prepare`: `busy` (another sync holds the connection), `fresh` (every stream is
 * still fresh; nothing requested), `denied` (no character can read it), `error`.
 */
export interface TrackingSyncEnded {
	ok: false;
	status: 'busy' | 'fresh' | 'denied' | 'error';
	message: string;
}

export interface TrackingPrepared {
	ok: true;
	kind: string;
	/** The character every stream step reads with. */
	readerId: number;
	/** Streams to fetch (missing, or `expires_at` reached). */
	due: string[];
	/** Kept as `tracking_last_error` on success: why readers before `readerId` were skipped. */
	note: string | null;
}

export interface StreamOutcome {
	stream: string;
	status: 'ok' | 'denied' | 'error';
	/** Rows stored (new or changed). */
	rows: number;
	/** The stream's `last_error`, null when ok. */
	message: string | null;
}

export interface TrackingFinished {
	ok: true;
	status: 'ok' | 'error';
	streams: StreamOutcome[];
	/** False when the ledger rebuild failed (the ledger was marked dirty for the cron). */
	ledgerRebuilt: boolean;
}

export type TrackingSyncResult = TrackingFinished | TrackingSyncEnded;

/** A tracking connection (`inventory_sources` columns). */
interface TrackingSource {
	sourceId: number;
	userId: string;
	/** 'character' | 'corporation' */
	kind: string;
	ownerId: number;
	ownerName: string;
	/** The preferred reading character. */
	characterId: number;
	runId: string | null;
	walletDivisionsJson: string | null;
}

/** A character that may read a connection (`characters` columns of the token). */
interface Reader extends StoredToken {
	name: string;
	scopes: string;
	tokenStatus: string;
}

const READER_COLUMNS = {
	characterId: characters.characterId,
	name: characters.name,
	scopes: characters.scopes,
	refreshTokenEnc: characters.refreshTokenEnc,
	ssoClientId: characters.ssoClientId,
	tokenStatus: characters.tokenStatus
};

/** Contract states after which the items changed hands. */
const FINISHED_CONTRACT: Record<string, true> = {
	finished: true,
	finished_issuer: true,
	finished_contractor: true
};

/** A tracked job's ESI `blueprint_id` and the activity it ran (`activity_id`), stored for every job. */
const JOBS_SQL = jsonInsertSql(
	'tracked_jobs',
	[
		'user_id',
		'job_id',
		'source_id',
		'installer_id',
		'activity_id',
		'blueprint_id',
		'blueprint_type_id',
		'product_type_id',
		'runs',
		'status',
		'cost',
		'facility_id',
		'output_location_id',
		'start_date',
		'end_date',
		'completed_date'
	],
	`ON CONFLICT (user_id, job_id) DO UPDATE SET status = excluded.status, cost = excluded.cost,
		end_date = excluded.end_date, completed_date = excluded.completed_date,
		activity_id = excluded.activity_id, blueprint_id = excluded.blueprint_id`
);

/** Which of the blueprint type ids `?1` (JSON array) consume tracked materials (`manufacturing_blueprints`). */
const CONSUMING_BLUEPRINTS_SQL = `SELECT blueprint_type_id FROM manufacturing_blueprints
	WHERE blueprint_type_id IN (SELECT value FROM json_each(?1))`;

/** Stream of the blueprints of manufacturing jobs (their material efficiency); see `syncBlueprints`. */
export const BLUEPRINTS_STREAM = 'blueprints';

/**
 * `tracking_streams` rows that only keep the `Expires` of a request of the sync (never a stream line,
 * never make a connection due): `/corporations/{id}/divisions` and the readers' `/characters/affiliation`.
 */
export const DIVISIONS_REQUEST = 'divisions';
export const AFFILIATIONS_REQUEST = 'affiliations';

/** Statuses of a job whose blueprint is still installed (readable from the owner's blueprints). */
const RUNNING_JOB_STATUSES = "('active', 'paused', 'ready')";

/** Blueprint items (`?3` = connection) of the user's manufacturing jobs whose ME is not read yet. */
const WANTED_BLUEPRINTS_SQL = `
	SELECT DISTINCT blueprint_id FROM tracked_jobs
	WHERE user_id = ?1 AND source_id = ?2 AND activity_id = ${MANUFACTURING_ACTIVITY_ID}
		AND blueprint_id IS NOT NULL AND blueprint_me IS NULL AND status IN ${RUNNING_JOB_STATUSES}
	ORDER BY blueprint_id`;

/** Sets the ME of those jobs from `?3` (`[[blueprintId, me], …]`). */
const BLUEPRINT_ME_SQL = `
	UPDATE tracked_jobs SET blueprint_me = (
		SELECT json_extract(value, '$[1]') FROM json_each(?3) WHERE json_extract(value, '$[0]') = tracked_jobs.blueprint_id)
	WHERE user_id = ?1 AND source_id = ?2 AND activity_id = ${MANUFACTURING_ACTIVITY_ID}
		AND blueprint_me IS NULL AND status IN ${RUNNING_JOB_STATUSES}
		AND blueprint_id IN (SELECT json_extract(value, '$[0]') FROM json_each(?3))`;

const TRANSACTIONS_SQL = jsonInsertSql(
	'tracked_transactions',
	[
		'user_id',
		'transaction_id',
		'source_id',
		'division',
		'date',
		'type_id',
		'quantity',
		'unit_price',
		'is_buy',
		'client_id',
		'location_id',
		'journal_ref_id',
		'is_personal'
	],
	'ON CONFLICT DO NOTHING'
);

const JOURNAL_SQL = jsonInsertSql(
	'tracked_journal',
	[
		'user_id',
		'ref_id',
		'source_id',
		'division',
		'date',
		'ref_type',
		'amount',
		'context_id',
		'context_id_type'
	],
	'ON CONFLICT DO NOTHING'
);

const ORDERS_SQL = jsonInsertSql(
	'tracked_orders',
	[
		'user_id',
		'order_id',
		'source_id',
		'type_id',
		'is_buy',
		'price',
		'volume_total',
		'volume_remain',
		'issued',
		'location_id',
		'division',
		'state'
	],
	`ON CONFLICT (user_id, order_id) DO UPDATE SET price = excluded.price, volume_remain = excluded.volume_remain,
		issued = excluded.issued, state = excluded.state`
);

/** A finished contract; its Janice appraisal is copied from another contract of the user with that code. */
const CONTRACT_SQL = `
	INSERT INTO tracked_contracts (user_id, contract_id, source_id, type, status, issuer_id, issuer_corporation_id,
		acceptor_id, assignee_id, for_corporation, price, reward, title, date_issued, date_completed,
		start_location_id, janice_code, janice_json)
	VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
		(SELECT janice_json FROM tracked_contracts
		WHERE user_id = ?1 AND janice_code = ?17 AND janice_json IS NOT NULL LIMIT 1))
	ON CONFLICT DO NOTHING`;

const CONTRACT_ITEMS_SQL = jsonInsertSql(
	'tracked_contract_items',
	['user_id', 'contract_id', 'record_id', 'type_id', 'quantity', 'is_included'],
	'ON CONFLICT DO NOTHING'
);

/**
 * Stream `?2` of connection `?1` ends as `error` (`?4`) while run `?3` still holds the connection (the
 * row is created when missing: `blueprints` gets its row only when it is fetched).
 */
const STREAM_ERROR_SQL = `
	INSERT INTO tracking_streams (source_id, stream, user_id, status, last_error)
	SELECT ?1, ?2, user_id, 'error', ?4 FROM inventory_sources
	WHERE source_id = ?1 AND tracking_run_id = ?3 AND tracking_status = 'running'
	ON CONFLICT (source_id, stream) DO UPDATE SET status = 'error', last_error = excluded.last_error`;

function loadSource(env: Env, sourceId: number): Promise<TrackingSource | undefined> {
	return getCoreDb(env.DB)
		.select({
			sourceId: inventorySources.sourceId,
			userId: inventorySources.userId,
			kind: inventorySources.kind,
			ownerId: inventorySources.ownerId,
			ownerName: inventorySources.ownerName,
			characterId: inventorySources.characterId,
			runId: inventorySources.trackingRunId,
			walletDivisionsJson: inventorySources.walletDivisionsJson
		})
		.from(inventorySources)
		.where(eq(inventorySources.sourceId, sourceId))
		.get();
}

/** Character `characterId` of the connection's account; any other character stops the run. */
async function loadReader(env: Env, source: TrackingSource, characterId: number): Promise<Reader> {
	const reader = await getCoreDb(env.DB)
		.select(READER_COLUMNS)
		.from(characters)
		.where(and(eq(characters.characterId, characterId), eq(characters.userId, source.userId)))
		.get();
	if (!reader) throw new NonRetryableError(`reading character ${characterId} was removed`);
	return reader;
}

/** The connection while run `runId` holds it; a removed or superseded connection stops the run. */
async function ownedSource(env: Env, sourceId: number, runId: string): Promise<TrackingSource> {
	const source = await loadSource(env, sourceId);
	if (!source) throw new NonRetryableError(`tracking connection ${sourceId} does not exist`);
	if (source.runId !== runId)
		throw new NonRetryableError(`tracking connection ${sourceId} is synced by ${source.runId} now`);
	return source;
}

/** User-facing failure of an ESI request a step gives up on (`what`: e.g. `wallet journal page 2`). */
const esiFailure = (status: number, what: string) =>
	`ESI answered HTTP ${status} for ${what}; the next sync tries again.`;

/** The sentences steps throw on purpose, found in an error message that may wrap them. */
const SYNC_FAILURE =
	/ESI answered HTTP \d{3} for [a-z0-9 ]+; the next sync tries again\.|No character can read .+|EVE Online (?:did not answer|answered HTTP \d{3}); it will be retried\./;

/** `last_error` of a failed sync or stream: a sentence a step threw on purpose, else a generic one (cause logged). */
function syncFailureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const sentence = SYNC_FAILURE.exec(message)?.[0];
	if (sentence) return userFacingError(sentence);
	console.error(`[tracking] sync failed: ${errorMessage(error)}`);
	return ERROR_INTERNAL;
}

/** Records how run `runId` ended on the connection. */
async function endSync(
	env: Env,
	source: TrackingSource,
	runId: string,
	status: 'ok' | 'denied' | 'error',
	message: string | null
): Promise<void> {
	await env.DB.prepare(
		`UPDATE inventory_sources SET tracking_status = ?3, tracking_last_error = ?4
		WHERE source_id = ?1 AND tracking_run_id = ?2`
	)
		.bind(source.sourceId, runId, status, message)
		.run();
}

/** A fresh access token of `reader`; a character already `token_status <> 'ok'` is invalid without asking SSO. */
function readerToken(env: Env, reader: Reader): Promise<AccessTokenResult> {
	if (reader.tokenStatus === 'ok') return refreshCharacterToken(env, reader);
	return Promise.resolve({ ok: false, invalid: true, message: TOKEN_ERROR_REVOKED });
}

/**
 * A fresh access token of the reading character. A token that can no longer be refreshed ends the
 * sync as `error` with the token sentence (`NonRetryableError`); other refresh failures throw so the
 * step retries.
 */
async function accessToken(env: Env, source: TrackingSource, reader: Reader, runId: string): Promise<string> {
	const token = await readerToken(env, reader);
	if (token.ok) return token.accessToken;
	if (!token.invalid) throw new Error(token.message);
	const message = `${reader.name}: ${token.message}`;
	await endSync(env, source, runId, 'error', message);
	throw new NonRetryableError(message);
}

/**
 * The corporation reader: the preferred reader, then the pool (`inventory_source_readers`, only
 * characters of the connection's account) in the order they were added; the first with Corporation
 * profit tracking, still in the corporation and a working token. Membership comes from one bulk
 * affiliation lookup, not asked again before its `Expires` (the `AFFILIATIONS_REQUEST` row): until
 * then the stored `characters.corporation_id` is used. None: `denied` with every reason, or a thrown
 * error (step retried) when a token refresh failed for a reason other than an invalid token.
 */
async function pickCorporationReader(
	env: Env,
	source: TrackingSource,
	runId: string,
	now: number
): Promise<{ reader: Reader; notes: string[] } | TrackingSyncEnded> {
	const pool = await getCoreDb(env.DB)
		.select({ ...READER_COLUMNS, corporationId: characters.corporationId })
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
		if (hasFeature(c.scopes, 'corp_tracking')) return true;
		notes.push(`${c.name} has not allowed Corporation profit tracking`);
		return false;
	});
	const members = new Set<number>();
	if (readers.length > 0 && (await requestFresh(env, source.sourceId, AFFILIATIONS_REQUEST, now))) {
		for (const r of readers) if (r.corporationId === source.ownerId) members.add(r.characterId);
	} else if (readers.length > 0) {
		const affiliations = await fetchAffiliations(
			esiClient(env),
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
		await storeRequestExpiry(env, source, AFFILIATIONS_REQUEST, affiliations.expiresAt, now);
		for (const a of affiliations.items) if (a.corporationId === source.ownerId) members.add(a.characterId);
	}
	let retry = false;
	for (const reader of readers) {
		if (!members.has(reader.characterId)) {
			notes.push(`${reader.name} is not in the corporation`);
			continue;
		}
		const token = await readerToken(env, reader);
		if (token.ok) return { reader, notes };
		notes.push(
			token.invalid ? `${reader.name} has an invalid token` : `${reader.name}'s token could not be refreshed`
		);
		retry ||= !token.invalid;
	}
	const message = `No character can read ${source.ownerName}: ${notes.join('; ')}`;
	if (retry) throw new Error(message);
	await endSync(env, source, runId, 'denied', message);
	return { ok: false, status: 'denied', message };
}

/**
 * Step `prepare`: takes the connection (claim, when the trigger did not), creates its missing stream
 * rows and picks the due streams, plus `blueprints` last when it is not fresh and the jobs stream is due
 * or a manufacturing job still waits for its blueprint's ME; with none due the sync ends `fresh`
 * without any request. Then picks the reader: personal → the character (needs Profit tracking),
 * corporation → `pickCorporationReader`.
 */
export async function prepareTrackingSync(
	env: Env,
	sourceId: number,
	runId: string,
	now: number
): Promise<TrackingPrepared | TrackingSyncEnded> {
	let source = await loadSource(env, sourceId);
	if (!source) throw new NonRetryableError(`tracking connection ${sourceId} does not exist`);
	if (source.runId !== runId) {
		const claim = await claimTrackingSource(env, sourceId, runId, now, false);
		if (claim === 'missing') throw new NonRetryableError(`tracking connection ${sourceId} is not tracked`);
		if (claim !== 'claimed')
			return { ok: false, status: 'busy', message: `${source.runId} is still running` };
		source = await ownedSource(env, sourceId, runId);
	}
	const names = trackingStreamNames(source.kind, source.walletDivisionsJson);
	const results = await env.DB.batch([
		...names.map((name) =>
			env.DB.prepare(
				'INSERT OR IGNORE INTO tracking_streams (source_id, stream, user_id) VALUES (?, ?, ?)'
			).bind(sourceId, name, source.userId)
		),
		env.DB.prepare('SELECT stream, expires_at FROM tracking_streams WHERE source_id = ?').bind(sourceId)
	]);
	const stored = results.at(-1)!.results as { stream: string; expires_at: number | null }[];
	const { due } = dueStreams(names, stored, now);
	// Blueprints: only for manufacturing jobs whose ME is not read yet, also those the jobs step may store.
	if (
		dueStreams([BLUEPRINTS_STREAM], stored, now).due.length > 0 &&
		(due.includes('jobs') || (await wantedBlueprints(env, source)).length > 0)
	)
		due.push(BLUEPRINTS_STREAM);
	if (due.length === 0) {
		await env.DB.prepare(
			"UPDATE inventory_sources SET tracking_status = 'ok' WHERE source_id = ?1 AND tracking_run_id = ?2"
		)
			.bind(sourceId, runId)
			.run();
		return { ok: false, status: 'fresh', message: 'every stream is still fresh' };
	}
	if (source.kind === 'corporation') {
		const picked = await pickCorporationReader(env, source, runId, now);
		if ('ok' in picked) return picked;
		const note = picked.notes.length > 0 ? picked.notes.join('; ') : null;
		return { ok: true, kind: source.kind, readerId: picked.reader.characterId, due, note };
	}
	const reader = await loadReader(env, source, source.characterId);
	if (!hasFeature(reader.scopes, 'tracking')) {
		const message = `${reader.name} has not allowed Profit tracking`;
		await endSync(env, source, runId, 'denied', message);
		return { ok: false, status: 'denied', message };
	}
	return { ok: true, kind: source.kind, readerId: reader.characterId, due, note: null };
}

/** What a stream fetch stored, or the ESI failure that stopped it. */
type StreamFetch =
	| { ok: true; rows: number; expiresAt: number | null; cursor: number | null; label?: never }
	| (EsiFailure & { label: string });

interface StreamContext {
	env: Env;
	client: EsiClient;
	source: TrackingSource;
	token: string;
	/** Wallet division of a corporation `transactions:<n>`/`journal:<n>` stream; null otherwise. */
	division: number | null;
	cursor: number | null;
	/** `blueprints` stream: the blueprint items whose ME is wanted (`wantedBlueprints`); empty otherwise. */
	wanted: readonly number[];
}

/** Blueprint items of the connection's manufacturing jobs still installed whose ME is not read yet. */
async function wantedBlueprints(env: Env, source: TrackingSource): Promise<number[]> {
	const { results } = await env.DB.prepare(WANTED_BLUEPRINTS_SQL)
		.bind(source.userId, source.sourceId)
		.all<{ blueprint_id: number }>();
	return results.map((r) => r.blueprint_id);
}

const failed = (failure: EsiFailure, label: string): StreamFetch => ({ ...failure, label });

/** The later of two `Expires` (null = none): a stream is not asked again before any of its requests expire. */
const laterExpiry = (a: number | null, b: number | null): number | null =>
	a === null ? b : b === null ? a : Math.max(a, b);

/** Every page of a paged endpoint (at most `TRACKING_MAX_PAGES`); the latest `Expires` of its pages. */
async function allPages<T>(
	fetchPage: (
		page: number
	) => Promise<{ ok: true; items: T[]; pages: number; expiresAt: number | null } | EsiFailure>,
	label: string
): Promise<{ ok: true; items: T[]; expiresAt: number | null } | (EsiFailure & { label: string })> {
	const items: T[] = [];
	let expiresAt: number | null = null;
	for (let page = 1; page <= TRACKING_MAX_PAGES; page++) {
		const res = await fetchPage(page);
		if (!res.ok) return { ...res, label: `${label} page ${page}` };
		expiresAt = laterExpiry(expiresAt, res.expiresAt);
		items.push(...res.items);
		if (page >= res.pages) break;
	}
	return { ok: true, items, expiresAt };
}

/**
 * Reaction jobs, and manufacturing jobs whose blueprint uses reaction products (they take reaction
 * output; never shown as jobs), makes a reaction material (fuel blocks) or consumes another tracked
 * material (`manufacturing_blueprints`). Rows keep their stored `blueprint_me`.
 */
async function syncJobs({ env, client, source, token }: StreamContext): Promise<StreamFetch> {
	const corporation = source.kind === 'corporation';
	const res = corporation
		? await allPages(
				(page) =>
					fetchCorporationIndustryJobs(client, source.ownerId, token, page, { includeCompleted: true }),
				'industry jobs'
			)
		: await fetchCharacterIndustryJobs(client, source.ownerId, token, { includeCompleted: true });
	if (!res.ok) return failed(res, 'industry jobs');
	// `Dataset.manufacturing`: blueprints using reaction products or making reaction materials.
	const manufacturing = new Set(
		((await publishedDataset(env)).manufacturing ?? []).map((b) => b.blueprintTypeId)
	);
	const others = [
		...new Set(
			res.items
				.filter((j) => j.activityId === MANUFACTURING_ACTIVITY_ID && !manufacturing.has(j.blueprintTypeId))
				.map((j) => j.blueprintTypeId)
		)
	];
	if (others.length > 0) {
		const { results } = await env.DB.prepare(CONSUMING_BLUEPRINTS_SQL)
			.bind(JSON.stringify(others))
			.all<{ blueprint_type_id: number }>();
		for (const r of results) manufacturing.add(r.blueprint_type_id);
	}
	const rows = res.items
		.filter(
			(j: IndustryJobRow) =>
				REACTION_ACTIVITY_IDS.has(j.activityId) ||
				(j.activityId === MANUFACTURING_ACTIVITY_ID && manufacturing.has(j.blueprintTypeId))
		)
		.map((j) => [
			source.userId,
			j.jobId,
			source.sourceId,
			j.installerId,
			j.activityId,
			j.blueprintId,
			j.blueprintTypeId,
			j.productTypeId,
			j.runs,
			j.status,
			j.cost,
			j.facilityId,
			j.outputLocationId,
			j.startDate,
			j.endDate,
			j.completedDate
		]);
	if (rows.length > 0) await env.DB.prepare(JOBS_SQL).bind(JSON.stringify(rows)).run();
	return { ok: true, rows: rows.length, expiresAt: res.expiresAt, cursor: null };
}

/**
 * Blueprint pages until every wanted blueprint item is found (or the last page, at most
 * `TRACKING_MAX_PAGES`); their material efficiency is stored on the waiting manufacturing jobs.
 * The latest `Expires` of the pages read; a blueprint not found leaves its jobs without ME (the ledger
 * assumes one).
 */
async function syncBlueprints({ env, client, source, token, wanted }: StreamContext): Promise<StreamFetch> {
	const missing = new Set(wanted);
	const found: [number, number][] = [];
	let expiresAt: number | null = null;
	for (let page = 1; page <= TRACKING_MAX_PAGES && missing.size > 0; page++) {
		const res =
			source.kind === 'corporation'
				? await fetchCorporationBlueprints(client, source.ownerId, token, page)
				: await fetchCharacterBlueprints(client, source.ownerId, token, page);
		if (!res.ok) return failed(res, `blueprints page ${page}`);
		expiresAt = laterExpiry(expiresAt, res.expiresAt);
		for (const b of res.items as Blueprint[]) {
			if (!missing.delete(b.itemId)) continue;
			found.push([b.itemId, b.materialEfficiency]);
		}
		if (page >= res.pages) break;
	}
	if (found.length === 0) return { ok: true, rows: 0, expiresAt, cursor: null };
	const updated = await env.DB.prepare(BLUEPRINT_ME_SQL)
		.bind(source.userId, source.sourceId, JSON.stringify(found))
		.run();
	return { ok: true, rows: updated.meta.changes, expiresAt, cursor: null };
}

async function syncTransactions({
	env,
	client,
	source,
	token,
	division,
	cursor
}: StreamContext): Promise<StreamFetch> {
	const tracked = trackedTypeIds(await publishedDataset(env));
	const walk = await collectWalletTransactions(
		(fromId) =>
			division === null
				? fetchCharacterWalletTransactions(client, source.ownerId, token, fromId)
				: fetchCorporationWalletTransactions(client, source.ownerId, division, token, fromId),
		cursor,
		TRACKING_TX_MAX_PAGES
	);
	if (!walk.ok) return failed(walk, 'wallet transactions');
	const rows = walk.items
		.filter((t: WalletTransaction) => tracked.has(t.typeId) && !(division === null && t.isPersonal === false))
		.map((t) => [
			source.userId,
			t.transactionId,
			source.sourceId,
			division,
			t.date,
			t.typeId,
			t.quantity,
			t.unitPrice,
			t.isBuy,
			t.clientId,
			t.locationId,
			t.journalRefId,
			t.isPersonal
		]);
	if (rows.length > 0) await env.DB.prepare(TRANSACTIONS_SQL).bind(JSON.stringify(rows)).run();
	// A walk cut off by the page cap keeps the cursor: once page 1 expires the next run walks again from
	// the newest row (stored rows are ignored), so no gap is left below the cut.
	if (!walk.complete) return { ok: true, rows: rows.length, expiresAt: walk.expiresAt, cursor };
	const newest = walk.items.reduce((max, t) => Math.max(max, t.transactionId), cursor ?? 0);
	return { ok: true, rows: rows.length, expiresAt: walk.expiresAt, cursor: newest > 0 ? newest : cursor };
}

/** Journal pages from 1 until a page reaching the cursor (or the last page); tracked ref types newer than it. */
async function syncJournal({
	env,
	client,
	source,
	token,
	division,
	cursor
}: StreamContext): Promise<StreamFetch> {
	const kept: WalletJournalEntry[] = [];
	let newest = cursor ?? 0;
	let expiresAt: number | null = null;
	let complete = false;
	for (let page = 1; page <= TRACKING_MAX_PAGES; page++) {
		const res =
			division === null
				? await fetchCharacterWalletJournal(client, source.ownerId, token, page)
				: await fetchCorporationWalletJournal(client, source.ownerId, division, token, page);
		if (!res.ok) return failed(res, `wallet journal page ${page}`);
		expiresAt = laterExpiry(expiresAt, res.expiresAt);
		let reachedCursor = false;
		for (const entry of res.items) {
			newest = Math.max(newest, entry.id);
			if (cursor !== null && entry.id <= cursor) reachedCursor = true;
			else if (isTrackedJournalRefType(entry.refType)) kept.push(entry);
		}
		if (res.items.length === 0 || reachedCursor || page >= res.pages) {
			complete = true;
			break;
		}
	}
	const rows = kept.map((e) => [
		source.userId,
		e.id,
		source.sourceId,
		division,
		e.date,
		e.refType,
		e.amount,
		e.contextId,
		e.contextIdType
	]);
	if (rows.length > 0) await env.DB.prepare(JOURNAL_SQL).bind(JSON.stringify(rows)).run();
	// Cut off by the page cap: cursor kept, asked again once the pages expire (see `syncTransactions`).
	if (!complete) return { ok: true, rows: rows.length, expiresAt, cursor };
	return { ok: true, rows: rows.length, expiresAt, cursor: newest > 0 ? newest : cursor };
}

/** Open orders plus order history; personal streams leave out orders placed for a corporation. */
async function syncOrders({ env, client, source, token }: StreamContext): Promise<StreamFetch> {
	const corporation = source.kind === 'corporation';
	const open = corporation
		? await allPages((page) => fetchCorporationOrders(client, source.ownerId, token, page), 'market orders')
		: await fetchCharacterOrders(client, source.ownerId, token);
	if (!open.ok) return failed(open, 'market orders');
	const history = await allPages(
		(page) =>
			corporation
				? fetchCorporationOrderHistory(client, source.ownerId, token, page)
				: fetchCharacterOrderHistory(client, source.ownerId, token, page),
		'order history'
	);
	if (!history.ok) return history;
	const rows = [...open.items, ...history.items]
		.filter((o: OwnMarketOrder) => corporation || o.isCorporation !== true)
		.map((o) => [
			source.userId,
			o.orderId,
			source.sourceId,
			o.typeId,
			o.isBuyOrder,
			o.price,
			o.volumeTotal,
			o.volumeRemain,
			o.issued,
			o.locationId,
			corporation ? o.walletDivision : null,
			o.state
		]);
	if (rows.length > 0) await env.DB.prepare(ORDERS_SQL).bind(JSON.stringify(rows)).run();
	return {
		ok: true,
		rows: rows.length,
		expiresAt: laterExpiry(open.expiresAt, history.expiresAt),
		cursor: null
	};
}

/**
 * Every contract page; finished item exchanges not stored yet get their items fetched (at most
 * `TRACKING_CONTRACT_ITEMS_PER_STEP`, the rest once the contract pages expire again) and are stored
 * with their items and the first Janice code of the title. Items are read once per contract, so only
 * the pages' `Expires` is kept.
 */
async function syncContracts({ env, client, source, token }: StreamContext): Promise<StreamFetch> {
	const corporation = source.kind === 'corporation';
	const list = await allPages(
		(page) =>
			corporation
				? fetchCorporationContracts(client, source.ownerId, token, page)
				: fetchCharacterContracts(client, source.ownerId, token, page),
		'contracts'
	);
	if (!list.ok) return list;
	const finished = list.items.filter(
		(c: Contract) => c.type === 'item_exchange' && FINISHED_CONTRACT[c.status]
	);
	const { results: stored } = await env.DB.prepare(
		'SELECT contract_id FROM tracked_contracts WHERE user_id = ?1 AND contract_id IN (SELECT value FROM json_each(?2))'
	)
		.bind(source.userId, JSON.stringify(finished.map((c) => c.contractId)))
		.all<{ contract_id: number }>();
	const known = new Set(stored.map((r) => r.contract_id));
	const todo = finished.filter((c) => !known.has(c.contractId));
	const batch = todo.slice(0, TRACKING_CONTRACT_ITEMS_PER_STEP);
	for (const c of batch) {
		const items = corporation
			? await fetchCorporationContractItems(client, source.ownerId, c.contractId, token)
			: await fetchCharacterContractItems(client, source.ownerId, c.contractId, token);
		if (!items.ok) return failed(items, 'contract items');
		const itemRows = items.items.map((i: ContractItem) => [
			source.userId,
			c.contractId,
			i.recordId,
			i.typeId,
			i.quantity,
			i.isIncluded
		]);
		await env.DB.batch([
			env.DB.prepare(CONTRACT_SQL).bind(
				source.userId,
				c.contractId,
				source.sourceId,
				c.type,
				c.status,
				c.issuerId,
				c.issuerCorporationId,
				c.acceptorId,
				c.assigneeId,
				c.forCorporation ? 1 : 0,
				c.price,
				c.reward,
				c.title,
				c.dateIssued,
				c.dateCompleted,
				c.startLocationId,
				parseJaniceCodes(c.title)[0] ?? null
			),
			env.DB.prepare(CONTRACT_ITEMS_SQL).bind(JSON.stringify(itemRows))
		]);
	}
	return { ok: true, rows: batch.length, expiresAt: list.expiresAt, cursor: null };
}

const STREAM_FETCHERS: Record<string, (context: StreamContext) => Promise<StreamFetch>> = {
	jobs: syncJobs,
	transactions: syncTransactions,
	journal: syncJournal,
	orders: syncOrders,
	contracts: syncContracts,
	[BLUEPRINTS_STREAM]: syncBlueprints
};

/** `last_error` of a stream ESI answered 403: the corporation role the reader needs. */
function deniedMessage(kind: string, source: TrackingSource, reader: Reader): string {
	if (source.kind !== 'corporation' || kind === 'contracts') return 'ESI denied access';
	if (kind === 'jobs') return `${reader.name} needs the Factory Manager role`;
	if (kind === 'orders') return `${reader.name} needs the Accountant or Trader role`;
	if (kind === BLUEPRINTS_STREAM) return `${reader.name} needs the Director role`;
	return `${reader.name} needs the Accountant or Junior Accountant role`;
}

/**
 * Step `stream-<name>`: fetches one stream with a fresh access token of the reader and stores its rows;
 * the stream becomes `ok` with the latest `Expires` of its requests and the newest id as cursor. 403 → the stream
 * is `denied` with the role it needs; other ESI failures throw (step retried). `blueprints` with no
 * manufacturing job waiting for its ME is skipped (null): no request; an error of an earlier attempt is
 * cleared, since nothing is left to read.
 */
export async function syncTrackingStream(
	env: Env,
	sourceId: number,
	runId: string,
	readerId: number,
	stream: string,
	now: number
): Promise<StreamOutcome | null> {
	const source = await ownedSource(env, sourceId, runId);
	const [kind = stream, divisionText] = stream.split(':');
	const fetcher = STREAM_FETCHERS[kind];
	if (!fetcher) throw new NonRetryableError(`unknown tracking stream ${stream}`);
	const wanted = kind === BLUEPRINTS_STREAM ? await wantedBlueprints(env, source) : [];
	if (kind === BLUEPRINTS_STREAM && wanted.length === 0) {
		await env.DB.prepare(
			"UPDATE tracking_streams SET status = 'ok', last_error = NULL WHERE source_id = ? AND stream = ? AND status = 'error'"
		)
			.bind(sourceId, stream)
			.run();
		return null;
	}
	const reader = await loadReader(env, source, readerId);
	const token = await accessToken(env, source, reader, runId);
	const [, row] = await env.DB.batch<{ cursor: number | null }>([
		env.DB.prepare(
			'INSERT OR IGNORE INTO tracking_streams (source_id, stream, user_id) VALUES (?, ?, ?)'
		).bind(sourceId, stream, source.userId),
		env.DB.prepare('SELECT cursor FROM tracking_streams WHERE source_id = ? AND stream = ?').bind(
			sourceId,
			stream
		)
	]);
	const cursor = row!.results[0]?.cursor ?? null;
	const result = await fetcher({
		env,
		client: esiClient(env),
		source,
		token,
		division: divisionText === undefined ? null : Number(divisionText),
		cursor,
		wanted
	});
	if (!result.ok) {
		if (result.status !== 403) throw new Error(esiFailure(result.status, result.label));
		const message = deniedMessage(kind, source, reader);
		await env.DB.prepare(
			"UPDATE tracking_streams SET status = 'denied', last_error = ?3 WHERE source_id = ?1 AND stream = ?2"
		)
			.bind(sourceId, stream, message)
			.run();
		return { stream, status: 'denied', rows: 0, message };
	}
	await env.DB.prepare(
		`UPDATE tracking_streams SET status = 'ok', last_error = NULL, expires_at = ?3, cursor = ?4, last_synced_at = ?5
		WHERE source_id = ?1 AND stream = ?2`
	)
		.bind(sourceId, stream, result.expiresAt, result.cursor ?? cursor, now)
		.run();
	return { stream, status: 'ok', rows: result.rows, message: null };
}

/**
 * `tracked_contracts.janice_json` of a code whose appraisal failed: `failures` in a row, tried again
 * from `retryAt` (unix ms). An appraisal never has `retryAt` (`parseJanice` reads no appraisal here).
 */
interface JaniceFailure {
	failures: number;
	retryAt: number;
}

/**
 * The user's (`?1`) Janice codes to appraise at `?2`, at most `?3`: never tried first, then failed ones
 * whose `retryAt` passed, longest due first; ties by code.
 */
const DUE_JANICE_SQL = `
	SELECT janice_code, MAX(janice_json) AS failure FROM tracked_contracts
	WHERE user_id = ?1 AND janice_code IS NOT NULL
		AND (janice_json IS NULL OR json_extract(janice_json, '$.retryAt') <= ?2)
	GROUP BY janice_code
	ORDER BY failure IS NOT NULL, json_extract(failure, '$.retryAt'), janice_code
	LIMIT ?3`;

/** Stores failure `?3` on the contracts with code `?2`, never over an appraisal stored meanwhile. */
const JANICE_FAILED_SQL = `
	UPDATE tracked_contracts SET janice_json = ?3
	WHERE user_id = ?1 AND janice_code = ?2
		AND (janice_json IS NULL OR json_extract(janice_json, '$.retryAt') IS NOT NULL)`;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Failure state after one more failed appraisal: tried again after `JANICE_RETRY_MIN_HOURS`, doubled
 * per failure in a row up to `JANICE_RETRY_MAX_DAYS`.
 */
function janiceFailure(previous: string | null, now: number): JaniceFailure {
	let failures = 0;
	if (previous !== null) {
		const stored = JSON.parse(previous) as Partial<JaniceFailure>;
		if (typeof stored.failures === 'number') failures = stored.failures;
	}
	failures++;
	const wait = Math.min(
		JANICE_RETRY_MIN_HOURS * HOUR_MS * 2 ** (failures - 1),
		JANICE_RETRY_MAX_DAYS * DAY_MS
	);
	return { failures, retryAt: now + wait };
}

/**
 * Step `janice`: appraisals of the user's stored contracts whose Janice code has none yet, each code
 * fetched once (at most `TRACKING_JANICE_PER_STEP`, `DUE_JANICE_SQL`) and stored on every contract with
 * that code. A failed appraisal (an answer other than a valid appraisal, or none) is stored as a
 * `JaniceFailure`, so codes that keep failing wait longer each time and never hold back the others.
 * Without `JANICE_API_KEY` nothing is requested. The codes are never logged.
 */
export async function fetchTrackingJanice(
	env: Env,
	sourceId: number,
	runId: string,
	now: number
): Promise<{ fetched: number; failed: number }> {
	const source = await ownedSource(env, sourceId, runId);
	if (!env.JANICE_API_KEY) return { fetched: 0, failed: 0 };
	const { results } = await env.DB.prepare(DUE_JANICE_SQL)
		.bind(source.userId, now, TRACKING_JANICE_PER_STEP)
		.all<{ janice_code: string; failure: string | null }>();
	const counts = { fetched: 0, failed: 0 };
	const statuses = new Set<number>();
	for (const { janice_code: code, failure } of results) {
		const res = await fetchJaniceAppraisal(
			httpFetch,
			{ apiKey: env.JANICE_API_KEY, userAgent: userAgent(env) },
			code
		);
		if (!res.ok) {
			statuses.add(res.status);
			counts.failed++;
			await env.DB.prepare(JANICE_FAILED_SQL)
				.bind(source.userId, code, JSON.stringify(janiceFailure(failure, now)))
				.run();
			continue;
		}
		await env.DB.prepare(
			'UPDATE tracked_contracts SET janice_json = ?3 WHERE user_id = ?1 AND janice_code = ?2'
		)
			.bind(source.userId, code, JSON.stringify(res.appraisal))
			.run();
		counts.fetched++;
	}
	if (counts.failed > 0)
		console.error(
			`[tracking] ${counts.failed} Janice appraisals of connection ${sourceId} failed (status ${[...statuses].join(', ')})`
		);
	return counts;
}

/** Stores the `Expires` of request row `name` of the connection (see `DIVISIONS_REQUEST`). */
async function storeRequestExpiry(
	env: Env,
	source: TrackingSource,
	name: string,
	expiresAt: number | null,
	now: number
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO tracking_streams (source_id, stream, user_id, status, expires_at, last_synced_at)
		VALUES (?1, ?2, ?3, 'ok', ?4, ?5)
		ON CONFLICT (source_id, stream) DO UPDATE SET expires_at = excluded.expires_at,
			last_synced_at = excluded.last_synced_at`
	)
		.bind(source.sourceId, name, source.userId, expiresAt, now)
		.run();
}

/** True while request row `name` of the connection has an `Expires` after `now`. */
async function requestFresh(env: Env, sourceId: number, name: string, now: number): Promise<boolean> {
	const row = await env.DB.prepare(
		'SELECT expires_at FROM tracking_streams WHERE source_id = ? AND stream = ?'
	)
		.bind(sourceId, name)
		.first<{ expires_at: number | null }>();
	return row?.expires_at != null && row.expires_at > now;
}

/**
 * Step `divisions` (corporations): wallet division names of `/corporations/{id}/divisions` into
 * `wallet_names_json` (`{"2":"Industry"}`), not asked again before the answer's `Expires` (kept in the
 * `DIVISIONS_REQUEST` row, also for a refusal); a failure or a fresh answer keeps the stored names.
 */
export async function nameTrackingWallets(
	env: Env,
	sourceId: number,
	runId: string,
	readerId: number,
	now: number
): Promise<{ named: number | null }> {
	const source = await ownedSource(env, sourceId, runId);
	if (await requestFresh(env, sourceId, DIVISIONS_REQUEST, now)) return { named: null };
	const reader = await loadReader(env, source, readerId);
	const token = await accessToken(env, source, reader, runId);
	const res = await esiClient(env).get<{ wallet?: { division?: number; name?: string }[] }>(
		`/corporations/${source.ownerId}/divisions`,
		{ accessToken: token }
	);
	await storeRequestExpiry(env, source, DIVISIONS_REQUEST, res.expiresAt, now);
	if (res.status !== 200 || !res.data) {
		console.error(`[tracking] wallet division names of connection ${sourceId}: HTTP ${res.status}`);
		return { named: null };
	}
	const names: Record<string, string> = {};
	for (const { division, name } of res.data.wallet ?? [])
		if (name && division != null && division >= 1 && division <= 7) names[String(division)] = name;
	await env.DB.prepare(
		'UPDATE inventory_sources SET wallet_names_json = ?3 WHERE source_id = ?1 AND tracking_run_id = ?2'
	)
		.bind(sourceId, runId, JSON.stringify(names))
		.run();
	return { named: Object.keys(names).length };
}

/**
 * The user's job facilities due for a lookup (`?2` = now, at most `?3`): no row yet, or `next_check_at`
 * reached; never looked up first, then the longest due.
 */
const DUE_FACILITIES_SQL = `
	SELECT j.facility_id, f.kind, f.checked_at, f.next_check_at
	FROM (SELECT DISTINCT facility_id FROM tracked_jobs WHERE user_id = ?1) j
	LEFT JOIN tracked_facilities f ON f.user_id = ?1 AND f.facility_id = j.facility_id
	WHERE f.facility_id IS NULL OR f.next_check_at IS NULL OR f.next_check_at <= ?2
	ORDER BY f.next_check_at IS NOT NULL, f.next_check_at, j.facility_id
	LIMIT ?3`;

/**
 * Takes facility `?2` for one lookup until `?3` (a sync of another connection of the user skips it):
 * a new row is `unknown` until the lookup answers. No change (0 rows) = someone else took it.
 */
const CLAIM_FACILITY_SQL = `
	INSERT INTO tracked_facilities (user_id, facility_id, kind, next_check_at) VALUES (?1, ?2, 'unknown', ?3)
	ON CONFLICT (user_id, facility_id) DO UPDATE SET next_check_at = excluded.next_check_at
	WHERE tracked_facilities.next_check_at IS NULL OR tracked_facilities.next_check_at <= ?4`;

interface DueFacility {
	facility_id: number;
	kind: string | null;
	checked_at: number | null;
	next_check_at: number | null;
}

/**
 * When a facility whose lookup failed is tried again: one day, doubled after each failure in a row (up
 * to `FACILITY_RECHECK_DAYS`), and never before the answer's `Expires`.
 */
function facilityRetryAt(previous: DueFacility, expiresAt: number | null, now: number): number {
	const previousWait =
		previous.kind === 'unknown' && previous.checked_at !== null && previous.next_check_at !== null
			? previous.next_check_at - previous.checked_at
			: 0;
	const wait = Math.min(
		Math.max(2 * previousWait, FACILITY_RETRY_MIN_DAYS * DAY_MS),
		FACILITY_RECHECK_DAYS * DAY_MS
	);
	return Math.max(now + wait, expiresAt ?? 0);
}

/**
 * Step `facilities`: looks up the user's job facilities that have no `tracked_facilities` row or whose
 * `next_check_at` passed (at most `TRACKING_FACILITY_LOOKUPS_PER_SYNC`, each taken first so another
 * connection's sync does not ask again): NPC stations publicly, structures with the reader's token.
 * Found → kind, name, system and type, next lookup in `FACILITY_RECHECK_DAYS` (not before `Expires`);
 * refused or failed → `unknown` keeping what was found before, retried per `facilityRetryAt`. The
 * `ledger` step that follows rebuilds with the new values.
 */
export async function lookUpTrackingFacilities(
	env: Env,
	sourceId: number,
	runId: string,
	readerId: number,
	now: number
): Promise<{ found: number; failed: number }> {
	const source = await ownedSource(env, sourceId, runId);
	const { results: due } = await env.DB.prepare(DUE_FACILITIES_SQL)
		.bind(source.userId, now, TRACKING_FACILITY_LOOKUPS_PER_SYNC)
		.all<DueFacility>();
	const counts = { found: 0, failed: 0 };
	if (due.length === 0) return counts;
	let token: string | null = null;
	if (due.some((f) => !isStationId(f.facility_id))) {
		const refreshed = await readerToken(env, await loadReader(env, source, readerId));
		if (refreshed.ok) token = refreshed.accessToken;
	}
	const lease = now + TRACKING_RUN_STALE_MINUTES * 60_000;
	const client = esiClient(env);
	await forEachConcurrent(due, ESI_CONCURRENCY, async (facility) => {
		const id = facility.facility_id;
		// Without a token only stations can be looked up; structures wait for a sync that has one.
		if (token === null && !isStationId(id)) return;
		const claimed = await env.DB.prepare(CLAIM_FACILITY_SQL).bind(source.userId, id, lease, now).run();
		if (claimed.meta.changes === 0) return;
		const found = await lookUpFacility(client, id, token ?? '').catch((error: unknown) => {
			// Not a failed lookup: the step waits out the downtime (the facility is retried after its lease).
			if (isEsiDowntime(error)) throw error;
			console.error(`[tracking] facility ${id}: ${errorMessage(error)}`);
			return { ok: false as const, status: 0, expiresAt: null };
		});
		if (found.ok) {
			counts.found++;
			await env.DB.prepare(
				`UPDATE tracked_facilities SET kind = ?3, name = ?4, system_id = ?5, type_id = ?6, checked_at = ?7,
					next_check_at = ?8 WHERE user_id = ?1 AND facility_id = ?2`
			)
				.bind(
					source.userId,
					id,
					found.kind,
					found.name,
					found.systemId,
					found.typeId,
					now,
					Math.max(now + FACILITY_RECHECK_DAYS * DAY_MS, found.expiresAt ?? 0)
				)
				.run();
			return;
		}
		counts.failed++;
		await env.DB.prepare(
			`UPDATE tracked_facilities SET kind = 'unknown', checked_at = ?3, next_check_at = ?4
			WHERE user_id = ?1 AND facility_id = ?2`
		)
			.bind(source.userId, id, now, facilityRetryAt(facility, found.expiresAt, now))
			.run();
	});
	return counts;
}

/**
 * Step `ledger`: rebuilds the user's ledger (a failure marks it dirty for the cron and is logged), then
 * ends the sync: `ok` (with the reader note) unless every fetched stream failed (`error` with the first
 * stream's message), `tracking_synced_at` = now on `ok`.
 */
export async function finishTrackingSync(
	env: Env,
	sourceId: number,
	runId: string,
	outcomes: StreamOutcome[],
	note: string | null,
	now: number
): Promise<TrackingFinished> {
	const source = await ownedSource(env, sourceId, runId);
	let ledgerRebuilt = true;
	try {
		await rebuildLedger(env, source.userId, now);
	} catch (error) {
		console.error(`[tracking] ledger rebuild of connection ${sourceId}: ${errorMessage(error)}`);
		await markLedgerDirty(env, source.userId);
		ledgerRebuilt = false;
	}
	const firstFailure = outcomes.find((o) => o.status !== 'ok');
	const allFailed = outcomes.length > 0 && outcomes.every((o) => o.status !== 'ok');
	const status = allFailed ? 'error' : 'ok';
	await env.DB.prepare(
		`UPDATE inventory_sources SET tracking_status = ?3, tracking_last_error = ?4,
			tracking_synced_at = CASE WHEN ?3 = 'ok' THEN ?5 ELSE tracking_synced_at END
		WHERE source_id = ?1 AND tracking_run_id = ?2 AND tracking_status = 'running'`
	)
		.bind(sourceId, runId, status, allFailed ? (firstFailure?.message ?? ERROR_INTERNAL) : note, now)
		.run();
	return { ok: true, status, streams: outcomes, ledgerRebuilt };
}

/**
 * Reads one tracking connection from ESI: instance `tracking-<sourceId>-<ms>`. One step per due stream
 * (fresh token each); a stream that keeps failing ends `error` and the others go on; then Janice
 * appraisals (with a key, when contracts were read), corporation wallet names, the job facility
 * lookups and the ledger rebuild.
 * Not a `job_runs` row: the outcome lives on the connection and its streams.
 */
export class TrackingSyncWorkflow extends WorkflowEntrypoint<Env, TrackingSyncParams> {
	override async run(
		event: Readonly<WorkflowEvent<TrackingSyncParams>>,
		step: WorkflowStep
	): Promise<TrackingSyncResult> {
		const { sourceId } = event.payload;
		const runId = event.instanceId;
		const env = this.env;
		const steps = new StepTracker(env, step, runId);
		try {
			const prepared = await steps.do('prepare', STEP_CONFIG, () =>
				prepareTrackingSync(env, sourceId, runId, Date.now())
			);
			if (!prepared.ok) return prepared;
			const corporation = prepared.kind === 'corporation';
			const janice = Boolean(env.JANICE_API_KEY) && prepared.due.includes('contracts');
			steps.total = 1 + prepared.due.length + (janice ? 1 : 0) + (corporation ? 1 : 0) + 2;
			const outcomes: StreamOutcome[] = [];
			for (const stream of prepared.due) {
				try {
					const outcome = await steps.do(`stream-${stream}`, STEP_CONFIG, () =>
						syncTrackingStream(env, sourceId, runId, prepared.readerId, stream, Date.now())
					);
					if (outcome) outcomes.push(outcome);
				} catch (error) {
					// Still in the downtime after every wait: end the sync instead of waiting again per stream.
					if (isEsiDowntime(error)) throw error;
					const message = syncFailureMessage(error);
					const marked = await env.DB.prepare(STREAM_ERROR_SQL).bind(sourceId, stream, runId, message).run();
					if (marked.meta.changes === 0) throw error;
					outcomes.push({ stream, status: 'error', rows: 0, message });
				}
			}
			if (janice) {
				try {
					await steps.do('janice', STEP_CONFIG, () => fetchTrackingJanice(env, sourceId, runId, Date.now()));
				} catch (error) {
					console.error(`[${runId}] janice: ${errorMessage(error)}`);
				}
			}
			if (corporation) {
				try {
					await steps.do('divisions', STEP_CONFIG, () =>
						nameTrackingWallets(env, sourceId, runId, prepared.readerId, Date.now())
					);
				} catch (error) {
					if (isEsiDowntime(error)) throw error;
					console.error(`[${runId}] divisions: ${errorMessage(error)}`);
				}
			}
			try {
				await steps.do('facilities', STEP_CONFIG, () =>
					lookUpTrackingFacilities(env, sourceId, runId, prepared.readerId, Date.now())
				);
			} catch (error) {
				if (isEsiDowntime(error)) throw error;
				console.error(`[${runId}] facilities: ${errorMessage(error)}`);
			}
			return await steps.do('ledger', STEP_CONFIG, () =>
				finishTrackingSync(env, sourceId, runId, outcomes, prepared.note, Date.now())
			);
		} catch (error) {
			await failTrackingSync(env, sourceId, runId, syncFailureMessage(error));
			throw error;
		}
	}
}
