import { describe, expect, it, vi } from 'vitest';
import {
	ESI_COMPAT_DATE,
	EsiError,
	createEsiClient,
	fetchConstellationInfo,
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
});
