import { CACHE_LONG, apiHandler, apiJson, parseQuery } from '#lib/server/api/http.js';
import { SystemsQuery } from '#lib/server/api/schemas.js';
import { searchSystems } from '#lib/server/systems.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const query = parseQuery(SystemsQuery, event.url);
	return apiJson(await searchSystems(event.locals.env, query), CACHE_LONG);
});
