import { JOBS, type UpdaterAction } from '$lib/admin/jobs';

/** A job run inline in the RPC call (`InlineRunResult` in `apps/updater/src/rpc.ts`). */
export interface InlineRunResult {
	runId: string;
	status: 'ok' | 'failed';
	summary: string;
}

/**
 * The `UPDATER` service binding (`UpdaterRpc` in `apps/updater/src/rpc.ts`). Declared here because the
 * web app does not import the updater's sources; keep it in step with `UpdaterRpc`.
 */
export interface UpdaterApi {
	triggerPriceRefresh(): Promise<{ instanceId: string }>;
	triggerSdeSync(force: boolean): Promise<{ instanceId: string } | { skipped: true; build: number }>;
	triggerDaily(date: string): Promise<{ instanceId: string }>;
	triggerHistoryBackfill(): Promise<{ instanceId: string }>;
	triggerAdjustedPrices(): Promise<InlineRunResult>;
	triggerCostIndices(): Promise<InlineRunResult>;
	triggerAffiliations(): Promise<InlineRunResult>;
	/** One inventory pass now, ignoring the daily schedule (run `inventory-manual-<ms>`). */
	triggerInventoryPass(): Promise<InlineRunResult>;
	/**
	 * Syncs one inventory source now; `busy` while a sync of it is still running, `notBefore` (unix ms)
	 * while the ESI data of its last sync has not expired (nothing started).
	 */
	triggerInventorySync(
		sourceId: number
	): Promise<{ instanceId: string } | { busy: true } | { notBefore: number }>;
	/** One profit tracking pass now (run `tracking-manual-<ms>`). */
	triggerTrackingPass(): Promise<InlineRunResult>;
	/**
	 * Syncs one tracking connection now; `busy` while a sync of it is still running, `notBefore` (unix ms)
	 * while every stream's ESI data is still fresh (nothing started).
	 */
	triggerTrackingSync(
		sourceId: number
	): Promise<{ instanceId: string } | { busy: true } | { notBefore: number }>;
	/** Rebuilds the user's ledger now; `{ error: 'unavailable' }` when it failed (the ledger is marked dirty). */
	rebuildLedger(userId: string): Promise<LedgerRebuildSummary | { error: 'unavailable' }>;
	/**
	 * Prices the user's contract by the Janice appraisal `code` the user gave, then rebuilds the ledger
	 * (`setContractJanice` in `apps/updater/src/contract-janice.ts`); nothing is stored on an error.
	 */
	setContractJanice(userId: string, contractId: number, code: string): Promise<ContractJaniceResult>;
	publishMarketSnapshot(): Promise<{ snapshotAt: number; hubIds: string[] }>;
	workflowStatus(runs: { kind: string; runId: string }[]): Promise<Record<string, WorkflowStatus>>;
}

/**
 * Result of `setContractJanice` (`ContractJaniceResult` in `apps/updater/src/contract-janice.ts`):
 * `missing` no such contract of the user, `unavailable` no Janice API key, `unknown` Janice has no
 * appraisal with that code, `failed` any other failure of the fetch.
 */
export type ContractJaniceResult =
	{ rebuilt: boolean } | { error: 'missing' | 'unavailable' | 'unknown' | 'failed' };

/** Result of a ledger rebuild (`rebuildLedger` in `apps/updater/src/ledger.ts`). */
export interface LedgerRebuildSummary {
	rebuiltAt: number;
	lots: number;
	jobs: number;
	needsReview: number;
}

/** Live Cloudflare Workflows instance status of a run (`queued`, `running`, `errored`, `complete`, ...). */
export interface WorkflowStatus {
	status: string;
	error: string | null;
}

export interface UpdaterNotice {
	ok: boolean;
	text: string;
}

const NOTICE_NAMES = Object.fromEntries(
	JOBS.flatMap((job) => job.actions.map((a) => [a.action, a.notice]))
) as Record<UpdaterAction, string>;

function workflowNotice(name: string, result: { instanceId: string } | { skipped: true; build: number }) {
	return 'instanceId' in result
		? { ok: true, text: `${name} started: workflow instance ${result.instanceId}.` }
		: { ok: true, text: `${name} skipped: build ${result.build} is already imported.` };
}

function inlineNotice(name: string, result: InlineRunResult): UpdaterNotice {
	return result.status === 'ok'
		? { ok: true, text: `${name} run ${result.runId} finished: ${result.summary}.` }
		: { ok: false, text: `${name} run ${result.runId} failed: ${result.summary}` };
}

async function callUpdater(
	updater: UpdaterApi,
	action: UpdaterAction,
	name: string,
	today: string
): Promise<UpdaterNotice> {
	switch (action) {
		case 'prices':
			return workflowNotice(name, await updater.triggerPriceRefresh());
		case 'sde_check':
			return workflowNotice(name, await updater.triggerSdeSync(false));
		case 'sde_force':
			return workflowNotice(name, await updater.triggerSdeSync(true));
		case 'daily':
			return workflowNotice(name, await updater.triggerDaily(today));
		case 'history':
			return workflowNotice(name, await updater.triggerHistoryBackfill());
		case 'adjusted_prices':
			return inlineNotice(name, await updater.triggerAdjustedPrices());
		case 'cost_indices':
			return inlineNotice(name, await updater.triggerCostIndices());
		case 'affiliations':
			return inlineNotice(name, await updater.triggerAffiliations());
		case 'inventory':
			return inlineNotice(name, await updater.triggerInventoryPass());
		case 'tracking':
			return inlineNotice(name, await updater.triggerTrackingPass());
		case 'market_snapshot': {
			const { hubIds } = await updater.publishMarketSnapshot();
			return { ok: true, text: `${name} published with ${hubIds.length} public hubs.` };
		}
	}
}

/**
 * Runs an admin trigger over RPC (`today` is the date of the daily job). A missing binding or an
 * unreachable updater (e.g. local dev without `npm run dev -w apps/updater`) becomes an error notice
 * instead of a 500.
 */
export async function triggerUpdater(env: Env, action: UpdaterAction, today: string): Promise<UpdaterNotice> {
	// `wrangler types` declares the binding as an untyped `Service`; its RPC surface is `UpdaterApi`.
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	const name = NOTICE_NAMES[action];
	if (!updater) return { ok: false, text: `${name} not started: the UPDATER binding is missing.` };
	try {
		return await callUpdater(updater, action, name, today);
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			text: `${name} not started: the updater worker did not answer (${reason}). Locally, run \`npm run dev -w apps/updater\` next to the web dev server.`
		};
	}
}

/**
 * Asks the updater to rewrite KV `market:v1` after an admin hub change. `false` when the binding is
 * missing or the updater did not answer; the next price refresh publishes the change anyway.
 */
export async function publishMarket(env: Env): Promise<boolean> {
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	if (!updater) return false;
	try {
		await updater.publishMarketSnapshot();
		return true;
	} catch (e) {
		console.error('UPDATER.publishMarketSnapshot failed', e);
		return false;
	}
}

/**
 * Live workflow status per run id, in one RPC. Best effort: no runs, a missing binding or an updater that
 * did not answer give `{}`; runs the updater cannot look up are absent.
 */
export async function workflowStatuses(
	env: Env,
	runs: { kind: string; runId: string }[]
): Promise<Record<string, WorkflowStatus>> {
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	if (!updater || runs.length === 0) return {};
	try {
		return await updater.workflowStatus(runs);
	} catch (e) {
		console.error('UPDATER.workflowStatus failed', e);
		return {};
	}
}
