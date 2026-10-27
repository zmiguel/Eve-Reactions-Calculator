import { isEsiDowntime } from '@reactions/eve';
import { refreshAdjustedPrices } from './cron/adjusted-prices.ts';
import { refreshAffiliations } from './cron/affiliations.ts';
import { refreshCostIndices } from './cron/cost-indices.ts';
import { startDaily } from './cron/daily.ts';
import { startInventoryPass } from './cron/inventory.ts';
import { startPriceRefresh } from './cron/prices.ts';
import { checkSdeUpdate } from './cron/sde-check.ts';
import { startTrackingPass } from './cron/tracking.ts';
import { esiAvailable } from './esi-downtime.ts';
import { errorMessage } from './jobs.ts';

/**
 * Cron `*\/10 * * * *`. Every step runs isolated (a failure is logged and the next step still runs)
 * and logs exactly one line `[scheduled] <step>: <outcome>`. From 10:55 UTC until ESI is back after the
 * daily downtime (`esiAvailable`), the steps that send ESI requests or start a workflow that does are
 * skipped and catch up on a later tick.
 */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
	const at = controller.scheduledTime;
	console.log(`[scheduled] cron=${controller.cron} at=${new Date(at).toISOString()}`);
	const open = await esiAvailable(env, Date.now());
	const steps: [name: string, esi: boolean, run: () => Promise<string>][] = [
		['adjusted-prices', true, () => refreshAdjustedPrices(env, Date.now())],
		['cost-indices', true, () => refreshCostIndices(env, Date.now())],
		['prices', true, () => startPriceRefresh(env, at)],
		['sde-check', false, () => checkSdeUpdate(env, at, Date.now())],
		['daily', true, () => startDaily(env, at)],
		['affiliations', true, () => refreshAffiliations(env, at, Date.now())],
		['inventory', true, () => startInventoryPass(env, at, Date.now())],
		['tracking', true, () => startTrackingPass(env, Date.now())]
	];
	for (const [name, esi, run] of steps) {
		if (esi && !open) {
			console.log(`[scheduled] ${name}: skipped (ESI downtime)`);
			continue;
		}
		try {
			console.log(`[scheduled] ${name}: ${await run()}`);
		} catch (error) {
			if (isEsiDowntime(error)) console.log(`[scheduled] ${name}: skipped (ESI downtime)`);
			else console.error(`[scheduled] ${name}: failed — ${errorMessage(error)}`);
		}
	}
}
