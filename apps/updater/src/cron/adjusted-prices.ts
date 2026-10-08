import { adjustedPrices, getCoreDb, trackedTypeIds, upsertMany } from '@reactions/db';
import { ESI_BASE_URL, fetchMarketPrices } from '@reactions/eve';
import { MARKET_PRICES_PATH } from '../config.ts';
import { conditionalRefresh, describeOutcome, esiClient } from '../http.ts';
import { failJobRun, finishJobRun, inlineRunId, NO_NEW_DATA, startJobRun } from '../jobs.ts';
import { publishMarketSnapshot } from '../market-snapshot.ts';

export const MARKET_PRICES_URL = ESI_BASE_URL + MARKET_PRICES_PATH;

/**
 * Cron step 1: conditional GET `/markets/prices` → `adjusted_prices` (tracked types only) →
 * `market:v1`. From cron a `job_runs` row (kind `adjusted_prices`) is written only when data is
 * written or the refresh fails. A `manual` run (admin RPC) requests even while the cached response is
 * fresh and always records its row. Returns the log line fragment.
 */
export async function refreshAdjustedPrices(env: Env, now: number, manual = false): Promise<string> {
	const db = getCoreDb(env.DB);
	const runId = inlineRunId('adjusted_prices', now, manual);
	try {
		if (manual) await startJobRun(env, runId, 'adjusted_prices', now);
		const outcome = await conditionalRefresh(
			env,
			MARKET_PRICES_URL,
			now,
			(etag) => fetchMarketPrices(esiClient(env), { etag }),
			async (prices) => {
				const tracked = new Set(await trackedTypeIds(db));
				// Without reactions (SDE not imported yet) nothing is tracked: keep no validator so the
				// next tick fetches the full list again instead of receiving 304.
				if (tracked.size === 0) {
					if (manual)
						await finishJobRun(env, runId, 'ok', {
							received: prices.length,
							written: 0,
							note: 'no reactions imported yet'
						});
					return { result: 0, store: false };
				}
				await startJobRun(env, runId, 'adjusted_prices', now);
				const rows = prices
					.filter((p) => p.adjustedPrice !== null && tracked.has(p.typeId))
					.map((p) => ({
						typeId: p.typeId,
						adjustedPrice: p.adjustedPrice!,
						averagePrice: p.averagePrice,
						updatedAt: now
					}));
				await upsertMany(
					db,
					adjustedPrices,
					rows,
					[adjustedPrices.typeId],
					[adjustedPrices.adjustedPrice, adjustedPrices.averagePrice, adjustedPrices.updatedAt]
				);
				await publishMarketSnapshot(env, now);
				await finishJobRun(env, runId, 'ok', { received: prices.length, written: rows.length });
				return { result: rows.length, store: true };
			},
			manual
		);
		if (manual && outcome.kind !== 'updated') await finishJobRun(env, runId, 'ok', NO_NEW_DATA);
		return describeOutcome(outcome, (written) =>
			written === 0 ? 'no tracked types yet' : `${written} adjusted prices written, market:v1 published`
		);
	} catch (error) {
		await failJobRun(env, runId, 'adjusted_prices', now, error);
		throw error;
	}
}
