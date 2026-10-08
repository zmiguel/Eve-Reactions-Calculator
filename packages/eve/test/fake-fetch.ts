import type { FetchFn } from '../src/esi.ts';

/** User-Agent the tests pass to every request function. */
export const TEST_UA = 'EVE-Reactions-Calculator/9.9.9 (+https://example.test/; mail:test@example.test)';

export interface RecordedCall {
	url: string;
	method: string;
	headers: Headers;
	body: string | null;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** Fake `fetch` that records every request and answers through `handler`. */
export function fakeFetch(handler: Handler): { fetch: FetchFn; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const fetch: FetchFn = async (input, init) => {
		const call: RecordedCall = {
			url: String(input instanceof Request ? input.url : input),
			method: init?.method ?? 'GET',
			headers: new Headers(init?.headers),
			body: typeof init?.body === 'string' ? init.body : null
		};
		calls.push(call);
		return handler(call);
	};
	return { fetch, calls };
}

export function json(
	body: unknown,
	init: { status?: number; headers?: Record<string, string> } = {}
): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { 'Content-Type': 'application/json', ...init.headers }
	});
}
