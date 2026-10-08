import { CACHE_LONG, apiHandler, apiJson, requireEnv } from '$lib/server/api/http';
import { hubResponse, publicHubs } from '$lib/server/api/data';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) =>
	apiJson((await publicHubs(requireEnv(event))).map(hubResponse), CACHE_LONG)
);
