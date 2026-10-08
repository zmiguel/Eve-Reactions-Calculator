import { getCoreDb, sdeState } from '@reactions/db';
import { fetchSdeLatest, SDE_LATEST_URL } from '@reactions/eve';
import { eq } from 'drizzle-orm';
import { SDE_CHECK_MAX_MINUTE } from '../config.ts';
import { getHttpCache, httpFetch, saveHttpCache, touchHttpCache, userAgent } from '../http.ts';
import { createWorkflowInstance } from '../workflows/instances.ts';

/** Build number of the imported SDE, `null` before the first import. */
export async function importedSdeBuild(env: Env): Promise<number | null> {
	const row = await getCoreDb(env.DB)
		.select({ build: sdeState.buildNumber })
		.from(sdeState)
		.where(eq(sdeState.id, 1))
		.get();
	return row?.build ?? null;
}

/**
 * Cron step 4: during minutes 0–9 of every hour, conditional GET of the SDE `latest.jsonl`; a build
 * newer than `sde_state` (or no state) starts `SdeSyncWorkflow` instance `sde-<build>`.
 * Returns the log line fragment.
 */
export async function checkSdeUpdate(env: Env, scheduledTime: number, now: number): Promise<string> {
	if (new Date(scheduledTime).getUTCMinutes() > SDE_CHECK_MAX_MINUTE) return 'skipped (checked hourly)';
	const cached = await getHttpCache(env, SDE_LATEST_URL);
	const latest = await fetchSdeLatest(httpFetch, userAgent(env), { etag: cached?.etag ?? null });
	if (latest.notModified || latest.data === null) {
		await touchHttpCache(env, SDE_LATEST_URL, latest.expiresAt, now);
		return 'latest.jsonl not modified';
	}
	const build = latest.data.buildNumber;
	const imported = await importedSdeBuild(env);
	let message: string;
	if (imported !== null && build <= imported) {
		message = `build ${build} already imported`;
	} else {
		const instance = await createWorkflowInstance(env.SDE_SYNC, `sde-${build}`, { build });
		message = instance.created
			? `build ${build} is new (imported ${imported ?? 'none'}), started ${instance.id}`
			: `build ${build} sync ${instance.id} already exists`;
	}
	// Stored only after the instance exists: a failed create is retried on the next hourly check.
	await saveHttpCache(env, SDE_LATEST_URL, { etag: latest.etag, expiresAt: latest.expiresAt }, now);
	return message;
}
