import { expect, test } from './fixtures';

test('/sitemap.xml lists the reaction pages @smoke', async ({ request }) => {
	const response = await request.get('/sitemap.xml');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('application/xml');
	const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
		(m) => new URL(m[1]).pathname
	);
	const reactions = locs.filter((path) => /^\/(composite|biochemical|hybrid)\/[a-z0-9-]+$/.test(path));
	expect(reactions.length).toBeGreaterThan(0);
	expect(locs).toEqual(
		expect.arrayContaining(['/', '/composite', '/biochemical', '/hybrid', '/composite/caesarium-cadmide'])
	);
});

test('/robots.txt points to the sitemap @smoke', async ({ request }) => {
	const response = await request.get('/robots.txt');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('text/plain');
	expect(await response.text()).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
});
