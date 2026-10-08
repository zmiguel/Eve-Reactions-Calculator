import { ApiError, CACHE_LONG, apiHandler, apiJson, parseParams, requireEnv } from '$lib/server/api/http';
import { SystemIdParams } from '$lib/server/api/schemas';
import { getSystemsByIds } from '$lib/server/systems';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const { id } = parseParams(SystemIdParams, event.params);
	const system = (await getSystemsByIds(requireEnv(event), [id])).get(id);
	if (!system) throw new ApiError(404, 'NOT_FOUND', `Unknown system ${id}.`);
	return apiJson(system, CACHE_LONG);
});
