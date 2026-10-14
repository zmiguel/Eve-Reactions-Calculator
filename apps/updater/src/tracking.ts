import { ERROR_INTERNAL } from '@reactions/eve';
import { TRACKING_RUN_STALE_MINUTES } from './config.ts';
import { errorMessage } from './jobs.ts';
import { createWorkflowInstance } from './workflows/instances.ts';
import type { TrackingSyncParams } from './workflows/tracking-sync.ts';

/** `tracking_last_error` of a sync that stayed `running` past `TRACKING_RUN_STALE_MINUTES`. */
export const STALE_TRACKING_ERROR = 'sync did not finish';
/** `tracking_last_error` of a claimed sync whose workflow instance id was already used. */
export const TRACKING_ALREADY_RAN = 'This sync had already run; the next sync tries again.';

/** Every wallet division of a corporation. */
const ALL_DIVISIONS = [1, 2, 3, 4, 5, 6, 7];

/**
 * The corporation wallet divisions a connection counts: `wallet_divisions_json` (`[1,3]`), null or
 * unreadable = every division.
 */
export function walletDivisions(json: string | null): number[] {
	if (json === null) return ALL_DIVISIONS;
	try {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed)) return ALL_DIVISIONS;
		return ALL_DIVISIONS.filter((d) => parsed.includes(d));
	} catch {
		return ALL_DIVISIONS;
	}
}

/**
 * Stream names of a connection: personal `jobs`, `transactions`, `journal`, `orders`, `contracts`;
 * corporation `jobs`, `orders`, `contracts` plus `transactions:<n>` and `journal:<n>` per counted wallet
 * division n. Not listed: `blueprints`, read only while manufacturing jobs wait for their blueprint's
 * ME (`prepareTrackingSync`); it never makes a connection due on its own.
 */
export function trackingStreamNames(kind: string, walletDivisionsJson: string | null): string[] {
	if (kind !== 'corporation') return ['jobs', 'transactions', 'journal', 'orders', 'contracts'];
	const names = ['jobs', 'orders', 'contracts'];
	for (const n of walletDivisions(walletDivisionsJson)) names.push(`transactions:${n}`, `journal:${n}`);
	return names;
}

/** A stored stream's freshness (`tracking_streams` columns). */
interface StreamExpiry {
	stream: string;
	expires_at: number | null;
}

/**
 * The streams of `names` to fetch at `now`: missing ones and those whose `expires_at` is null or
 * ≤ `now`. `notBefore` = the earliest `expires_at` when none is due.
 */
export function dueStreams(
	names: string[],
	stored: StreamExpiry[],
	now: number
): { due: string[]; notBefore: number | null } {
	const byName = new Map(stored.map((s) => [s.stream, s.expires_at]));
	const due: string[] = [];
	let notBefore: number | null = null;
	for (const name of names) {
		const expiresAt = byName.get(name);
		if (expiresAt == null || expiresAt <= now) due.push(name);
		else notBefore = notBefore === null ? expiresAt : Math.min(notBefore, expiresAt);
	}
	return { due, notBefore: due.length > 0 ? null : notBefore };
}

/**
 * Marks `running` tracking syncs started at or before `?2` (or without a start time) as `error`; `?1`
 * limits this to one connection, `NULL` settles every connection.
 */
const SETTLE_SQL = `
	UPDATE inventory_sources SET tracking_status = 'error', tracking_last_error = '${STALE_TRACKING_ERROR}'
	WHERE (?1 IS NULL OR source_id = ?1) AND tracking_status = 'running'
		AND (tracking_started_at IS NULL OR tracking_started_at <= ?2)
	RETURNING source_id`;

/** Claims connection `?1` for run `?2` at `?3` unless a tracking sync is running or tracking is off. */
const CLAIM_SQL = `
	UPDATE inventory_sources SET tracking_status = 'running', tracking_run_id = ?2, tracking_started_at = ?3,
		tracking_last_attempt_at = ?3
	WHERE source_id = ?1 AND tracking_enabled = 1 AND tracking_status IS NOT 'running'
	RETURNING source_id`;

/** Ends run `?2` of connection `?1` as `error` with message `?3`, unless it already ended or lost the connection. */
const FAIL_SQL = `
	UPDATE inventory_sources SET tracking_status = 'error', tracking_last_error = ?3
	WHERE source_id = ?1 AND tracking_run_id = ?2 AND tracking_status = 'running'`;

/**
 * Why a connection was not claimed: `busy` (a sync is running), `missing` (no such connection or
 * tracking is off), or `{ notBefore }` = the earliest stream `expires_at` (unix ms) while every stream
 * is still fresh.
 */
export type TrackingClaimRefusal = 'busy' | 'missing' | { notBefore: number };

/** Marks every tracking sync `running` for more than `TRACKING_RUN_STALE_MINUTES` as `error`; returns how many. */
export async function settleStaleTrackingSyncs(env: Env, now: number): Promise<number> {
	const { results } = await env.DB.prepare(SETTLE_SQL)
		.bind(null, now - TRACKING_RUN_STALE_MINUTES * 60_000)
		.all();
	return results.length;
}

/**
 * Takes a tracking connection for run `runId`: a stale `running` sync is settled first, then the
 * connection becomes `running` (`tracking_run_id`, `tracking_started_at`, `tracking_last_attempt_at` =
 * `now`) unless a sync is running, tracking is off, or, with `respectExpiry`, every stream's `expires_at`
 * is after `now` (ESI must not be asked again before then).
 */
export async function claimTrackingSource(
	env: Env,
	sourceId: number,
	runId: string,
	now: number,
	respectExpiry: boolean
): Promise<'claimed' | TrackingClaimRefusal> {
	const [, existing, streams] = await env.DB.batch([
		env.DB.prepare(SETTLE_SQL).bind(sourceId, now - TRACKING_RUN_STALE_MINUTES * 60_000),
		env.DB.prepare(
			'SELECT kind, tracking_enabled, tracking_status, wallet_divisions_json FROM inventory_sources WHERE source_id = ?'
		).bind(sourceId),
		env.DB.prepare('SELECT stream, expires_at FROM tracking_streams WHERE source_id = ?').bind(sourceId)
	]);
	const row = (
		existing!.results as {
			kind: string;
			tracking_enabled: number;
			tracking_status: string | null;
			wallet_divisions_json: string | null;
		}[]
	)[0];
	if (!row || !row.tracking_enabled) return 'missing';
	if (row.tracking_status === 'running') return 'busy';
	if (respectExpiry) {
		const names = trackingStreamNames(row.kind, row.wallet_divisions_json);
		const { notBefore } = dueStreams(names, streams!.results as StreamExpiry[], now);
		if (notBefore !== null) return { notBefore };
	}
	const claimed = await env.DB.prepare(CLAIM_SQL).bind(sourceId, runId, now).all();
	return claimed.results.length > 0 ? 'claimed' : 'busy';
}

/** Ends tracking sync `runId` as `error` with `message` while it still holds the connection as `running`. */
export async function failTrackingSync(
	env: Env,
	sourceId: number,
	runId: string,
	message: string
): Promise<void> {
	await env.DB.prepare(FAIL_SQL).bind(sourceId, runId, message).run();
}

/**
 * Claims the connection (respecting its streams' `expires_at`) and creates `TrackingSyncWorkflow`
 * instance `instanceId`. `exists`: the instance id was used before; `missing`: no such connection or
 * tracking is off; `{ notBefore }`: every stream is still fresh. A claim whose instance is not created is
 * released as `error`; a failed create is rethrown afterwards.
 */
export async function startTrackingSync(
	env: Env,
	sourceId: number,
	instanceId: string,
	trigger: TrackingSyncParams['trigger'],
	now: number
): Promise<'started' | 'exists' | TrackingClaimRefusal> {
	const claim = await claimTrackingSource(env, sourceId, instanceId, now, true);
	if (claim !== 'claimed') return claim;
	try {
		const instance = await createWorkflowInstance(env.TRACKING_SYNC, instanceId, { sourceId, trigger });
		if (instance.created) return 'started';
		console.error(`[tracking] sync ${instanceId} already ran`);
		await failTrackingSync(env, sourceId, instanceId, TRACKING_ALREADY_RAN);
		return 'exists';
	} catch (error) {
		console.error(`[tracking] sync ${instanceId} not started: ${errorMessage(error)}`);
		await failTrackingSync(env, sourceId, instanceId, ERROR_INTERNAL);
		throw error;
	}
}
