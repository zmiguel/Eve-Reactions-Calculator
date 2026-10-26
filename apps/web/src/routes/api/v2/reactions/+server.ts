import { recipeResponse, requireDataset } from '#lib/server/api/data.js';
import { CACHE_LONG, apiHandler, apiJson, parseQuery } from '#lib/server/api/http.js';
import { ReactionsQuery } from '#lib/server/api/schemas.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const { reactor, tier } = parseQuery(ReactionsQuery.schema, event.url);
	const dataset = await requireDataset(event.locals.env);
	const reactions = dataset.reactions
		.filter((r) => (!reactor || r.reactor === reactor) && (!tier || r.tier === tier))
		.map((r) => recipeResponse(r, dataset));
	return apiJson(reactions, CACHE_LONG);
});
