import type { Dataset } from '@reactions/engine';
import { SITE_URL } from '$lib/site';

const escapeXml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** sitemap.xml for the static pages, the reactor listings and every reaction detail page. */
export function buildSitemap(dataset: Dataset | null, snapshotAt: number | null): string {
	const lastmod = snapshotAt ? new Date(snapshotAt).toISOString().slice(0, 10) : null;
	const urls: { path: string; lastmod: string | null }[] = [
		{ path: '/', lastmod },
		...['composite', 'biochemical', 'hybrid'].map((r) => ({ path: `/${r}`, lastmod })),
		...(dataset?.reactions ?? []).map((r) => ({ path: `/${r.reactor}/${r.slug}`, lastmod })),
		{ path: '/planner', lastmod: null },
		{ path: '/api', lastmod: null },
		{ path: '/about', lastmod: null }
	];
	const body = urls
		.map(
			(u) =>
				`\t<url><loc>${escapeXml(SITE_URL + u.path)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /api/v2/
Sitemap: ${SITE_URL}/sitemap.xml
`;
