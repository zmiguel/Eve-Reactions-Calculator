import { describe, expect, it, vi } from 'vitest';
import {
	STRUCTURE_SCOPES,
	aggregateOrders,
	createEsiClient,
	fetchIndustrySystems,
	fetchMarketHistory,
	fetchMarketPrices,
	fetchSdeLatest,
	fetchStructureInfo,
	fetchStructureOrders,
	searchStructures
} from '../src/index.ts';
import type { MarketOrder } from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, sleep: vi.fn(async () => {}) })
	};
}

let nextId = 1;
function order(
	o: Partial<MarketOrder> & Pick<MarketOrder, 'price' | 'volumeRemain' | 'isBuyOrder'>
): MarketOrder {
	return { orderId: nextId++, typeId: 34, locationId: 60003760, systemId: 30000142, range: 'station', ...o };
}

describe('aggregateOrders', () => {
	const orders: MarketOrder[] = [
		// Jita 4-4
		order({ isBuyOrder: false, price: 12, volumeRemain: 920 }),
		order({ isBuyOrder: false, price: 10, volumeRemain: 30 }),
		order({ isBuyOrder: false, price: 11, volumeRemain: 50 }),
		order({ isBuyOrder: true, price: 99, volumeRemain: 990 }),
		order({ isBuyOrder: true, price: 100, volumeRemain: 10 }),
		// other station in Jita
		order({ isBuyOrder: false, price: 9, volumeRemain: 5, locationId: 60003761 }),
		order({ isBuyOrder: true, price: 101, volumeRemain: 5, locationId: 60003761 }),
		// Perimeter structure
		order({ isBuyOrder: false, price: 8, volumeRemain: 100, locationId: 1044752365771, systemId: 30000144 })
	];

	it('station filter uses only that location; p5 is the volume-weighted best 5 %', () => {
		// sell: 1000 volume → 50 units: 30 × 10 + 20 × 11 = 520 → 10.4
		// buy: 1000 volume → 50 units: 10 × 100 + 40 × 99 = 4960 → 99.2
		expect(aggregateOrders(orders, { kind: 'station', locationId: 60003760 })).toEqual({
			buyMax: 100,
			sellMin: 10,
			buyP5: 99.2,
			sellP5: 10.4,
			buyVolume: 1000,
			sellVolume: 1000,
			buyOrders: 2,
			sellOrders: 3
		});
	});

	it('system filter includes every location in the system', () => {
		const agg = aggregateOrders(orders, { kind: 'system', systemId: 30000142 });
		expect(agg.buyMax).toBe(101);
		expect(agg.sellMin).toBe(9);
		expect(agg.buyVolume).toBe(1005);
		expect(agg.sellOrders).toBe(4);
	});

	it('empty side yields null prices and zero counts', () => {
		expect(aggregateOrders(orders, { kind: 'system', systemId: 30000144 })).toEqual({
			buyMax: null,
			sellMin: 8,
			buyP5: null,
			sellP5: 8,
			buyVolume: 0,
			sellVolume: 100,
			buyOrders: 0,
			sellOrders: 1
		});
		expect(aggregateOrders(orders, { kind: 'structure', locationId: 1 }).sellP5).toBeNull();
	});
});

describe('structure endpoints', () => {
	it('searchStructures sends search params with the bearer token', async () => {
		const { esi, calls } = esiWith(() => json({ structure: [1044752365771, 1042508032148] }));
		const ids = await searchStructures(esi, 90000001, 'Perimeter', 'access-1');
		expect(ids).toEqual([1044752365771, 1042508032148]);
		const url = new URL(calls[0].url);
		expect(url.pathname).toBe('/characters/90000001/search');
		expect(url.searchParams.get('categories')).toBe('structure');
		expect(url.searchParams.get('search')).toBe('Perimeter');
		expect(url.searchParams.get('strict')).toBe('false');
		expect(calls[0].headers.get('Authorization')).toBe('Bearer access-1');
	});

	it('searchStructures returns [] when nothing matches', async () => {
		const { esi } = esiWith(() => json({}));
		expect(await searchStructures(esi, 1, 'abc', 't')).toEqual([]);
	});

	it('searchStructures rejects text shorter than 3 characters without a request', async () => {
		const { esi, calls } = esiWith(() => json({}));
		await expect(searchStructures(esi, 1, 'ab', 't')).rejects.toThrow(RangeError);
		expect(calls).toHaveLength(0);
	});

	it('fetchStructureInfo maps fields', async () => {
		const { esi, calls } = esiWith(() =>
			json({
				name: 'Perimeter - Tranquility Trading Tower',
				owner_id: 98000001,
				solar_system_id: 30000144,
				type_id: 35834,
				position: { x: 1, y: 2, z: 3 }
			})
		);
		expect(await fetchStructureInfo(esi, 1044752365771, 'tok')).toEqual({
			name: 'Perimeter - Tranquility Trading Tower',
			solarSystemId: 30000144,
			ownerId: 98000001,
			typeId: 35834
		});
		expect(calls[0].url).toBe('https://esi.evetech.net/universe/structures/1044752365771');
		expect(calls[0].headers.get('Authorization')).toBe('Bearer tok');
	});

	it('fetchStructureInfo returns null on 403', async () => {
		const { esi } = esiWith(() => json({ error: 'Forbidden' }, { status: 403 }));
		expect(await fetchStructureInfo(esi, 1, 'tok')).toBeNull();
	});

	it('fetchStructureOrders exposes a 403 first page as a typed result', async () => {
		const { esi, calls } = esiWith(() => json({ error: 'Forbidden' }, { status: 403 }));
		expect(await fetchStructureOrders(esi, 1044752365771, 'tok')).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
		expect(calls).toHaveLength(1);
	});

	it('fetchStructureOrders pages through X-Pages', async () => {
		const { esi, calls } = esiWith((call) => {
			const page = Number(new URL(call.url).searchParams.get('page'));
			return json(
				[
					{
						order_id: page,
						type_id: 34,
						location_id: 1044752365771,
						is_buy_order: false,
						price: 5 + page,
						volume_remain: 10,
						volume_total: 10,
						range: 'station',
						duration: 90,
						issued: '2026-10-01T00:00:00Z',
						min_volume: 1
					}
				],
				{ headers: { 'X-Pages': '2' } }
			);
		});
		const res = await fetchStructureOrders(esi, 1044752365771, 'tok');
		expect(calls.map((c) => c.url)).toEqual([
			'https://esi.evetech.net/markets/structures/1044752365771?page=1',
			'https://esi.evetech.net/markets/structures/1044752365771?page=2'
		]);
		expect(calls.every((c) => c.headers.get('Authorization') === 'Bearer tok')).toBe(true);
		expect(res).toMatchObject({ ok: true, status: 200 });
		if (!res.ok) return;
		expect(res.items.map((o) => [o.orderId, o.price, o.systemId])).toEqual([
			[1, 6, null],
			[2, 7, null]
		]);
	});

	it('exports the structure scopes', () => {
		expect(STRUCTURE_SCOPES).toEqual([
			'esi-markets.structure_markets.v1',
			'esi-universe.read_structures.v1',
			'esi-search.search_structures.v1'
		]);
	});
});

describe('public market endpoints', () => {
	it('fetchMarketHistory parses rows', async () => {
		const { esi, calls } = esiWith(() =>
			json([
				{
					average: 5.25,
					date: '2026-10-04',
					highest: 5.27,
					lowest: 5.11,
					order_count: 2267,
					volume: 16276782
				},
				{ average: 5.3, date: '2026-10-05', highest: 5.4, lowest: 5.2, order_count: 2000, volume: 100 }
			])
		);
		expect(await fetchMarketHistory(esi, 10000002, 34)).toEqual([
			{ date: '2026-10-04', average: 5.25, highest: 5.27, lowest: 5.11, volume: 16276782, orderCount: 2267 },
			{ date: '2026-10-05', average: 5.3, highest: 5.4, lowest: 5.2, volume: 100, orderCount: 2000 }
		]);
		expect(calls[0].url).toBe('https://esi.evetech.net/markets/10000002/history?type_id=34');
	});

	it('fetchMarketPrices maps prices and keeps etag/expiry', async () => {
		const { esi } = esiWith(() =>
			json(
				[
					{ type_id: 34, adjusted_price: 4.5, average_price: 5.1 },
					{ type_id: 16663, adjusted_price: 1000 }
				],
				{ headers: { ETag: '"p1"', Expires: 'Tue, 06 Oct 2026 13:00:00 GMT' } }
			)
		);
		expect(await fetchMarketPrices(esi)).toEqual({
			notModified: false,
			etag: '"p1"',
			expiresAt: Date.UTC(2026, 9, 6, 13),
			data: [
				{ typeId: 34, adjustedPrice: 4.5, averagePrice: 5.1 },
				{ typeId: 16663, adjustedPrice: 1000, averagePrice: null }
			]
		});
	});

	it('fetchIndustrySystems handles 304 with the conditional etag', async () => {
		const { esi, calls } = esiWith(
			() => new Response(null, { status: 304, headers: { Expires: 'Tue, 06 Oct 2026 13:00:00 GMT' } })
		);
		expect(await fetchIndustrySystems(esi, { etag: '"i1"' })).toEqual({
			notModified: true,
			data: null,
			etag: '"i1"',
			expiresAt: Date.UTC(2026, 9, 6, 13)
		});
		expect(calls[0].headers.get('If-None-Match')).toBe('"i1"');
	});

	it('fetchIndustrySystems maps cost indices per activity', async () => {
		const { esi } = esiWith(() =>
			json([
				{
					solar_system_id: 30002647,
					cost_indices: [
						{ activity: 'manufacturing', cost_index: 0.02 },
						{ activity: 'reaction', cost_index: 0.0412 }
					]
				}
			])
		);
		const res = await fetchIndustrySystems(esi);
		expect(res.data).toEqual([
			{ systemId: 30002647, costIndices: { manufacturing: 0.02, reaction: 0.0412 } }
		]);
	});
});

describe('fetchSdeLatest', () => {
	it('parses build number with user agent and etag', async () => {
		const { fetch, calls } = fakeFetch(
			() =>
				new Response('{"_key":"sde","buildNumber":3421648,"releaseDate":"2026-09-30T11:00:00Z"}\n', {
					headers: { ETag: '"s2"' }
				})
		);
		expect(await fetchSdeLatest(fetch, TEST_UA, { etag: '"s1"' })).toEqual({
			notModified: false,
			data: { buildNumber: 3421648, releaseDate: '2026-09-30T11:00:00Z' },
			etag: '"s2"',
			expiresAt: null
		});
		expect(calls[0].url).toBe('https://developers.eveonline.com/static-data/tranquility/latest.jsonl');
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
		expect(calls[0].headers.get('If-None-Match')).toBe('"s1"');
	});

	it('returns notModified on 304', async () => {
		const { fetch } = fakeFetch(() => new Response(null, { status: 304 }));
		expect(await fetchSdeLatest(fetch, TEST_UA, { etag: '"s1"' })).toMatchObject({
			notModified: true,
			data: null
		});
	});
});
