import { recipeResponse, requireDataset, requireReaction } from '$lib/server/api/data';
import { CACHE_LONG, apiHandler, apiJson, requireEnv } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const dataset = await requireDataset(requireEnv(event));
	return apiJson(recipeResponse(requireReaction(dataset, event.params.slug), dataset), CACHE_LONG);
});
