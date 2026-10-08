import { ROBOTS_TXT } from '$lib/server/sitemap';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	new Response(ROBOTS_TXT, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }
	});
