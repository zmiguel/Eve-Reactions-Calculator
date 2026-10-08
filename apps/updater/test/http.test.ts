import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { conditionalRefresh, describeOutcome, esiClient, httpFetch, userAgent } from '../src/http.ts';
import { installFetch, resetState } from './helpers.ts';

const URL_KEY = 'https://example.test/resource';

async function cacheRow() {
	return env.DB.prepare('SELECT etag, expires_at, updated_at FROM http_cache WHERE url = ?')
		.bind(URL_KEY)
		.first();
}

describe('httpFetch', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('resolves the global fetch at call time', async () => {
		const calls = installFetch(() => new Response('hello'));

		const res = await httpFetch('https://example.test/x', { headers: { 'X-Test': '1' } });

		expect(await res.text()).toBe('hello');
		expect(calls[0]!.url).toBe('https://example.test/x');
		expect(calls[0]!.headers.get('X-Test')).toBe('1');
	});
});

describe('userAgent', () => {
	afterEach(() => vi.unstubAllGlobals());

	const expected = `EVE-Reactions-Calculator/${pkg.version} (+https://example.test/; mail:ops@example.test)`;

	it('builds the User-Agent from the package version and the USER_AGENT_* vars', () => {
		expect(userAgent(env)).toBe(expected);
		expect(userAgent({ USER_AGENT_URL: ' ', USER_AGENT_CONTACT: '' })).toBe(
			`EVE-Reactions-Calculator/${pkg.version}`
		);
	});

	it('is sent by the ESI client', async () => {
		const calls = installFetch(() => Response.json([]));

		await esiClient(env).get('/markets/prices');

		expect(calls[0]!.headers.get('User-Agent')).toBe(expected);
	});
});

describe('conditionalRefresh', () => {
	beforeEach(resetState);

	it('applies a 200, then stores the validator', async () => {
		const request = vi.fn(async (etag: string | null) => ({
			notModified: false,
			data: [1, 2],
			etag: etag === null ? '"a"' : '"b"',
			expiresAt: 500
		}));

		const outcome = await conditionalRefresh(env, URL_KEY, 100, request, async (data) => ({
			result: data.length,
			store: true
		}));

		expect(request).toHaveBeenCalledWith(null);
		expect(outcome).toEqual({ kind: 'updated', expiresAt: 500, result: 2 });
		expect(await cacheRow()).toEqual({ etag: '"a"', expires_at: 500, updated_at: 100 });
		expect(describeOutcome(outcome, (n) => `${n} rows`)).toBe(
			`2 rows (expires ${new Date(500).toISOString()})`
		);
	});

	it('does not store the validator when applying the data fails', async () => {
		const request = async () => ({ notModified: false, data: 'x', etag: '"a"', expiresAt: 500 });

		await expect(
			conditionalRefresh(env, URL_KEY, 100, request, async () => {
				throw new Error('write failed');
			})
		).rejects.toThrow('write failed');

		expect(await cacheRow()).toBeNull();
	});

	it('reports fresh entries without requesting', async () => {
		await env.DB.prepare('INSERT INTO http_cache (url, etag, expires_at, updated_at) VALUES (?, ?, 1000, 1)')
			.bind(URL_KEY, '"a"')
			.run();
		const request = vi.fn();

		const outcome = await conditionalRefresh(env, URL_KEY, 999, request, async () => ({
			result: 0,
			store: true
		}));

		expect(request).not.toHaveBeenCalled();
		expect(outcome).toEqual({ kind: 'fresh', expiresAt: 1000 });
	});
});
