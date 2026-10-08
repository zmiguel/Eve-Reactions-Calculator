import { CACHE_LONG, apiHandler, apiJson, parseQuery, requireEnv } from '$lib/server/api/http';
import { SystemsQuery } from '$lib/server/api/schemas';
import { searchSystems } from '$lib/server/systems';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const query = parseQuery(SystemsQuery, event.url);
	return apiJson(await searchSystems(requireEnv(event), query), CACHE_LONG);
});
