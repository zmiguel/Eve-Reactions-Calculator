import { getDataset, getMarket } from '$lib/server/data';
import { buildSitemap } from '$lib/server/sitemap';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const [dataset, market] = platform
		? await Promise.all([getDataset(platform.env), getMarket(platform.env)])
		: [null, null];
	return new Response(buildSitemap(dataset, market?.snapshotAt ?? null), {
		headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
	});
};
