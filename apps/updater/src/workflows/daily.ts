import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { getCoreDb, marketHubs, trackedTypeIds } from '@reactions/db';
import { fetchMarketHistory, isEsiDowntime } from '@reactions/eve';
import type { MarketHistoryDay } from '@reactions/eve';
import { eq } from 'drizzle-orm';
import {
	ESI_CONCURRENCY,
	HISTORY_RETRY_WAITS,
	JOB_RUN_RETENTION_DAYS,
	PRICE_ARCHIVE_PREFIX,
	SNAPSHOT_RETENTION_DAYS,
	STEP_CONFIG
} from '../config.ts';
import { addDays, DAY_MS, dayStart, isIsoDate, utcDate } from '../dates.ts';
import { esiClient } from '../http.ts';
import { errorMessage, failJobRun, finishJobRun, startJobRun } from '../jobs.ts';
import { forEachConcurrent } from '../pool.ts';
import { StepTracker } from '../progress.ts';
import { jsonInsertSql, upsertClause } from '../prices.ts';

export interface DailyParams {
	/** UTC day the run is for (`YYYY-MM-DD`); price rollup, archive check and retention look at the day before. */
	date: string;
}

export interface HistoryCounts {
	regionId: number;
	types: number;
	inserted: number;
	/** Types whose history could not be fetched (after the retries, in the run's result). */
	failed: number;
	failedTypeIds: number[];
	stats: number;
}

export interface DailyResult {
	date: string;
	status: 'ok' | 'partial';
	history: HistoryCounts[];
	/** Types (over all regions) whose first fetch failed and that were retried. */
	historyRetried: number;
	/** Types still missing after the last retry round. */
	historyFailed: number;
	priceDaily: number;
	adjusted: number;
	costIndices: number;
	archive: { objects: number; bytes: number };
	retention: { dates: number; deleted: number };
	prune: PruneCounts;
}

export interface PruneCounts {
	sessions: number;
	jobRuns: number;
}

const HISTORY_COLUMNS = [
	'region_id',
	'type_id',
	'date',
	'average',
	'highest',
	'lowest',
	'volume',
	'order_count'
];
export const HISTORY_SQL = jsonInsertSql('esi_market_history', HISTORY_COLUMNS, 'ON CONFLICT DO NOTHING');

const STATS_COLUMNS = [
	'region_id',
	'type_id',
	'avg_daily_volume_30d',
	'avg_daily_volume_7d',
	'avg_price_5d',
	'avg_price_30d',
	'last_date',
	'updated_at'
];
const STATS_SQL = jsonInsertSql(
	'market_stats',
	STATS_COLUMNS,
	upsertClause('market_stats', STATS_COLUMNS, ['region_id', 'type_id'], ['updated_at'])
);

/**
 * Types of region `?1` with their latest history day: a loose index scan over the primary key (one
 * probe for the next `type_id`, one for its `MAX(date)`) instead of a scan of the region's rows.
 */
const LAST_DATES_CTE = `
	types(type_id) AS (
		SELECT MIN(type_id) FROM esi_market_history WHERE region_id = ?1
		UNION ALL
		SELECT (SELECT MIN(h.type_id) FROM esi_market_history h WHERE h.region_id = ?1 AND h.type_id > t.type_id)
		FROM types t WHERE t.type_id IS NOT NULL
	),
	last AS MATERIALIZED (
		SELECT t.type_id, (
			SELECT MAX(h.date) FROM esi_market_history h WHERE h.region_id = ?1 AND h.type_id = t.type_id
		) AS last_date
		FROM types t WHERE t.type_id IS NOT NULL
	)`;

/** `typeId` and `lastDate` of every type of region `?1` with stored history. */
const LAST_DATES_QUERY = `WITH RECURSIVE ${LAST_DATES_CTE}
	SELECT type_id AS typeId, last_date AS lastDate FROM last`;

/**
 * Per type of a region: days counted back from its latest history day (`last_date` included).
 * Days without trades are absent from ESI history, so the 30- and 7-day volumes are divided by 30
 * and 7, not by the number of rows; prices are the mean of the daily averages present in the window.
 * `CROSS JOIN` keeps the type list as the outer loop, so only each type's last 30 days are read.
 */
const STATS_QUERY = `WITH RECURSIVE ${LAST_DATES_CTE}
	SELECT h.type_id AS typeId, l.last_date AS lastDate,
		SUM(h.volume) / 30.0 AS volume30,
		TOTAL(CASE WHEN h.date > date(l.last_date, '-7 days') THEN h.volume END) / 7.0 AS volume7,
		AVG(CASE WHEN h.date > date(l.last_date, '-5 days') THEN h.average END) AS price5,
		AVG(h.average) AS price30
	FROM last l CROSS JOIN esi_market_history h
	WHERE h.region_id = ?1 AND h.type_id = l.type_id AND h.date > date(l.last_date, '-30 days')
	GROUP BY h.type_id, l.last_date`;

/** Step `plan`: distinct regions of the enabled hubs. */
export async function planDaily(env: Env): Promise<{ regionIds: number[] }> {
	const rows = await getCoreDb(env.DB)
		.selectDistinct({ regionId: marketHubs.regionId })
		.from(marketHubs)
		.where(eq(marketHubs.enabled, true))
		.orderBy(marketHubs.regionId)
		.all();
	return { regionIds: rows.map((r) => r.regionId) };
}

/** Tracked types that have a market (formula blueprints are not traded on the market). */
export async function historyTypeIds(env: Env): Promise<number[]> {
	const formulas = new Set(
		(await env.DB.prepare('SELECT blueprint_type_id AS id FROM reactions').all<{ id: number }>()).results.map(
			(r) => r.id
		)
	);
	return (await trackedTypeIds(getCoreDb(env.DB))).filter((t) => !formulas.has(t));
}

/** `esi_market_history` rows of one region/type for `HISTORY_SQL`. */
export function historyRows(regionId: number, typeId: number, days: MarketHistoryDay[]): unknown[][] {
	return days.map((d) => [regionId, typeId, d.date, d.average, d.highest, d.lowest, d.volume, d.orderCount]);
}

/** Recomputes `market_stats` of `regionId` from its stored history; returns the number of types. */
export async function recomputeMarketStats(env: Env, regionId: number, now: number): Promise<number> {
	const stats = await env.HISTORY_DB.prepare(STATS_QUERY).bind(regionId).all<{
		typeId: number;
		lastDate: string;
		volume30: number;
		volume7: number;
		price5: number;
		price30: number;
	}>();
	const statRows = stats.results.map((s) => [
		regionId,
		s.typeId,
		s.volume30,
		s.volume7,
		s.price5,
		s.price30,
		s.lastDate,
		now
	]);
	if (statRows.length > 0) await env.DB.prepare(STATS_SQL).bind(JSON.stringify(statRows)).run();
	return statRows.length;
}

/**
 * Step `history-<regionId>`: ESI market history of every tracked non-formula type (or only `typeIds`,
 * a retry); only days newer than the stored maximum for (region, type) are inserted (the first run
 * stores the full history), so a type missed once gets its days on the next fetch. Types not fetched
 * (an ESI error, or skipped once the ESI error limit runs low) are listed in `failedTypeIds`. Then
 * `market_stats` of the region is recomputed.
 */
export async function refreshRegionHistory(
	env: Env,
	regionId: number,
	now: number,
	typeIds?: readonly number[]
): Promise<HistoryCounts> {
	const types = typeIds ?? (await historyTypeIds(env));
	const stored = await env.HISTORY_DB.prepare(LAST_DATES_QUERY)
		.bind(regionId)
		.all<{ typeId: number; lastDate: string }>();
	const lastDate = new Map(stored.results.map((r) => [r.typeId, r.lastDate]));

	const client = esiClient(env);
	let inserted = 0;
	const failedTypeIds: number[] = [];
	let skipped = 0;
	await forEachConcurrent(types, ESI_CONCURRENCY, async (typeId) => {
		if (client.guard.tripped()) {
			failedTypeIds.push(typeId);
			skipped++;
			return;
		}
		let days: MarketHistoryDay[];
		try {
			days = await fetchMarketHistory(client, regionId, typeId);
		} catch (error) {
			// The downtime is no failed type: the step waits and runs again.
			if (isEsiDowntime(error)) throw error;
			console.error(`[daily] history region ${regionId} type ${typeId}: ${errorMessage(error)}`);
			failedTypeIds.push(typeId);
			return;
		}
		const after = lastDate.get(typeId) ?? '';
		const rows = historyRows(
			regionId,
			typeId,
			days.filter((d) => d.date > after)
		);
		if (rows.length === 0) return;
		await env.HISTORY_DB.prepare(HISTORY_SQL).bind(JSON.stringify(rows)).run();
		inserted += rows.length;
	});
	if (skipped > 0) {
		const { errorLimitRemain, throttled } = client.guard;
		console.warn(
			`[daily] history region ${regionId}: ${skipped} types skipped (ESI error limit remain ${errorLimitRemain}, throttled ${throttled})`
		);
	}

	failedTypeIds.sort((a, b) => a - b);
	const stats = await recomputeMarketStats(env, regionId, now);
	return { regionId, types: types.length, inserted, failed: failedTypeIds.length, failedTypeIds, stats };
}

const PRICE_DAILY_COLUMNS = [
	'date',
	'hub_id',
	'type_id',
	'buy_avg',
	'sell_avg',
	'buy_close',
	'sell_close',
	'buy_low',
	'buy_high',
	'sell_low',
	'sell_high',
	'samples'
];
const PRICE_DAILY_SQL = jsonInsertSql(
	'price_daily',
	PRICE_DAILY_COLUMNS,
	upsertClause('price_daily', PRICE_DAILY_COLUMNS, ['hub_id', 'type_id', 'date'])
);
/** `price_daily` rows per statement (one JSON parameter each). */
const PRICE_DAILY_CHUNK = 2000;

/** Weighted average, low and high of one price column of a pair's day. */
class Side {
	sum = 0;
	weight = 0;
	low: number | null = null;
	high: number | null = null;

	add(value: number | null, weight: number): void {
		if (value === null) return;
		this.sum += value * weight;
		this.weight += weight;
		if (this.low === null || value < this.low) this.low = value;
		if (this.high === null || value > this.high) this.high = value;
	}

	get avg(): number | null {
		return this.weight > 0 ? this.sum / this.weight : null;
	}
}

/**
 * Step `rollup-prices`: `price_daily` of `day` from its `price_snapshots` (per hub/type: average,
 * low, high and close = value of the latest snapshot of the day, number of samples).
 * `price_snapshots` stores only changed pairs after the first refresh of a day, so each stored row
 * stands for every refresh of the day (distinct `snapshot_at` over all hubs) from its own time until
 * the pair's next row of the day, or until the day's last refresh: averages and samples weight rows by
 * that count, which gives the values of one row per pair and refresh. The day's rows are read with one
 * index range scan (no `ORDER BY`, window or `GROUP BY`: D1 bills their temporary b-trees as rows
 * read) and weighted here. Guarded upsert: a re-run writes nothing. Returns the number of pairs.
 */
export async function rollupPrices(env: Env, day: string): Promise<number> {
	const from = dayStart(day);
	const { results } = await env.HISTORY_DB.prepare(
		`SELECT hub_id AS hubId, type_id AS typeId, snapshot_at AS at, buy_max AS buy, sell_min AS sell
		FROM price_snapshots WHERE snapshot_at >= ?1 AND snapshot_at < ?2`
	)
		.bind(from, from + DAY_MS)
		.all<{ hubId: string; typeId: number; at: number; buy: number | null; sell: number | null }>();
	const refresh = new Map(
		[...new Set(results.map((r) => r.at))].sort((a, b) => a - b).map((at, i) => [at, i])
	);
	const pairs = new Map<string, typeof results>();
	for (const row of results) {
		const key = `${row.hubId}\u0000${row.typeId}`;
		const list = pairs.get(key);
		if (list) list.push(row);
		else pairs.set(key, [row]);
	}
	const rows: unknown[][] = [];
	for (const list of pairs.values()) {
		list.sort((a, b) => a.at - b.at);
		const buy = new Side();
		const sell = new Side();
		let samples = 0;
		for (const [i, row] of list.entries()) {
			const next = list[i + 1];
			const weight = (next ? refresh.get(next.at)! : refresh.size) - refresh.get(row.at)!;
			buy.add(row.buy, weight);
			sell.add(row.sell, weight);
			samples += weight;
		}
		const close = list.at(-1)!;
		rows.push([
			day,
			close.hubId,
			close.typeId,
			buy.avg,
			sell.avg,
			close.buy,
			close.sell,
			buy.low,
			buy.high,
			sell.low,
			sell.high,
			samples
		]);
	}
	for (let i = 0; i < rows.length; i += PRICE_DAILY_CHUNK)
		await env.HISTORY_DB.prepare(PRICE_DAILY_SQL)
			.bind(JSON.stringify(rows.slice(i, i + PRICE_DAILY_CHUNK)))
			.run();
	return rows.length;
}

const ADJUSTED_DAILY_COLUMNS = ['date', 'type_id', 'adjusted_price'];
const ADJUSTED_DAILY_SQL = jsonInsertSql(
	'adjusted_price_daily',
	ADJUSTED_DAILY_COLUMNS,
	upsertClause('adjusted_price_daily', ADJUSTED_DAILY_COLUMNS, ['type_id', 'date'])
);

/**
 * `cost_index_daily` rows `?1` (`[system_id, reaction]`) at date `?2`, skipping systems whose latest
 * row before `?2` holds the same value; a row already stored at `?2` is updated only when it changed.
 * Both lookups use the primary key.
 */
const COST_INDEX_DAILY_SQL = `WITH j AS (
		SELECT json_extract(value, '$[0]') AS system_id, json_extract(value, '$[1]') AS reaction
		FROM json_each(?1)
	)
	INSERT INTO cost_index_daily (date, system_id, reaction)
	SELECT ?2, j.system_id, j.reaction FROM j
	WHERE NOT EXISTS (
		SELECT 1 FROM cost_index_daily c
		WHERE c.system_id = j.system_id AND c.date < ?2 AND c.reaction = j.reaction
			AND c.date = (
				SELECT MAX(d.date) FROM cost_index_daily d WHERE d.system_id = j.system_id AND d.date <= ?2
			)
	)
	${upsertClause('cost_index_daily', ['date', 'system_id', 'reaction'], ['system_id', 'date'])}`;

/**
 * Step `rollup-indices`: `date`'s `adjusted_price_daily` and `cost_index_daily` from the latest tables.
 * `cost_index_daily` is change-only: a system gets a row only when its value differs from its latest
 * row at or before `date` (that row is its value as of `date`). Returns the number of systems and types.
 */
export async function rollupIndices(
	env: Env,
	date: string
): Promise<{ adjusted: number; costIndices: number }> {
	const [adjusted, costs] = await env.DB.batch<{ id: number; value: number }>([
		env.DB.prepare('SELECT type_id AS id, adjusted_price AS value FROM adjusted_prices'),
		env.DB.prepare('SELECT system_id AS id, reaction AS value FROM cost_indices')
	]);
	if (adjusted!.results.length > 0)
		await env.HISTORY_DB.prepare(ADJUSTED_DAILY_SQL)
			.bind(JSON.stringify(adjusted!.results.map((r) => [date, r.id, r.value])))
			.run();
	if (costs!.results.length > 0)
		await env.HISTORY_DB.prepare(COST_INDEX_DAILY_SQL)
			.bind(JSON.stringify(costs!.results.map((r) => [r.id, r.value])), date)
			.run();
	return { adjusted: adjusted!.results.length, costIndices: costs!.results.length };
}

/** Step `archive-verify`: counts `day`'s R2 price archives into `archive_manifest`. */
export async function verifyArchive(
	env: Env,
	day: string,
	now: number
): Promise<{ objects: number; bytes: number }> {
	let objects = 0;
	let bytes = 0;
	let cursor: string | undefined;
	do {
		const page = await env.ARCHIVE.list({ prefix: PRICE_ARCHIVE_PREFIX(day), cursor });
		objects += page.objects.length;
		bytes += page.objects.reduce((sum, o) => sum + o.size, 0);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	await env.HISTORY_DB.prepare(
		`INSERT INTO archive_manifest (date, object_count, bytes, verified_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (date) DO UPDATE SET object_count = excluded.object_count, bytes = excluded.bytes,
			verified_at = excluded.verified_at`
	)
		.bind(day, objects, bytes, now)
		.run();
	return { objects, bytes };
}

/**
 * Step `retention`: deletes the `price_snapshots` of every day older than 90 days that is rolled up
 * (`price_daily` rows) and fully archived in R2: `archive_manifest` counts at least one object per
 * refresh of that day (each refresh writes one archive in its final step, so a refresh that failed
 * before it has no copy and keeps the day). Change-only snapshots keep this rule: every refresh stores
 * at least the first-of-day or the changed rows, so the distinct `snapshot_at` of a day are its
 * refreshes. Deletes in 6-hour windows.
 */
export async function applyRetention(env: Env, date: string): Promise<{ dates: number; deleted: number }> {
	const oldest = await env.HISTORY_DB.prepare('SELECT MIN(snapshot_at) AS at FROM price_snapshots').first<{
		at: number | null;
	}>();
	if (oldest?.at == null) return { dates: 0, deleted: 0 };
	const due = await env.HISTORY_DB.prepare(
		`SELECT m.date FROM archive_manifest m
		WHERE m.date >= ?1 AND m.date < ?2 AND m.object_count > 0
			AND EXISTS (SELECT 1 FROM price_daily p WHERE p.date = m.date)
			AND m.object_count >= (
				SELECT COUNT(DISTINCT s.snapshot_at) FROM price_snapshots s
				WHERE s.snapshot_at >= unixepoch(m.date) * 1000 AND s.snapshot_at < (unixepoch(m.date) + 86400) * 1000
			)
		ORDER BY m.date`
	)
		.bind(utcDate(oldest.at), addDays(date, -SNAPSHOT_RETENTION_DAYS))
		.all<{ date: string }>();
	const window = DAY_MS / 4;
	let deleted = 0;
	for (const { date: day } of due.results) {
		for (let from = dayStart(day); from < dayStart(day) + DAY_MS; from += window) {
			const result = await env.HISTORY_DB.prepare(
				'DELETE FROM price_snapshots WHERE snapshot_at >= ? AND snapshot_at < ?'
			)
				.bind(from, from + window)
				.run();
			deleted += result.meta.changes;
		}
	}
	return { dates: due.results.length, deleted };
}

/**
 * Step `prune`: removes expired login sessions and finished `job_runs` rows older than
 * `JOB_RUN_RETENTION_DAYS` (the admin status shows only the latest run per kind; running rows stay).
 */
export async function pruneCoreTables(env: Env, now: number): Promise<PruneCounts> {
	const [sessions, runs] = await env.DB.batch([
		env.DB.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').bind(now),
		env.DB.prepare("DELETE FROM job_runs WHERE started_at < ? AND status <> 'running'").bind(
			now - JOB_RUN_RETENTION_DAYS * DAY_MS
		)
	]);
	return { sessions: sessions!.meta.changes, jobRuns: runs!.meta.changes };
}

/** Daily maintenance for `params.date`: instance `daily-<date>` (cron) or `daily-<date>-manual-<ms>`. */
export class DailyWorkflow extends WorkflowEntrypoint<Env, DailyParams> {
	override async run(event: Readonly<WorkflowEvent<DailyParams>>, step: WorkflowStep): Promise<DailyResult> {
		const { date } = event.payload;
		const runId = event.instanceId;
		const startedAt = event.timestamp.getTime();
		const env = this.env;
		await startJobRun(env, runId, 'daily', startedAt);
		const steps = new StepTracker(env, step, runId);
		try {
			if (!isIsoDate(date)) throw new NonRetryableError(`invalid date ${JSON.stringify(date)}`);
			const yesterday = addDays(date, -1);
			const { regionIds } = await steps.do('plan', STEP_CONFIG, () => planDaily(env));
			// plan + one history step per region + rollup-prices, rollup-indices, archive-verify, retention, prune
			steps.total = 1 + regionIds.length + 5;
			const history: HistoryCounts[] = [];
			let historyRetried = 0;
			for (const regionId of regionIds)
				history.push(
					await steps.do(`history-${regionId}`, STEP_CONFIG, () =>
						refreshRegionHistory(env, regionId, Date.now())
					)
				);
			for (const counts of history) historyRetried += counts.failed;
			// Types not fetched get up to one retry per wait; inserted rows add up, the last retry's
			// failures are the run's.
			for (const [round, wait] of HISTORY_RETRY_WAITS.entries()) {
				const pending = history.filter((h) => h.failed > 0);
				if (pending.length === 0) break;
				await step.sleep(`history-wait-${round + 1}`, wait);
				steps.total += pending.length;
				for (const counts of pending) {
					const retry = await steps.do(`history-${counts.regionId}-retry-${round + 1}`, STEP_CONFIG, () =>
						refreshRegionHistory(env, counts.regionId, Date.now(), counts.failedTypeIds)
					);
					counts.inserted += retry.inserted;
					counts.failed = retry.failed;
					counts.failedTypeIds = retry.failedTypeIds;
					counts.stats = retry.stats;
				}
			}
			const priceDaily = await steps.do('rollup-prices', STEP_CONFIG, () => rollupPrices(env, yesterday));
			const indices = await steps.do('rollup-indices', STEP_CONFIG, () => rollupIndices(env, date));
			const archive = await steps.do('archive-verify', STEP_CONFIG, () =>
				verifyArchive(env, yesterday, Date.now())
			);
			const retention = await steps.do('retention', STEP_CONFIG, () => applyRetention(env, date));
			const prune = await steps.do('prune', STEP_CONFIG, () => pruneCoreTables(env, Date.now()));
			const historyFailed = history.reduce((sum, h) => sum + h.failed, 0);
			const result: DailyResult = {
				date,
				status: historyFailed > 0 ? 'partial' : 'ok',
				history,
				historyRetried,
				historyFailed,
				priceDaily,
				...indices,
				archive,
				retention,
				prune
			};
			await finishJobRun(env, runId, result.status, result);
			return result;
		} catch (error) {
			await failJobRun(env, runId, 'daily', startedAt, error);
			throw error;
		}
	}
}
