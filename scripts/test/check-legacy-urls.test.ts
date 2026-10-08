import { describe, expect, it } from 'vitest';
import { LEGACY_TYPES } from '../../apps/web/src/lib/server/legacy.ts';
import {
	buildLegacyUrls,
	checkUrl,
	main,
	mapPool,
	type CliDeps,
	type ReactionRef
} from '../check-legacy-urls.ts';

const ORIGIN = 'https://reactions.example';

const REACTIONS: ReactionRef[] = [
	{ reactor: 'composite', slug: 'caesarium-cadmide', product: { typeId: 16663 } },
	{ reactor: 'biochemical', slug: 'standard-blue-pill-booster', product: { typeId: 28672 } },
	{ reactor: 'hybrid', slug: 'c3-ftm-acid', product: { typeId: 30303 } }
];

type Route = { status: number; location?: string };

/** Fetch over a route table keyed by absolute URL; unknown URLs answer 404. Records requested URLs. */
function fakeFetch(routes: Record<string, Route | unknown[]>) {
	const requests: { url: string; redirect: RequestRedirect | undefined }[] = [];
	const fetchFn = (async (input: string, init?: RequestInit) => {
		requests.push({ url: input, redirect: init?.redirect });
		const route = routes[input];
		if (Array.isArray(route)) return Response.json(route);
		if (!route) return new Response('not found', { status: 404 });
		const headers = route.location ? { location: route.location } : undefined;
		return new Response(null, { status: route.status, headers });
	}) as typeof fetch;
	return { fetchFn, requests };
}

/** Routes under which every URL of {@link buildLegacyUrls}(REACTIONS) passes. */
function healthyRoutes(): Record<string, Route | unknown[]> {
	const routes: Record<string, Route | unknown[]> = { [`${ORIGIN}/api/v2/reactions`]: REACTIONS };
	for (const { path, target } of buildLegacyUrls(REACTIONS)) {
		if (path !== target) routes[`${ORIGIN}${path}`] = { status: 301, location: target };
		routes[`${ORIGIN}${target}`] = { status: 200 };
	}
	return routes;
}

const OLD = { path: '/composite/simple/16663', target: '/composite/caesarium-cadmide' };
const OLD_URL = `${ORIGIN}${OLD.path}`;
const NEW_URL = `${ORIGIN}${OLD.target}`;

describe('buildLegacyUrls', () => {
	const urls = buildLegacyUrls(REACTIONS);

	it('covers the listings, every legacy type per reactor and the hybrid detail pattern', () => {
		const composite = Object.keys(LEGACY_TYPES.composite).length;
		const biochemical = Object.keys(LEGACY_TYPES.biochemical).length;
		expect(urls).toHaveLength(3 + composite + biochemical + 1);
		for (const reactor of ['composite', 'biochemical', 'hybrid']) {
			expect(urls).toContainEqual({ path: `/${reactor}`, target: `/${reactor}` });
		}
		expect(urls).toContainEqual({ path: '/hybrid/30303', target: '/hybrid/c3-ftm-acid' });
	});

	it('maps each legacy type to the v3 detail page with its query', () => {
		expect(urls).toContainEqual(OLD);
		expect(urls).toContainEqual({
			path: '/composite/chain/16663',
			target: '/composite/caesarium-cadmide?view=chain'
		});
		expect(urls).toContainEqual({
			path: '/composite/refined/16663',
			target: '/composite/caesarium-cadmide?output=reprocessed'
		});
		expect(urls).toContainEqual({
			path: '/biochemical/improved_chain/28672',
			target: '/biochemical/standard-blue-pill-booster?view=chain'
		});
	});

	it('never pairs a product with another reactor’s legacy types', () => {
		expect(urls.some((u) => u.path.startsWith('/composite/') && u.path.endsWith('/28672'))).toBe(false);
		expect(urls.filter((u) => u.path.startsWith('/hybrid/'))).toHaveLength(1);
	});
});

describe('checkUrl', () => {
	it('passes a 301 to a same-origin page answering 200, without following redirects itself', async () => {
		const { fetchFn, requests } = fakeFetch({
			[OLD_URL]: { status: 301, location: OLD.target },
			[NEW_URL]: { status: 200 }
		});
		expect(await checkUrl(OLD, ORIGIN, fetchFn)).toEqual({ url: OLD_URL, ok: true });
		expect(requests).toEqual([
			{ url: OLD_URL, redirect: 'manual' },
			{ url: NEW_URL, redirect: 'manual' }
		]);
	});

	it('passes one extra 301 hop and an absolute same-origin Location', async () => {
		const { fetchFn } = fakeFetch({
			[OLD_URL]: { status: 301, location: `${ORIGIN}/composite/16663` },
			[`${ORIGIN}/composite/16663`]: { status: 301, location: OLD.target },
			[NEW_URL]: { status: 200 }
		});
		expect(await checkUrl(OLD, ORIGIN, fetchFn)).toEqual({ url: OLD_URL, ok: true });
	});

	it('passes a listing that answers 200 directly', async () => {
		const { fetchFn } = fakeFetch({ [`${ORIGIN}/hybrid`]: { status: 200 } });
		expect(await checkUrl({ path: '/hybrid', target: '/hybrid' }, ORIGIN, fetchFn)).toEqual({
			url: `${ORIGIN}/hybrid`,
			ok: true
		});
	});

	it.each<[string, Record<string, Route>, string]>([
		[
			'404 target',
			{ [OLD_URL]: { status: 301, location: OLD.target } },
			`target ${NEW_URL} answered HTTP 404`
		],
		[
			'302 instead of 301',
			{ [OLD_URL]: { status: 302, location: OLD.target }, [NEW_URL]: { status: 200 } },
			'HTTP 302 instead of 301'
		],
		[
			'307 on the second hop',
			{
				[OLD_URL]: { status: 301, location: '/composite/16663' },
				[`${ORIGIN}/composite/16663`]: { status: 307, location: OLD.target },
				[NEW_URL]: { status: 200 }
			},
			`HTTP 307 instead of 301 at ${ORIGIN}/composite/16663`
		],
		[
			'redirect loop',
			{
				[OLD_URL]: { status: 301, location: OLD.target },
				[NEW_URL]: { status: 301, location: OLD.path }
			},
			`redirect loop: ${OLD.path} -> ${OLD.target} -> ${OLD.path}`
		],
		[
			'cross-origin location',
			{ [OLD_URL]: { status: 301, location: 'https://evil.example/composite/caesarium-cadmide' } },
			'cross-origin redirect to https://evil.example/composite/caesarium-cadmide'
		],
		[
			'too many hops',
			{
				[OLD_URL]: { status: 301, location: '/a' },
				[`${ORIGIN}/a`]: { status: 301, location: '/b' },
				[`${ORIGIN}/b`]: { status: 301, location: OLD.target },
				[NEW_URL]: { status: 200 }
			},
			`more than 2 redirects: ${OLD.path} -> /a -> /b -> ${OLD.target}`
		],
		[
			'non-200 final',
			{ [OLD_URL]: { status: 301, location: OLD.target }, [NEW_URL]: { status: 500 } },
			`target ${NEW_URL} answered HTTP 500`
		],
		[
			'redirect to the listing fallback',
			{ [OLD_URL]: { status: 301, location: '/composite' }, [`${ORIGIN}/composite`]: { status: 200 } },
			`redirected to /composite, expected ${OLD.target}`
		],
		['missing Location', { [OLD_URL]: { status: 301 } }, '301 without Location header'],
		[
			'old URL served directly',
			{ [OLD_URL]: { status: 200 } },
			`HTTP 200 without redirect, expected 301 to ${OLD.target}`
		],
		['old URL 404', {}, 'HTTP 404']
	])('reports %s as a failure naming the old URL', async (_, routes, reason) => {
		const { fetchFn } = fakeFetch(routes);
		expect(await checkUrl(OLD, ORIGIN, fetchFn)).toEqual({ url: OLD_URL, ok: false, reason });
	});

	it('reports network errors', async () => {
		const fetchFn = (async () => {
			throw new Error('ECONNRESET');
		}) as typeof fetch;
		expect(await checkUrl(OLD, ORIGIN, fetchFn)).toEqual({
			url: OLD_URL,
			ok: false,
			reason: `request to ${OLD_URL} failed: ECONNRESET`
		});
	});
});

describe('mapPool', () => {
	it('keeps input order and never exceeds the limit', async () => {
		let inFlight = 0;
		let peak = 0;
		// Items finish out of order: each yields to the microtask queue `n` times before completing.
		const out = await mapPool([5, 1, 4, 2, 3], 2, async (n) => {
			peak = Math.max(peak, ++inFlight);
			for (let i = 0; i < n; i++) await Promise.resolve();
			inFlight--;
			return n * 10;
		});
		expect(out).toEqual([50, 10, 40, 20, 30]);
		expect(peak).toBe(2);
	});
});

describe('main', () => {
	function deps(routes: Record<string, Route | unknown[]>): CliDeps & { out: string[]; err: string[] } {
		const out: string[] = [];
		const err: string[] = [];
		return { fetch: fakeFetch(routes).fetchFn, log: (l) => out.push(l), error: (l) => err.push(l), out, err };
	}

	it('exits 0 and summarizes when every legacy URL passes', async () => {
		const d = deps(healthyRoutes());
		expect(await main([`${ORIGIN}/some/path`, '--concurrency', '3'], d)).toBe(0);
		const total = buildLegacyUrls(REACTIONS).length;
		expect(d.err).toEqual([]);
		expect(d.out.at(-1)).toBe(`${total} passed, 0 failed of ${total} legacy URLs`);
	});

	it('exits 1 and names each failing URL with its reason', async () => {
		const routes = healthyRoutes();
		routes[OLD_URL] = { status: 302, location: OLD.target };
		delete routes[`${ORIGIN}/hybrid/c3-ftm-acid`];
		const d = deps(routes);
		expect(await main([ORIGIN], d)).toBe(1);
		expect(d.err).toEqual([
			`FAIL ${OLD_URL}: HTTP 302 instead of 301`,
			`FAIL ${ORIGIN}/hybrid/30303: target ${ORIGIN}/hybrid/c3-ftm-acid answered HTTP 404`
		]);
		expect(d.out.at(-1)).toMatch(/, 2 failed of \d+ legacy URLs$/);
	});

	it('exits 1 when the reaction list is unavailable or malformed', async () => {
		const down = deps({});
		expect(await main([ORIGIN], down)).toBe(1);
		expect(down.err).toEqual([`FAIL reaction list: ${ORIGIN}/api/v2/reactions answered HTTP 404`]);

		const malformed = deps({ [`${ORIGIN}/api/v2/reactions`]: [{ slug: 'x' }] });
		expect(await main([ORIGIN], malformed)).toBe(1);
		expect(malformed.err[0]).toMatch(/did not return a non-empty array of reactions/);
	});

	it.each([[[]], [['not a url']], [[ORIGIN, '--concurrency', '0']], [[ORIGIN, '--bogus']]])(
		'exits 2 on bad arguments %j',
		async (args) => {
			const d = deps(healthyRoutes());
			expect(await main(args, d)).toBe(2);
			expect(d.err[0]).toMatch(/Usage: node scripts\/check-legacy-urls\.ts/);
		}
	);
});
