import {
	PRIVATE_HUB_ACTIVE_DAYS,
	TRACKING_LEDGERS_PER_TICK,
	TRACKING_MIN_INTERVAL_MINUTES,
	TRACKING_SYNCS_PER_TICK
} from '../config.ts';
import { DAY_MS } from '../dates.ts';
import { failJobRun, finishJobRun, inlineRunId, startJobRun } from '../jobs.ts';
import { rebuildDirtyLedgers } from '../ledger.ts';
import { settleStaleTrackingSyncs, startTrackingSync } from '../tracking.ts';

/**
 * Connections due for a tracking sync: tracking on, not `running`/`denied`, user seen after `?1`, last
 * attempt before `?2` (or never), and a counted stream (`trackingStreamNames`: the personal streams,
 * or `jobs`/`orders`/`contracts` and the wallet streams of the divisions the corporation connection
 * counts) whose `expires_at` is null or ≤ `?3` (or no stream yet); least recently attempted first, at
 * most `?4`. Rows of divisions no longer counted, `blueprints` (read along with the others, see
 * `prepareTrackingSync`) and the expiry rows of `divisions`/`affiliations` never make a connection
 * due. Divisions newly selected (no stream row yet) are caught by `startTrackingSync`'s own check once
 * any other stream expires.
 */
const DUE_SQL = `
	SELECT s.source_id FROM inventory_sources s JOIN users u ON u.user_id = s.user_id
	WHERE s.tracking_enabled = 1 AND s.tracking_status IS NOT 'running' AND s.tracking_status IS NOT 'denied'
		AND u.last_seen_at > ?1
		AND (s.tracking_last_attempt_at IS NULL OR s.tracking_last_attempt_at <= ?2)
		AND (
			NOT EXISTS (SELECT 1 FROM tracking_streams t WHERE t.source_id = s.source_id)
			OR EXISTS (
				SELECT 1 FROM tracking_streams t
				WHERE t.source_id = s.source_id AND (t.expires_at IS NULL OR t.expires_at <= ?3)
					AND (
						t.stream IN ('jobs', 'orders', 'contracts')
						OR (s.kind <> 'corporation' AND t.stream IN ('transactions', 'journal'))
						OR (s.kind = 'corporation' AND (t.stream LIKE 'transactions:_' OR t.stream LIKE 'journal:_')
							AND NOT (
								CASE WHEN json_valid(s.wallet_divisions_json)
									THEN json_type(s.wallet_divisions_json) = 'array' ELSE 0 END
								AND CAST(substr(t.stream, instr(t.stream, ':') + 1) AS INTEGER) NOT IN (
									SELECT value FROM json_each(CASE WHEN json_valid(s.wallet_divisions_json)
										THEN s.wallet_divisions_json ELSE '[]' END))))
					)
			)
		)
	ORDER BY s.tracking_last_attempt_at, s.source_id
	LIMIT ?4`;

export interface TrackingPassCounts {
	started: number;
	/** The connection was removed, tracking turned off, or every stream is still fresh. */
	skipped: number;
	/** Another sync of the connection was running. */
	busy: number;
	ledgersRebuilt: number;
	ledgersFailed: number;
}

/**
 * Cron step 8 (every tick): marks tracking syncs `running` for more than `TRACKING_RUN_STALE_MINUTES`
 * as `error`, starts up to `TRACKING_SYNCS_PER_TICK` syncs (`tracking-<sourceId>-<now ms>`) of due
 * connections (user seen within `PRIVATE_HUB_ACTIVE_DAYS`, last attempt at least
 * `TRACKING_MIN_INTERVAL_MINUTES` ago, a stream expired or missing), then rebuilds up to
 * `TRACKING_LEDGERS_PER_TICK` dirty ledgers. A tick that did something records one `job_runs` row (kind
 * `tracking`, the counts); a `manual` pass (admin RPC) is always recorded. Returns the log line fragment.
 */
export async function startTrackingPass(env: Env, now: number, manual = false): Promise<string> {
	const runId = inlineRunId('tracking', now, manual);
	try {
		const stale = await settleStaleTrackingSyncs(env, now);
		const { results } = await env.DB.prepare(DUE_SQL)
			.bind(
				now - PRIVATE_HUB_ACTIVE_DAYS * DAY_MS,
				now - TRACKING_MIN_INTERVAL_MINUTES * 60_000,
				now,
				TRACKING_SYNCS_PER_TICK
			)
			.all<{ source_id: number }>();
		const counts: TrackingPassCounts = {
			started: 0,
			skipped: 0,
			busy: 0,
			ledgersRebuilt: 0,
			ledgersFailed: 0
		};
		for (const { source_id: sourceId } of results) {
			const outcome = await startTrackingSync(
				env,
				sourceId,
				`tracking-${sourceId}-${now}`,
				manual ? 'manual' : 'hourly',
				now
			);
			if (outcome === 'started') counts.started++;
			else if (outcome === 'busy') counts.busy++;
			else counts.skipped++;
		}
		const ledgers = await rebuildDirtyLedgers(env, TRACKING_LEDGERS_PER_TICK);
		counts.ledgersRebuilt = ledgers.rebuilt;
		counts.ledgersFailed = ledgers.failed;
		if (manual || results.length > 0 || ledgers.rebuilt > 0 || ledgers.failed > 0) {
			await startJobRun(env, runId, 'tracking', now);
			await finishJobRun(env, runId, ledgers.failed > 0 ? 'partial' : 'ok', counts);
		}
		const settled = stale > 0 ? `; stale syncs marked error: ${stale}` : '';
		const rebuilt = `; ledgers rebuilt: ${ledgers.rebuilt}${ledgers.failed > 0 ? ` (${ledgers.failed} failed)` : ''}`;
		const synced =
			results.length === 0
				? 'no connections due'
				: `started ${counts.started} of ${results.length} due connections (${counts.skipped} skipped, ${counts.busy} busy)`;
		return `${synced}${rebuilt}${settled}`;
	} catch (error) {
		await failJobRun(env, runId, 'tracking', now, error);
		throw error;
	}
}
