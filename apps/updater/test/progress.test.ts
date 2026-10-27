import type { WorkflowStep } from 'cloudflare:workers';
import { env } from 'cloudflare:workers';
import { EsiDowntimeError } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESI_DOWNTIME_MAX_WAITS, ESI_DOWNTIME_WAIT, STEP_CONFIG } from '../src/config.ts';
import { finishJobRun, startJobRun } from '../src/jobs.ts';
import { StepTracker } from '../src/progress.ts';
import { resetState } from './helpers.ts';

/**
 * A workflow step stand-in: runs a body once per name and replays the stored result afterwards;
 * records the step names it was asked for and the sleeps.
 */
function fakeStep(cache = new Map<string, unknown>()) {
	const names: string[] = [];
	const sleeps: [name: string, duration: unknown][] = [];
	return {
		cache,
		names,
		sleeps,
		step: {
			do: async (name: string, _config: unknown, body: () => Promise<unknown>) => {
				names.push(name);
				if (cache.has(name)) return cache.get(name);
				const value = await body();
				cache.set(name, value);
				return value;
			},
			sleep: async (name: string, duration: unknown) => {
				sleeps.push([name, duration]);
			}
		} as unknown as WorkflowStep
	};
}

async function progressOf(runId: string) {
	const row = await env.DB.prepare('SELECT progress_json, progress_at FROM job_runs WHERE run_id = ?')
		.bind(runId)
		.first<{ progress_json: string | null; progress_at: number | null }>();
	return {
		progress: row?.progress_json ? JSON.parse(row.progress_json) : null,
		at: row?.progress_at ?? null
	};
}

describe('StepTracker', () => {
	beforeEach(resetState);
	afterEach(() => vi.restoreAllMocks());

	it('records the step in progress with its position and logs start and end of each body', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await startJobRun(env, 'prices-1', 'prices', 1);
		let now = 1000;
		const { step } = fakeStep();
		const tracker = new StepTracker(env, step, 'prices-1', () => now);

		await tracker.do('plan', STEP_CONFIG, async () => {
			expect(await progressOf('prices-1')).toEqual({
				progress: { step: 'plan', done: 0, total: null },
				at: 1000
			});
			now += 2500;
			return { regions: 2 };
		});
		tracker.total = 3;
		now = 5000;
		await tracker.do('region-10000002', STEP_CONFIG, async () => 7);

		expect(await progressOf('prices-1')).toEqual({
			progress: { step: 'region-10000002', done: 1, total: 3 },
			at: 5000
		});
		const lines = log.mock.calls.map((c) => c.join(' '));
		expect(lines).toContain('[prices-1] step 1 plan: started');
		expect(lines).toContain('[prices-1] step 1 plan: done in 2.5s {"regions":2}');
		expect(lines).toContain('[prices-1] step 2/3 region-10000002: started');
	});

	it('replayed steps are counted but neither logged nor written again', async () => {
		await startJobRun(env, 'daily-1', 'daily', 1);
		const { step, cache } = fakeStep();
		const first = new StepTracker(env, step, 'daily-1', () => 100);
		await first.do('plan', STEP_CONFIG, async () => 1);
		first.total = 2;
		await first.do('history-1', STEP_CONFIG, async () => 2);

		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const replay = new StepTracker(env, fakeStep(cache).step, 'daily-1', () => 900);
		await replay.do('plan', STEP_CONFIG, async () => 1);
		replay.total = 2;
		await replay.do('history-1', STEP_CONFIG, async () => 2);
		expect(log).not.toHaveBeenCalled();
		expect(await progressOf('daily-1')).toEqual({
			progress: { step: 'history-1', done: 1, total: 2 },
			at: 100
		});
	});

	it('logs a failing body as an error and keeps the failed step as the last progress', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await startJobRun(env, 'sde-1', 'sde', 1);
		const tracker = new StepTracker(env, fakeStep().step, 'sde-1', () => 50);
		tracker.total = 4;
		await expect(
			tracker.do('download-parse', STEP_CONFIG, async () => {
				throw new Error('zip broken');
			})
		).rejects.toThrow('zip broken');
		expect(error.mock.calls.map((c) => c.join(' '))).toContain(
			'[sde-1] step 1/4 download-parse: failed: Error: zip broken'
		);
		expect((await progressOf('sde-1')).progress).toEqual({ step: 'download-parse', done: 0, total: 4 });
	});
});

describe('StepTracker during the ESI downtime', () => {
	beforeEach(async () => {
		await resetState();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	/** A body that hits the downtime `times` times, then returns `value`. */
	function downtimeThen<T>(times: number, value: T) {
		let calls = 0;
		return vi.fn(async () => {
			if (calls++ < times) throw new EsiDowntimeError();
			return value;
		});
	}

	it('sleeps and runs the body again as new steps until ESI is back', async () => {
		await startJobRun(env, 'prices-2', 'prices', 1);
		const fake = fakeStep();
		const tracker = new StepTracker(env, fake.step, 'prices-2', () => 10);
		const body = downtimeThen(2, { esi: 10 });

		expect(await tracker.do('region-10000002', STEP_CONFIG, body)).toEqual({ esi: 10 });
		await tracker.do('publish', STEP_CONFIG, async () => {
			expect((await progressOf('prices-2')).progress).toMatchObject({ step: 'publish', done: 1 });
			return 0;
		});

		expect(body).toHaveBeenCalledTimes(3);
		expect(fake.names).toEqual([
			'region-10000002',
			'region-10000002 (after ESI downtime 1)',
			'region-10000002 (after ESI downtime 2)',
			'publish'
		]);
		expect(fake.sleeps).toEqual([
			['region-10000002 (ESI downtime wait 1)', ESI_DOWNTIME_WAIT],
			['region-10000002 (ESI downtime wait 2)', ESI_DOWNTIME_WAIT]
		]);

		// A replay walks the same step names and gets the stored value without running the body.
		const replay = fakeStep(fake.cache);
		const replayed = vi.fn(async () => ({ esi: 0 }));
		expect(
			await new StepTracker(env, replay.step, 'prices-2').do('region-10000002', STEP_CONFIG, replayed)
		).toEqual({
			esi: 10
		});
		expect(replayed).not.toHaveBeenCalled();
		expect(replay.names).toEqual(fake.names.slice(0, 3));
	});

	it('fails the step once ESI stays down through every wait', async () => {
		await startJobRun(env, 'daily-2', 'daily', 1);
		const fake = fakeStep();
		const tracker = new StepTracker(env, fake.step, 'daily-2');

		await expect(tracker.do('history-1', STEP_CONFIG, downtimeThen(Infinity, 0))).rejects.toBeInstanceOf(
			EsiDowntimeError
		);
		expect(fake.sleeps).toHaveLength(ESI_DOWNTIME_MAX_WAITS);
	});

	it('still throws other errors without waiting', async () => {
		await startJobRun(env, 'daily-3', 'daily', 1);
		const fake = fakeStep();
		const tracker = new StepTracker(env, fake.step, 'daily-3');

		await expect(
			tracker.do('history-1', STEP_CONFIG, async () => {
				throw new Error('D1 unavailable');
			})
		).rejects.toThrow('D1 unavailable');
		expect(fake.sleeps).toEqual([]);
	});
});

describe('job log lines', () => {
	beforeEach(resetState);
	afterEach(() => vi.restoreAllMocks());

	it('logs a run once when it starts, with how it was triggered, and its end with the duration', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await startJobRun(env, 'history-backfill-manual-1000', 'history', 1000);
		await startJobRun(env, 'history-backfill-manual-1000', 'history', 1000);
		await finishJobRun(env, 'history-backfill-manual-1000', 'ok', { rows: 5 }, 4000);
		expect(log.mock.calls.map((c) => c.join(' '))).toEqual([
			'[job] history-backfill-manual-1000 started (history, manual)',
			'[job] history-backfill-manual-1000 ok after 3.0s: {"rows":5}'
		]);
	});
});
