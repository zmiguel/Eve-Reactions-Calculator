import { describe, expect, it, vi } from 'vitest';
import { ESI_COMPAT_DATE, buildUserAgent, createEsiClient, fetchRegionOrders } from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function client(handler: Parameters<typeof fakeFetch>[0], attempts?: number) {
	const fake = fakeFetch(handler);
	const sleep = vi.fn(async () => {});
	return {
		...fake,
		sleep,
		esi: createEsiClient({ fetch: fake.fetch, userAgent: TEST_UA, now: () => NOW, sleep, attempts })
	};
}

describe('buildUserAgent', () => {
	it('formats version, url and contact', () => {
		expect(
			buildUserAgent({
				version: '3.1.0',
				url: 'https://example.test/',
				contact: 'mail:you@example.test; eve:Some Pilot; discord:name'
			})
		).toBe(
			'EVE-Reactions-Calculator/3.1.0 (+https://example.test/; mail:you@example.test; eve:Some Pilot; discord:name)'
		);
	});

	it('leaves out missing or blank parts', () => {
		expect(buildUserAgent({ version: '3.1.0', url: 'https://example.test/' })).toBe(
			'EVE-Reactions-Calculator/3.1.0 (+https://example.test/)'
		);
		expect(buildUserAgent({ version: '3.1.0', url: ' ', contact: 'mail:a@b.test' })).toBe(
			'EVE-Reactions-Calculator/3.1.0 (mail:a@b.test)'
		);
		expect(buildUserAgent({ version: '3.1.0', url: '', contact: '' })).toBe('EVE-Reactions-Calculator/3.1.0');
		expect(buildUserAgent({ version: '3.1.0' })).toBe('EVE-Reactions-Calculator/3.1.0');
	});

	it('trims every part', () => {
		expect(
			buildUserAgent({ version: ' 3.1.0\n', url: '  https://example.test/ ', contact: '\tmail:a@b.test  ' })
		).toBe('EVE-Reactions-Calculator/3.1.0 (+https://example.test/; mail:a@b.test)');
	});
});

describe('createEsiClient', () => {
	it('sends user agent, compatibility date, etag and bearer token', async () => {
		const { esi, calls } = client(() => json([]));
		await esi.get('/markets/prices', { etag: '"abc"', accessToken: 'tok' });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://esi.evetech.net/markets/prices');
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
		expect(calls[0].headers.get('X-Compatibility-Date')).toBe('2026-08-18');
		expect(ESI_COMPAT_DATE).toBe('2026-08-18');
		expect(calls[0].headers.get('If-None-Match')).toBe('"abc"');
		expect(calls[0].headers.get('Authorization')).toBe('Bearer tok');
	});

	it('omits If-None-Match and Authorization when not given', async () => {
		const { esi, calls } = client(() => json([]));
		await esi.get('/markets/prices');
		expect(calls[0].headers.has('If-None-Match')).toBe(false);
		expect(calls[0].headers.has('Authorization')).toBe(false);
	});

	it('parses data and headers of a 200 response', async () => {
		const { esi } = client(() =>
			json([1, 2], {
				headers: {
					ETag: '"v1"',
					Expires: 'Tue, 06 Oct 2026 13:00:00 GMT',
					'X-Pages': '4',
					'X-Ratelimit-Remaining': '11800',
					'X-Ratelimit-Limit': '12000/15m',
					'X-ESI-Error-Limit-Remain': '100'
				}
			})
		);
		const res = await esi.get<number[]>('/x');
		expect(res).toEqual({
			status: 200,
			data: [1, 2],
			etag: '"v1"',
			expiresAt: Date.UTC(2026, 9, 6, 13, 0, 0),
			pages: 4,
			rateLimit: { remaining: 11800, limit: 12000 },
			errorLimitRemain: 100,
			retryAfter: null
		});
		expect(esi.guard.tripped()).toBe(false);
	});

	it('returns null data for 304 with the new expiry', async () => {
		const { esi } = client(
			() =>
				new Response(null, {
					status: 304,
					headers: { ETag: '"v1"', Expires: 'Tue, 06 Oct 2026 14:00:00 GMT' }
				})
		);
		const res = await esi.get('/industry/systems', { etag: '"v1"' });
		expect(res.status).toBe(304);
		expect(res.data).toBeNull();
		expect(res.etag).toBe('"v1"');
		expect(res.expiresAt).toBe(Date.UTC(2026, 9, 6, 14, 0, 0));
	});

	it('retries a 5xx once by default and returns the second answer', async () => {
		let n = 0;
		const { esi, calls, sleep } = client(() =>
			++n === 1 ? json({ error: 'boom' }, { status: 503 }) : json([7])
		);
		const res = await esi.get<number[]>('/x');
		expect(res.status).toBe(200);
		expect(res.data).toEqual([7]);
		expect(calls).toHaveLength(2);
		expect(sleep).toHaveBeenCalledWith(1000);
	});

	it('gives up after the configured attempts', async () => {
		const { esi, calls } = client(() => json({ error: 'boom' }, { status: 502 }), 3);
		const res = await esi.get('/x');
		expect(res.status).toBe(502);
		expect(calls).toHaveLength(3);
	});

	it('does not retry a 4xx', async () => {
		const { esi, calls } = client(() => json({ error: 'forbidden' }, { status: 403 }));
		const res = await esi.get('/x');
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(1);
	});
});

describe('EsiGuard', () => {
	const withHeaders = (headers: Record<string, string>, status = 200) =>
		client(() => json([], { status, headers }), 1);

	it('trips when remaining tokens drop below 10 % of the limit', async () => {
		const ok = withHeaders({ 'X-Ratelimit-Remaining': '1200', 'X-Ratelimit-Limit': '12000/15m' });
		await ok.esi.get('/x');
		expect(ok.esi.guard.tripped()).toBe(false);

		const low = withHeaders({ 'X-Ratelimit-Remaining': '1199', 'X-Ratelimit-Limit': '12000/15m' });
		await low.esi.get('/x');
		expect(low.esi.guard.rateLimit).toEqual({ remaining: 1199, limit: 12000 });
		expect(low.esi.guard.tripped()).toBe(true);
	});

	it('trips when the error limit remain drops below 20', async () => {
		const ok = withHeaders({ 'X-ESI-Error-Limit-Remain': '20' });
		await ok.esi.get('/x');
		expect(ok.esi.guard.tripped()).toBe(false);

		const low = withHeaders({ 'X-ESI-Error-Limit-Remain': '19' });
		await low.esi.get('/x');
		expect(low.esi.guard.tripped()).toBe(true);
	});

	it('trips on 420', async () => {
		const { esi } = withHeaders({}, 420);
		const res = await esi.get('/x');
		expect(res.status).toBe(420);
		expect(esi.guard.tripped()).toBe(true);
	});

	it('trips on 429, parses Retry-After and waits that long before retrying', async () => {
		let n = 0;
		const { esi, calls, sleep } = client(() =>
			++n === 1 ? json({ error: 'slow down' }, { status: 429, headers: { 'Retry-After': '7' } }) : json([1])
		);
		const res = await esi.get('/x');
		expect(sleep).toHaveBeenCalledWith(7000);
		expect(calls).toHaveLength(2);
		expect(res.status).toBe(200);
		expect(esi.guard.tripped()).toBe(true);
		expect(esi.guard.retryAfter).toBe(7);
	});

	it('does not wait out a long Retry-After: returns the 429 at once (guard tripped) for the caller to fall back', async () => {
		const { esi, calls, sleep } = client(() =>
			json({ error: 'slow down' }, { status: 429, headers: { 'Retry-After': '600' } })
		);
		const res = await esi.get('/x');
		expect(res).toMatchObject({ status: 429, retryAfter: 600 });
		expect(calls).toHaveLength(1);
		expect(sleep).not.toHaveBeenCalled();
		expect(esi.guard.tripped()).toBe(true);
	});

	it('parses Retry-After given as an HTTP date', async () => {
		const { esi } = withHeaders({ 'Retry-After': 'Tue, 06 Oct 2026 12:00:30 GMT' }, 429);
		const res = await esi.get('/x');
		expect(res.retryAfter).toBe(30);
	});
});

describe('fetchRegionOrders', () => {
	it('fetches every X-Pages page and maps orders', async () => {
		const order = (id: number) => ({
			order_id: id,
			type_id: 16663,
			location_id: 60003760,
			system_id: 30000142,
			is_buy_order: id % 2 === 0,
			price: id * 10,
			volume_remain: id,
			volume_total: id,
			range: 'region',
			duration: 90,
			issued: '2026-10-01T00:00:00Z',
			min_volume: 1
		});
		const { esi, calls } = client((call) => {
			const page = Number(new URL(call.url).searchParams.get('page'));
			return json([order(page * 10 + 1), order(page * 10 + 2)], { headers: { 'X-Pages': '3' } });
		});
		const res = await fetchRegionOrders(esi, 10000002, 16663);
		expect(calls.map((c) => c.url)).toEqual(
			[1, 2, 3].map(
				(p) => `https://esi.evetech.net/markets/10000002/orders?order_type=all&type_id=16663&page=${p}`
			)
		);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.items.map((o) => o.orderId)).toEqual([11, 12, 21, 22, 31, 32]);
		expect(res.items[1]).toEqual({
			orderId: 12,
			typeId: 16663,
			locationId: 60003760,
			systemId: 30000142,
			isBuyOrder: true,
			price: 120,
			volumeRemain: 12,
			range: 'region'
		});
	});

	it('returns a failed first page as a typed result', async () => {
		const { esi } = client(() => json({ error: 'x' }, { status: 429, headers: { 'Retry-After': '5' } }), 1);
		expect(await fetchRegionOrders(esi, 10000002, 34)).toEqual({ ok: false, status: 429, retryAfter: 5 });
	});
});
