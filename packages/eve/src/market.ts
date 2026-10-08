import { EsiError, fetchAllPages, parseExpires } from './esi.ts';
import type { EsiClient, FetchFn, PagedResult } from './esi.ts';

export const STRUCTURE_SCOPES = [
	'esi-markets.structure_markets.v1',
	'esi-universe.read_structures.v1',
	'esi-search.search_structures.v1'
] as const;

export const SDE_LATEST_URL = 'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';

export interface MarketOrder {
	orderId: number;
	typeId: number;
	locationId: number;
	/** Absent on structure market orders. */
	systemId: number | null;
	isBuyOrder: boolean;
	price: number;
	volumeRemain: number;
	range: string;
}

interface RawOrder {
	order_id: number;
	type_id: number;
	location_id: number;
	system_id?: number;
	is_buy_order: boolean;
	price: number;
	volume_remain: number;
	range: string;
}

function mapOrders(result: PagedResult<RawOrder>): PagedResult<MarketOrder> {
	if (!result.ok) return result;
	return {
		...result,
		items: result.items.map((o) => ({
			orderId: o.order_id,
			typeId: o.type_id,
			locationId: o.location_id,
			systemId: o.system_id ?? null,
			isBuyOrder: o.is_buy_order,
			price: o.price,
			volumeRemain: o.volume_remain,
			range: o.range
		}))
	};
}

/** All buy and sell orders of one type in a region (every `X-Pages` page). */
export async function fetchRegionOrders(
	client: EsiClient,
	regionId: number,
	typeId: number
): Promise<PagedResult<MarketOrder>> {
	return mapOrders(
		await fetchAllPages<RawOrder>(client, `/markets/${regionId}/orders?order_type=all&type_id=${typeId}`)
	);
}

/** All orders of a structure market. A non-2XX first page (e.g. 403 no access) is returned as `{ ok: false }`. */
export async function fetchStructureOrders(
	client: EsiClient,
	structureId: number,
	accessToken: string
): Promise<PagedResult<MarketOrder>> {
	return mapOrders(
		await fetchAllPages<RawOrder>(client, `/markets/structures/${structureId}`, { accessToken })
	);
}

export interface StructureInfo {
	name: string;
	solarSystemId: number;
	ownerId: number;
	typeId: number | null;
}

/** `/universe/structures/{id}`; `null` when the character cannot see the structure (401/403/404). */
export async function fetchStructureInfo(
	client: EsiClient,
	structureId: number,
	accessToken: string
): Promise<StructureInfo | null> {
	const path = `/universe/structures/${structureId}`;
	const res = await client.get<{ name: string; solar_system_id: number; owner_id: number; type_id?: number }>(
		path,
		{ accessToken }
	);
	if (res.status === 401 || res.status === 403 || res.status === 404) return null;
	if (res.status !== 200 || !res.data) throw new EsiError(res.status, path);
	return {
		name: res.data.name,
		solarSystemId: res.data.solar_system_id,
		ownerId: res.data.owner_id,
		typeId: res.data.type_id ?? null
	};
}

/** Structure ids matching `text` visible to the character (scope `esi-search.search_structures.v1`). */
export async function searchStructures(
	client: EsiClient,
	characterId: number,
	text: string,
	accessToken: string
): Promise<number[]> {
	const search = text.trim();
	if (search.length < 3) throw new RangeError('Structure search text must be at least 3 characters');
	const params = new URLSearchParams({ categories: 'structure', search, strict: 'false' });
	const path = `/characters/${characterId}/search?${params}`;
	const res = await client.get<{ structure?: number[] }>(path, { accessToken });
	if (res.status !== 200) throw new EsiError(res.status, path);
	return res.data?.structure ?? [];
}

export interface MarketHistoryDay {
	date: string;
	average: number;
	highest: number;
	lowest: number;
	volume: number;
	orderCount: number;
}

export async function fetchMarketHistory(
	client: EsiClient,
	regionId: number,
	typeId: number
): Promise<MarketHistoryDay[]> {
	const path = `/markets/${regionId}/history?type_id=${typeId}`;
	const res = await client.get<
		{
			date: string;
			average: number;
			highest: number;
			lowest: number;
			volume: number;
			order_count: number;
		}[]
	>(path);
	if (res.status !== 200) throw new EsiError(res.status, path);
	return (res.data ?? []).map((d) => ({
		date: d.date,
		average: d.average,
		highest: d.highest,
		lowest: d.lowest,
		volume: d.volume,
		orderCount: d.order_count
	}));
}

/** Result of a conditional GET: `data` is `null` when the server answered 304. */
export interface ConditionalResult<T> {
	notModified: boolean;
	data: T | null;
	etag: string | null;
	expiresAt: number | null;
}

async function conditionalEsiGet<T>(
	client: EsiClient,
	path: string,
	etag: string | null | undefined
): Promise<ConditionalResult<T>> {
	const res = await client.get<T>(path, { etag });
	if (res.status === 304)
		return { notModified: true, data: null, etag: res.etag ?? etag ?? null, expiresAt: res.expiresAt };
	if (res.status !== 200 || res.data == null) throw new EsiError(res.status, path);
	return { notModified: false, data: res.data, etag: res.etag, expiresAt: res.expiresAt };
}

export interface MarketPrice {
	typeId: number;
	adjustedPrice: number | null;
	averagePrice: number | null;
}

export async function fetchMarketPrices(
	client: EsiClient,
	options: { etag?: string | null } = {}
): Promise<ConditionalResult<MarketPrice[]>> {
	const res = await conditionalEsiGet<{ type_id: number; adjusted_price?: number; average_price?: number }[]>(
		client,
		'/markets/prices',
		options.etag
	);
	return {
		...res,
		data:
			res.data?.map((p) => ({
				typeId: p.type_id,
				adjustedPrice: p.adjusted_price ?? null,
				averagePrice: p.average_price ?? null
			})) ?? null
	};
}

export interface IndustrySystem {
	systemId: number;
	/** Activity name (`reaction`, `manufacturing`, …) → cost index fraction. */
	costIndices: Record<string, number>;
}

export async function fetchIndustrySystems(
	client: EsiClient,
	options: { etag?: string | null } = {}
): Promise<ConditionalResult<IndustrySystem[]>> {
	const res = await conditionalEsiGet<
		{ solar_system_id: number; cost_indices: { activity: string; cost_index: number }[] }[]
	>(client, '/industry/systems', options.etag);
	return {
		...res,
		data:
			res.data?.map((s) => ({
				systemId: s.solar_system_id,
				costIndices: Object.fromEntries(s.cost_indices.map((c) => [c.activity, c.cost_index]))
			})) ?? null
	};
}

export interface SdeLatest {
	buildNumber: number;
	releaseDate: string;
}

/** Conditional GET of the SDE `latest.jsonl` pointer. */
export async function fetchSdeLatest(
	fetchFn: FetchFn,
	userAgent: string,
	options: { etag?: string | null } = {}
): Promise<ConditionalResult<SdeLatest>> {
	const headers: Record<string, string> = { 'User-Agent': userAgent };
	if (options.etag) headers['If-None-Match'] = options.etag;
	const res = await fetchFn(SDE_LATEST_URL, { method: 'GET', headers });
	const etag = res.headers.get('ETag');
	const expiresAt = parseExpires(res.headers);
	if (res.status === 304)
		return { notModified: true, data: null, etag: etag ?? options.etag ?? null, expiresAt };
	if (res.status !== 200)
		throw new EsiError(res.status, SDE_LATEST_URL, `SDE latest.jsonl returned ${res.status}`);
	const line = (await res.text()).split('\n').find((l) => l.trim() !== '');
	const parsed = line ? (JSON.parse(line) as { buildNumber?: number; releaseDate?: string }) : {};
	if (typeof parsed.buildNumber !== 'number') throw new Error('SDE latest.jsonl has no buildNumber');
	return {
		notModified: false,
		data: { buildNumber: parsed.buildNumber, releaseDate: parsed.releaseDate ?? '' },
		etag,
		expiresAt
	};
}

export interface HubAggregate {
	buyMax: number | null;
	sellMin: number | null;
	buyP5: number | null;
	sellP5: number | null;
	buyVolume: number;
	sellVolume: number;
	buyOrders: number;
	sellOrders: number;
}

export type OrderFilter =
	| { kind: 'station'; locationId: number }
	| { kind: 'system'; systemId: number }
	| { kind: 'structure'; locationId: number };

/** Volume-weighted average price of the best 5 % of volume (orders sorted best first; boundary order partially used). */
function bestFivePercent(sorted: MarketOrder[], totalVolume: number): number | null {
	if (totalVolume <= 0) return null;
	const target = totalVolume * 0.05;
	let taken = 0;
	let value = 0;
	for (const order of sorted) {
		const take = Math.min(order.volumeRemain, target - taken);
		taken += take;
		value += take * order.price;
		if (taken >= target) break;
	}
	return value / taken;
}

/** Aggregates the orders located in a hub (station/structure by `locationId`, system by `systemId`). */
export function aggregateOrders(orders: MarketOrder[], filter: OrderFilter): HubAggregate {
	const inHub = orders.filter((o) =>
		filter.kind === 'system' ? o.systemId === filter.systemId : o.locationId === filter.locationId
	);
	const buys = inHub.filter((o) => o.isBuyOrder).sort((a, b) => b.price - a.price);
	const sells = inHub.filter((o) => !o.isBuyOrder).sort((a, b) => a.price - b.price);
	const buyVolume = buys.reduce((sum, o) => sum + o.volumeRemain, 0);
	const sellVolume = sells.reduce((sum, o) => sum + o.volumeRemain, 0);
	return {
		buyMax: buys.length ? buys[0].price : null,
		sellMin: sells.length ? sells[0].price : null,
		buyP5: bestFivePercent(buys, buyVolume),
		sellP5: bestFivePercent(sells, sellVolume),
		buyVolume,
		sellVolume,
		buyOrders: buys.length,
		sellOrders: sells.length
	};
}
