import { failJobRun, startJobRun } from '../jobs.ts';
import type { JobKind } from '../jobs.ts';

/**
 * Creates a workflow instance. Workflows reject a reused instance id; that is reported as
 * `created: false` (the run was already started), every other error is rethrown.
 */
export async function createWorkflowInstance<P>(
	workflow: Workflow<P>,
	id: string,
	params: P
): Promise<{ id: string; created: boolean }> {
	try {
		await workflow.create({ id, params });
		return { id, created: true };
	} catch (error) {
		if (error instanceof Error && /already exists|already_exists|duplicate/i.test(error.message))
			return { id, created: false };
		throw error;
	}
}

/**
 * Records the `running` `job_runs` row (started at `now`) and then creates the instance, so the
 * row exists before the workflow's own (no-op) insert. A failed create marks the row `failed`.
 */
export async function startWorkflowRun<P>(
	env: Env,
	workflow: Workflow<P>,
	id: string,
	kind: JobKind,
	params: P,
	now: number
): Promise<{ id: string; created: boolean }> {
	await startJobRun(env, id, kind, now);
	try {
		return await createWorkflowInstance(workflow, id, params);
	} catch (error) {
		await failJobRun(env, id, kind, now, error);
		throw error;
	}
}
