import { jobsTable, userJobsQuery } from '#lib/server/jobs.js';
import { profitsApiContext } from '#lib/server/profits-access.js';
import type { RequestHandler } from './$types';

/** A page of the jobs table (`PagedTable` Next / Previous) for the jobs page's query string. */
export const GET: RequestHandler = async (event) => {
	const { env, user } = await profitsApiContext(event);
	const { filters, page } = await userJobsQuery(env, user.userId, event.url.searchParams);
	return Response.json(await jobsTable(env, { user, settings: event.locals.settings }, filters, page));
};
