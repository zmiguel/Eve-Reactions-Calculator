import { describe, expect, it, vi } from 'vitest';
import {
	createEsiClient,
	fetchCharacterContractItems,
	fetchCharacterContracts,
	fetchCorporationContractItems,
	fetchCorporationContracts
} from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, attempts: 1, sleep: vi.fn(async () => {}) })
	};
}

const ESI_CONTRACT = {
	contract_id: 300,
	type: 'item_exchange',
	status: 'finished',
	issuer_id: 9001,
	issuer_corporation_id: 98000001,
	acceptor_id: 2112,
	assignee_id: 2112,
	for_corporation: false,
	availability: 'personal',
	price: 125000000,
	reward: 0,
	title: 'janice.e-351.com/a/AbC123',
	collateral: 0,
	days_to_complete: 0,
	volume: 1000,
	date_issued: '2026-10-10T08:00:00Z',
	date_accepted: '2026-10-11T09:30:00Z',
	date_completed: '2026-10-11T09:30:00Z',
	date_expired: '2026-10-24T08:00:00Z',
	start_location_id: 60003760,
	end_location_id: 60003760
};

describe('contract clients', () => {
	it('fetches a character contract page with the bearer token and maps dates to ms', async () => {
		const { esi, calls } = esiWith(() =>
			json([ESI_CONTRACT], { headers: { 'X-Pages': '3', Expires: 'Mon, 12 Oct 2026 12:05:00 GMT' } })
		);
		expect(await fetchCharacterContracts(esi, 9001, 'tok', 2)).toEqual({
			ok: true,
			items: [
				{
					contractId: 300,
					type: 'item_exchange',
					status: 'finished',
					issuerId: 9001,
					issuerCorporationId: 98000001,
					acceptorId: 2112,
					assigneeId: 2112,
					forCorporation: false,
					availability: 'personal',
					price: 125000000,
					reward: 0,
					title: 'janice.e-351.com/a/AbC123',
					dateIssued: Date.UTC(2026, 9, 10, 8),
					dateAccepted: Date.UTC(2026, 9, 11, 9, 30),
					dateCompleted: Date.UTC(2026, 9, 11, 9, 30),
					dateExpired: Date.UTC(2026, 9, 24, 8),
					startLocationId: 60003760,
					endLocationId: 60003760
				}
			],
			pages: 3,
			expiresAt: Date.UTC(2026, 9, 12, 12, 5)
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/contracts?page=2');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('maps absent optional contract fields to null', async () => {
		const outstanding: Record<string, unknown> = {
			...ESI_CONTRACT,
			status: 'outstanding',
			acceptor_id: 0,
			assignee_id: 0,
			availability: 'public'
		};
		for (const key of [
			'price',
			'reward',
			'title',
			'date_accepted',
			'date_completed',
			'start_location_id',
			'end_location_id'
		])
			delete outstanding[key];
		const { esi, calls } = esiWith(() => json([outstanding]));
		const result = await fetchCorporationContracts(esi, 98000001, 'tok', 1);
		expect(result.ok && result.items[0]).toMatchObject({
			status: 'outstanding',
			acceptorId: 0,
			price: null,
			reward: null,
			title: null,
			dateAccepted: null,
			dateCompleted: null,
			startLocationId: null,
			endLocationId: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/contracts?page=1');
	});

	it('returns 403 typed instead of throwing', async () => {
		const { esi } = esiWith(() => json({ error: 'forbidden' }, { status: 403 }));
		expect(await fetchCorporationContracts(esi, 98000001, 'tok', 1)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
	});
});

describe('contract item clients', () => {
	it('fetches the items of a character contract, offered and asked for', async () => {
		const { esi, calls } = esiWith(() =>
			json([
				{ record_id: 1, type_id: 16663, quantity: 2000, is_included: true, is_singleton: false },
				{
					record_id: 2,
					type_id: 46166,
					quantity: 1,
					is_included: false,
					is_singleton: true,
					raw_quantity: -2
				}
			])
		);
		expect(await fetchCharacterContractItems(esi, 9001, 300, 'tok')).toEqual({
			ok: true,
			items: [
				{
					recordId: 1,
					typeId: 16663,
					quantity: 2000,
					isIncluded: true,
					isSingleton: false,
					rawQuantity: null
				},
				{ recordId: 2, typeId: 46166, quantity: 1, isIncluded: false, isSingleton: true, rawQuantity: -2 }
			],
			expiresAt: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/contracts/300/items');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('fetches corporation contract items; 404 is typed', async () => {
		const { esi, calls } = esiWith(() => json({ error: 'Contract not found!' }, { status: 404 }));
		expect(await fetchCorporationContractItems(esi, 98000001, 300, 'tok')).toEqual({
			ok: false,
			status: 404,
			retryAfter: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/contracts/300/items');
	});
});
