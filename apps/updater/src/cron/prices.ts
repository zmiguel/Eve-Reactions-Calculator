import { getCoreDb, jobRuns } from '@reactions/db';
import { and, desc, eq, lte } from 'drizzle-orm';
import { PRICE_REFRESH_MINUTES, PRICE_RUN_STALE_MINUTES } from '../config.ts';
import { errorMessage, failJobRun, finishJobRun } from '../jobs.ts';
import { startWorkflowRun } from '../workflows/instances.ts';

/** Workflow states in which an instance can still finish and record its own result. */
const LIVE_STATES = new Set(['queued', 'running', 'paused', 'waiting', 'waitingForPause']);

/** Instance state, or `missing` when the engine does not know the id (e.g. local state was reset). */
async function instanceState(binding: Workflow, id: string): Promise<string> {
	try {
		return (await (await binding.get(id)).status()).status;
	} catch {
		return 'missing';
	}
}

/**
 * Settles `running` prices rows whose workflow will never record a result: instances that errored,
 * were terminated or vanished are marked `failed` at once; instances still reported as live but older
 * than `PRICE_RUN_STALE_MINUTES` are terminated (best effort) and marked `failed`. The latter happens
 * when the process running the instance died, e.g. a restarted `wrangler dev`. Returns the run id of a
 * run that is still legitimately in progress, if any.
 */
async function settleRunningRuns(env: Env, now: number): Promise<string | null> {
	const db = getCoreDb(env.DB);
	const rows = await db
		.select({ runId: jobRuns.runId, startedAt: jobRuns.startedAt })
		.from(jobRuns)
		.where(and(eq(jobRuns.kind, 'prices'), eq(jobRuns.status, 'running')))
		.orderBy(desc(jobRuns.startedAt))
		.all();
	let inProgress: string | null = null;
	for (const row of rows) {
		const state = await instanceState(env.PRICE_REFRESH, row.runId);
		const stale = row.startedAt <= now - PRICE_RUN_STALE_MINUTES * 60_000;
		if (LIVE_STATES.has(state) && !stale) {
			inProgress ??= row.runId;
			continue;
		}
		if (state === 'complete') {
			// The instance finished but its final job_runs update was lost.
			await finishJobRun(
				env,
				row.runId,
				'partial',
				{ note: 'instance completed without recording a result' },
				now
			);
			continue;
		}
		if (LIVE_STATES.has(state)) {
			try {
				await (await env.PRICE_REFRESH.get(row.runId)).terminate();
			} catch (error) {
				console.error(`[prices] could not terminate ${row.runId}: ${errorMessage(error)}`);
			}
		}
		const reason = LIVE_STATES.has(state)
			? `abandoned: still ${state} after ${PRICE_RUN_STALE_MINUTES} minutes`
			: `instance ${state}`;
		await failJobRun(env, row.runId, 'prices', row.startedAt, new Error(reason));
	}
	return inProgress;
}

/**
 * Cron step 3: unless a prices run is still in progress or the latest prices run started less than
 * `PRICE_REFRESH_MINUTES` ago, starts `PriceRefreshWorkflow` instance `prices-<now floored to
 * PRICE_REFRESH_MINUTES>` and records it in `job_runs`. `now` is the cron's scheduled time so that
 * ticks exactly one interval apart qualify. Returns the log line fragment.
 */
export async function startPriceRefresh(env: Env, now: number): Promise<string> {
	const running = await settleRunningRuns(env, now);
	if (running) return `skipped (${running} still running)`;
	const interval = PRICE_REFRESH_MINUTES * 60_000;
	const latest = await getCoreDb(env.DB)
		.select({ runId: jobRuns.runId, startedAt: jobRuns.startedAt, status: jobRuns.status })
		.from(jobRuns)
		.where(and(eq(jobRuns.kind, 'prices'), lte(jobRuns.startedAt, now)))
		.orderBy(desc(jobRuns.startedAt))
		.get();
	// A failed run does not hold back the next one for a full interval; only completed runs do.
	if (latest && latest.status !== 'failed' && latest.startedAt > now - interval)
		return `skipped (${latest.runId} started ${new Date(latest.startedAt).toISOString()})`;
	const slot = Math.floor(now / interval) * interval;
	const runId = latest?.runId === `prices-${slot}` ? `prices-${slot}-retry-${now}` : `prices-${slot}`;
	const instance = await startWorkflowRun(env, env.PRICE_REFRESH, runId, 'prices', {}, now);
	return instance.created ? `started ${runId}` : `${runId} already exists`;
}
