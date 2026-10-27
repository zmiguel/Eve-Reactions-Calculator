import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getCoreDb, jobRuns } from '@reactions/db';
import { EsiDowntimeError, isEsiDowntime } from '@reactions/eve';
import { eq } from 'drizzle-orm';
import { ESI_DOWNTIME_MAX_WAITS, ESI_DOWNTIME_WAIT } from './config.ts';
import { errorMessage, summarize } from './jobs.ts';

/**
 * Step output of a body stopped by ESI's daily downtime. Returned instead of thrown so the wait does
 * not use up the step's retries; only `StepTracker` ever sees it.
 */
interface DowntimeWait {
	__esiDowntime: true;
}

function isDowntimeWait(value: unknown): value is DowntimeWait {
	return (
		typeof value === 'object' && value !== null && '__esiDowntime' in value && value.__esiDowntime === true
	);
}

/** `job_runs.progress_json` of a running workflow: the step in progress and how far the run got. */
export interface StepProgress {
	step: string;
	/** Steps finished before this one. */
	done: number;
	/** All steps of the run, once the plan is known. */
	total: number | null;
}

/**
 * Runs workflow steps while recording progress: when a step body starts (also on a retry) it writes
 * `progress_json`/`progress_at` of the run and logs `[<runId>] step n/total <name>`, and when it ends it
 * logs the duration and a summary of its result (or the error). Replayed steps (already done) skip
 * their body, so they neither log nor write again; `done` still counts them.
 *
 * A body stopped by ESI's daily downtime (`EsiDowntimeError`) ends its step with a wait marker; the
 * tracker then sleeps `ESI_DOWNTIME_WAIT` and runs the body again as `<name> (after ESI downtime <i>)`,
 * up to `ESI_DOWNTIME_MAX_WAITS` times. Other results are stored unchanged, so instances started
 * before this existed replay as before.
 */
export class StepTracker {
	private readonly env: Env;
	private readonly step: WorkflowStep;
	private readonly runId: string;
	private readonly now: () => number;
	private done = 0;
	/** All steps of the run; set once the plan is known. */
	total: number | null = null;

	constructor(env: Env, step: WorkflowStep, runId: string, now: () => number = Date.now) {
		this.env = env;
		this.step = step;
		this.runId = runId;
		this.now = now;
	}

	async do<T extends Rpc.Serializable<T>>(
		name: string,
		config: WorkflowStepConfig,
		body: () => Promise<T>
	): Promise<T> {
		const position = this.done;
		let result = await this.step.do(name, config, () => this.run(name, position, body));
		for (let wait = 1; isDowntimeWait(result); wait++) {
			if (wait > ESI_DOWNTIME_MAX_WAITS)
				throw new EsiDowntimeError(
					`ESI was still in its daily downtime after ${ESI_DOWNTIME_MAX_WAITS} waits`
				);
			await this.step.sleep(`${name} (ESI downtime wait ${wait})`, ESI_DOWNTIME_WAIT);
			const again = `${name} (after ESI downtime ${wait})`;
			result = await this.step.do(again, config, () => this.run(again, position, body));
		}
		this.done++;
		return result;
	}

	private async run<T>(name: string, position: number, body: () => Promise<T>): Promise<T | DowntimeWait> {
		const progress: StepProgress = { step: name, done: position, total: this.total };
		const startedAt = this.now();
		await getCoreDb(this.env.DB)
			.update(jobRuns)
			.set({ progressJson: JSON.stringify(progress), progressAt: startedAt })
			.where(eq(jobRuns.runId, this.runId));
		const of = this.total === null ? '' : `/${this.total}`;
		console.log(`[${this.runId}] step ${position + 1}${of} ${name}: started`);
		try {
			const value = await body();
			const seconds = ((this.now() - startedAt) / 1000).toFixed(1);
			console.log(
				`[${this.runId}] step ${position + 1}${of} ${name}: done in ${seconds}s ${summarize(value)}`
			);
			return value;
		} catch (error) {
			if (isEsiDowntime(error)) {
				console.log(`[${this.runId}] step ${position + 1}${of} ${name}: waiting for ESI (daily downtime)`);
				return { __esiDowntime: true };
			}
			console.error(`[${this.runId}] step ${position + 1}${of} ${name}: failed: ${errorMessage(error)}`);
			throw error;
		}
	}
}
