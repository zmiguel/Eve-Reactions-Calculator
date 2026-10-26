import { overviewTable } from '#lib/server/profits-overview.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** Page of the overview's sales table for the query string (`period`, `sales`), as the page renders it. */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return Response.json(
		await overviewTable(env, { user, settings: event.locals.settings }, 'sales', event.url)
	);
};
