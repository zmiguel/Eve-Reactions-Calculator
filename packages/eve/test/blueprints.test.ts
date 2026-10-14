import { describe, expect, it, vi } from 'vitest';
import { createEsiClient, fetchCharacterBlueprints, fetchCorporationBlueprints } from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, attempts: 1, sleep: vi.fn(async () => {}) })
	};
}

const ESI_BLUEPRINT = {
	item_id: 1000000001,
	type_id: 46207,
	location_id: 1030000000001,
	location_flag: 'Hangar',
	material_efficiency: 10,
	time_efficiency: 20,
	runs: -1,
	quantity: -1
};

describe('blueprint clients', () => {
	it('fetches a character blueprint page with the bearer token and maps the rows', async () => {
		const { esi, calls } = esiWith(() =>
			json(
				[
					ESI_BLUEPRINT,
					{ ...ESI_BLUEPRINT, item_id: 1000000002, material_efficiency: 4, runs: 12, quantity: -2 }
				],
				{
					headers: { 'X-Pages': '2', Expires: 'Mon, 12 Oct 2026 12:05:00 GMT' }
				}
			)
		);
		expect(await fetchCharacterBlueprints(esi, 9001, 'tok', 2)).toEqual({
			ok: true,
			items: [
				{
					itemId: 1000000001,
					typeId: 46207,
					locationId: 1030000000001,
					materialEfficiency: 10,
					timeEfficiency: 20,
					runs: -1,
					quantity: -1
				},
				{
					itemId: 1000000002,
					typeId: 46207,
					locationId: 1030000000001,
					materialEfficiency: 4,
					timeEfficiency: 20,
					runs: 12,
					quantity: -2
				}
			],
			pages: 2,
			expiresAt: Date.UTC(2026, 9, 12, 12, 5)
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/blueprints?page=2');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('uses the corporation path', async () => {
		const { esi, calls } = esiWith(() => json([]));
		const page = await fetchCorporationBlueprints(esi, 98000001, 'tok', 1);
		expect(page).toMatchObject({ ok: true, items: [] });
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/blueprints?page=1');
	});

	it('returns 403 typed instead of throwing', async () => {
		const { esi } = esiWith(() =>
			json({ error: 'Character does not have required role(s)' }, { status: 403 })
		);
		expect(await fetchCorporationBlueprints(esi, 98000001, 'tok', 1)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
	});
});
