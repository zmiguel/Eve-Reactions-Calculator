import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { MARKET_KV_KEY } from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshRegion } from '../src/workflows/price-refresh.ts';
import type { PublishCounts } from '../src/workflows/price-refresh.ts';
import {
	fuzzwork,
	installFetch,
	json,
	order,
	resetState,
	seedReaction,
	seedTrackedReaction
} from './helpers.ts';

const TRACKED = [4312, 16643, 16647, 16663, 46166];
const HUB_LOCATIONS: [location: number, system: number][] = [
	[60003760, 30000142], // jita
	[60008494, 30002187], // amarr
	[60011866, 30002659], // dodixie
	[60004588, 30002510], // rens
	[60005686, 30002053] // hek
];

/** The Forge orders of one type: Jita 4-4, another Jita station, a Perimeter structure and NPC station. */
function forgeOrders(typeId: number) {
	return [
		order(typeId, 60003760, 30000142, true, 100, 10),
		order(typeId, 60003760, 30000142, false, 120, 5),
		order(typeId, 60003761, 30000142, false, 110, 3),
		order(typeId, 1044752365771, 30000144, true, 105, 2),
		order(typeId, 1044752365771, 30000144, false, 115, 4),
		order(typeId, 60000001, 30000144, true, 90, 1)
	];
}

async function latest(hubId: string, typeId: number) {
	return env.DB.prepare(
		`SELECT buy_max, sell_min, buy_volume, sell_volume, buy_orders, sell_orders, source, observed_at
		FROM latest_prices WHERE hub_id = ? AND type_id = ?`
	)
		.bind(hubId, typeId)
		.first();
}

async function sourceCounts(): Promise<Record<string, number>> {
	const { results } = await env.DB.prepare(
		'SELECT source, COUNT(*) AS n FROM latest_prices GROUP BY source'
	).all<{ source: string; n: number }>();
	return Object.fromEntries(results.map((r) => [r.source, r.n]));
}

async function gunzipJson(body: ReadableStream<Uint8Array>): Promise<unknown> {
	return new Response(body.pipeThrough(new DecompressionStream('gzip'))).json();
}

describe('PriceRefreshWorkflow region step', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('aggregates one region response per hub: Jita by station, Perimeter by system', async () => {
		await seedTrackedReaction();
		const calls = installFetch((url) =>
			url.pathname === '/markets/10000002/orders'
				? json(forgeOrders(Number(url.searchParams.get('type_id'))))
				: new Response('unexpected', { status: 500 })
		);

		const counts = await refreshRegion(env, 10000002, ['jita', 'perimeter'], 1000);

		expect(counts).toEqual({ regionId: 10000002, types: 5, esi: 10, fuzzwork: 0, missing: 0 });
		expect(await latest('jita', 16663)).toEqual({
			buy_max: 100,
			sell_min: 120,
			buy_volume: 10,
			sell_volume: 5,
			buy_orders: 1,
			sell_orders: 1,
			source: 'esi',
			observed_at: 1000
		});
		expect(await latest('perimeter', 16663)).toEqual({
			buy_max: 105,
			sell_min: 115,
			buy_volume: 3,
			sell_volume: 4,
			buy_orders: 2,
			sell_orders: 1,
			source: 'esi',
			observed_at: 1000
		});
		const snapshots = await env.HISTORY_DB.prepare(
			'SELECT COUNT(*) AS n FROM price_snapshots WHERE snapshot_at = 1000'
		).first();
		expect(snapshots).toEqual({ n: 10 });
		expect(
			calls.map((c) => Number(new URL(c.url).searchParams.get('type_id'))).sort((a, b) => a - b)
		).toEqual(TRACKED);
		expect(calls.every((c) => c.url.includes('order_type=all') && c.url.includes('page=1'))).toBe(true);
	});

	it('takes the types left after the ESI guard trips from Fuzzwork, per hub', async () => {
		// Tracked: 900–908. The first 6 requests are in flight before any answer; every answer reports
		// < 10 % of the rate limit left, so types 906–908 are never requested from ESI.
		await seedReaction(900, 901, [902, 903, 904, 905, 906, 907, 908]);
		const calls = installFetch((url) => {
			if (url.hostname === 'market.fuzzwork.co.uk') return fuzzwork(url);
			const typeId = Number(url.searchParams.get('type_id'));
			return json(forgeOrders(typeId), { 'X-Ratelimit-Remaining': '1000', 'X-Ratelimit-Limit': '12000/15m' });
		});

		const counts = await refreshRegion(env, 10000002, ['jita', 'perimeter'], 2000);

		expect(counts).toEqual({ regionId: 10000002, types: 9, esi: 12, fuzzwork: 6, missing: 0 });
		const esiTypes = calls
			.filter((c) => c.url.startsWith('https://esi.evetech.net/'))
			.map((c) => Number(new URL(c.url).searchParams.get('type_id')))
			.sort((a, b) => a - b);
		expect(esiTypes).toEqual([900, 901, 902, 903, 904, 905]);
		expect(calls.filter((c) => c.url.startsWith('https://market.fuzzwork.co.uk/')).map((c) => c.url)).toEqual(
			[
				'https://market.fuzzwork.co.uk/aggregates/?region=60003760&types=906,907,908',
				'https://market.fuzzwork.co.uk/aggregates/?region=30000144&types=906,907,908'
			]
		);
		expect(await sourceCounts()).toEqual({ esi: 12, fuzzwork: 6 });
		expect(await latest('perimeter', 908)).toMatchObject({ buy_max: 50, sell_min: 60, source: 'fuzzwork' });
		expect(await latest('jita', 905)).toMatchObject({ buy_max: 100, sell_min: 120, source: 'esi' });
	});
});

describe('PriceRefreshWorkflow', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	async function run(id: string): Promise<PublishCounts> {
		await using instance = await introspectWorkflowInstance(env.PRICE_REFRESH, id);
		await instance.modify(async (m) => m.disableRetryDelays());
		await env.PRICE_REFRESH.create({ id, params: {} });
		await instance.waitForStatus('complete');
		return (await instance.getOutput()) as PublishCounts;
	}

	async function jobStatus(id: string) {
		return env.DB.prepare('SELECT kind, status FROM job_runs WHERE run_id = ?').bind(id).first();
	}

	it('publishes market:v1, archives the rows gzipped to R2 and marks the run ok', async () => {
		await seedTrackedReaction();
		installFetch((url) => {
			const typeId = Number(url.searchParams.get('type_id'));
			return json([
				...forgeOrders(typeId),
				...HUB_LOCATIONS.slice(1).flatMap(([location, system]) => [
					order(typeId, location, system, true, 10, 1),
					order(typeId, location, system, false, 20, 1)
				])
			]);
		});

		const output = await run('prices-test-ok');

		expect(output).toEqual({
			status: 'ok',
			esi: 30,
			fuzzwork: 0,
			missing: 0,
			archived: 30,
			bytes: expect.any(Number)
		});
		expect(await jobStatus('prices-test-ok')).toEqual({ kind: 'prices', status: 'ok' });
		const market = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');
		expect(market!.hubs.map((h) => h.hubId)).toEqual([
			'jita',
			'amarr',
			'perimeter',
			'dodixie',
			'rens',
			'hek'
		]);
		expect(market!.prices.jita![16663]).toEqual([100, 120, 10, 5]);
		expect(market!.prices.hek![4312]).toEqual([10, 20, 1, 1]);

		const listed = await env.ARCHIVE.list({ prefix: 'prices/raw/' });
		expect(listed.objects).toHaveLength(1);
		const key = listed.objects[0]!.key;
		const match = /^prices\/raw\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)\.json\.gz$/.exec(key);
		expect(match).not.toBeNull();
		const snapshotAt = Number(match![4]);
		expect(`${match![1]}-${match![2]}-${match![3]}`).toBe(new Date(snapshotAt).toISOString().slice(0, 10));
		expect(market!.snapshotAt).toBe(snapshotAt);
		const object = await env.ARCHIVE.get(key);
		expect(object!.size).toBe(output.bytes);
		const rows = (await gunzipJson(object!.body)) as { snapshotAt: number; hubId: string; typeId: number }[];
		expect(rows).toHaveLength(30);
		expect(rows.every((r) => r.snapshotAt === snapshotAt)).toBe(true);
		expect(rows.find((r) => r.hubId === 'perimeter' && r.typeId === 16663)).toMatchObject({
			buyMax: 105,
			sellMin: 115,
			source: 'esi'
		});
	});

	it('marks the run partial when a region falls back to Fuzzwork', async () => {
		await seedTrackedReaction();
		const calls = installFetch((url) => {
			if (url.hostname === 'market.fuzzwork.co.uk') return fuzzwork(url);
			if (url.pathname === '/markets/10000042/orders')
				return json({ error: 'unavailable' }, { 'Retry-After': '0' }, 503);
			return json(forgeOrders(Number(url.searchParams.get('type_id'))));
		});

		const output = await run('prices-test-partial');

		expect(output).toMatchObject({ status: 'partial', fuzzwork: 5, missing: 0, archived: 30 });
		expect(await jobStatus('prices-test-partial')).toEqual({ kind: 'prices', status: 'partial' });
		expect(calls.filter((c) => c.url.includes('/markets/10000042/orders'))).toHaveLength(10);
		expect(await latest('hek', 16663)).toMatchObject({ buy_max: 50, sell_min: 60, source: 'fuzzwork' });
		const market = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');
		expect(market!.prices.hek![16663]).toEqual([50, 60, 100, 200]);
	});
});
