import { describe, expect, it, vi } from 'vitest';
import {
	ESI_BULK_CHUNK,
	ESI_COMPAT_DATE,
	EsiError,
	createEsiClient,
	fetchAffiliations,
	fetchConstellationInfo,
	fetchNames,
	fetchRegionInfo,
	fetchSystemInfo
} from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, sleep: vi.fn(async () => {}) })
	};
}

describe('universe clients', () => {
	it('fetchSystemInfo maps fields and sends public ESI headers', async () => {
		const { esi, calls } = esiWith(() =>
			json({
				system_id: 30004604,
				name: '671-ST',
				constellation_id: 20000672,
				security_status: -0.0849,
				security_class: 'J',
				position: { x: 1, y: 2, z: 3 },
				star_id: 40291920
			})
		);
		expect(await fetchSystemInfo(esi, 30004604)).toEqual({
			systemId: 30004604,
			name: '671-ST',
			constellationId: 20000672,
			securityStatus: -0.0849
		});
		expect(calls[0].url).toBe('https://esi.evetech.net/universe/systems/30004604');
		expect(calls[0].headers.get('X-Compatibility-Date')).toBe(ESI_COMPAT_DATE);
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
		expect(calls[0].headers.get('Authorization')).toBeNull();
	});

	it('fetchConstellationInfo maps the region', async () => {
		const { esi, calls } = esiWith(() =>
			json({ constellation_id: 20000672, name: 'Q-LN5I', region_id: 10000058, systems: [30004604] })
		);
		expect(await fetchConstellationInfo(esi, 20000672)).toEqual({
			constellationId: 20000672,
			name: 'Q-LN5I',
			regionId: 10000058
		});
		expect(calls[0].url).toBe('https://esi.evetech.net/universe/constellations/20000672');
	});

	it('fetchRegionInfo maps the name', async () => {
		const { esi, calls } = esiWith(() =>
			json({ region_id: 10000058, name: 'Fountain', constellations: [20000672] })
		);
		expect(await fetchRegionInfo(esi, 10000058)).toEqual({ regionId: 10000058, name: 'Fountain' });
		expect(calls[0].url).toBe('https://esi.evetech.net/universe/regions/10000058');
	});

	it('returns null for an unknown id', async () => {
		const { esi } = esiWith(() => json({ error: 'Not found' }, { status: 404 }));
		expect(await fetchSystemInfo(esi, 1)).toBeNull();
		expect(await fetchConstellationInfo(esi, 1)).toBeNull();
		expect(await fetchRegionInfo(esi, 1)).toBeNull();
	});

	it('throws EsiError on other failures after retrying', async () => {
		const { esi, calls } = esiWith(() => json({ error: 'down' }, { status: 503 }));
		await expect(fetchSystemInfo(esi, 30004604)).rejects.toMatchObject({
			name: 'EsiError',
			status: 503,
			path: '/universe/systems/30004604'
		});
		expect(calls).toHaveLength(2);
		await expect(fetchRegionInfo(esi, 10000058)).rejects.toBeInstanceOf(EsiError);
	});

	it('fetchAffiliations posts JSON id chunks of 100 and maps missing alliances to null', async () => {
		const ids = Array.from({ length: 205 }, (_, i) => 90000001 + i);
		const { esi, calls } = esiWith(({ body }) =>
			json(
				(JSON.parse(body!) as number[]).map((id) => ({
					character_id: id,
					corporation_id: 98000001,
					...(id % 2 ? { alliance_id: 99000001 } : {})
				}))
			)
		);
		const { items, failedChunks } = await fetchAffiliations(esi, [...ids, ids[0]]);
		expect(calls.map((c) => [c.method, c.url, (JSON.parse(c.body!) as number[]).length])).toEqual([
			['POST', 'https://esi.evetech.net/characters/affiliation', ESI_BULK_CHUNK],
			['POST', 'https://esi.evetech.net/characters/affiliation', ESI_BULK_CHUNK],
			['POST', 'https://esi.evetech.net/characters/affiliation', 5]
		]);
		expect(calls[0].headers.get('Content-Type')).toBe('application/json');
		expect(calls[0].headers.get('X-Compatibility-Date')).toBe(ESI_COMPAT_DATE);
		expect(items).toHaveLength(205);
		expect(items.slice(0, 2)).toEqual([
			{ characterId: 90000001, corporationId: 98000001, allianceId: 99000001 },
			{ characterId: 90000002, corporationId: 98000001, allianceId: null }
		]);
		expect(failedChunks).toEqual([]);
	});

	it('reports a refused chunk and still resolves the others', async () => {
		const ids = Array.from({ length: 150 }, (_, i) => 1 + i);
		const { esi } = esiWith(({ body }) => {
			const chunk = JSON.parse(body!) as number[];
			return chunk[0] === 1
				? json({ error: 'Invalid character ID' }, { status: 404 })
				: json(chunk.map((id) => ({ id, name: `Name ${id}`, category: 'corporation' })));
		});
		const { items, failedChunks } = await fetchNames(esi, ids);
		expect(items.map((i) => i.id)).toEqual(ids.slice(100));
		expect(items[0]).toEqual({ id: 101, name: 'Name 101', category: 'corporation' });
		expect(failedChunks).toEqual([{ ids: ids.slice(0, 100), status: 404 }]);
	});
});
