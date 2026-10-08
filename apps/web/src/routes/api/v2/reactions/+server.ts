import { recipeResponse, requireDataset } from '$lib/server/api/data';
import { CACHE_LONG, apiHandler, apiJson, parseQuery, requireEnv } from '$lib/server/api/http';
import { ReactionsQuery } from '$lib/server/api/schemas';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const { reactor, tier } = parseQuery(ReactionsQuery.schema, event.url);
	const dataset = await requireDataset(requireEnv(event));
	const reactions = dataset.reactions
		.filter((r) => (!reactor || r.reactor === reactor) && (!tier || r.tier === tier))
		.map((r) => recipeResponse(r, dataset));
	return apiJson(reactions, CACHE_LONG);
});
