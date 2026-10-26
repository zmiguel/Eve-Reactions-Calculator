import { pageParam } from '#lib/paging.js';
import { reconcileInputs } from '#lib/server/ledger-reconcile.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** One page of the job inputs without a purchase on `/profits/ledger/reconcile` (`inputs`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return Response.json(await reconcileInputs(env, user.userId, pageParam(event.url, 'inputs')));
};
