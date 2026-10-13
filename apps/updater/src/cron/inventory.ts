import { INVENTORY_DAILY_MINUTE_UTC, INVENTORY_SYNCS_PER_TICK, PRIVATE_HUB_ACTIVE_DAYS } from '../config.ts';
import { DAY_MS, dayStart, utcDate } from '../dates.ts';
import { settleStaleInventorySyncs, startInventorySync } from '../inventory.ts';
import { failJobRun, finishJobRun, inlineRunId, startJobRun } from '../jobs.ts';

/**
 * Sources due for a sync: not `running`/`denied`, user seen after `?1`, last attempt before `?2`
 * (`NULL` = any attempt), least recently attempted first (never attempted before all), at most `?3`.
 */
const DUE_SQL = `
	SELECT s.source_id FROM inventory_sources s JOIN users u ON u.user_id = s.user_id
	WHERE s.status NOT IN ('running', 'denied') AND u.last_seen_at > ?1
		AND (?2 IS NULL OR s.last_attempt_at IS NULL OR s.last_attempt_at < ?2)
	ORDER BY s.last_attempt_at, s.source_id
	LIMIT ?3`;

export interface InventoryPassCounts {
	started: number;
	/**
	 * The day's instance id already existed (the source was synced today), the source was removed, or
	 * its ESI data has not expired yet (`data_expires_at` after now).
	 */
	skipped: number;
	/** Another sync of the source was running. */
	busy: number;
}

/**
 * Cron step 7: first marks syncs `running` for more than `INVENTORY_RUN_STALE_MINUTES` as `error`; then,
 * on every tick from 12:00 UTC (after downtime), starts up to `INVENTORY_SYNCS_PER_TICK` syncs
 * (`inventory-<sourceId>-<date>`) of sources not attempted since today 12:00 UTC whose user was seen in
 * the last `PRIVATE_HUB_ACTIVE_DAYS` days; a source whose `data_expires_at` is still ahead counts as
 * skipped. A tick that starts syncs records one `job_runs` row (kind
 * `inventory`, the counts); the syncs themselves are not rows. A `manual` pass (admin RPC) ignores the
 * 12:00 gate and the attempts of today, names its instances `inventory-<sourceId>-manual-<now ms>` and is
 * always recorded. Returns the log line fragment.
 */
export async function startInventoryPass(
	env: Env,
	scheduledTime: number,
	now: number,
	manual = false
): Promise<string> {
	const runId = inlineRunId('inventory', now, manual);
	try {
		const stale = await settleStaleInventorySyncs(env, now);
		const settled = stale > 0 ? `; stale syncs marked error: ${stale}` : '';
		const at = new Date(scheduledTime);
		if (!manual && at.getUTCHours() * 60 + at.getUTCMinutes() < INVENTORY_DAILY_MINUTE_UTC)
			return `skipped (daily from 12:00 UTC)${settled}`;
		const date = utcDate(scheduledTime);
		const { results } = await env.DB.prepare(DUE_SQL)
			.bind(
				now - PRIVATE_HUB_ACTIVE_DAYS * DAY_MS,
				manual ? null : dayStart(date) + INVENTORY_DAILY_MINUTE_UTC * 60_000,
				INVENTORY_SYNCS_PER_TICK
			)
			.all<{ source_id: number }>();
		const counts: InventoryPassCounts = { started: 0, skipped: 0, busy: 0 };
		for (const { source_id: sourceId } of results) {
			const instanceId = manual ? `inventory-${sourceId}-manual-${now}` : `inventory-${sourceId}-${date}`;
			const outcome = await startInventorySync(env, sourceId, instanceId, manual ? 'manual' : 'daily', now);
			if (outcome === 'started') counts.started++;
			else if (outcome === 'busy') counts.busy++;
			else counts.skipped++;
		}
		if (manual || counts.started > 0) {
			await startJobRun(env, runId, 'inventory', now);
			await finishJobRun(env, runId, 'ok', counts);
		}
		if (results.length === 0) return `no sources due${settled}`;
		return `started ${counts.started} of ${results.length} due sources (${counts.skipped} skipped, ${counts.busy} busy)${settled}`;
	} catch (error) {
		await failJobRun(env, runId, 'inventory', now, error);
		throw error;
	}
}
