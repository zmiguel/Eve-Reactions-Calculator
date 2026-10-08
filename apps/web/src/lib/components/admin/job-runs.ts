import type { JobDefinition } from '$lib/admin/jobs';

export interface JobRunView {
	runId: string;
	kind: string;
	status: string;
	startedAt: number;
	finishedAt: number | null;
	detailJson: string | null;
	/** `{ step, done, total }` of the workflow step in progress (kept after the run ends). */
	progressJson: string | null;
	/** When that step started (unix ms). */
	progressAt: number | null;
	/** Live workflow instance status, asked for running workflow rows only. */
	workflow: { status: string; error: string | null } | null;
}

/** A registry job with its recent runs, newest `started_at` first (the first is its latest run). */
export interface JobView extends JobDefinition {
	runs: JobRunView[];
}

export interface JobProgress {
	step: string;
	/** Steps finished before `step`. */
	done: number;
	/** All steps of the run; `null` until the plan step has finished. */
	total: number | null;
}

export const STATUS_CLASSES: Record<string, string> = {
	ok: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
	partial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
	failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
	running: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300'
};

/** A step may legitimately take ~10 min per attempt; no sign of life for longer than this is suspicious. */
export const STUCK_AFTER_MS = 15 * 60_000;

/** Workflow statuses that mean the instance no longer runs (or is gone) although the row says `running`. */
export const ENDED_WORKFLOW: Record<string, true> = {
	errored: true,
	terminated: true,
	complete: true,
	unknown: true
};

/** Live statuses not worth a line: the row already says it is running. */
export const QUIET_WORKFLOW: Record<string, true> = { running: true, queued: true };

/** How a run was started, from its id: `-manual-` = admin/RPC, `-retry-` = automatic retry, else cron. */
export function triggerOf(runId: string): 'manual' | 'retry' | 'cron' {
	if (runId.includes('-manual-')) return 'manual';
	if (runId.includes('-retry-')) return 'retry';
	return 'cron';
}

/** `progress_json`, or `null` when absent or not `{ step, done, total }`. */
export function parseProgress(json: string | null): JobProgress | null {
	if (!json) return null;
	try {
		const p: unknown = JSON.parse(json);
		if (
			p &&
			typeof p === 'object' &&
			'step' in p &&
			typeof p.step === 'string' &&
			'done' in p &&
			typeof p.done === 'number' &&
			'total' in p &&
			(p.total === null || typeof p.total === 'number')
		)
			return { step: p.step, done: p.done, total: p.total };
	} catch {
		// not JSON: no progress to show
	}
	return null;
}

/**
 * A running row with no sign of life (`progress_at`, else `started_at`) for `STUCK_AFTER_MS`, or whose
 * workflow instance has ended or cannot be found.
 */
export function isPossiblyStuck(run: JobRunView, now: number): boolean {
	if (run.status !== 'running') return false;
	if (run.workflow && ENDED_WORKFLOW[run.workflow.status]) return true;
	return now - (run.progressAt ?? run.startedAt) > STUCK_AFTER_MS;
}

/** One-line summary of `detail_json`: the error, else its scalar fields except status/timestamps. */
export function summarizeDetail(json: string | null): string {
	if (!json) return '';
	let detail: unknown;
	try {
		detail = JSON.parse(json);
	} catch {
		return json;
	}
	if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return String(detail);
	if ('error' in detail && typeof detail.error === 'string') return detail.error;
	return Object.entries(detail)
		.filter(
			([key, value]) =>
				key !== 'status' && !key.endsWith('At') && ['string', 'number', 'boolean'].includes(typeof value)
		)
		.map(([key, value]) => `${key}: ${typeof value === 'number' ? value.toLocaleString('en-US') : value}`)
		.join(' · ');
}
