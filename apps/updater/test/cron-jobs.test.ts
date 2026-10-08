import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { startDaily } from '../src/cron/daily.ts';
import { startPriceRefresh } from '../src/cron/prices.ts';
import { finishJobRun, startJobRun } from '../src/jobs.ts';
import { completedInstanceCount, mockedDailyWorkflow, mockedPriceWorkflow, resetState } from './helpers.ts';

const MINUTE = 60_000;

async function jobRunIds(kind: string): Promise<string[]> {
	const { results } = await env.DB.prepare('SELECT run_id FROM job_runs WHERE kind = ? ORDER BY started_at')
		.bind(kind)
		.all<{ run_id: string }>();
	return results.map((r) => r.run_id);
}

describe('cron step 3: prices', () => {
	beforeEach(resetState);

	it('starts one run per 30-minute slot and none while a recent run exists', async () => {
		await using introspector = await mockedPriceWorkflow();
		const t0 = Date.UTC(2026, 10, 1, 12, 0);

		expect(await startPriceRefresh(env, t0)).toBe(`started prices-${t0}`);
		expect(await completedInstanceCount(introspector)).toBe(1);
		await finishJobRun(env, `prices-${t0}`, 'ok', {});
		expect(await startPriceRefresh(env, t0 + 10 * MINUTE)).toMatch(/^skipped \(prices-\d+ started /);
		expect(await startPriceRefresh(env, t0 + 20 * MINUTE)).toMatch(/^skipped/);
		expect(await jobRunIds('prices')).toEqual([`prices-${t0}`]);

		const t1 = t0 + 30 * MINUTE;
		expect(await startPriceRefresh(env, t1)).toBe(`started prices-${t1}`);
		expect(await completedInstanceCount(introspector)).toBe(2);
		expect(await jobRunIds('prices')).toEqual([`prices-${t0}`, `prices-${t1}`]);
	});

	/** A stand-in `PRICE_REFRESH` binding whose instances report the given states. */
	function fakeWorkflow(states: Record<string, string>) {
		const created: string[] = [];
		const terminated: string[] = [];
		const binding = {
			async get(id: string) {
				if (!(id in states)) throw new Error('instance.not_found');
				return {
					status: async () => ({ status: states[id] }),
					terminate: async () => {
						terminated.push(id);
						states[id] = 'terminated';
					}
				};
			},
			async create({ id }: { id: string }) {
				created.push(id);
				states[id] = 'queued';
				return { id };
			}
		} as unknown as Workflow;
		// Prototype lookup keeps every other binding of the real env.
		const testEnv = Object.create(env, { PRICE_REFRESH: { value: binding } }) as Env;
		return { testEnv, created, terminated };
	}

	async function jobRun(runId: string) {
		return env.DB.prepare('SELECT status, detail_json FROM job_runs WHERE run_id = ?')
			.bind(runId)
			.first<{ status: string; detail_json: string | null }>();
	}

	it('waits for a live run younger than 25 minutes', async () => {
		const t0 = Date.UTC(2026, 10, 2, 12, 0);
		const { testEnv, created } = fakeWorkflow({ 'prices-manual-1': 'running' });
		await startJobRun(env, 'prices-manual-1', 'prices', t0 - 20 * MINUTE);

		expect(await startPriceRefresh(testEnv, t0)).toBe('skipped (prices-manual-1 still running)');
		expect(created).toEqual([]);
		expect((await jobRun('prices-manual-1'))?.status).toBe('running');
	});

	it('terminates and fails a run still reported live after 25 minutes, then starts a new one', async () => {
		const t0 = Date.UTC(2026, 10, 2, 13, 0);
		// e.g. the process running the instance died (restarted `wrangler dev`)
		const { testEnv, created, terminated } = fakeWorkflow({ 'prices-old': 'running' });
		await startJobRun(env, 'prices-old', 'prices', t0 - 26 * MINUTE);

		expect(await startPriceRefresh(testEnv, t0)).toBe(`started prices-${t0}`);
		expect(terminated).toEqual(['prices-old']);
		expect(created).toEqual([`prices-${t0}`]);
		const old = await jobRun('prices-old');
		expect(old?.status).toBe('failed');
		expect(old?.detail_json).toContain('abandoned: still running after 25 minutes');
	});

	it.each([
		['errored', 'instance errored'],
		['terminated', 'instance terminated']
	])('fails a running row whose instance %s at once and starts a new run', async (state, reason) => {
		const t0 = Date.UTC(2026, 10, 2, 14, 0);
		const { testEnv, created } = fakeWorkflow({ 'prices-dead': state });
		await startJobRun(env, 'prices-dead', 'prices', t0 - 5 * MINUTE);

		expect(await startPriceRefresh(testEnv, t0)).toBe(`started prices-${t0}`);
		expect(created).toEqual([`prices-${t0}`]);
		expect((await jobRun('prices-dead'))?.detail_json).toContain(reason);
	});

	it('fails a running row whose instance no longer exists (e.g. local state reset)', async () => {
		const t0 = Date.UTC(2026, 10, 2, 15, 0);
		const { testEnv, created } = fakeWorkflow({});
		await startJobRun(env, 'prices-gone', 'prices', t0 - 5 * MINUTE);

		expect(await startPriceRefresh(testEnv, t0)).toBe(`started prices-${t0}`);
		expect(created).toEqual([`prices-${t0}`]);
		expect(await jobRun('prices-gone')).toMatchObject({ status: 'failed' });
	});

	it('records a completed instance whose row stayed running as partial and respects the interval', async () => {
		const t0 = Date.UTC(2026, 10, 2, 16, 0);
		const { testEnv, created } = fakeWorkflow({ 'prices-done': 'complete' });
		await startJobRun(env, 'prices-done', 'prices', t0 - 5 * MINUTE);

		expect(await startPriceRefresh(testEnv, t0)).toMatch(/^skipped \(prices-done started /);
		expect(created).toEqual([]);
		expect((await jobRun('prices-done'))?.status).toBe('partial');
	});

	it('retries in the same slot after a failed run with a distinct instance id', async () => {
		const slot = Date.UTC(2026, 10, 2, 17, 0);
		const { testEnv, created } = fakeWorkflow({ [`prices-${slot}`]: 'errored' });
		await startJobRun(env, `prices-${slot}`, 'prices', slot);
		await finishJobRun(env, `prices-${slot}`, 'failed', { error: 'boom' });

		const now = slot + 10 * MINUTE;
		expect(await startPriceRefresh(testEnv, now)).toBe(`started prices-${slot}-retry-${now}`);
		expect(created).toEqual([`prices-${slot}-retry-${now}`]);
	});

	it('ignores an instance id that already exists', async () => {
		await using introspector = await mockedPriceWorkflow();
		const t0 = Date.UTC(2026, 10, 3, 12, 0);
		await env.PRICE_REFRESH.create({ id: `prices-${t0}`, params: {} });
		expect(await completedInstanceCount(introspector)).toBe(1);
		// The instance exists but its `job_runs` row is gone (e.g. lost write): no second instance.
		await env.DB.prepare('DELETE FROM job_runs').run();

		expect(await startPriceRefresh(env, t0 + 5 * MINUTE)).toBe(`prices-${t0} already exists`);
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect(await jobRunIds('prices')).toEqual([`prices-${t0}`]);
	});
});

describe('cron step 5: daily', () => {
	beforeEach(resetState);

	it('starts daily-<today> only from 11:20 UTC, after the first SDE import, and once per day', async () => {
		await using introspector = await mockedDailyWorkflow();

		// A fresh deploy has nothing to track before the SDE import: the run waits for it.
		expect(await startDaily(env, Date.UTC(2026, 10, 6, 11, 20))).toBe('skipped (no SDE imported yet)');
		expect(await jobRunIds('daily')).toEqual([]);
		await env.DB.prepare(`INSERT INTO sde_state VALUES (1, 3421648, '2026-01-01', 1, '{}', '[]')`).run();

		expect(await startDaily(env, Date.UTC(2026, 10, 6, 11, 10))).toBe('skipped (before 11:20 UTC)');
		expect(await startDaily(env, Date.UTC(2026, 10, 6, 11, 20))).toBe('started daily-2026-11-06');
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect(await startDaily(env, Date.UTC(2026, 10, 6, 11, 30))).toMatch(/^skipped \(daily-2026-11-06 /);
		expect(await startDaily(env, Date.UTC(2026, 10, 6, 23, 50))).toMatch(/^skipped/);
		expect(await startDaily(env, Date.UTC(2026, 10, 7, 11, 0))).toBe('skipped (before 11:20 UTC)');
		expect(await startDaily(env, Date.UTC(2026, 10, 7, 11, 20))).toBe('started daily-2026-11-07');

		expect(await completedInstanceCount(introspector)).toBe(2);
		expect(await jobRunIds('daily')).toEqual(['daily-2026-11-06', 'daily-2026-11-07']);
	});
});
