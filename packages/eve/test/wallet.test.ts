import { describe, expect, it, vi } from 'vitest';
import {
	TRACKED_JOURNAL_REF_TYPES,
	collectWalletTransactions,
	createEsiClient,
	fetchCharacterWalletJournal,
	fetchCharacterWalletTransactions,
	fetchCorporationWalletJournal,
	fetchCorporationWalletTransactions,
	isTrackedJournalRefType,
	type WalletTransaction,
	type WalletTransactionPage,
	type WalletTransactionWalk
} from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

function esiWith(handler: Parameters<typeof fakeFetch>[0]) {
	const fake = fakeFetch(handler);
	return {
		...fake,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, attempts: 1, sleep: vi.fn(async () => {}) })
	};
}

const ESI_TRANSACTION = {
	transaction_id: 5000,
	date: '2026-10-12T10:00:00Z',
	type_id: 16663,
	quantity: 200,
	unit_price: 1500.5,
	is_buy: true,
	client_id: 2112,
	location_id: 60003760,
	journal_ref_id: 77
};

const TRANSACTION: WalletTransaction = {
	transactionId: 5000,
	date: Date.UTC(2026, 9, 12, 10),
	typeId: 16663,
	quantity: 200,
	unitPrice: 1500.5,
	isBuy: true,
	clientId: 2112,
	locationId: 60003760,
	journalRefId: 77,
	isPersonal: null
};

describe('wallet transaction clients', () => {
	it('fetches the newest character transactions with the bearer token', async () => {
		const { esi, calls } = esiWith(() =>
			json([{ ...ESI_TRANSACTION, is_personal: true }], {
				headers: { Expires: 'Mon, 12 Oct 2026 11:00:00 GMT' }
			})
		);
		expect(await fetchCharacterWalletTransactions(esi, 9001, 'tok')).toEqual({
			ok: true,
			items: [{ ...TRANSACTION, isPersonal: true }],
			expiresAt: Date.UTC(2026, 9, 12, 11)
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/wallet/transactions');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('passes from_id and the corporation wallet division', async () => {
		const { esi, calls } = esiWith(() => json([ESI_TRANSACTION]));
		expect(await fetchCorporationWalletTransactions(esi, 98000001, 3, 'tok', 4999)).toEqual({
			ok: true,
			items: [TRANSACTION],
			expiresAt: null
		});
		expect(calls[0]!.url).toBe(
			'https://esi.evetech.net/corporations/98000001/wallets/3/transactions?from_id=4999'
		);
	});

	it('returns 403 typed instead of throwing', async () => {
		const { esi } = esiWith(() => json({ error: 'forbidden' }, { status: 403 }));
		expect(await fetchCorporationWalletTransactions(esi, 98000001, 1, 'tok')).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
	});
});

describe('collectWalletTransactions', () => {
	const tx = (transactionId: number): WalletTransaction => ({ ...TRANSACTION, transactionId });
	const ids = (result: WalletTransactionWalk) =>
		result.ok ? result.items.map((t) => t.transactionId) : result;

	/** Serves `history` (any order) like ESI: the 3 newest rows with id ≤ from_id (inclusive, as observed). */
	function wallet(history: number[], pageSize = 3) {
		const fromIds: (number | undefined)[] = [];
		const fetchPage = vi.fn(async (fromId: number | undefined): Promise<WalletTransactionPage> => {
			fromIds.push(fromId);
			const rows = history
				.filter((id) => fromId == null || id <= fromId)
				.sort((a, b) => b - a)
				.slice(0, pageSize);
			return { ok: true, items: rows.map(tx), expiresAt: 1000 + fromIds.length };
		});
		return { fetchPage, fromIds };
	}

	it('walks back to the oldest row and stops at an empty page', async () => {
		const { fetchPage, fromIds } = wallet([10, 9, 8, 7, 6, 5, 4]);
		const result = await collectWalletTransactions(fetchPage, null, 10);
		expect(ids(result)).toEqual([10, 9, 8, 7, 6, 5, 4]);
		expect(result).toMatchObject({ ok: true, complete: true, expiresAt: 1001 });
		expect(fromIds).toEqual([undefined, 7, 4, 3]);
	});

	it('stops at the page reaching the stored cursor and leaves out older rows', async () => {
		const { fetchPage, fromIds } = wallet([10, 9, 8, 7, 6, 5, 4, 3, 2]);
		const result = await collectWalletTransactions(fetchPage, 6, 10);
		expect(ids(result)).toEqual([10, 9, 8, 7]);
		expect(result).toMatchObject({ ok: true, complete: true });
		expect(fromIds).toEqual([undefined, 7]);
	});

	it('makes one call when nothing is newer than the cursor', async () => {
		const { fetchPage } = wallet([10, 9]);
		const result = await collectWalletTransactions(fetchPage, 10, 10);
		expect(result).toEqual({ ok: true, items: [], complete: true, expiresAt: 1001 });
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('reports an incomplete walk after maxPages calls', async () => {
		const { fetchPage } = wallet([10, 9, 8, 7, 6, 5, 4]);
		const result = await collectWalletTransactions(fetchPage, null, 2);
		expect(ids(result)).toEqual([10, 9, 8, 7, 6, 5]);
		expect(result).toMatchObject({ ok: true, complete: false });
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('drops rows seen twice and stops when a page brings nothing new', async () => {
		const pages: number[][] = [
			[10, 9, 8],
			[8, 7],
			[8, 7]
		];
		const fetchPage = vi.fn(async (): Promise<WalletTransactionPage> => ({
			ok: true,
			items: (pages.shift() ?? []).map(tx),
			expiresAt: null
		}));
		const result = await collectWalletTransactions(fetchPage, null, 10);
		expect(ids(result)).toEqual([10, 9, 8, 7]);
		expect(result).toMatchObject({ ok: true, complete: true });
		expect(fetchPage).toHaveBeenCalledTimes(3);
	});

	it('returns the first failing call', async () => {
		const answers: WalletTransactionPage[] = [
			{ ok: true, items: [tx(10)], expiresAt: null },
			{ ok: false, status: 403, retryAfter: null }
		];
		const fetchPage = vi.fn(async () => answers.shift()!);
		expect(await collectWalletTransactions(fetchPage, null, 10)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
	});

	it('walks a corporation division through the client', async () => {
		const { esi, calls } = esiWith((call) =>
			new URL(call.url).searchParams.has('from_id') ? json([]) : json([ESI_TRANSACTION])
		);
		const result = await collectWalletTransactions(
			(fromId) => fetchCorporationWalletTransactions(esi, 98000001, 2, 'tok', fromId),
			null,
			5
		);
		expect(result).toEqual({ ok: true, items: [TRANSACTION], complete: true, expiresAt: null });
		expect(calls.map((c) => c.url)).toEqual([
			'https://esi.evetech.net/corporations/98000001/wallets/2/transactions',
			'https://esi.evetech.net/corporations/98000001/wallets/2/transactions?from_id=4999'
		]);
	});
});

describe('wallet journal clients', () => {
	const ESI_ENTRY = {
		id: 77,
		date: '2026-10-12T10:00:00Z',
		ref_type: 'market_transaction',
		amount: -300100,
		balance: 1e9,
		context_id: 5000,
		context_id_type: 'market_transaction_id',
		first_party_id: 9001,
		second_party_id: 2112,
		description: 'Market: Pilot bought stuff',
		reason: ''
	};

	it('fetches a character journal page and maps nullable fields', async () => {
		const { esi, calls } = esiWith(() =>
			json(
				[
					ESI_ENTRY,
					{ id: 78, date: '2026-10-12T10:00:01Z', ref_type: 'reaction', description: 'Reaction fee' }
				],
				{ headers: { 'X-Pages': '4' } }
			)
		);
		expect(await fetchCharacterWalletJournal(esi, 9001, 'tok', 2)).toEqual({
			ok: true,
			items: [
				{
					id: 77,
					date: Date.UTC(2026, 9, 12, 10),
					refType: 'market_transaction',
					amount: -300100,
					tax: null,
					contextId: 5000,
					contextIdType: 'market_transaction_id',
					firstPartyId: 9001,
					secondPartyId: 2112,
					description: 'Market: Pilot bought stuff',
					reason: ''
				},
				{
					id: 78,
					date: Date.UTC(2026, 9, 12, 10, 0, 1),
					refType: 'reaction',
					amount: null,
					tax: null,
					contextId: null,
					contextIdType: null,
					firstPartyId: null,
					secondPartyId: null,
					description: 'Reaction fee',
					reason: null
				}
			],
			pages: 4,
			expiresAt: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/characters/9001/wallet/journal?page=2');
		expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
	});

	it('fetches a corporation division journal page; 403 is typed', async () => {
		const { esi, calls } = esiWith(() => json({ error: 'forbidden' }, { status: 403 }));
		expect(await fetchCorporationWalletJournal(esi, 98000001, 7, 'tok', 1)).toEqual({
			ok: false,
			status: 403,
			retryAfter: null
		});
		expect(calls[0]!.url).toBe('https://esi.evetech.net/corporations/98000001/wallets/7/journal?page=1');
	});

	it('keeps trade, contract, fee and reaction ref types only', () => {
		expect(Object.keys(TRACKED_JOURNAL_REF_TYPES)).toHaveLength(16);
		expect(isTrackedJournalRefType('brokers_fee')).toBe(true);
		expect(isTrackedJournalRefType('market_provider_tax')).toBe(true);
		expect(isTrackedJournalRefType('contract_reward_deposited_corp')).toBe(true);
		expect(isTrackedJournalRefType('player_donation')).toBe(false);
		expect(isTrackedJournalRefType('toString')).toBe(false);
	});
});
