import { pageParam } from '#lib/paging.js';
import { reconcileContracts } from '#lib/server/ledger-reconcile.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** One page of the contract items needing review on `/profits/ledger/reconcile` (`contracts`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return Response.json(await reconcileContracts(env, user.userId, pageParam(event.url, 'contracts')));
};
