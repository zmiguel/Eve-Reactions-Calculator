import { getCoreDb, jobRuns } from '@reactions/db';
import type { JobRunRow } from '@reactions/db';
import { eq, sql } from 'drizzle-orm';

/** Longest log summary of a job or step result. */
const SUMMARY_CHARS = 300;

/** Compact one-line JSON of a result for the log. */
export function summarize(value: unknown): string {
	if (value === undefined) return '';
	const text = JSON.stringify(value) ?? String(value);
	return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}…` : text;
}

export type JobKind =
	'prices' | 'daily' | 'sde' | 'cost_indices' | 'adjusted_prices' | 'history' | 'market_snapshot';
export type JobStatus = 'running' | 'ok' | 'partial' | 'failed';

/**
 * Inserts a `running` row and logs the start; a second call with the same id (workflow replay, or the
 * workflow confirming the row its trigger created) is a no-op and logs nothing.
 */
export async function startJobRun(env: Env, runId: string, kind: JobKind, startedAt: number): Promise<void> {
	const inserted = await getCoreDb(env.DB)
		.insert(jobRuns)
		.values({ runId, kind, startedAt, status: 'running' })
		.onConflictDoNothing({ target: jobRuns.runId })
		.returning({ runId: jobRuns.runId });
	if (inserted.length > 0) console.log(`[job] ${runId} started (${kind}, ${triggerOf(runId)})`);
}

/** How a run was started, from its id: `-manual-` = admin/RPC, `-retry-` = automatic retry, else cron. */
export function triggerOf(runId: string): 'manual' | 'retry' | 'cron' {
	if (runId.includes('-manual-')) return 'manual';
	if (runId.includes('-retry-')) return 'retry';
	return 'cron';
}

/**
 * Id of a run that executes inline (no workflow instance): `<kind>-<now ms>` from cron,
 * `<kind>-manual-<now ms>` when an admin starts it, so the two never collide.
 */
export function inlineRunId(kind: JobKind, now: number, manual: boolean): string {
	return manual ? `${kind}-manual-${now}` : `${kind}-${now}`;
}

/** `detail_json` of a manual inline run whose conditional request found nothing new (304). */
export const NO_NEW_DATA = { note: 'ESI returned no new data' };

/** Records the final status and result of a run and logs it with its duration. */
export async function finishJobRun(
	env: Env,
	runId: string,
	status: Exclude<JobStatus, 'running'>,
	detail: unknown,
	finishedAt: number = Date.now()
): Promise<void> {
	const [row] = await getCoreDb(env.DB)
		.update(jobRuns)
		.set({ status, finishedAt, detailJson: JSON.stringify(detail) })
		.where(eq(jobRuns.runId, runId))
		.returning({ startedAt: jobRuns.startedAt });
	const took = row ? ` after ${((finishedAt - row.startedAt) / 1000).toFixed(1)}s` : '';
	const line = `[job] ${runId} ${status}${took}: ${summarize(detail)}`;
	if (status === 'failed') console.error(line);
	else console.log(line);
}

/** Marks a run `failed` with the error message, creating the row if the run never started. */
export async function failJobRun(
	env: Env,
	runId: string,
	kind: JobKind,
	startedAt: number,
	error: unknown
): Promise<void> {
	await startJobRun(env, runId, kind, startedAt);
	await finishJobRun(env, runId, 'failed', { error: errorMessage(error) });
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The most recent run (by `started_at`) of every kind that has run at least once. */
export async function latestJobRuns(env: Env): Promise<JobRunRow[]> {
	return getCoreDb(env.DB)
		.select()
		.from(jobRuns)
		.where(
			sql`${jobRuns.runId} = (SELECT j.run_id FROM job_runs j WHERE j.kind = ${jobRuns.kind} ORDER BY j.started_at DESC, j.run_id DESC LIMIT 1)`
		)
		.orderBy(jobRuns.kind)
		.all();
}
