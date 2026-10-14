import { json } from '@sveltejs/kit';
import { pageParam } from '$lib/paging';
import { listManualEntries } from '$lib/server/manual-entries';
import { profitsApiContext } from '$lib/server/profits-access';
import type { RequestHandler } from './$types';

/** One page of the purchases list on `/profits/ledger/add` (`page`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return json(await listManualEntries(env, user.userId, pageParam(event.url, 'page')));
};
