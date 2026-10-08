import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import { match as integer } from '../params/integer';
import { match as reactor } from '../params/reactor';
import { asEnv, fakeEnv } from '../test/fakes';
import { NOW, loadSde, putKv } from '../test/fixtures';
import { GET as legacyGet } from './[reactor=reactor]/[legacyType]/[id=integer]/+server';
import { GET as openapiGet } from './api/openapi/+server';
import { GET as v1Get, POST as v1Post } from './api/v1/[...rest]/+server';
import { GET as robotsGet } from './robots.txt/+server';
import { GET as sitemapGet } from './sitemap.xml/+server';

beforeEach(() => clearDataMemo());

type Handler = (event: RequestEvent) => unknown;

async function call(handler: Handler, event: Record<string, unknown>) {
	try {
		return { response: (await handler(event as unknown as RequestEvent)) as Response };
	} catch (e) {
		if (isRedirect(e)) return { redirect: { status: e.status, location: e.location } };
		throw e;
	}
}

async function seededPlatform() {
	const env = fakeEnv();
	await putKv(env, await loadSde());
	return { env: asEnv(env) };
}

describe('legacy redirects', () => {
	const cases: [string, string, number, string][] = [
		['composite', 'simple', 16663, '/composite/caesarium-cadmide'],
		['composite', 'complex', 16671, '/composite/titanium-carbide'],
		['composite', 'chain', 16671, '/composite/titanium-carbide?view=chain'],
		['composite', 'unrefined', 32825, '/composite/unrefined-hexite'],
		['composite', 'refined', 32825, '/composite/unrefined-hexite?output=reprocessed'],
		['composite', 'eratic', 90283, '/composite/unrefined-tritanium'],
		['composite', 'eratic-repro', 90283, '/composite/unrefined-tritanium?output=reprocessed'],
		['biochemical', 'synth', 28686, '/biochemical/pure-synth-blue-pill-booster'],
		['biochemical', 'standard', 25237, '/biochemical/pure-standard-blue-pill-booster'],
		['biochemical', 'improved', 25241, '/biochemical/pure-improved-blue-pill-booster'],
		['biochemical', 'improved_chain', 25241, '/biochemical/pure-improved-blue-pill-booster?view=chain'],
		['biochemical', 'strong', 25283, '/biochemical/pure-strong-blue-pill-booster'],
		['biochemical', 'strong_chain', 25283, '/biochemical/pure-strong-blue-pill-booster?view=chain'],
		// The v2 biochemical pages themselves were /biochemical/simple|chain/<productTypeId>.
		['biochemical', 'simple', 28686, '/biochemical/pure-synth-blue-pill-booster'],
		['biochemical', 'chain', 25241, '/biochemical/pure-improved-blue-pill-booster?view=chain']
	];

	it.each(cases)('/%s/%s/%i → %s', async (r, type, id, expected) => {
		const platform = await seededPlatform();
		const result = await call(legacyGet as Handler, {
			params: { reactor: r, legacyType: type, id: String(id) },
			platform
		});
		expect(result.redirect).toEqual({ status: 301, location: expected });
	});

	it('molecular-forged products redirect to their biochemical page', async () => {
		const sde = await loadSde();
		const molecular = sde.dataset.reactions.find((r) => r.tier === 'molecular_forged')!;
		const result = await call(legacyGet as Handler, {
			params: { reactor: 'biochemical', legacyType: 'molecular', id: String(molecular.product.typeId) },
			platform: await seededPlatform()
		});
		expect(result.redirect).toEqual({ status: 301, location: `/biochemical/${molecular.slug}` });
	});

	it.each([
		['composite', 'simple', '99999999'],
		['composite', 'nonsense', '16663'],
		['hybrid', 'simple', '30306']
	])('unknown /%s/%s/%s → reactor listing', async (r, type, id) => {
		const result = await call(legacyGet as Handler, {
			params: { reactor: r, legacyType: type, id },
			platform: await seededPlatform()
		});
		expect(result.redirect).toEqual({ status: 301, location: `/${r}` });
	});

	it('redirects temporarily to the listing while the dataset is not loaded', async () => {
		const result = await call(legacyGet as Handler, {
			params: { reactor: 'composite', legacyType: 'simple', id: '16663' },
			platform: { env: asEnv(fakeEnv()) }
		});
		expect(result.redirect).toEqual({ status: 307, location: '/composite' });
	});
});

describe('/api/v1/*', () => {
	it('answers 410 with the documented body for any method', async () => {
		for (const handler of [v1Get, v1Post]) {
			const { response } = await call(handler as Handler, {});
			expect(response!.status).toBe(410);
			expect(await response!.json()).toEqual({
				error: {
					code: 'API_V1_REMOVED',
					message: 'API v1 was removed. Use /api/v2.',
					details: { docs: 'https://reactions.coalition.space/api' }
				}
			});
		}
	});
});

describe('/api/openapi', () => {
	it('301 → /api', async () => {
		expect((await call(openapiGet as Handler, {})).redirect).toEqual({ status: 301, location: '/api' });
	});
});

describe('/sitemap.xml', () => {
	it('lists static pages, reactor pages and all 119 detail URLs with lastmod', async () => {
		const { response } = await call(sitemapGet as Handler, { platform: await seededPlatform() });
		expect(response!.headers.get('Content-Type')).toContain('application/xml');
		const xml = await response!.text();
		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
		const details = locs.filter((l) => /\/(composite|biochemical|hybrid)\/[a-z0-9-]+$/.test(l));
		expect(details).toHaveLength(119);
		expect(locs).toEqual(
			expect.arrayContaining([
				'https://reactions.coalition.space/',
				'https://reactions.coalition.space/composite',
				'https://reactions.coalition.space/planner',
				'https://reactions.coalition.space/api',
				'https://reactions.coalition.space/about',
				'https://reactions.coalition.space/composite/caesarium-cadmide'
			])
		);
		expect(xml).toContain(
			`<url><loc>https://reactions.coalition.space/composite/caesarium-cadmide</loc><lastmod>${new Date(NOW).toISOString().slice(0, 10)}</lastmod></url>`
		);
		expect(xml).toContain('<url><loc>https://reactions.coalition.space/about</loc></url>');
	});

	it('still lists the static pages without data', async () => {
		const { response } = await call(sitemapGet as Handler, { platform: { env: asEnv(fakeEnv()) } });
		const xml = await response!.text();
		expect([...xml.matchAll(/<loc>/g)]).toHaveLength(7);
	});
});

describe('/robots.txt', () => {
	it('disallows private areas and points to the sitemap', async () => {
		const { response } = await call(robotsGet as Handler, {});
		expect(await response!.text()).toBe(
			'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /auth\nDisallow: /api/v2/\nSitemap: https://reactions.coalition.space/sitemap.xml\n'
		);
	});
});

describe('param matchers', () => {
	it('reactor', () => {
		expect(['composite', 'biochemical', 'hybrid'].every((r) => reactor(r))).toBe(true);
		expect(reactor('polymer')).toBe(false);
		expect(reactor('Composite')).toBe(false);
	});

	it('integer', () => {
		expect(integer('16663')).toBe(true);
		expect(integer('16a')).toBe(false);
		expect(integer('-1')).toBe(false);
		expect(integer('')).toBe(false);
	});
});
