import type { EsiClient, EsiFailure } from './esi.ts';

export type OwnMarketOrderState = 'open' | 'cancelled' | 'expired';

/**
 * A market order of a character or corporation (`/characters/{id}/orders[/history]`,
 * `/corporations/{id}/orders[/history]`). Named apart from `MarketOrder`, the public order book row.
 */
export interface OwnMarketOrder {
	orderId: number;
	typeId: number;
	isBuyOrder: boolean;
	price: number;
	volumeTotal: number;
	volumeRemain: number;
	/** Unix ms. */
	issued: number;
	locationId: number;
	regionId: number;
	/** Days; 0 for an instant trade. */
	duration: number;
	range: string;
	/** Buy orders only. */
	escrow: number | null;
	minVolume: number | null;
	/** `open` for the current-orders endpoints; history reports `cancelled` or `expired`. */
	state: OwnMarketOrderState;
	/** Corporation orders only. */
	walletDivision: number | null;
	/** Character orders only: placed on behalf of the corporation. */
	isCorporation: boolean | null;
}

interface EsiOwnOrder {
	order_id: number;
	type_id: number;
	is_buy_order?: boolean;
	price: number;
	volume_total: number;
	volume_remain: number;
	issued: string;
	location_id: number;
	region_id: number;
	duration: number;
	range: string;
	escrow?: number;
	min_volume?: number;
	state?: 'cancelled' | 'expired';
	wallet_division?: number;
	is_corporation?: boolean;
}

export type OwnMarketOrderPage =
	{ ok: true; items: OwnMarketOrder[]; pages: number; expiresAt: number | null } | EsiFailure;

function mapOrder(row: EsiOwnOrder): OwnMarketOrder {
	return {
		orderId: row.order_id,
		typeId: row.type_id,
		isBuyOrder: row.is_buy_order ?? false,
		price: row.price,
		volumeTotal: row.volume_total,
		volumeRemain: row.volume_remain,
		issued: Date.parse(row.issued),
		locationId: row.location_id,
		regionId: row.region_id,
		duration: row.duration,
		range: row.range,
		escrow: row.escrow ?? null,
		minVolume: row.min_volume ?? null,
		state: row.state ?? 'open',
		walletDivision: row.wallet_division ?? null,
		isCorporation: row.is_corporation ?? null
	};
}

async function fetchOrderPage(
	client: EsiClient,
	path: string,
	accessToken: string
): Promise<OwnMarketOrderPage> {
	const res = await client.get<EsiOwnOrder[]>(path, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return { ok: true, items: (res.data ?? []).map(mapOrder), pages: res.pages, expiresAt: res.expiresAt };
}

/** Open orders of `/characters/{id}/orders` (scope `esi-markets.read_character_orders.v1`, not paged). Non-2XX is returned, not thrown. */
export function fetchCharacterOrders(
	client: EsiClient,
	characterId: number,
	accessToken: string
): Promise<OwnMarketOrderPage> {
	return fetchOrderPage(client, `/characters/${characterId}/orders`, accessToken);
}

/** One page of `/characters/{id}/orders/history` (scope `esi-markets.read_character_orders.v1`, 90 days). */
export function fetchCharacterOrderHistory(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	page: number
): Promise<OwnMarketOrderPage> {
	return fetchOrderPage(client, `/characters/${characterId}/orders/history?page=${page}`, accessToken);
}

/** One page of `/corporations/{id}/orders` (scope `esi-markets.read_corporation_orders.v1`, role Accountant or Trader). */
export function fetchCorporationOrders(
	client: EsiClient,
	corporationId: number,
	accessToken: string,
	page: number
): Promise<OwnMarketOrderPage> {
	return fetchOrderPage(client, `/corporations/${corporationId}/orders?page=${page}`, accessToken);
}

/** One page of `/corporations/{id}/orders/history` (scope `esi-markets.read_corporation_orders.v1`, role Accountant or Trader). */
export function fetchCorporationOrderHistory(
	client: EsiClient,
	corporationId: number,
	accessToken: string,
	page: number
): Promise<OwnMarketOrderPage> {
	return fetchOrderPage(client, `/corporations/${corporationId}/orders/history?page=${page}`, accessToken);
}
