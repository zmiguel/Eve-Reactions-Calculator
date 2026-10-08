import { refreshAdjustedPrices } from './cron/adjusted-prices.ts';
import { refreshCostIndices } from './cron/cost-indices.ts';
import { startDaily } from './cron/daily.ts';
import { startPriceRefresh } from './cron/prices.ts';
import { checkSdeUpdate } from './cron/sde-check.ts';
import { errorMessage } from './jobs.ts';

/**
 * Cron `*\/10 * * * *`. Every step runs isolated (a failure is logged and the next step still runs)
 * and logs exactly one line `[scheduled] <step>: <outcome>`.
 */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
	const at = controller.scheduledTime;
	console.log(`[scheduled] cron=${controller.cron} at=${new Date(at).toISOString()}`);
	const steps: [name: string, run: () => Promise<string>][] = [
		['adjusted-prices', () => refreshAdjustedPrices(env, Date.now())],
		['cost-indices', () => refreshCostIndices(env, Date.now())],
		['prices', () => startPriceRefresh(env, at)],
		['sde-check', () => checkSdeUpdate(env, at, Date.now())],
		['daily', () => startDaily(env, at)]
	];
	for (const [name, run] of steps) {
		try {
			console.log(`[scheduled] ${name}: ${await run()}`);
		} catch (error) {
			console.error(`[scheduled] ${name}: failed — ${errorMessage(error)}`);
		}
	}
}
