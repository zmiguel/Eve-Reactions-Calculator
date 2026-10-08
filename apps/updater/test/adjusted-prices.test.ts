import { env } from 'cloudflare:workers';
import { MARKET_KV_KEY } from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_PRICES_URL, refreshAdjustedPrices } from '../src/cron/adjusted-prices.ts';
import { cacheHeaders, installFetch, json, resetState, seedTrackedReaction } from './helpers.ts';

const T0 = Date.UTC(2026, 9, 6, 12, 0);
const HOUR = 3_600_000;

const PRICES = [
	{ type_id: 34, adjusted_price: 5.1, average_price: 5.3 },
	{ type_id: 4312, adjusted_price: 1200.5, average_price: 1300 },
	{ type_id: 16643, adjusted_price: 900 },
	{ type_id: 16647, average_price: 77 },
	{ type_id: 16663, adjusted_price: 2500, average_price: 2600 },
	{ type_id: 46166, adjusted_price: 150_000_000 }
];

describe('refreshAdjustedPrices', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('stores adjusted prices of tracked types only and publishes market:v1', async () => {
		await seedTrackedReaction();
		const calls = installFetch(() => json(PRICES, cacheHeaders('"p1"', T0 + HOUR)));

		const line = await refreshAdjustedPrices(env, T0);

		expect(calls.map((c) => c.url)).toEqual(['https://esi.evetech.net/markets/prices']);
		expect(line).toContain('4 adjusted prices written');
		const { results } = await env.DB.prepare(
			'SELECT type_id, adjusted_price, average_price, updated_at FROM adjusted_prices ORDER BY type_id'
		).all();
		// 34 is not tracked; 16647 has no adjusted price.
		expect(results).toEqual([
			{ type_id: 4312, adjusted_price: 1200.5, average_price: 1300, updated_at: T0 },
			{ type_id: 16643, adjusted_price: 900, average_price: null, updated_at: T0 },
			{ type_id: 16663, adjusted_price: 2500, average_price: 2600, updated_at: T0 },
			{ type_id: 46166, adjusted_price: 150_000_000, average_price: null, updated_at: T0 }
		]);
		const market = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');
		expect(market?.adjusted).toEqual({ 4312: 1200.5, 16643: 900, 16663: 2500, 46166: 150_000_000 });
		expect(market?.adjustedUpdatedAt).toBe(T0);
		const cache = await env.DB.prepare('SELECT etag, expires_at FROM http_cache WHERE url = ?')
			.bind(MARKET_PRICES_URL)
			.first();
		expect(cache).toEqual({ etag: '"p1"', expires_at: T0 + HOUR });
		const job = await env.DB.prepare("SELECT status FROM job_runs WHERE kind = 'adjusted_prices'").first();
		expect(job).toEqual({ status: 'ok' });
	});

	it('keeps no validator before any reaction is imported, so the next tick refetches everything', async () => {
		const calls = installFetch(() => json(PRICES, cacheHeaders('"p1"', T0 + HOUR)));

		const line = await refreshAdjustedPrices(env, T0);
		await refreshAdjustedPrices(env, T0 + 1);

		expect(line).toContain('no tracked types');
		expect(calls).toHaveLength(2);
		expect(calls[1]!.headers.get('If-None-Match')).toBeNull();
		const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM adjusted_prices').first();
		expect(count).toEqual({ n: 0 });
		expect(await env.CACHE.get(MARKET_KV_KEY)).toBeNull();
	});
});
