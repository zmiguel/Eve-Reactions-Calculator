import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import {
	completedInstanceCount,
	installFetch,
	json,
	mockedDailyWorkflow,
	mockedPriceWorkflow,
	mockedSdeWorkflow,
	resetState,
	sdeLatest,
	seedTrackedReaction
} from './helpers.ts';

const CRON = '*/10 * * * *';

/** Runs the cron; `log`/`error` hold the cron's own `[scheduled]` lines, `all` every log line. */
async function runCron(scheduledTime: number) {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	await worker.scheduled(createScheduledController({ cron: CRON, scheduledTime }), env);
	const lines = (calls: unknown[][]) => calls.map((args) => args.join(' '));
	const own = (l: string) => l.startsWith('[scheduled]');
	return {
		log: lines(log.mock.calls).filter(own),
		error: lines(error.mock.calls).filter(own),
		all: [...lines(log.mock.calls), ...lines(error.mock.calls)]
	};
}

/** An SDE import has happened (the daily job waits for the first one). */
const importedBuild = (build: number) =>
	env.DB.prepare(`INSERT INTO sde_state VALUES (1, ?, '2026-01-01', 1, '{}', '[]')`).bind(build).run();

describe('scheduled', () => {
	beforeEach(resetState);
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('runs every step and logs one line per step', async () => {
		await seedTrackedReaction();
		await importedBuild(6000);
		await using introspector = await mockedSdeWorkflow();
		await using prices = await mockedPriceWorkflow();
		await using daily = await mockedDailyWorkflow();
		const calls = installFetch((url) => {
			if (url.pathname === '/markets/prices') return json([{ type_id: 4312, adjusted_price: 1200 }]);
			if (url.pathname === '/industry/systems')
				return json([
					{ solar_system_id: 30002647, cost_indices: [{ activity: 'reaction', cost_index: 0.04 }] }
				]);
			return sdeLatest(7000);
		});

		const at = Date.UTC(2026, 9, 6, 12, 0);
		const { log, error, all } = await runCron(at);

		expect(error).toEqual([]);
		expect(log).toHaveLength(6);
		expect(log[0]).toContain(CRON);
		// The job lifecycle is logged too: each run's start with how it was triggered.
		expect(all).toContain(`[job] prices-${at} started (prices, cron)`);
		expect(all).toContain('[job] daily-2026-10-06 started (daily, cron)');
		expect(log[1]).toMatch(/^\[scheduled\] adjusted-prices: 1 adjusted prices written/);
		expect(log[2]).toMatch(/^\[scheduled\] cost-indices: 1 systems written/);
		expect(log[3]).toBe(`[scheduled] prices: started prices-${at}`);
		expect(log[4]).toMatch(/^\[scheduled\] sde-check: build 7000 is new .* started sde-7000$/);
		expect(log[5]).toBe('[scheduled] daily: started daily-2026-10-06');
		expect(calls).toHaveLength(3);
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect(await completedInstanceCount(prices)).toBe(1);
		expect(await completedInstanceCount(daily)).toBe(1);
	});

	it('isolates a failing step and skips the SDE check outside minutes 0–9', async () => {
		await importedBuild(6000);
		await using prices = await mockedPriceWorkflow();
		await using daily = await mockedDailyWorkflow();
		const calls = installFetch((url) =>
			url.pathname === '/markets/prices'
				? json({ error: 'nope' }, {}, 400)
				: json([{ solar_system_id: 30002647, cost_indices: [{ activity: 'reaction', cost_index: 0.04 }] }])
		);

		const at = Date.UTC(2026, 9, 6, 12, 30);
		const { log, error } = await runCron(at);

		expect(error).toHaveLength(1);
		expect(error[0]).toMatch(/^\[scheduled\] adjusted-prices: failed — .*400/);
		expect(log.slice(1)).toEqual([
			expect.stringMatching(/^\[scheduled\] cost-indices: 1 systems written/),
			`[scheduled] prices: started prices-${at}`,
			'[scheduled] sde-check: skipped (checked hourly)',
			'[scheduled] daily: started daily-2026-10-06'
		]);
		expect(await completedInstanceCount(prices)).toBe(1);
		expect(await completedInstanceCount(daily)).toBe(1);
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/markets/prices', '/industry/systems']);
		const costIndex = await env.DB.prepare(
			'SELECT reaction FROM cost_indices WHERE system_id = 30002647'
		).first();
		expect(costIndex).toEqual({ reaction: 0.04 });
	});
});
