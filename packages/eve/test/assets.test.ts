import { describe, expect, it, vi } from 'vitest';
import {
	ESI_COMPAT_DATE,
	EsiError,
	createEsiClient,
	fetchCharacterAssets,
	fetchCorporationAssets,
	fetchCorporationDivisions,
	fetchStationInfo
} from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, attempts: 1, sleep: vi.fn(async () => {}) })
	};
}

const ROW = {
	item_id: 1,
	type_id: 46166,
	quantity: 2,
	location_id: 60003760,
	location_type: 'station',
	location_flag: 'Hangar',
	is_singleton: false,
	is_blueprint_copy: false
};

describe('asset clients', () => {
	it('fetches one character page with the bearer token, pages, Last-Modified and Expires', async () => {
		const { esi, calls } = esiWith(() =>
			json([ROW, { ...ROW, item_id: 2, is_blueprint_copy: undefined, is_singleton: true }], {
				headers: {
					'X-Pages': '3',
					'Last-Modified': 'Mon, 12 Oct 2026 10:00:00 GMT',
					Expires: 'Mon, 12 Oct 2026 11:00:00 GMT'
				}
			})
		);
		expect(await fetchCharacterAssets(esi, 9001, 'tok', 2)).toEqual({
			ok: true,
			pages: 3,
			lastModified: Date.UTC(2026, 9, 12, 10),
			expiresAt: Date.UTC(2026, 9, 12, 11),
			items: [
				{
					itemId: 1,
					typeId: 46166,
					quantity: 2,
					locationId: 60003760,
					locationType: 'station',
					locationFlag: 'Hangar',
					isSingleton: false,
					isBlueprintCopy: false
				},
				{
					itemId: 2,
					typeId: 46166,
					quantity: 2,
					locationId: 60003760,
					locationType: 'station',
					locationFlag: 'Hangar',
					isSingleton: true
				}
			]
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/assets?page=2');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
		expect(calls[0]!.headers.get('X-Compatibility-Date')).toBe(ESI_COMPAT_DATE);
	});

	it('returns lastModified and expiresAt null when the headers are absent', async () => {
		const { esi } = esiWith(() => json([]));
		expect(await fetchCharacterAssets(esi, 9001, 'tok', 1)).toEqual({
			ok: true,
			items: [],
			pages: 1,
			lastModified: null,
			expiresAt: null
		});
	});

	it('returns non-2XX pages typed instead of throwing', async () => {
		const { esi } = esiWith(() => json({ error: 'forbidden' }, { status: 403 }));
		expect(await fetchCharacterAssets(esi, 9001, 'tok', 1)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
		const notFound = esiWith(() => json({ error: 'nope' }, { status: 404 }));
		expect(await fetchCorporationAssets(notFound.esi, 98000001, 'tok', 1)).toMatchObject({
			ok: false,
			status: 404
		});
	});

	it('fetches corporation pages from the corporation path', async () => {
		const { esi, calls } = esiWith(() => json([{ ...ROW, location_flag: 'CorpSAG1' }]));
		const page = await fetchCorporationAssets(esi, 98000001, 'tok', 1);
		expect(page.ok && page.items[0]!.locationFlag).toBe('CorpSAG1');
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/assets?page=1');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('maps named hangar divisions only; 403 is null, other errors throw', async () => {
		const { esi, calls } = esiWith(() =>
			json({
				hangar: [{ division: 1, name: 'Moon goo' }, { division: 2 }, { division: 3, name: 'Fuel' }],
				wallet: [{ division: 1, name: 'Master Wallet' }]
			})
		);
		expect(await fetchCorporationDivisions(esi, 98000001, 'tok')).toEqual({ 1: 'Moon goo', 3: 'Fuel' });
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/divisions');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
		const denied = esiWith(() => json({ error: 'x' }, { status: 403 }));
		expect(await fetchCorporationDivisions(denied.esi, 98000001, 'tok')).toBeNull();
		const broken = esiWith(() => json({ error: 'x' }, { status: 500 }));
		await expect(fetchCorporationDivisions(broken.esi, 98000001, 'tok')).rejects.toBeInstanceOf(EsiError);
	});

	it('fetchStationInfo maps name and system; 404 is null', async () => {
		const { esi, calls } = esiWith(() =>
			json({
				station_id: 60003760,
				name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
				system_id: 30000142
			})
		);
		expect(await fetchStationInfo(esi, 60003760)).toEqual({
			stationId: 60003760,
			name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
			systemId: 30000142
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/universe/stations/60003760');
		expect(calls[0]!.headers.get('Authorization')).toBeNull();
		const missing = esiWith(() => json({ error: 'not found' }, { status: 404 }));
		expect(await fetchStationInfo(missing.esi, 1)).toBeNull();
	});
});
