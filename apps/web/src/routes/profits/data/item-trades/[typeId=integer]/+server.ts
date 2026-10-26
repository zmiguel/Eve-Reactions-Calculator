import { error } from '@sveltejs/kit';
import { pageParam } from '#lib/paging.js';
import { ledgerItemTrades } from '#lib/server/ledger-item.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** One page (`trades`) of the purchases and sales table of `/profits/ledger/<typeId>`. */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	const page = await ledgerItemTrades(
		env,
		user.userId,
		Number(event.params.typeId),
		pageParam(event.url, 'trades')
	);
	if (!page) error(404, 'Not Found');
	return Response.json(page);
};
