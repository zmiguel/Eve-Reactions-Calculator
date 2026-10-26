import { CACHE_SHORT, apiHandler, apiJson } from '#lib/server/api/http.js';
import { hubResponse, publicHubs } from '#lib/server/api/data.js';
import { getDataset, getMarket } from '#lib/server/data.js';
import type { RequestHandler } from './$types';

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

export const GET: RequestHandler = apiHandler(async (event) => {
	const env = event.locals.env;
	const [dataset, market, hubs] = await Promise.all([getDataset(env), getMarket(env), publicHubs(env)]);
	return apiJson(
		{
			sdeBuild: dataset?.sdeBuild ?? null,
			pricesUpdatedAt: iso(market?.snapshotAt),
			costIndicesUpdatedAt: iso(market?.costIndicesUpdatedAt),
			adjustedUpdatedAt: iso(market?.adjustedUpdatedAt),
			hubs: hubs.map(hubResponse)
		},
		CACHE_SHORT
	);
});
