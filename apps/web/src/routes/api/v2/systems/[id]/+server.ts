import { ApiError, CACHE_LONG, apiHandler, apiJson, parseParams } from '#lib/server/api/http.js';
import { SystemIdParams } from '#lib/server/api/schemas.js';
import { getSystemsByIds } from '#lib/server/systems.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const { id } = parseParams(SystemIdParams, event.params);
	const system = (await getSystemsByIds(event.locals.env, [id])).get(id);
	if (!system) throw new ApiError(404, 'NOT_FOUND', `Unknown system ${id}.`);
	return apiJson(system, CACHE_LONG);
});
