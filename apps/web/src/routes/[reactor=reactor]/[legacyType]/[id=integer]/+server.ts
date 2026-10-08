import { redirect } from '@sveltejs/kit';
import { getDataset } from '$lib/server/data';
import { legacyRedirect } from '$lib/server/legacy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
	const dataset = platform ? await getDataset(platform.env) : null;
	// Without the dataset the reaction cannot be looked up: send to the listing temporarily, so browsers
	// and crawlers do not keep a permanent redirect from a data outage.
	redirect(
		dataset ? 301 : 307,
		legacyRedirect(dataset, params.reactor, params.legacyType, Number(params.id))
	);
};
