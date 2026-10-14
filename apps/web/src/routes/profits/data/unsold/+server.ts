import { json } from '@sveltejs/kit';
import { overviewTable } from '$lib/server/profits-overview';
import { profitsApiContext } from '$lib/server/profits-access';
import type { RequestHandler } from './$types';

/** Page of the overview's unsold table for the query string (`period`, `unsold`), as the page renders it. */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	return json(await overviewTable(env, { user, settings: event.locals.settings }, 'unsold', event.url));
};
