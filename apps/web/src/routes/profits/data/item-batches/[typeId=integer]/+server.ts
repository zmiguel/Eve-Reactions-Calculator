import { error, json } from '@sveltejs/kit';
import { pageParam } from '$lib/paging';
import { ledgerItemBatches } from '$lib/server/ledger-item';
import { profitsApiContext } from '$lib/server/profits-access';
import type { RequestHandler } from './$types';

/** One page (`batches`) of the batches table of `/profits/ledger/<typeId>`. */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	const page = await ledgerItemBatches(
		env,
		user.userId,
		Number(event.params.typeId),
		pageParam(event.url, 'batches')
	);
	if (!page) error(404, 'Not Found');
	return json(page);
};
