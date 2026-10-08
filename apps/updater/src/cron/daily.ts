import { getCoreDb, jobRuns } from '@reactions/db';
import { eq } from 'drizzle-orm';
import { DAILY_START_MINUTE_UTC } from '../config.ts';
import { utcDate } from '../dates.ts';
import { startWorkflowRun } from '../workflows/instances.ts';
import { importedSdeBuild } from './sde-check.ts';

/**
 * Cron step 5: from 11:20 UTC, starts `DailyWorkflow` instance `daily-<today>` (params `{ date: today }`)
 * unless `job_runs` already has that run. Before the first SDE import nothing is tracked yet, so the run
 * waits (a fresh deploy then gets its full history on the first tick after the import). Returns the log
 * line fragment.
 */
export async function startDaily(env: Env, now: number): Promise<string> {
	const at = new Date(now);
	if (at.getUTCHours() * 60 + at.getUTCMinutes() < DAILY_START_MINUTE_UTC)
		return 'skipped (before 11:20 UTC)';
	if ((await importedSdeBuild(env)) === null) return 'skipped (no SDE imported yet)';
	const date = utcDate(now);
	const runId = `daily-${date}`;
	const existing = await getCoreDb(env.DB)
		.select({ status: jobRuns.status })
		.from(jobRuns)
		.where(eq(jobRuns.runId, runId))
		.get();
	if (existing) return `skipped (${runId} ${existing.status})`;
	const instance = await startWorkflowRun(env, env.DAILY, runId, 'daily', { date }, now);
	return instance.created ? `started ${runId}` : `${runId} already exists`;
}
