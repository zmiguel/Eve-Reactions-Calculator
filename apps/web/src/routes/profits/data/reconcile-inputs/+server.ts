import { json } from '@sveltejs/kit';
import { pageParam } from '$lib/paging';
import { reconcileInputs } from '$lib/server/ledger-reconcile';
import { profitsApiContext } from '$lib/server/profits-access';
import type { RequestHandler } from './$types';

/** One page of the job inputs without a purchase on `/profits/ledger/reconcile` (`inputs`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return json(await reconcileInputs(env, user.userId, pageParam(event.url, 'inputs')));
};
