import { json } from '@sveltejs/kit';
import { jobsTable, userJobsQuery } from '$lib/server/jobs';
import { profitsApiContext } from '$lib/server/profits-access';
import type { RequestHandler } from './$types';

/** A page of the jobs table (`PagedTable` Next / Previous) for the jobs page's query string. */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	const { filters, page } = await userJobsQuery(env, user.userId, event.url.searchParams);
	return json(await jobsTable(env, { user, settings: event.locals.settings }, filters, page));
};
