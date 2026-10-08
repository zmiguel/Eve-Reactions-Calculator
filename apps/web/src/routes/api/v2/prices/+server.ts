import type { HubPrice } from '@reactions/engine';
import { apiCsv } from '$lib/server/api/csv';
import { publicHubs, requireDataset, requireHub, requireMarket } from '$lib/server/api/data';
import { CACHE_SHORT, apiHandler, apiJson, parseQuery, requireEnv } from '$lib/server/api/http';
import { PRICE_COLUMNS, PricesQuery } from '$lib/server/api/schemas';
import { checkDate } from '$lib/server/api/settings';
import { FALLBACK_HUB } from '$lib/server/hubs';
import { trackedTypes } from '$lib/server/planner';
import { getDailyPriceBook } from '$lib/server/prices';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const q = parseQuery(PricesQuery.schema, event.url);
	checkDate(q.date, Date.now());
	const env = requireEnv(event);
	const [dataset, market, hubs] = await Promise.all([
		requireDataset(env),
		requireMarket(env),
		publicHubs(env)
	]);
	const hub = requireHub(hubs, q.hub ?? FALLBACK_HUB);
	const typeIds = q.types ?? [...trackedTypes(dataset)].sort((a, b) => a - b);

	let asOf = new Date(market.snapshotAt).toISOString();
	let approximate = false;
	let quote: (typeId: number) => HubPrice | undefined;
	if (q.date) {
		// Daily averages carry no order-book volumes (left undefined → null).
		const book = await getDailyPriceBook(env, q.date, [hub], dataset, market.adjusted);
		const prices = book.hubs[hub.hubId] ?? {};
		asOf = q.date;
		approximate = book.approximate;
		quote = (typeId) => prices[typeId];
	} else {
		const prices = market.prices[hub.hubId] ?? {};
		quote = (typeId) => {
			const t = prices[typeId];
			return t && { buy: t[0], sell: t[1], buyVolume: t[2], sellVolume: t[3] };
		};
	}
	const rows = typeIds.map((typeId) => {
		const p = quote(typeId);
		return {
			typeId,
			name: dataset.types[typeId]?.name ?? null,
			buy: p?.buy ?? null,
			sell: p?.sell ?? null,
			buyVolume: p?.buyVolume ?? null,
			sellVolume: p?.sellVolume ?? null
		};
	});
	if (q.format === 'csv') return apiCsv(PRICE_COLUMNS, rows, CACHE_SHORT);
	return apiJson({ hub: hub.hubId, asOf, approximate, prices: rows }, CACHE_SHORT);
});
