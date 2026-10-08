import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { failJobRun, finishJobRun, latestJobRuns, startJobRun } from '../src/jobs.ts';
import { resetState } from './helpers.ts';

async function row(runId: string) {
	return env.DB.prepare(
		'SELECT kind, status, started_at, finished_at, detail_json FROM job_runs WHERE run_id = ?'
	)
		.bind(runId)
		.first();
}

describe('job_runs helpers', () => {
	beforeEach(resetState);

	it('starts once per run id and finishes with status and detail', async () => {
		await startJobRun(env, 'sde-1', 'sde', 100);
		await startJobRun(env, 'sde-1', 'sde', 999);
		expect(await row('sde-1')).toEqual({
			kind: 'sde',
			status: 'running',
			started_at: 100,
			finished_at: null,
			detail_json: null
		});

		await finishJobRun(env, 'sde-1', 'ok', { reactions: 119 }, 200);
		expect(await row('sde-1')).toEqual({
			kind: 'sde',
			status: 'ok',
			started_at: 100,
			finished_at: 200,
			detail_json: '{"reactions":119}'
		});
	});

	it('fails a run that never started by creating it', async () => {
		await failJobRun(env, 'cost_indices-5', 'cost_indices', 5, new TypeError('boom'));

		expect(await row('cost_indices-5')).toMatchObject({
			kind: 'cost_indices',
			status: 'failed',
			started_at: 5,
			detail_json: '{"error":"TypeError: boom"}'
		});
	});

	it('lists the most recent run of every kind', async () => {
		await startJobRun(env, 'sde-old', 'sde', 1);
		await startJobRun(env, 'sde-new', 'sde', 3);
		await startJobRun(env, 'cost_indices-2', 'cost_indices', 2);
		await startJobRun(env, 'cost_indices-1', 'cost_indices', 1);

		const latest = await latestJobRuns(env);

		expect(latest.map((r) => [r.kind, r.runId])).toEqual([
			['cost_indices', 'cost_indices-2'],
			['sde', 'sde-new']
		]);
	});
});
