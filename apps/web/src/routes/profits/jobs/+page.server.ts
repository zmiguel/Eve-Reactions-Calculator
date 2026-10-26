import type { JobsPageData } from '#lib/jobs/types.js';
import { emptyJobsPage, jobsPage, parseJobsQuery, userJobsQuery } from '#lib/server/jobs.js';
import { profitsContext } from '#lib/server/profits-access.js';
import type { PageServerLoad } from './$types';

/**
 * The jobs tab (period from the URL, else the user's default period); without access the layout shows
 * the login / switch-on message and this returns no jobs.
 */
export const load: PageServerLoad = async (event): Promise<JobsPageData> => {
	const context = await profitsContext(event);
	if (!context) return emptyJobsPage(parseJobsQuery(event.url.searchParams).filters);
	const { filters, page, defaultPeriod } = await userJobsQuery(
		context.env,
		context.user.userId,
		event.url.searchParams
	);
	return jobsPage(
		context.env,
		{ user: context.user, settings: event.locals.settings },
		filters,
		page,
		Date.now(),
		defaultPeriod
	);
};
