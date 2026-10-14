import type { EsiClient, EsiFailure } from './esi.ts';

/** One row of `/characters/{id}/wallet/transactions` or `/corporations/{id}/wallets/{division}/transactions`. */
export interface WalletTransaction {
	transactionId: number;
	/** Unix ms. */
	date: number;
	typeId: number;
	quantity: number;
	unitPrice: number;
	isBuy: boolean;
	clientId: number;
	locationId: number;
	journalRefId: number;
	/** Character rows only: whether the trade was for the character, not their corporation. */
	isPersonal: boolean | null;
}

interface EsiWalletTransaction {
	transaction_id: number;
	date: string;
	type_id: number;
	quantity: number;
	unit_price: number;
	is_buy: boolean;
	client_id: number;
	location_id: number;
	journal_ref_id: number;
	is_personal?: boolean;
}

export type WalletTransactionPage =
	{ ok: true; items: WalletTransaction[]; expiresAt: number | null } | EsiFailure;

function mapTransaction(row: EsiWalletTransaction): WalletTransaction {
	return {
		transactionId: row.transaction_id,
		date: Date.parse(row.date),
		typeId: row.type_id,
		quantity: row.quantity,
		unitPrice: row.unit_price,
		isBuy: row.is_buy,
		clientId: row.client_id,
		locationId: row.location_id,
		journalRefId: row.journal_ref_id,
		isPersonal: row.is_personal ?? null
	};
}

async function fetchTransactionPage(
	client: EsiClient,
	path: string,
	accessToken: string,
	fromId: number | undefined
): Promise<WalletTransactionPage> {
	const query = fromId == null ? '' : `?from_id=${fromId}`;
	const res = await client.get<EsiWalletTransaction[]>(path + query, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return { ok: true, items: (res.data ?? []).map(mapTransaction), expiresAt: res.expiresAt };
}

/** One call of `/characters/{id}/wallet/transactions` (scope `esi-wallet.read_character_wallet.v1`). Non-2XX is returned, not thrown. */
export function fetchCharacterWalletTransactions(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	fromId?: number
): Promise<WalletTransactionPage> {
	return fetchTransactionPage(client, `/characters/${characterId}/wallet/transactions`, accessToken, fromId);
}

/** One call of `/corporations/{id}/wallets/{division}/transactions` (scope `esi-wallet.read_corporation_wallets.v1`, role Accountant or Junior_Accountant). */
export function fetchCorporationWalletTransactions(
	client: EsiClient,
	corporationId: number,
	division: number,
	accessToken: string,
	fromId?: number
): Promise<WalletTransactionPage> {
	return fetchTransactionPage(
		client,
		`/corporations/${corporationId}/wallets/${division}/transactions`,
		accessToken,
		fromId
	);
}

export type WalletTransactionWalk =
	{ ok: true; items: WalletTransaction[]; complete: boolean; expiresAt: number | null } | EsiFailure;

/**
 * Walks the transactions endpoint backwards from the newest row. The first call has no `from_id`; each
 * next call passes the smallest `transaction_id` seen − 1. ESI documents `from_id` as "only show
 * transactions happened before the one referenced by this id", but the row with that id has been
 * reported back too (esi-issues #553, #715), so asking for one below the smallest seen is correct
 * under either reading; duplicates are dropped anyway.
 *
 * Stops (`complete: true`) at an empty page, at a page reaching `sinceId` (rows ≤ `sinceId` are
 * already stored and left out) or at a page with nothing new; stops with `complete: false` after
 * `maxPages` calls. Returns the rows newest first and the `Expires` of the first call, or the first
 * failing call.
 */
export async function collectWalletTransactions(
	fetchPage: (fromId: number | undefined) => Promise<WalletTransactionPage>,
	sinceId: number | null,
	maxPages: number
): Promise<WalletTransactionWalk> {
	const seen = new Map<number, WalletTransaction>();
	let expiresAt: number | null = null;
	let fromId: number | undefined;
	for (let call = 0; call < maxPages; call++) {
		const page = await fetchPage(fromId);
		if (!page.ok) return page;
		if (call === 0) expiresAt = page.expiresAt;
		let smallest = Infinity;
		let added = 0;
		for (const row of page.items) {
			smallest = Math.min(smallest, row.transactionId);
			if (sinceId != null && row.transactionId <= sinceId) continue;
			if (seen.has(row.transactionId)) continue;
			seen.set(row.transactionId, row);
			added++;
		}
		const reachedCursor = sinceId != null && smallest <= sinceId;
		if (page.items.length === 0 || reachedCursor || added === 0) return done(seen, true, expiresAt);
		fromId = smallest - 1;
	}
	return done(seen, false, expiresAt);
}

function done(
	seen: Map<number, WalletTransaction>,
	complete: boolean,
	expiresAt: number | null
): WalletTransactionWalk {
	const items = [...seen.values()].sort((a, b) => b.transactionId - a.transactionId);
	return { ok: true, items, complete, expiresAt };
}

/**
 * Journal `ref_type`s profit tracking keeps (trades, contracts, fees, taxes and reaction job costs).
 * `market_provider_tax` is the SCC surcharge of a structure market, charged with the broker fee when an
 * order is placed (seen on the owner's corporation wallet, B22 probe).
 */
export const TRACKED_JOURNAL_REF_TYPES = {
	market_transaction: true,
	market_escrow: true,
	brokers_fee: true,
	market_provider_tax: true,
	transaction_tax: true,
	contract_price: true,
	contract_price_payment_corp: true,
	contract_brokers_fee: true,
	contract_brokers_fee_corp: true,
	contract_sales_tax: true,
	contract_reward: true,
	contract_reward_deposited: true,
	contract_reward_deposited_corp: true,
	contract_reward_refund: true,
	industry_job_tax: true,
	reaction: true
} as const satisfies Record<string, true>;

export type TrackedJournalRefType = keyof typeof TRACKED_JOURNAL_REF_TYPES;

export function isTrackedJournalRefType(refType: string): refType is TrackedJournalRefType {
	return Object.hasOwn(TRACKED_JOURNAL_REF_TYPES, refType);
}

/** One row of `/characters/{id}/wallet/journal` or `/corporations/{id}/wallets/{division}/journal`. */
export interface WalletJournalEntry {
	id: number;
	/** Unix ms. */
	date: number;
	refType: string;
	amount: number | null;
	tax: number | null;
	contextId: number | null;
	/** `market_transaction_id`, `contract_id`, `industry_job_id`, … */
	contextIdType: string | null;
	firstPartyId: number | null;
	secondPartyId: number | null;
	description: string;
	reason: string | null;
}

interface EsiWalletJournalEntry {
	id: number;
	date: string;
	ref_type: string;
	amount?: number;
	tax?: number;
	context_id?: number;
	context_id_type?: string;
	first_party_id?: number;
	second_party_id?: number;
	description: string;
	reason?: string;
}

export type WalletJournalPage =
	{ ok: true; items: WalletJournalEntry[]; pages: number; expiresAt: number | null } | EsiFailure;

function mapJournalEntry(row: EsiWalletJournalEntry): WalletJournalEntry {
	return {
		id: row.id,
		date: Date.parse(row.date),
		refType: row.ref_type,
		amount: row.amount ?? null,
		tax: row.tax ?? null,
		contextId: row.context_id ?? null,
		contextIdType: row.context_id_type ?? null,
		firstPartyId: row.first_party_id ?? null,
		secondPartyId: row.second_party_id ?? null,
		description: row.description,
		reason: row.reason ?? null
	};
}

async function fetchJournalPage(
	client: EsiClient,
	path: string,
	accessToken: string,
	page: number
): Promise<WalletJournalPage> {
	const res = await client.get<EsiWalletJournalEntry[]>(`${path}?page=${page}`, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return {
		ok: true,
		items: (res.data ?? []).map(mapJournalEntry),
		pages: res.pages,
		expiresAt: res.expiresAt
	};
}

/** One page of `/characters/{id}/wallet/journal` (scope `esi-wallet.read_character_wallet.v1`, 30 days). */
export function fetchCharacterWalletJournal(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	page: number
): Promise<WalletJournalPage> {
	return fetchJournalPage(client, `/characters/${characterId}/wallet/journal`, accessToken, page);
}

/** One page of `/corporations/{id}/wallets/{division}/journal` (scope `esi-wallet.read_corporation_wallets.v1`, role Accountant or Junior_Accountant). */
export function fetchCorporationWalletJournal(
	client: EsiClient,
	corporationId: number,
	division: number,
	accessToken: string,
	page: number
): Promise<WalletJournalPage> {
	return fetchJournalPage(
		client,
		`/corporations/${corporationId}/wallets/${division}/journal`,
		accessToken,
		page
	);
}
