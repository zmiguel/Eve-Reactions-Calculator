import { CACHE_LONG, apiHandler, apiJson } from '#lib/server/api/http.js';
import { hubResponse, publicHubs } from '#lib/server/api/data.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) =>
	apiJson((await publicHubs(event.locals.env)).map(hubResponse), CACHE_LONG)
);
