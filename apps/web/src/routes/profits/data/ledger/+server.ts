import { ledgerRows, parseLedgerQuery } from '#lib/server/ledger.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** One page of the `/profits/ledger` table for the same query string (filters and `page`). */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	const { filters, page } = parseLedgerQuery(event.url);
	return Response.json(await ledgerRows(env, user.userId, filters, page));
};
