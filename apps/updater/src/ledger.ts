import { DATASET_KV_KEY } from '@reactions/db';
import { runLedger, type Dataset } from '@reactions/engine';
import { errorMessage } from './jobs.ts';
import {
	JOB_RESULT_COLUMNS,
	LEDGER_LOT_COLUMNS,
	LEDGER_PRICE_COLUMNS,
	LEDGER_USE_COLUMNS,
	UNALLOCATED_FEE_COLUMNS,
	ledgerResultRows,
	facilitiesFromEve,
	parseAccountSettings,
	parseTrackingSettings,
	profileSystemIds,
	referenceRequests,
	toRunLedgerInput,
	type ContractItemRow,
	type ContractRow,
	type CorrectionRow,
	type JobRow,
	type ManualEntryRow,
	type JournalRow,
	type OrderRow,
	type SqlValue,
	type TrackedRows,
	type TrackedFacilityRow,
	type TransactionRow
} from './ledger-rows.ts';
import { loadReferencePrices } from './reference-prices.ts';

export interface LedgerRebuildSummary {
	rebuiltAt: number;
	lots: number;
	jobs: number;
	/** Priced trades and contract items needing review, plus job inputs with no price at all. */
	needsReview: number;
}

/** Raw rows of connections with Profit tracking on only (`?1` = user id). */
const TRACKED_SOURCES = `source_id IN (SELECT source_id FROM inventory_sources WHERE user_id = ?1 AND tracking_enabled = 1)`;

/**
 * Rows of `table` outside the corporation wallet divisions its connection counts are left out: a row
 * with a `division` is kept only when its connection's `wallet_divisions_json` is null (every division),
 * not a JSON array (unreadable counts as every division, like the sync) or lists it.
 */
const countedDivision = (table: string) => `(${table}.division IS NULL OR NOT EXISTS (
	SELECT 1 FROM inventory_sources s WHERE s.source_id = ${table}.source_id
		AND CASE WHEN json_valid(s.wallet_divisions_json) THEN json_type(s.wallet_divisions_json) = 'array' ELSE 0 END
		AND ${table}.division NOT IN (SELECT value FROM json_each(
			CASE WHEN json_valid(s.wallet_divisions_json) THEN s.wallet_divisions_json ELSE '[]' END))))`;

const LOAD_SQL = {
	user: 'SELECT settings_json, tracking_json FROM users WHERE user_id = ?1',
	characters: 'SELECT character_id FROM characters WHERE user_id = ?1',
	corporations: "SELECT owner_id FROM inventory_sources WHERE user_id = ?1 AND kind = 'corporation'",
	ordersAvailable: `SELECT source_id FROM tracking_streams
		WHERE user_id = ?1 AND stream = 'orders' AND status = 'ok' AND ${TRACKED_SOURCES}`,
	transactions: `SELECT transaction_id, source_id, division, date, type_id, quantity, unit_price, is_buy, client_id, location_id
		FROM tracked_transactions WHERE user_id = ?1 AND ${TRACKED_SOURCES}
			AND ${countedDivision('tracked_transactions')} ORDER BY transaction_id`,
	journal: `SELECT ref_id, source_id, division, date, ref_type, amount, context_id, context_id_type
		FROM tracked_journal WHERE user_id = ?1 AND ${TRACKED_SOURCES}
			AND ${countedDivision('tracked_journal')} ORDER BY ref_id`,
	orders: `SELECT order_id, source_id, division, type_id, is_buy, price, volume_total, volume_remain, issued, location_id, state
		FROM tracked_orders WHERE user_id = ?1 AND ${TRACKED_SOURCES}
			AND ${countedDivision('tracked_orders')} ORDER BY order_id`,
	contracts: `SELECT contract_id, issuer_id, issuer_corporation_id, acceptor_id, assignee_id, for_corporation, price, reward,
			title, date_issued, date_completed, janice_json
		FROM tracked_contracts WHERE user_id = ?1 AND ${TRACKED_SOURCES} ORDER BY contract_id`,
	contractItems: `SELECT i.contract_id, i.record_id, i.type_id, i.quantity, i.is_included
		FROM tracked_contract_items i
		JOIN tracked_contracts c ON c.user_id = i.user_id AND c.contract_id = i.contract_id
		WHERE i.user_id = ?1 AND c.${TRACKED_SOURCES} ORDER BY i.contract_id, i.record_id`,
	/** Reaction jobs and manufacturing jobs (`activity_id` 1: fuel block jobs, and jobs taking reaction output). */
	jobs: `SELECT job_id, activity_id, blueprint_type_id, blueprint_me, runs, status, cost, facility_id, start_date, end_date
		FROM tracked_jobs WHERE user_id = ?1 AND ${TRACKED_SOURCES} ORDER BY job_id`,
	corrections: 'SELECT target_kind, target_ref, unit_price FROM price_corrections WHERE user_id = ?1',
	manualEntries: `SELECT entry_id, date, type_id, quantity, unit_price FROM manual_entries
		WHERE user_id = ?1 ORDER BY entry_id`,
	/** Systems of the facilities of the user's jobs, from any of the user's connections. */
	locations: `SELECT DISTINCT l.location_id, l.system_id FROM inventory_locations l
		JOIN inventory_sources s ON s.source_id = l.source_id
		WHERE s.user_id = ?1 AND l.system_id IS NOT NULL
			AND l.location_id IN (SELECT facility_id FROM tracked_jobs WHERE user_id = ?1)
		ORDER BY l.location_id, l.system_id`,
	/** The job facilities as EVE describes them (lookups, rigs from corporation assets). */
	facilities: `SELECT facility_id, kind, system_id, type_id, rigs_json FROM tracked_facilities
		WHERE user_id = ?1 AND facility_id IN (SELECT facility_id FROM tracked_jobs WHERE user_id = ?1)`
} as const;

const SYSTEM_BANDS_SQL =
	'SELECT system_id, security_band FROM systems WHERE system_id IN (SELECT value FROM json_each(?1))';

/** Result rows per insert statement (each statement carries its rows as one JSON parameter). */
const INSERT_ROWS_PER_STATEMENT = 500;

/**
 * `ledger_state.dirty`: 0 = results current, 1 = a change waits for a rebuild, 2 = a rebuild loaded the
 * rows of that change and has not stored its results yet (left at 2 when it died: the cron retries).
 */
const DIRTY_LOADING = 2;

/**
 * Taken in the load transaction: a waiting change (`dirty = 1`) becomes `2`, so a change marked while
 * this rebuild runs (`dirty = 1` again) survives its final upsert.
 */
const LOADING_SQL = `UPDATE ledger_state SET dirty = ${DIRTY_LOADING} WHERE user_id = ?1 AND dirty = 1`;

/**
 * True while no rebuild that loaded after `?2` (its `rebuilt_at`) stored its results for user `?1`: an
 * older rebuild finishing later writes nothing, so it never replaces newer results.
 */
const CURRENT_SQL = 'NOT EXISTS (SELECT 1 FROM ledger_state WHERE user_id = ?1 AND rebuilt_at > ?2)';

const RESULT_TABLES = [
	'ledger_lots',
	'ledger_uses',
	'job_results',
	'ledger_prices',
	'ledger_unallocated_fees'
] as const;

/**
 * `INSERT INTO <table> (user_id, …) SELECT ?1, … FROM json_each(?3)` while `CURRENT_SQL` holds: row `i`
 * is an array in `columns` order.
 */
function insertSql(table: string, columns: readonly string[]): string {
	const values = columns.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ');
	return `INSERT INTO ${table} (user_id, ${columns.join(', ')}) SELECT ?1, ${values} FROM json_each(?3)
		WHERE ${CURRENT_SQL}`;
}

/**
 * Stores the rebuild of `?2` unless a later one already did (`rebuilt_at` = when its rows were loaded);
 * the ledger is clean again unless a change was marked after this rebuild loaded (`dirty = 1`).
 */
const STATE_SQL = `
	INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES (?1, ?2, 0)
	ON CONFLICT (user_id) DO UPDATE SET rebuilt_at = excluded.rebuilt_at,
		dirty = CASE WHEN ledger_state.dirty = ${DIRTY_LOADING} THEN 0 ELSE ledger_state.dirty END
	WHERE ledger_state.rebuilt_at IS NULL OR ledger_state.rebuilt_at <= excluded.rebuilt_at`;

const INSERT_SQL = {
	ledger_lots: insertSql('ledger_lots', LEDGER_LOT_COLUMNS),
	ledger_uses: insertSql('ledger_uses', LEDGER_USE_COLUMNS),
	job_results: insertSql('job_results', JOB_RESULT_COLUMNS),
	ledger_prices: insertSql('ledger_prices', LEDGER_PRICE_COLUMNS),
	ledger_unallocated_fees: insertSql('ledger_unallocated_fees', UNALLOCATED_FEE_COLUMNS)
} as const;

/**
 * Rebuilds one user's ledger from scratch: loads the raw rows of the user's connections with Profit
 * tracking on (reaction, fuel block and manufacturing jobs), the manual purchases, the corrections and both
 * settings, runs the engine (`runLedger`) with reference and buy prices of the contract rule's hub,
 * then, in one transaction, replaces the user's `ledger_lots`, `ledger_uses`, `job_results`,
 * `ledger_prices` and `ledger_unallocated_fees` and updates `ledger_state` (`STATE_SQL`). `now` is
 * when the rows are loaded (the stored `rebuilt_at`): overlapping rebuilds of one user keep the results
 * of the one that loaded last. Every query is scoped to `userId`. Throws when the user does not exist
 * or no SDE dataset is published.
 */
export async function rebuildLedger(env: Env, userId: string, now: number): Promise<LedgerRebuildSummary> {
	const db = env.DB;
	const [, user, characters, corporations, ordersAvailable, ...rest] = await db.batch([
		db.prepare(LOADING_SQL).bind(userId),
		...Object.values(LOAD_SQL).map((sql) => db.prepare(sql).bind(userId))
	]);
	const [
		transactions,
		journal,
		orders,
		contracts,
		contractItems,
		jobs,
		corrections,
		manualEntries,
		locations,
		facilities
	] = rest;
	const userRow = (user!.results as { settings_json: string | null; tracking_json: string | null }[])[0];
	if (!userRow) throw new Error(`user ${userId} not found`);
	const dataset = await env.CACHE.get<Dataset>(DATASET_KV_KEY, 'json');
	if (!dataset) throw new Error(`no SDE dataset published yet (KV ${DATASET_KV_KEY})`);

	const settings = parseAccountSettings(userRow.settings_json);
	const tracking = parseTrackingSettings(userRow.tracking_json);
	const rows: TrackedRows = {
		transactions: transactions!.results as unknown as TransactionRow[],
		journal: journal!.results as unknown as JournalRow[],
		orders: orders!.results as unknown as OrderRow[],
		contracts: contracts!.results as unknown as ContractRow[],
		contractItems: contractItems!.results as unknown as ContractItemRow[],
		jobs: jobs!.results as unknown as JobRow[],
		corrections: corrections!.results as unknown as CorrectionRow[],
		manualEntries: manualEntries!.results as unknown as ManualEntryRow[]
	};
	const locationSystems = new Map(
		(locations!.results as { location_id: number; system_id: number }[]).map((l) => [
			l.location_id,
			l.system_id
		])
	);
	const facilityRows = facilities!.results as unknown as TrackedFacilityRow[];
	const systemIds = [
		...new Set([
			...profileSystemIds(settings),
			...locationSystems.values(),
			...facilityRows.flatMap((f) => (f.system_id === null ? [] : [f.system_id]))
		])
	];
	const [bands, prices] = await Promise.all([
		db
			.prepare(SYSTEM_BANDS_SQL)
			.bind(JSON.stringify(systemIds))
			.all<{ system_id: number; security_band: string }>(),
		loadReferencePrices(env, userId, tracking.contractRule, referenceRequests(rows, dataset))
	]);
	const systemBands = new Map(bands.results.map((b) => [b.system_id, b.security_band]));

	const result = runLedger(
		toRunLedgerInput(rows, {
			dataset,
			settings,
			tracking,
			systemBands,
			facilities: facilitiesFromEve(facilityRows, locationSystems, systemBands),
			characterIds: (characters!.results as { character_id: number }[]).map((c) => c.character_id),
			corporationIds: (corporations!.results as { owner_id: number }[]).map((c) => c.owner_id),
			ordersAvailable: (ordersAvailable!.results as { source_id: number }[]).map((s) => s.source_id),
			referencePrice: prices.referencePrice,
			buyPrice: prices.buyPrice,
			now
		})
	);
	const out = ledgerResultRows(result);
	const tableRows: Record<(typeof RESULT_TABLES)[number], SqlValue[][]> = {
		ledger_lots: out.lots,
		ledger_uses: out.uses,
		job_results: out.jobs,
		ledger_prices: out.prices,
		ledger_unallocated_fees: out.unallocatedFees
	};
	const statements: D1PreparedStatement[] = RESULT_TABLES.map((table) =>
		db.prepare(`DELETE FROM ${table} WHERE user_id = ?1 AND ${CURRENT_SQL}`).bind(userId, now)
	);
	for (const table of RESULT_TABLES) {
		const list = tableRows[table];
		for (let i = 0; i < list.length; i += INSERT_ROWS_PER_STATEMENT) {
			statements.push(
				db
					.prepare(INSERT_SQL[table])
					.bind(userId, now, JSON.stringify(list.slice(i, i + INSERT_ROWS_PER_STATEMENT)))
			);
		}
	}
	statements.push(db.prepare(STATE_SQL).bind(userId, now));
	await db.batch(statements);
	return { rebuiltAt: now, lots: out.lots.length, jobs: out.jobs.length, needsReview: out.needsReview };
}

/** Flags the user's ledger for the next cron rebuild (the rebuild RPC was unreachable). */
export async function markLedgerDirty(env: Env, userId: string): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO ledger_state (user_id, dirty) VALUES (?1, 1) ON CONFLICT (user_id) DO UPDATE SET dirty = 1`
	)
		.bind(userId)
		.run();
}

/**
 * Rebuilds up to `limit` dirty ledgers (a change waiting, or a rebuild that did not finish), least
 * recently rebuilt first (never rebuilt first of all), each stamped with the time it starts. A failed
 * rebuild is logged and stays dirty for the next tick.
 */
export async function rebuildDirtyLedgers(
	env: Env,
	limit: number
): Promise<{ rebuilt: number; failed: number }> {
	const { results } = await env.DB.prepare(
		`SELECT user_id FROM ledger_state WHERE dirty <> 0
		ORDER BY rebuilt_at IS NOT NULL, rebuilt_at, user_id LIMIT ?1`
	)
		.bind(limit)
		.all<{ user_id: string }>();
	let rebuilt = 0;
	let failed = 0;
	for (const { user_id: userId } of results) {
		try {
			await rebuildLedger(env, userId, Date.now());
			rebuilt++;
		} catch (error) {
			failed++;
			console.error(`[ledger] rebuild of ${userId} failed: ${errorMessage(error)}`);
		}
	}
	return { rebuilt, failed };
}
