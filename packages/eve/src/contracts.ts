import type { EsiClient, EsiFailure } from './esi.ts';

export type ContractType = 'unknown' | 'item_exchange' | 'auction' | 'courier' | 'loan';
export type ContractStatus =
	| 'outstanding'
	| 'in_progress'
	| 'finished_issuer'
	| 'finished_contractor'
	| 'finished'
	| 'cancelled'
	| 'rejected'
	| 'failed'
	| 'deleted'
	| 'reversed';
export type ContractAvailability = 'public' | 'personal' | 'corporation' | 'alliance';

/** One row of `/characters/{id}/contracts` or `/corporations/{id}/contracts`. Dates are unix ms. */
export interface Contract {
	contractId: number;
	type: ContractType;
	status: ContractStatus;
	issuerId: number;
	issuerCorporationId: number;
	/** 0 while nobody accepted it. */
	acceptorId: number;
	/** 0 for public contracts. */
	assigneeId: number;
	forCorporation: boolean;
	availability: ContractAvailability;
	price: number | null;
	reward: number | null;
	/** The only free text ESI exposes (the in-game description is not available). */
	title: string | null;
	dateIssued: number;
	dateAccepted: number | null;
	dateCompleted: number | null;
	dateExpired: number;
	startLocationId: number | null;
	endLocationId: number | null;
}

interface EsiContract {
	contract_id: number;
	type: ContractType;
	status: ContractStatus;
	issuer_id: number;
	issuer_corporation_id: number;
	acceptor_id: number;
	assignee_id: number;
	for_corporation: boolean;
	availability: ContractAvailability;
	price?: number;
	reward?: number;
	title?: string;
	date_issued: string;
	date_accepted?: string;
	date_completed?: string;
	date_expired: string;
	start_location_id?: number;
	end_location_id?: number;
}

/** One row of `…/contracts/{contract_id}/items`. */
export interface ContractItem {
	recordId: number;
	typeId: number;
	quantity: number;
	/** `false`: an item the issuer asks for in return. */
	isIncluded: boolean;
	isSingleton: boolean;
	/** -1 for a singleton, -2 for a blueprint copy; absent otherwise. */
	rawQuantity: number | null;
}

interface EsiContractItem {
	record_id: number;
	type_id: number;
	quantity: number;
	is_included: boolean;
	is_singleton: boolean;
	raw_quantity?: number;
}

export type ContractPage =
	{ ok: true; items: Contract[]; pages: number; expiresAt: number | null } | EsiFailure;

export type ContractItemsResult = { ok: true; items: ContractItem[]; expiresAt: number | null } | EsiFailure;

function mapContract(row: EsiContract): Contract {
	return {
		contractId: row.contract_id,
		type: row.type,
		status: row.status,
		issuerId: row.issuer_id,
		issuerCorporationId: row.issuer_corporation_id,
		acceptorId: row.acceptor_id,
		assigneeId: row.assignee_id,
		forCorporation: row.for_corporation,
		availability: row.availability,
		price: row.price ?? null,
		reward: row.reward ?? null,
		title: row.title ?? null,
		dateIssued: Date.parse(row.date_issued),
		dateAccepted: row.date_accepted ? Date.parse(row.date_accepted) : null,
		dateCompleted: row.date_completed ? Date.parse(row.date_completed) : null,
		dateExpired: Date.parse(row.date_expired),
		startLocationId: row.start_location_id ?? null,
		endLocationId: row.end_location_id ?? null
	};
}

async function fetchContractPage(
	client: EsiClient,
	path: string,
	accessToken: string,
	page: number
): Promise<ContractPage> {
	const res = await client.get<EsiContract[]>(`${path}?page=${page}`, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return { ok: true, items: (res.data ?? []).map(mapContract), pages: res.pages, expiresAt: res.expiresAt };
}

async function fetchItems(
	client: EsiClient,
	path: string,
	accessToken: string
): Promise<ContractItemsResult> {
	const res = await client.get<EsiContractItem[]>(path, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return {
		ok: true,
		items: (res.data ?? []).map((row) => ({
			recordId: row.record_id,
			typeId: row.type_id,
			quantity: row.quantity,
			isIncluded: row.is_included,
			isSingleton: row.is_singleton,
			rawQuantity: row.raw_quantity ?? null
		})),
		expiresAt: res.expiresAt
	};
}

/** One page of `/characters/{id}/contracts` (scope `esi-contracts.read_character_contracts.v1`; last 30 days or in progress). Non-2XX is returned, not thrown. */
export function fetchCharacterContracts(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	page: number
): Promise<ContractPage> {
	return fetchContractPage(client, `/characters/${characterId}/contracts`, accessToken, page);
}

/** One page of `/corporations/{id}/contracts` (scope `esi-contracts.read_corporation_contracts.v1`). */
export function fetchCorporationContracts(
	client: EsiClient,
	corporationId: number,
	accessToken: string,
	page: number
): Promise<ContractPage> {
	return fetchContractPage(client, `/corporations/${corporationId}/contracts`, accessToken, page);
}

/** `/characters/{id}/contracts/{contract_id}/items` (scope `esi-contracts.read_character_contracts.v1`). */
export function fetchCharacterContractItems(
	client: EsiClient,
	characterId: number,
	contractId: number,
	accessToken: string
): Promise<ContractItemsResult> {
	return fetchItems(client, `/characters/${characterId}/contracts/${contractId}/items`, accessToken);
}

/** `/corporations/{id}/contracts/{contract_id}/items` (scope `esi-contracts.read_corporation_contracts.v1`). */
export function fetchCorporationContractItems(
	client: EsiClient,
	corporationId: number,
	contractId: number,
	accessToken: string
): Promise<ContractItemsResult> {
	return fetchItems(client, `/corporations/${corporationId}/contracts/${contractId}/items`, accessToken);
}
