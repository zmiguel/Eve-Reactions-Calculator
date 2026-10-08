import { CACHE_LONG, apiHandler, apiJson } from '$lib/server/api/http';
import { openapi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async () => apiJson(openapi, CACHE_LONG));
