import { json, type RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';

/** Shared API v2 plumbing: JSON error shape, CORS, cache headers, rate limiting and query parsing. */

export type ApiErrorCode = 'INVALID_PARAM' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL';

export const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' } as const;
/** Prices, profits and meta. */
export const CACHE_SHORT = 'public, max-age=60';
/** Reactions, hubs and systems. */
export const CACHE_LONG = 'public, max-age=3600';
/** POST responses and errors. */
export const NO_STORE = 'no-store';

/** Thrown inside {@link apiHandler} handlers; rendered as `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: ApiErrorCode,
		message: string,
		readonly details?: unknown,
		readonly headers: Record<string, string> = {}
	) {
		super(message);
	}
}

export function apiErrorResponse(e: ApiError): Response {
	const error = {
		code: e.code,
		message: e.message,
		...(e.details === undefined ? {} : { details: e.details })
	};
	return json(
		{ error },
		{ status: e.status, headers: { ...CORS_HEADERS, 'Cache-Control': NO_STORE, ...e.headers } }
	);
}

export function apiJson(data: unknown, cacheControl: string): Response {
	return json(data, { headers: { ...CORS_HEADERS, 'Cache-Control': cacheControl } });
}

/** Worker bindings of the request; a missing platform (never on Cloudflare) is an `INTERNAL` error. */
export function requireEnv(event: Pick<RequestEvent, 'platform'>): Env {
	if (!event.platform) throw new ApiError(500, 'INTERNAL', 'Platform bindings are unavailable.');
	return event.platform.env;
}
/**
 * Parses `url.searchParams` (first value per key) with `schema`; failures throw a 400 `INVALID_PARAM`
 * whose details list `{ param, message }` per issue.
 */
export function parseQuery<S extends z.ZodType>(schema: S, url: URL): z.output<S> {
	const raw: Record<string, string> = {};
	for (const [key, value] of url.searchParams) raw[key] ??= value;
	return parseParams(schema, raw);
}

/** Like {@link parseQuery} for an already collected object (e.g. route params). */
export function parseParams<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
	const parsed = schema.safeParse(raw);
	if (parsed.success) return parsed.data;
	const details = parsed.error.issues.map((issue) => ({
		// A root-level issue (e.g. a JSON body that is not an object) names the whole body.
		param: issue.path.join('.') || 'body',
		message: issue.message
	}));
	throw new ApiError(400, 'INVALID_PARAM', 'Invalid request parameters.', details);
}

/** 400 `INVALID_PARAM` for one parameter (checks zod cannot express, e.g. database lookups). */
export const invalidParam = (param: string, message: string) =>
	new ApiError(400, 'INVALID_PARAM', 'Invalid request parameters.', [{ param, message }]);

/**
 * JSON request body of at most `maxBytes` (413 `INVALID_PARAM` when larger, judged by `Content-Length`
 * and by the bytes actually read); malformed JSON → 400 `INVALID_PARAM` naming `body`.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
	const tooLarge = () =>
		new ApiError(413, 'INVALID_PARAM', `Request body must not exceed ${maxBytes} bytes.`, [
			{ param: 'body', message: `At most ${maxBytes} bytes` }
		]);
	if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw tooLarge();
	// Chunked bodies have no Content-Length: count while reading and stop at the limit.
	const bytes = await readBodyBounded(request, maxBytes);
	if (bytes === null) throw tooLarge();
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new ApiError(400, 'INVALID_PARAM', 'Invalid request parameters.', [
			{ param: 'body', message: 'Must be a JSON object' }
		]);
	}
}

/** The request body, or `null` as soon as more than `maxBytes` arrived (the rest is not read). */
export async function readBodyBounded(request: Request, maxBytes: number): Promise<Uint8Array | null> {
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/** CORS preflight answer for endpoints that accept `methods` (e.g. `POST`). */
export function preflight(methods: string[]): Response {
	return new Response(null, {
		status: 204,
		headers: {
			...CORS_HEADERS,
			'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Max-Age': '86400'
		}
	});
}

/** `API_RATE_LIMITER` keyed by the client IP; skipped when the binding is absent (e.g. prerendering). */
async function rateLimited(event: RequestEvent): Promise<boolean> {
	const limiter = event.platform?.env.API_RATE_LIMITER;
	if (!limiter) return false;
	const ip = event.request.headers.get('cf-connecting-ip') ?? 'unknown';
	const { success } = await limiter.limit({ key: `api:${ip}` });
	return !success;
}

/**
 * Wraps an API v2 handler: rate limit (429 `RATE_LIMITED` + `Retry-After: 60`), {@link ApiError} →
 * JSON error, anything else → 500 `INTERNAL`.
 */
export function apiHandler<E extends RequestEvent>(handler: (event: E) => Promise<Response>) {
	return async (event: E): Promise<Response> => {
		try {
			if (await rateLimited(event)) {
				throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.', undefined, {
					'Retry-After': '60'
				});
			}
			return await handler(event);
		} catch (e) {
			if (e instanceof ApiError) return apiErrorResponse(e);
			console.error('API error', e);
			return apiErrorResponse(new ApiError(500, 'INTERNAL', 'Internal error.'));
		}
	};
}
