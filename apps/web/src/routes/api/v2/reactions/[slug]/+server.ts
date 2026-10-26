import { recipeResponse, requireDataset, requireReaction } from '#lib/server/api/data.js';
import { CACHE_LONG, apiHandler, apiJson } from '#lib/server/api/http.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const dataset = await requireDataset(event.locals.env);
	return apiJson(recipeResponse(requireReaction(dataset, event.params.slug), dataset), CACHE_LONG);
});
