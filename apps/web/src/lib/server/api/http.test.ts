import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	ApiError,
	CACHE_SHORT,
	apiHandler,
	apiJson,
	invalidParam,
	parseParams,
	parseQuery,
	preflight,
	readJsonBody,
	requireEnv
} from './http';

const event = (platform?: unknown) =>
	({
		url: new URL('https://reactions.coalition.space/api/v2/x'),
		request: new Request('https://reactions.coalition.space/api/v2/x'),
		platform
	}) as unknown as RequestEvent;

describe('API v2 helpers', () => {
	it('apiJson adds CORS and Cache-Control', async () => {
		const response = apiJson({ ok: 1 }, CACHE_SHORT);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
		expect(await response.json()).toEqual({ ok: 1 });
	});

	it('parseQuery uses the first value per key and reports every invalid param', () => {
		const schema = z.object({ a: z.coerce.number().int(), b: z.enum(['x', 'y']) });
		expect(parseQuery(schema, new URL('https://h/p?a=1&a=2&b=y'))).toEqual({ a: 1, b: 'y' });
		try {
			parseQuery(schema, new URL('https://h/p?a=1.5&b=z'));
			throw new Error('expected ApiError');
		} catch (e) {
			expect(e).toBeInstanceOf(ApiError);
			expect((e as ApiError).status).toBe(400);
			expect((e as ApiError).code).toBe('INVALID_PARAM');
			expect(((e as ApiError).details as { param: string }[]).map((d) => d.param)).toEqual(['a', 'b']);
		}
	});

	it('apiHandler renders ApiError and unexpected errors in the error shape', async () => {
		const notFound = await apiHandler(async () => {
			throw new ApiError(404, 'NOT_FOUND', 'Nope.', { slug: 'x' });
		})(event());
		expect(notFound.status).toBe(404);
		expect(notFound.headers.get('Cache-Control')).toBe('no-store');
		expect(await notFound.json()).toEqual({
			error: { code: 'NOT_FOUND', message: 'Nope.', details: { slug: 'x' } }
		});

		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const crash = await apiHandler(async () => {
			throw new Error('boom');
		})(event());
		spy.mockRestore();
		expect(crash.status).toBe(500);
		expect(await crash.json()).toEqual({ error: { code: 'INTERNAL', message: 'Internal error.' } });
		expect(crash.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('apiHandler skips rate limiting without a limiter binding and requireEnv needs a platform', async () => {
		const ok = await apiHandler(async (e) => apiJson(requireEnv(e) ? 'env' : null, CACHE_SHORT))(
			event({ env: {} })
		);
		expect(await ok.json()).toBe('env');
		const missing = await apiHandler(async (e) => apiJson(requireEnv(e), CACHE_SHORT))(event());
		expect(missing.status).toBe(500);
	});

	it('parseParams names root-level issues "body" and invalidParam builds a one-param 400', () => {
		try {
			parseParams(z.object({ a: z.number() }), []);
			throw new Error('expected ApiError');
		} catch (e) {
			expect(((e as ApiError).details as { param: string }[])[0].param).toBe('body');
		}
		const e = invalidParam('lines', 'Requires slots=optimal');
		expect([e.status, e.code, e.details]).toEqual([
			400,
			'INVALID_PARAM',
			[{ param: 'lines', message: 'Requires slots=optimal' }]
		]);
	});

	it('readJsonBody parses JSON within the byte limit', async () => {
		const req = (body: string, headers: Record<string, string> = {}) =>
			new Request('https://h/p', { method: 'POST', body, headers });
		expect(await readJsonBody(req('{"a":1}'), 10)).toEqual({ a: 1 });
		// Multi-byte characters count as bytes, not characters.
		await expect(readJsonBody(req('"ééééé"'), 10)).rejects.toMatchObject({
			status: 413,
			code: 'INVALID_PARAM'
		});
		await expect(readJsonBody(req('{}', { 'content-length': '11' }), 10)).rejects.toMatchObject({
			status: 413
		});
		await expect(readJsonBody(req('{'), 10)).rejects.toMatchObject({
			status: 400,
			details: [{ param: 'body', message: 'Must be a JSON object' }]
		});

		// Chunked body without Content-Length: reading stops once the limit is passed.
		let pulled = 0;
		const endless = new ReadableStream<Uint8Array>({
			pull(c) {
				pulled++;
				c.enqueue(new Uint8Array(8));
			}
		});
		const chunked = new Request('https://h/p', {
			method: 'POST',
			body: endless,
			duplex: 'half'
		} as RequestInit);
		await expect(readJsonBody(chunked, 10)).rejects.toMatchObject({ status: 413 });
		expect(pulled).toBeLessThan(5);
	});

	it('preflight allows the methods plus OPTIONS from any origin', () => {
		const response = preflight(['POST']);
		expect(response.status).toBe(204);
		expect(Object.fromEntries(response.headers)).toMatchObject({
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'POST, OPTIONS',
			'access-control-allow-headers': 'Content-Type',
			'access-control-max-age': '86400'
		});
	});
});
