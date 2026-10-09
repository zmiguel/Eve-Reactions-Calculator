import { createExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { MARKET_KV_KEY } from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INDUSTRY_SYSTEMS_URL } from '../src/cron/cost-indices.ts';
import { NO_NEW_DATA, startJobRun } from '../src/jobs.ts';
import { UpdaterRpc } from '../src/rpc.ts';
import {
	cacheHeaders,
	completedInstanceCount,
	installFetch,
	json,
	mockedDailyWorkflow,
	mockedPriceWorkflow,
	mockedSdeWorkflow,
	notModified,
	resetState,
	sdeLatest,
	seedTrackedReaction
} from './helpers.ts';

const HOUR = 3_600_000;

async function jobRow(runId: string) {
	return env.DB.prepare('SELECT kind, status, detail_json FROM job_runs WHERE run_id = ?')
		.bind(runId)
		.first<{ kind: string; status: string; detail_json: string }>();
}

/** A fresh cached `/industry/systems` response with ETag `"v1"`, as left by the last cron tick. */
async function freshCostIndicesCache() {
	await env.DB.prepare('INSERT INTO http_cache (url, etag, expires_at, updated_at) VALUES (?, ?, ?, ?)')
		.bind(INDUSTRY_SYSTEMS_URL, '"v1"', Date.now() + HOUR, Date.now())
		.run();
}

describe('UpdaterRpc', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('status() returns the latest job run of every kind', async () => {
		await startJobRun(env, 'sde-1', 'sde', 10);
		await startJobRun(env, 'sde-2', 'sde', 20);
		await startJobRun(env, 'adjusted_prices-5', 'adjusted_prices', 5);

		const status = await exports.UpdaterRpc.status();

		expect(status.map((r) => ({ kind: r.kind, runId: r.runId, status: r.status }))).toEqual([
			{ kind: 'adjusted_prices', runId: 'adjusted_prices-5', status: 'running' },
			{ kind: 'sde', runId: 'sde-2', status: 'running' }
		]);
	});

	it('triggerSdeSync skips an imported build unless forced', async () => {
		await env.DB.prepare(`INSERT INTO sde_state VALUES (1, 6000, '2026-01-01', 1, '{}', '[]')`).run();
		await using introspector = await mockedSdeWorkflow();
		installFetch(() => sdeLatest(6000));

		expect(await exports.UpdaterRpc.triggerSdeSync(false)).toEqual({ skipped: true, build: 6000 });
		const forced = await exports.UpdaterRpc.triggerSdeSync(true);

		expect(forced).toEqual({ instanceId: expect.stringMatching(/^sde-6000-manual-\d+$/) });
		expect(await completedInstanceCount(introspector)).toBe(1);
	});

	it('triggerSdeSync starts sde-<build> for a newer build', async () => {
		await using introspector = await mockedSdeWorkflow();
		installFetch(() => sdeLatest(6001));

		expect(await exports.UpdaterRpc.triggerSdeSync(false)).toEqual({ instanceId: 'sde-6001' });
		expect(await completedInstanceCount(introspector)).toBe(1);
	});

	it('triggerPriceRefresh starts prices-manual-<ms> and records the run', async () => {
		await using introspector = await mockedPriceWorkflow();

		const { instanceId } = await exports.UpdaterRpc.triggerPriceRefresh();

		expect(instanceId).toMatch(/^prices-manual-\d+$/);
		expect(await completedInstanceCount(introspector)).toBe(1);
		const job = await env.DB.prepare('SELECT kind FROM job_runs WHERE run_id = ?').bind(instanceId).first();
		expect(job).toEqual({ kind: 'prices' });
	});

	it('workflowStatus reports the live state of workflow runs and leaves out the rest', async () => {
		await using introspector = await mockedPriceWorkflow();
		const { instanceId } = await exports.UpdaterRpc.triggerPriceRefresh();
		expect(await completedInstanceCount(introspector)).toBe(1);

		const states = await exports.UpdaterRpc.workflowStatus([
			{ kind: 'prices', runId: instanceId },
			{ kind: 'cost_indices', runId: 'cost_indices-1' },
			{ kind: 'daily', runId: 'daily-never-started' }
		]);

		expect(states).toEqual({ [instanceId]: { status: 'complete', error: null } });
	});

	it('triggerDaily starts daily-<date>-manual-<ms> and rejects malformed dates', async () => {
		await using introspector = await mockedDailyWorkflow();

		const { instanceId } = await exports.UpdaterRpc.triggerDaily('2026-10-05');

		expect(instanceId).toMatch(/^daily-2026-10-05-manual-\d+$/);
		expect(await completedInstanceCount(introspector)).toBe(1);
		const job = await env.DB.prepare('SELECT kind, status FROM job_runs WHERE run_id = ?')
			.bind(instanceId)
			.first();
		expect(job).toEqual({ kind: 'daily', status: 'ok' });
		// Called in-isolate: a rejected cross-isolate RPC call is also logged by workerd as uncaught.
		const rpc = new UpdaterRpc(createExecutionContext(), env);
		for (const bad of ['2026-13-01', '2026-02-30', '20261005', 'yesterday'])
			await expect(rpc.triggerDaily(bad)).rejects.toThrow(RangeError);
		expect(await completedInstanceCount(introspector)).toBe(1);
	});

	it('publishMarketSnapshot rewrites market:v1 from the current public hubs', async () => {
		await env.DB.prepare(
			`INSERT INTO market_hubs (hub_id, name, kind, region_id, system_id, location_id, fuzzwork_location_id,
				visibility, share_status, enabled, sort_order, created_at)
			VALUES ('structure-7', 'Approved Market', 'structure', 10000002, 30000144, 7, 7, 'public', 'approved', 1, 100, 1)`
		).run();
		await env.DB.prepare(
			`INSERT INTO latest_prices (hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, buy_orders,
				sell_orders, source, observed_at) VALUES ('structure-7', 34, 4, 5, 10, 20, 1, 1, 'esi_structure', 4242)`
		).run();
		await env.DB.prepare("UPDATE market_hubs SET enabled = 0 WHERE hub_id = 'hek'").run();

		const result = await exports.UpdaterRpc.publishMarketSnapshot();

		expect(result.snapshotAt).toBe(4242);
		expect(result.hubIds).toContain('structure-7');
		expect(result.hubIds).not.toContain('hek');
		const market = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');
		expect(market!.hubs.map((h) => h.hubId)).toEqual(result.hubIds);
		expect(market!.prices['structure-7']).toEqual({ 34: [4, 5, 10, 20] });
	});

	it('triggerCostIndices fetches while the cache is fresh and records a manual run without new data', async () => {
		await freshCostIndicesCache();
		const calls = installFetch(() => notModified({ Expires: new Date(Date.now() + HOUR).toUTCString() }));

		const result = await exports.UpdaterRpc.triggerCostIndices();

		expect(calls).toHaveLength(1);
		expect(calls[0]!.headers.get('If-None-Match')).toBe('"v1"');
		expect(result).toEqual({
			runId: expect.stringMatching(/^cost_indices-manual-\d+$/),
			status: 'ok',
			summary: expect.stringContaining('not modified')
		});
		expect(await jobRow(result.runId)).toEqual({
			kind: 'cost_indices',
			status: 'ok',
			detail_json: JSON.stringify(NO_NEW_DATA)
		});
	});

	it('triggerCostIndices writes new data and records the run', async () => {
		await freshCostIndicesCache();
		installFetch(() =>
			json(
				[{ solar_system_id: 30002647, cost_indices: [{ activity: 'reaction', cost_index: 0.04 }] }],
				cacheHeaders('"v2"', Date.now() + HOUR)
			)
		);

		const result = await exports.UpdaterRpc.triggerCostIndices();

		expect(result.status).toBe('ok');
		expect(await jobRow(result.runId)).toEqual({
			kind: 'cost_indices',
			status: 'ok',
			detail_json: JSON.stringify({ systems: 1 })
		});
		const stored = await env.DB.prepare(
			'SELECT reaction FROM cost_indices WHERE system_id = 30002647'
		).first();
		expect(stored).toEqual({ reaction: 0.04 });
	});

	it('triggerCostIndices returns a failed run instead of rejecting when ESI errors', async () => {
		installFetch(() => json({ error: 'bad request' }, {}, 400));

		const result = await exports.UpdaterRpc.triggerCostIndices();

		expect(result.status).toBe('failed');
		expect(result.summary).toContain('400');
		const row = await jobRow(result.runId);
		expect(row?.status).toBe('failed');
		expect(JSON.parse(row!.detail_json).error).toContain('400');
	});

	it('triggerAffiliations runs the lookup outside the daily schedule and records the run', async () => {
		await env.DB.batch([
			env.DB.prepare("INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('u1', 1, ?)").bind(
				Date.now()
			),
			env.DB.prepare(
				"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (95339706, 'u1', 'Pilot', 'h', 1)"
			)
		]);
		installFetch((url, call) =>
			url.pathname === '/characters/affiliation'
				? json([{ character_id: 95339706, corporation_id: 98210135 }])
				: json(
						(JSON.parse(call.body!) as number[]).map((id) => ({
							id,
							name: 'Infinite Point',
							category: 'corporation'
						}))
					)
		);

		const result = await exports.UpdaterRpc.triggerAffiliations();

		expect(result).toMatchObject({
			status: 'ok',
			summary: '1 of 1 characters updated (1 corporations, 0 alliances)'
		});
		expect(result.runId).toMatch(/^affiliations-manual-\d+$/);
		expect((await jobRow(result.runId))?.kind).toBe('affiliations');
		const character = await env.DB.prepare('SELECT corporation_name FROM characters').first();
		expect(character).toEqual({ corporation_name: 'Infinite Point' });
	});

	it('triggerAdjustedPrices records a manual run with or without tracked types', async () => {
		const prices = [{ type_id: 4312, adjusted_price: 1200.5, average_price: 1300 }];
		installFetch(() => json(prices, cacheHeaders('"p1"', Date.now() + HOUR)));

		const untracked = await exports.UpdaterRpc.triggerAdjustedPrices();
		expect(untracked.runId).toMatch(/^adjusted_prices-manual-\d+$/);
		expect(await jobRow(untracked.runId)).toEqual({
			kind: 'adjusted_prices',
			status: 'ok',
			detail_json: JSON.stringify({ received: 1, written: 0, note: 'no reactions imported yet' })
		});

		await env.DB.prepare('DELETE FROM job_runs').run();
		await seedTrackedReaction();
		const tracked = await exports.UpdaterRpc.triggerAdjustedPrices();
		expect(await jobRow(tracked.runId)).toEqual({
			kind: 'adjusted_prices',
			status: 'ok',
			detail_json: JSON.stringify({ received: 1, written: 1 })
		});
	});

	it('publishMarketSnapshot records a market_snapshot run', async () => {
		await exports.UpdaterRpc.publishMarketSnapshot();

		const { results } = await env.DB.prepare(
			"SELECT run_id, status FROM job_runs WHERE kind = 'market_snapshot'"
		).all<{ run_id: string; status: string }>();
		expect(results).toEqual([
			{ run_id: expect.stringMatching(/^market_snapshot-manual-\d+$/), status: 'ok' }
		]);
	});
});
