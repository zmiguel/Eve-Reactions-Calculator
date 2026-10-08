import { env } from 'cloudflare:workers';
import { MARKET_KV_KEY } from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INDUSTRY_SYSTEMS_URL, refreshCostIndices } from '../src/cron/cost-indices.ts';
import { cacheHeaders, installFetch, json, notModified, resetState } from './helpers.ts';

const T0 = Date.UTC(2026, 9, 6, 12, 0);
const HOUR = 3_600_000;

const SYSTEMS = [
	{
		solar_system_id: 30002647,
		cost_indices: [
			{ activity: 'manufacturing', cost_index: 0.0213 },
			{ activity: 'reaction', cost_index: 0.0412 },
			{ activity: 'invention', cost_index: 0.01 }
		]
	},
	{ solar_system_id: 30004604, cost_indices: [{ activity: 'reaction', cost_index: 0.05 }] }
];

async function costRows() {
	const { results } = await env.DB.prepare(
		'SELECT system_id, reaction, manufacturing, updated_at FROM cost_indices ORDER BY system_id'
	).all();
	return results;
}

async function cacheRow() {
	return env.DB.prepare('SELECT etag, expires_at, updated_at FROM http_cache WHERE url = ?')
		.bind(INDUSTRY_SYSTEMS_URL)
		.first<{ etag: string | null; expires_at: number | null; updated_at: number }>();
}

describe('refreshCostIndices', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('stores reaction and manufacturing indices of every returned system and publishes market:v1', async () => {
		const calls = installFetch(() => json(SYSTEMS, cacheHeaders('"v1"', T0 + HOUR)));

		const line = await refreshCostIndices(env, T0);

		expect(calls.map((c) => c.url)).toEqual(['https://esi.evetech.net/industry/systems']);
		expect(calls[0]!.headers.get('If-None-Match')).toBeNull();
		expect(line).toContain('2 systems written');
		expect(await costRows()).toEqual([
			{ system_id: 30002647, reaction: 0.0412, manufacturing: 0.0213, updated_at: T0 },
			{ system_id: 30004604, reaction: 0.05, manufacturing: 0, updated_at: T0 }
		]);
		expect(await cacheRow()).toEqual({ etag: '"v1"', expires_at: T0 + HOUR, updated_at: T0 });
		const market = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');
		expect(market?.costIndicesUpdatedAt).toBe(T0);
		const job = await env.DB.prepare(
			"SELECT status, detail_json FROM job_runs WHERE kind = 'cost_indices'"
		).first();
		expect(job).toEqual({ status: 'ok', detail_json: JSON.stringify({ systems: 2 }) });
	});

	it('makes no request while expires_at is in the future', async () => {
		const calls = installFetch(() => json(SYSTEMS, cacheHeaders('"v1"', T0 + HOUR)));
		await refreshCostIndices(env, T0);

		const line = await refreshCostIndices(env, T0 + HOUR - 1);

		expect(calls).toHaveLength(1);
		expect(line).toContain('skipped');
	});

	it('on 304 sends the stored ETag and updates only expires_at', async () => {
		let answer: Response = json(SYSTEMS, cacheHeaders('"v1"', T0 + HOUR));
		const calls = installFetch(() => answer);
		await refreshCostIndices(env, T0);
		const before = await costRows();

		answer = notModified({ Expires: new Date(T0 + 3 * HOUR).toUTCString() });
		const line = await refreshCostIndices(env, T0 + 2 * HOUR);

		expect(calls).toHaveLength(2);
		expect(calls[1]!.headers.get('If-None-Match')).toBe('"v1"');
		expect(line).toContain('not modified');
		expect(await cacheRow()).toEqual({ etag: '"v1"', expires_at: T0 + 3 * HOUR, updated_at: T0 + 2 * HOUR });
		expect(await costRows()).toEqual(before);
		const jobs = await env.DB.prepare(
			"SELECT COUNT(*) AS n FROM job_runs WHERE kind = 'cost_indices'"
		).first();
		expect(jobs).toEqual({ n: 1 });
	});

	it('records a failed job run and keeps no validator when ESI errors', async () => {
		installFetch(() => json({ error: 'bad request' }, {}, 400));

		await expect(refreshCostIndices(env, T0)).rejects.toThrow('400');

		expect(await cacheRow()).toBeNull();
		const job = await env.DB.prepare(
			"SELECT status, detail_json FROM job_runs WHERE kind = 'cost_indices'"
		).first<{ status: string; detail_json: string }>();
		expect(job?.status).toBe('failed');
		expect(JSON.parse(job!.detail_json).error).toContain('400');
	});
});
