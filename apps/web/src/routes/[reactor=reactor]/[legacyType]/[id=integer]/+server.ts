import { redirect } from '@sveltejs/kit';
import { getDataset } from '#lib/server/data.js';
import { legacyRedirect } from '#lib/server/legacy.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const dataset = await getDataset(locals.env);
	// Without the dataset the reaction cannot be looked up: send to the listing temporarily, so browsers
	// and crawlers do not keep a permanent redirect from a data outage.
	redirect(
		dataset ? 301 : 307,
		legacyRedirect(dataset, params.reactor, params.legacyType, Number(params.id))
	);
};
