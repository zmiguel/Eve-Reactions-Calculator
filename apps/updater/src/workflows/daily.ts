import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { getCoreDb, marketHubs, trackedTypeIds } from '@reactions/db';
import { fetchMarketHistory } from '@reactions/eve';
import type { MarketHistoryDay } from '@reactions/eve';
import { eq } from 'drizzle-orm';
import {
	ESI_CONCURRENCY,
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
	failed: number;
	stats: number;
}

export interface DailyResult {
	date: string;
	status: 'ok' | 'partial';
	history: HistoryCounts[];
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
	upsertClause(STATS_COLUMNS, ['region_id', 'type_id'])
);

/**
 * Per type of a region: days counted back from its latest history day (`last_date` included).
 * Days without trades are absent from ESI history, so the 30- and 7-day volumes are divided by 30
 * and 7, not by the number of rows; prices are the mean of the daily averages present in the window.
 */
const STATS_QUERY = `
	WITH last AS (
		SELECT type_id, MAX(date) AS last_date FROM esi_market_history WHERE region_id = ?1 GROUP BY type_id
	)
	SELECT h.type_id AS typeId, l.last_date AS lastDate,
		SUM(h.volume) / 30.0 AS volume30,
		TOTAL(CASE WHEN h.date > date(l.last_date, '-7 days') THEN h.volume END) / 7.0 AS volume7,
		AVG(CASE WHEN h.date > date(l.last_date, '-5 days') THEN h.average END) AS price5,
		AVG(h.average) AS price30
	FROM esi_market_history h JOIN last l ON l.type_id = h.type_id
	WHERE h.region_id = ?1 AND h.date > date(l.last_date, '-30 days')
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
 * Step `history-<regionId>`: ESI market history of every tracked non-formula type; only days newer
 * than the stored maximum for (region, type) are inserted (the first run stores the full history).
 * Then `market_stats` of the region is recomputed.
 */
export async function refreshRegionHistory(env: Env, regionId: number, now: number): Promise<HistoryCounts> {
	const typeIds = await historyTypeIds(env);
	const stored = await env.HISTORY_DB.prepare(
		'SELECT type_id AS typeId, MAX(date) AS lastDate FROM esi_market_history WHERE region_id = ? GROUP BY type_id'
	)
		.bind(regionId)
		.all<{ typeId: number; lastDate: string }>();
	const lastDate = new Map(stored.results.map((r) => [r.typeId, r.lastDate]));

	const client = esiClient(env);
	let inserted = 0;
	let failed = 0;
	await forEachConcurrent(typeIds, ESI_CONCURRENCY, async (typeId) => {
		if (client.guard.tripped()) {
			failed++;
			return;
		}
		let days: MarketHistoryDay[];
		try {
			days = await fetchMarketHistory(client, regionId, typeId);
		} catch (error) {
			console.error(`[daily] history region ${regionId} type ${typeId}: ${errorMessage(error)}`);
			failed++;
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

	const stats = await recomputeMarketStats(env, regionId, now);
	return { regionId, types: typeIds.length, inserted, failed, stats };
}

/**
 * Step `rollup-prices`: `price_daily` of `day` from its `price_snapshots` (per hub/type: average,
 * low, high and close = value of the latest snapshot of the day, number of samples).
 */
export async function rollupPrices(env: Env, day: string): Promise<number> {
	const from = dayStart(day);
	const result = await env.HISTORY_DB.prepare(
		`INSERT OR REPLACE INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, buy_close, sell_close,
			buy_low, buy_high, sell_low, sell_high, samples)
		WITH day AS (
			SELECT * FROM price_snapshots WHERE snapshot_at >= ?2 AND snapshot_at < ?3
		), last AS (
			SELECT hub_id, type_id, MAX(snapshot_at) AS snapshot_at FROM day GROUP BY hub_id, type_id
		)
		SELECT ?1, d.hub_id, d.type_id, AVG(d.buy_max), AVG(d.sell_min), c.buy_max, c.sell_min,
			MIN(d.buy_max), MAX(d.buy_max), MIN(d.sell_min), MAX(d.sell_min), COUNT(*)
		FROM day d
		JOIN last l ON l.hub_id = d.hub_id AND l.type_id = d.type_id
		JOIN day c ON c.hub_id = l.hub_id AND c.type_id = l.type_id AND c.snapshot_at = l.snapshot_at
		GROUP BY d.hub_id, d.type_id`
	)
		.bind(day, from, from + DAY_MS)
		.run();
	return result.meta.changes;
}

/** Step `rollup-indices`: `date`'s `adjusted_price_daily` and `cost_index_daily` from the latest tables. */
export async function rollupIndices(
	env: Env,
	date: string
): Promise<{ adjusted: number; costIndices: number }> {
	const [adjusted, costs] = await env.DB.batch<{ id: number; value: number }>([
		env.DB.prepare('SELECT type_id AS id, adjusted_price AS value FROM adjusted_prices'),
		env.DB.prepare('SELECT system_id AS id, reaction AS value FROM cost_indices')
	]);
	const write = async (
		table: string,
		idColumn: string,
		valueColumn: string,
		rows: { id: number; value: number }[]
	) => {
		if (rows.length === 0) return;
		const columns = ['date', idColumn, valueColumn];
		const sql = jsonInsertSql(table, columns, upsertClause(columns, [idColumn, 'date']));
		await env.HISTORY_DB.prepare(sql)
			.bind(JSON.stringify(rows.map((r) => [date, r.id, r.value])))
			.run();
	};
	await write('adjusted_price_daily', 'type_id', 'adjusted_price', adjusted!.results);
	await write('cost_index_daily', 'system_id', 'reaction', costs!.results);
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
 * before it has no copy and keeps the day). Deletes in 6-hour windows.
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
			for (const regionId of regionIds)
				history.push(
					await steps.do(`history-${regionId}`, STEP_CONFIG, () =>
						refreshRegionHistory(env, regionId, Date.now())
					)
				);
			const priceDaily = await steps.do('rollup-prices', STEP_CONFIG, () => rollupPrices(env, yesterday));
			const indices = await steps.do('rollup-indices', STEP_CONFIG, () => rollupIndices(env, date));
			const archive = await steps.do('archive-verify', STEP_CONFIG, () =>
				verifyArchive(env, yesterday, Date.now())
			);
			const retention = await steps.do('retention', STEP_CONFIG, () => applyRetention(env, date));
			const prune = await steps.do('prune', STEP_CONFIG, () => pruneCoreTables(env, Date.now()));
			const result: DailyResult = {
				date,
				status: history.some((h) => h.failed > 0) ? 'partial' : 'ok',
				history,
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
