import { getDataset, getMarket } from '#lib/server/data.js';
import { buildSitemap } from '#lib/server/sitemap.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const [dataset, market] = await Promise.all([getDataset(locals.env), getMarket(locals.env)]);
	return new Response(buildSitemap(dataset, market?.snapshotAt ?? null), {
		headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
	});
};
