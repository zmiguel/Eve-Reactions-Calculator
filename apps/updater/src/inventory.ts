import { ERROR_INTERNAL } from '@reactions/eve';
import { INVENTORY_RUN_STALE_MINUTES } from './config.ts';
import { errorMessage } from './jobs.ts';
import { createWorkflowInstance } from './workflows/instances.ts';
import type { InventorySyncParams } from './workflows/inventory-sync.ts';

/** `last_error` of a sync that stayed `running` past `INVENTORY_RUN_STALE_MINUTES`. */
export const STALE_SYNC_ERROR = 'sync did not finish';
/** `last_error` of a claimed sync whose workflow instance id was already used. */
export const SYNC_ALREADY_RAN = 'This sync had already run; the next sync tries again.';

/**
 * Marks `running` syncs started at or before `?2` (or without a start time) as `error`; `?1` limits
 * this to one source, `NULL` settles every source.
 */
const SETTLE_SQL = `
	UPDATE inventory_sources SET status = 'error', last_error = '${STALE_SYNC_ERROR}'
	WHERE (?1 IS NULL OR source_id = ?1) AND status = 'running'
		AND (sync_started_at IS NULL OR sync_started_at <= ?2)
	RETURNING source_id`;

/**
 * Claims source `?1` for run `?2` at `?3` unless a sync is running (stale ones are settled first) or,
 * with `?4` = 1, its ESI data expires after `?3`.
 */
const CLAIM_SQL = `
	UPDATE inventory_sources SET status = 'running', run_id = ?2, sync_started_at = ?3, last_attempt_at = ?3
	WHERE source_id = ?1 AND status <> 'running'
		AND (?4 = 0 OR data_expires_at IS NULL OR data_expires_at <= ?3)
	RETURNING source_id`;

/**
 * Why a source was not claimed: `busy` (a sync is running), `missing`, or `{ notBefore }` = the
 * `data_expires_at` (unix ms) before which ESI has no newer data.
 */
export type InventoryClaimRefusal = 'busy' | 'missing' | { notBefore: number };

/** Ends run `?2` of source `?1` as `error` with message `?3`, unless it already ended or lost the source. */
const FAIL_SQL = `
	UPDATE inventory_sources SET status = 'error', last_error = ?3
	WHERE source_id = ?1 AND run_id = ?2 AND status = 'running'`;

/**
 * Marks every `running` sync that started more than `INVENTORY_RUN_STALE_MINUTES` ago as `error`
 * ("sync did not finish"); returns how many.
 */
export async function settleStaleInventorySyncs(env: Env, now: number): Promise<number> {
	const { results } = await env.DB.prepare(SETTLE_SQL)
		.bind(null, now - INVENTORY_RUN_STALE_MINUTES * 60_000)
		.all();
	return results.length;
}

/**
 * The one way a sync takes a source (RPC, cron pass and a workflow started without a claim): in one
 * transaction, a stale `running` row is marked `error` ("sync did not finish"), then the source becomes
 * `running` with `run_id`, `sync_started_at` and `last_attempt_at` = `now`, unless it is `running`
 * (started within `INVENTORY_RUN_STALE_MINUTES`) or, with `respectExpiry`, its `data_expires_at` (ESI
 * `Expires` of the last sync) is after `now`: ESI must not be asked again before then. `denied` sources
 * can be claimed (a user retrying after fixing access); the daily pass leaves them out itself.
 */
export async function claimInventorySource(
	env: Env,
	sourceId: number,
	runId: string,
	now: number,
	respectExpiry: boolean
): Promise<'claimed' | InventoryClaimRefusal> {
	const [, claimed, existing] = await env.DB.batch([
		env.DB.prepare(SETTLE_SQL).bind(sourceId, now - INVENTORY_RUN_STALE_MINUTES * 60_000),
		env.DB.prepare(CLAIM_SQL).bind(sourceId, runId, now, respectExpiry ? 1 : 0),
		env.DB.prepare('SELECT status, data_expires_at FROM inventory_sources WHERE source_id = ?').bind(sourceId)
	]);
	if (claimed!.results.length > 0) return 'claimed';
	const row = (existing!.results as { status: string; data_expires_at: number | null }[])[0];
	if (!row) return 'missing';
	if (row.status === 'running' || row.data_expires_at === null) return 'busy';
	return { notBefore: row.data_expires_at };
}

/**
 * Ends sync `runId` of a source as `error` with `message` while it still holds the source as `running`
 * (a released claim, a failed workflow); a sync that already recorded its outcome or was superseded is
 * left alone.
 */
export async function failInventorySync(
	env: Env,
	sourceId: number,
	runId: string,
	message: string
): Promise<void> {
	await env.DB.prepare(FAIL_SQL).bind(sourceId, runId, message).run();
}

/**
 * Claims the source (respecting its `data_expires_at`) and creates `InventorySyncWorkflow` instance
 * `instanceId`. `exists`: the instance id was used before (a daily id of a source synced today),
 * `missing`: no such source, `{ notBefore }`: ESI has no newer data before then. A claim whose instance
 * is not created is released as `error`; a failed create is rethrown afterwards.
 */
export async function startInventorySync(
	env: Env,
	sourceId: number,
	instanceId: string,
	trigger: InventorySyncParams['trigger'],
	now: number
): Promise<'started' | 'exists' | InventoryClaimRefusal> {
	const claim = await claimInventorySource(env, sourceId, instanceId, now, true);
	if (claim !== 'claimed') return claim;
	try {
		const instance = await createWorkflowInstance(env.INVENTORY_SYNC, instanceId, { sourceId, trigger });
		if (instance.created) return 'started';
		console.error(`[inventory] sync ${instanceId} already ran`);
		await failInventorySync(env, sourceId, instanceId, SYNC_ALREADY_RAN);
		return 'exists';
	} catch (error) {
		console.error(`[inventory] sync ${instanceId} not started: ${errorMessage(error)}`);
		await failInventorySync(env, sourceId, instanceId, ERROR_INTERNAL);
		throw error;
	}
}
