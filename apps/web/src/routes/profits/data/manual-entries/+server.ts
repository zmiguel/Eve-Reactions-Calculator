import { pageParam } from '#lib/paging.js';
import { listManualEntries } from '#lib/server/manual-entries.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** One page of the purchases list on `/profits/ledger/add` (`page`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return Response.json(await listManualEntries(env, user.userId, pageParam(event.url, 'page')));
};
