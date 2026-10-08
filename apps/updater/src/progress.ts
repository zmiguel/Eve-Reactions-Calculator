import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { getCoreDb, jobRuns } from '@reactions/db';
import { eq } from 'drizzle-orm';
import { errorMessage, summarize } from './jobs.ts';

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
		const result = await this.step.do(name, config, async () => {
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
				console.error(`[${this.runId}] step ${position + 1}${of} ${name}: failed: ${errorMessage(error)}`);
				throw error;
			}
		});
		this.done++;
		return result;
	}
}
