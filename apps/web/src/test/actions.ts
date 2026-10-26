/** Request events and outcome helpers for `web-unit` tests of profits page loads, actions and endpoints. */
import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from '#lib/server/session.js';
import { FakeCookies, type FakeEnv } from './fakes.ts';

/** A GET (no `fields`) or form POST event for `path` (path and query). */
export function requestEvent(
	env: FakeEnv,
	user: SessionUser | null,
	path: string,
	fields?: Record<string, string>
): never {
	const url = new URL(`https://reactions.coalition.space${path}`);
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
	}
	return {
		url,
		params: {},
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark', env }
	} as unknown as RequestEvent as never;
}

/** What an action or endpoint did: its data (failure status), a redirect or an HTTP error. */
export async function settle(
	promise: unknown
): Promise<{ status?: number; data?: unknown; redirect?: string; error?: number }> {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		if (isHttpError(e)) return { error: e.status };
		throw e;
	}
}
