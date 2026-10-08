/** Helpers for API v2 route tests: a seeded fake env and request events for `+server.ts` handlers. */
import type { RequestEvent } from '@sveltejs/kit';
import { fakeEnv, type FakeEnv } from './fakes.ts';
import { insertSystems, loadSde, putKv } from './fixtures.ts';

export const ORIGIN = 'https://reactions.coalition.space';

/** Env with the default systems (Ignoitton …), the SDE fixture and a Jita market snapshot in KV. */
export async function seededEnv(overrides: Partial<FakeEnv> = {}) {
	const env = fakeEnv(overrides);
	insertSystems(env.DB);
	const sde = await loadSde();
	await putKv(env, sde);
	return { env, sde };
}

export function apiEvent(
	env: FakeEnv,
	path: string,
	opts: { params?: Record<string, string>; init?: RequestInit; ip?: string } = {}
): RequestEvent {
	const url = new URL(ORIGIN + path);
	const headers = new Headers(opts.init?.headers);
	headers.set('cf-connecting-ip', opts.ip ?? '203.0.113.7');
	return {
		url,
		params: opts.params ?? {},
		platform: { env },
		request: new Request(url, { ...opts.init, headers })
	} as unknown as RequestEvent;
}

/** Any `+server.ts` handler. */
export type Handler = (event: never) => Response | Promise<Response>;

/** Calls a handler; `body` is parsed JSON, or the text for non-JSON responses. */
export async function callApi(handler: Handler, event: RequestEvent) {
	const response = await handler(event as never);
	const text = await response.text();
	const json = response.headers.get('content-type')?.includes('application/json');
	return { response, body: json ? JSON.parse(text) : text, text };
}

/** `details[].param` of an `INVALID_PARAM` body. */
export const invalidParams = (body: { error: { details?: unknown } }) =>
	(body.error.details as { param: string }[]).map((d) => d.param);
