import { profitsContext } from '$lib/server/profits-access';
import { profitsOverview } from '$lib/server/profits-overview';
import type { PageServerLoad } from './$types';

/** The overview of the visitor's profits; null when the layout shows the login / enable message. */
export const load: PageServerLoad = async (event) => {
	const context = await profitsContext(event);
	if (!context) return { overview: null };
	return {
		overview: await profitsOverview(
			context.env,
			{ user: context.user, settings: event.locals.settings },
			event.url
		)
	};
};
