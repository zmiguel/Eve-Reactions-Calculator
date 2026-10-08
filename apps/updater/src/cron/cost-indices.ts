import { costIndices, getCoreDb, upsertMany } from '@reactions/db';
import { ESI_BASE_URL, fetchIndustrySystems } from '@reactions/eve';
import { INDUSTRY_SYSTEMS_PATH } from '../config.ts';
import { conditionalRefresh, describeOutcome, esiClient } from '../http.ts';
import { failJobRun, finishJobRun, inlineRunId, NO_NEW_DATA, startJobRun } from '../jobs.ts';
import { publishMarketSnapshot } from '../market-snapshot.ts';

export const INDUSTRY_SYSTEMS_URL = ESI_BASE_URL + INDUSTRY_SYSTEMS_PATH;

/**
 * Cron step 2: conditional GET `/industry/systems` → `cost_indices` (`reaction`, `manufacturing`;
 * an activity missing for a system is stored as 0) for every returned system → `market:v1`.
 * From cron a `job_runs` row (kind `cost_indices`) is written on 200 or failure only. A `manual` run
 * (admin RPC) requests even while the cached response is fresh and always records its row.
 * Returns the log line fragment.
 */
export async function refreshCostIndices(env: Env, now: number, manual = false): Promise<string> {
	const runId = inlineRunId('cost_indices', now, manual);
	try {
		if (manual) await startJobRun(env, runId, 'cost_indices', now);
		const outcome = await conditionalRefresh(
			env,
			INDUSTRY_SYSTEMS_URL,
			now,
			(etag) => fetchIndustrySystems(esiClient(env), { etag }),
			async (systems) => {
				await startJobRun(env, runId, 'cost_indices', now);
				const rows = systems.map((s) => ({
					systemId: s.systemId,
					reaction: s.costIndices.reaction ?? 0,
					manufacturing: s.costIndices.manufacturing ?? 0,
					updatedAt: now
				}));
				await upsertMany(
					getCoreDb(env.DB),
					costIndices,
					rows,
					[costIndices.systemId],
					[costIndices.reaction, costIndices.manufacturing, costIndices.updatedAt]
				);
				await publishMarketSnapshot(env, now);
				await finishJobRun(env, runId, 'ok', { systems: rows.length });
				return { result: rows.length, store: true };
			},
			manual
		);
		if (manual && outcome.kind !== 'updated') await finishJobRun(env, runId, 'ok', NO_NEW_DATA);
		return describeOutcome(outcome, (written) => `${written} systems written, market:v1 published`);
	} catch (error) {
		await failJobRun(env, runId, 'cost_indices', now, error);
		throw error;
	}
}
