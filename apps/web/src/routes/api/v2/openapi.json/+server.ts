import { CACHE_LONG, apiHandler, apiJson } from '#lib/server/api/http.js';
import { openapi } from '#lib/server/api/openapi.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async () => apiJson(openapi, CACHE_LONG));
