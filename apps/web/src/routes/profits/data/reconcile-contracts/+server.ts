import { json } from '@sveltejs/kit';
import { pageParam } from '$lib/paging';
import { reconcileContracts } from '$lib/server/ledger-reconcile';
import { profitsApiContext } from '$lib/server/profits-access';
import type { RequestHandler } from './$types';

/** One page of the contract items needing review on `/profits/ledger/reconcile` (`contracts`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return json(await reconcileContracts(env, user.userId, pageParam(event.url, 'contracts')));
};
