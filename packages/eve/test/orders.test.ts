import { describe, expect, it, vi } from 'vitest';
import {
	createEsiClient,
	fetchCharacterOrderHistory,
	fetchCharacterOrders,
	fetchCorporationOrderHistory,
	fetchCorporationOrders,
	type OwnMarketOrder
} from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, attempts: 1, sleep: vi.fn(async () => {}) })
	};
}

const ESI_ORDER = {
	order_id: 400,
	type_id: 16663,
	region_id: 10000002,
	location_id: 60003760,
	range: 'station',
	price: 1600,
	volume_total: 1000,
	volume_remain: 250,
	issued: '2026-10-11T07:15:00Z',
	duration: 90
};

const ORDER: OwnMarketOrder = {
	orderId: 400,
	typeId: 16663,
	isBuyOrder: false,
	price: 1600,
	volumeTotal: 1000,
	volumeRemain: 250,
	issued: Date.UTC(2026, 9, 11, 7, 15),
	locationId: 60003760,
	regionId: 10000002,
	duration: 90,
	range: 'station',
	escrow: null,
	minVolume: null,
	state: 'open',
	walletDivision: null,
	isCorporation: null
};

describe('own market order clients', () => {
	it('fetches open character orders as open, sell when is_buy_order is absent', async () => {
		const { esi, calls } = esiWith(() =>
			json([
				{ ...ESI_ORDER, is_corporation: false },
				{
					...ESI_ORDER,
					order_id: 401,
					is_buy_order: true,
					escrow: 50000,
					min_volume: 10,
					range: 'region',
					is_corporation: true
				}
			])
		);
		expect(await fetchCharacterOrders(esi, 9001, 'tok')).toEqual({
			ok: true,
			items: [
				{ ...ORDER, isCorporation: false },
				{
					...ORDER,
					orderId: 401,
					isBuyOrder: true,
					escrow: 50000,
					minVolume: 10,
					range: 'region',
					isCorporation: true
				}
			],
			pages: 1,
			expiresAt: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/orders');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('fetches a character history page with the reported state', async () => {
		const { esi, calls } = esiWith(() =>
			json([{ ...ESI_ORDER, state: 'expired', is_corporation: false }], { headers: { 'X-Pages': '2' } })
		);
		expect(await fetchCharacterOrderHistory(esi, 9001, 'tok', 2)).toEqual({
			ok: true,
			items: [{ ...ORDER, state: 'expired', isCorporation: false }],
			pages: 2,
			expiresAt: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/orders/history?page=2');
	});

	it('fetches corporation orders and history pages with the wallet division', async () => {
		const { esi, calls } = esiWith((call) =>
			call.url.includes('/history')
				? json([{ ...ESI_ORDER, state: 'cancelled', wallet_division: 2, issued_by: 9001 }])
				: json([{ ...ESI_ORDER, wallet_division: 1, issued_by: 9001 }])
		);
		const open = await fetchCorporationOrders(esi, 98000001, 'tok', 1);
		const history = await fetchCorporationOrderHistory(esi, 98000001, 'tok', 3);
		expect(open.ok && open.items).toEqual([{ ...ORDER, walletDivision: 1 }]);
		expect(history.ok && history.items).toEqual([{ ...ORDER, state: 'cancelled', walletDivision: 2 }]);
		expect(calls.map((c) => c.url)).toEqual([
			'https://esi.evetech.net/corporations/98000001/orders?page=1',
			'https://esi.evetech.net/corporations/98000001/orders/history?page=3'
		]);
	});

	it('returns 403 typed instead of throwing', async () => {
		const { esi } = esiWith(() => json({ error: 'forbidden' }, { status: 403 }));
		expect(await fetchCorporationOrders(esi, 98000001, 'tok', 1)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
	});
});
