import { getCoreDb, httpCache } from '@reactions/db';
import type { HttpCacheRow } from '@reactions/db';
import { buildUserAgent, createEsiClient } from '@reactions/eve';
import type { ConditionalResult, EsiClient, FetchFn } from '@reactions/eve';
import { eq } from 'drizzle-orm';
import pkg from '../package.json' with { type: 'json' };

/**
 * Every outbound request goes through the global `fetch`, resolved at call time so tests can
 * replace it (`vi.stubGlobal('fetch', …)`) inside the workers isolate.
 */
export const httpFetch: FetchFn = (input, init) => fetch(input, init);

/** User-Agent of every outbound request: this worker's package.json version + `USER_AGENT_URL`/`USER_AGENT_CONTACT`. */
export function userAgent(env: { USER_AGENT_URL?: string; USER_AGENT_CONTACT?: string }): string {
	return buildUserAgent({ version: pkg.version, url: env.USER_AGENT_URL, contact: env.USER_AGENT_CONTACT });
}

export function esiClient(env: Env, now: () => number = Date.now): EsiClient {
	return createEsiClient({ fetch: httpFetch, userAgent: userAgent(env), now });
}

export async function getHttpCache(env: Env, url: string): Promise<HttpCacheRow | null> {
	const row = await getCoreDb(env.DB).select().from(httpCache).where(eq(httpCache.url, url)).get();
	return row ?? null;
}

/** Records a 200 response: validator and freshness. */
export async function saveHttpCache(
	env: Env,
	url: string,
	values: { etag: string | null; expiresAt: number | null },
	now: number
): Promise<void> {
	const set = { etag: values.etag, lastModified: null, expiresAt: values.expiresAt, updatedAt: now };
	await getCoreDb(env.DB)
		.insert(httpCache)
		.values({ url, ...set })
		.onConflictDoUpdate({ target: httpCache.url, set });
}

/** Records a 304 response: only the freshness changes, the stored validator is kept. */
export async function touchHttpCache(
	env: Env,
	url: string,
	expiresAt: number | null,
	now: number
): Promise<void> {
	await getCoreDb(env.DB).update(httpCache).set({ expiresAt, updatedAt: now }).where(eq(httpCache.url, url));
}

export type ConditionalOutcome<R> =
	| { kind: 'fresh'; expiresAt: number }
	| { kind: 'not_modified'; expiresAt: number | null }
	| { kind: 'updated'; expiresAt: number | null; result: R };

/**
 * `http_cache`-driven conditional GET: no request while `expires_at` is in the future (unless `force`,
 * an admin run); otherwise the stored ETag is sent. 304 → only `expires_at` is updated. 200 →
 * `apply(data)` runs first and the validator is stored afterwards, so a failed write is retried on the
 * next tick. `apply` returns `store: false` to keep the old validator (e.g. nothing could be written yet).
 */
export async function conditionalRefresh<T, R>(
	env: Env,
	url: string,
	now: number,
	request: (etag: string | null) => Promise<ConditionalResult<T>>,
	apply: (data: T) => Promise<{ result: R; store: boolean }>,
	force = false
): Promise<ConditionalOutcome<R>> {
	const cached = await getHttpCache(env, url);
	if (!force && cached?.expiresAt != null && cached.expiresAt > now)
		return { kind: 'fresh', expiresAt: cached.expiresAt };
	const res = await request(cached?.etag ?? null);
	if (res.notModified || res.data === null) {
		await touchHttpCache(env, url, res.expiresAt, now);
		return { kind: 'not_modified', expiresAt: res.expiresAt };
	}
	const { result, store } = await apply(res.data);
	if (store) await saveHttpCache(env, url, { etag: res.etag, expiresAt: res.expiresAt }, now);
	return { kind: 'updated', expiresAt: res.expiresAt, result };
}

/** One log fragment describing a conditional refresh. */
export function describeOutcome<R>(outcome: ConditionalOutcome<R>, updated: (result: R) => string): string {
	const until = (ms: number | null) => (ms == null ? 'unknown' : new Date(ms).toISOString());
	if (outcome.kind === 'fresh') return `skipped (fresh until ${until(outcome.expiresAt)})`;
	if (outcome.kind === 'not_modified') return `not modified (expires ${until(outcome.expiresAt)})`;
	return `${updated(outcome.result)} (expires ${until(outcome.expiresAt)})`;
}
