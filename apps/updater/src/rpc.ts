import { WorkerEntrypoint } from 'cloudflare:workers';
import type { JobRunRow } from '@reactions/db';
import { fetchSdeLatest } from '@reactions/eve';
import { refreshAdjustedPrices } from './cron/adjusted-prices.ts';
import { refreshCostIndices } from './cron/cost-indices.ts';
import { importedSdeBuild } from './cron/sde-check.ts';
import { isIsoDate } from './dates.ts';
import { httpFetch, userAgent } from './http.ts';
import { errorMessage, failJobRun, finishJobRun, inlineRunId, latestJobRuns, startJobRun } from './jobs.ts';
import { publishMarketSnapshot } from './market-snapshot.ts';
import { createWorkflowInstance, startWorkflowRun } from './workflows/instances.ts';

export type TriggerResult = { instanceId: string } | { skipped: true; build: number };

/** Outcome of a job run inline in the RPC call (no workflow instance). */
export interface InlineRunResult {
	runId: string;
	status: 'ok' | 'failed';
	/** The log line fragment, or the error message of a failed run. */
	summary: string;
}

/** Live state of a workflow instance (Cloudflare Workflows `InstanceStatus`). */
export interface WorkflowState {
	status: string;
	error: string | null;
}

/**
 * Runs a cron step now as `<kind>-manual-<now ms>`; its `job_runs` row records a failure, so the error
 * is returned instead of rejecting the RPC call.
 */
async function runInline(
	method: string,
	kind: 'cost_indices' | 'adjusted_prices',
	run: (now: number) => Promise<string>
): Promise<InlineRunResult> {
	const now = Date.now();
	const runId = inlineRunId(kind, now, true);
	console.log(`[rpc] ${method}: running ${runId}`);
	try {
		return { runId, status: 'ok', summary: await run(now) };
	} catch (error) {
		return { runId, status: 'failed', summary: errorMessage(error) };
	}
}

/** Service-binding RPC used by the web app's admin pages. */
export class UpdaterRpc extends WorkerEntrypoint<Env> {
	/** Starts a price refresh now (instance `prices-manual-<now ms>`, never colliding with cron ids). */
	async triggerPriceRefresh(): Promise<{ instanceId: string }> {
		const now = Date.now();
		const id = `prices-manual-${now}`;
		console.log(`[rpc] triggerPriceRefresh: starting ${id}`);
		await startWorkflowRun(this.env, this.env.PRICE_REFRESH, id, 'prices', {}, now);
		return { instanceId: id };
	}

	/**
	 * Imports the latest SDE build when it is newer than the imported one (instance `sde-<build>`),
	 * or unconditionally with `force` (instance `sde-<build>-manual-<now ms>`, never colliding).
	 */
	async triggerSdeSync(force: boolean): Promise<TriggerResult> {
		const latest = await fetchSdeLatest(httpFetch, userAgent(this.env));
		const build = latest.data!.buildNumber;
		const imported = await importedSdeBuild(this.env);
		if (!force && imported !== null && build <= imported) {
			console.log(`[rpc] triggerSdeSync: skipped, build ${build} is already imported`);
			return { skipped: true, build };
		}
		const id = force ? `sde-${build}-manual-${Date.now()}` : `sde-${build}`;
		console.log(`[rpc] triggerSdeSync${force ? ' (forced)' : ''}: starting ${id}`);
		const instance = await createWorkflowInstance(this.env.SDE_SYNC, id, { build });
		return { instanceId: instance.id };
	}

	/** Runs the daily job for `date` (`YYYY-MM-DD`) as instance `daily-<date>-manual-<now ms>`. */
	async triggerDaily(date: string): Promise<{ instanceId: string }> {
		if (!isIsoDate(date)) throw new RangeError(`date must be a YYYY-MM-DD day, got ${JSON.stringify(date)}`);
		const now = Date.now();
		const id = `daily-${date}-manual-${now}`;
		console.log(`[rpc] triggerDaily(${date}): starting ${id}`);
		await startWorkflowRun(this.env, this.env.DAILY, id, 'daily', { date }, now);
		return { instanceId: id };
	}

	/** Imports market history from market.coalition.space (instance `history-backfill-manual-<now ms>`). */
	async triggerHistoryBackfill(): Promise<{ instanceId: string }> {
		const now = Date.now();
		const id = `history-backfill-manual-${now}`;
		console.log(`[rpc] triggerHistoryBackfill: starting ${id}`);
		await startWorkflowRun(this.env, this.env.HISTORY_BACKFILL, id, 'history', {}, now);
		return { instanceId: id };
	}

	/**
	 * Fetches `/markets/prices` now, even while the cached response is fresh, as run
	 * `adjusted_prices-manual-<now ms>` (always recorded, also when ESI has nothing new).
	 */
	async triggerAdjustedPrices(): Promise<InlineRunResult> {
		return runInline('triggerAdjustedPrices', 'adjusted_prices', (now) =>
			refreshAdjustedPrices(this.env, now, true)
		);
	}

	/**
	 * Fetches `/industry/systems` now, even while the cached response is fresh, as run
	 * `cost_indices-manual-<now ms>` (always recorded, also when ESI has nothing new).
	 */
	async triggerCostIndices(): Promise<InlineRunResult> {
		return runInline('triggerCostIndices', 'cost_indices', (now) => refreshCostIndices(this.env, now, true));
	}

	/**
	 * Rewrites KV `market:v1` from the current hub table and latest prices, so admin hub changes
	 * (approve, revoke, enable, disable, reorder) reach public pages without waiting for a price run.
	 * Every call is recorded as run `market_snapshot-manual-<now ms>`.
	 */
	async publishMarketSnapshot(): Promise<{ snapshotAt: number; hubIds: string[] }> {
		const now = Date.now();
		const runId = inlineRunId('market_snapshot', now, true);
		console.log(`[rpc] publishMarketSnapshot: running ${runId}`);
		await startJobRun(this.env, runId, 'market_snapshot', now);
		try {
			const snapshot = await publishMarketSnapshot(this.env, now);
			const prices = Object.values(snapshot.prices).reduce((n, types) => n + Object.keys(types).length, 0);
			await finishJobRun(this.env, runId, 'ok', { hubs: snapshot.hubs.length, prices });
			return { snapshotAt: snapshot.snapshotAt, hubIds: snapshot.hubs.map((h) => h.hubId) };
		} catch (error) {
			await failJobRun(this.env, runId, 'market_snapshot', now, error);
			throw error;
		}
	}

	/** Latest `job_runs` row per kind. */
	async status(): Promise<JobRunRow[]> {
		return latestJobRuns(this.env);
	}

	/**
	 * Live Workflows state of the given runs (admin progress view); runs of kinds without a workflow,
	 * or whose instance cannot be read, are left out.
	 */
	async workflowStatus(runs: { kind: string; runId: string }[]): Promise<Record<string, WorkflowState>> {
		const bindings: Record<string, Workflow<unknown> | undefined> = {
			prices: this.env.PRICE_REFRESH,
			daily: this.env.DAILY,
			sde: this.env.SDE_SYNC,
			history: this.env.HISTORY_BACKFILL
		};
		const states = await Promise.all(
			runs.map(async ({ kind, runId }) => {
				const binding = bindings[kind];
				if (!binding) return null;
				try {
					const { status, error } = await (await binding.get(runId)).status();
					const message = error == null ? null : typeof error === 'string' ? error : JSON.stringify(error);
					return [runId, { status, error: message }] as const;
				} catch {
					return null;
				}
			})
		);
		return Object.fromEntries(states.filter((s) => s !== null));
	}
}
