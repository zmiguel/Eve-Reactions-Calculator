/**
 * Post-cutover check (PLAN B13 step 7): requests every v2 URL pattern for every reaction product id and
 * expects a permanent, same-origin redirect to the matching v3 page, which must answer 200.
 * Usage: `node scripts/check-legacy-urls.ts <baseUrl> [--concurrency N]` (or `npm run check:legacy -- …`).
 * Exit code 0 when every URL passes, 1 on any failure, 2 on bad arguments.
 */
import { parseArgs } from 'node:util';
import type { Reactor } from '@reactions/engine';
import { LEGACY_TYPES } from '../apps/web/src/lib/server/legacy.ts';

export const DEFAULT_CONCURRENCY = 4;
/** The 301 of the old URL plus at most one more hop before the final 200. */
export const MAX_REDIRECTS = 2;

const REACTORS = Object.keys(LEGACY_TYPES) as Reactor[];

/** Fields of a `/api/v2/reactions` item the URL list needs. */
export interface ReactionRef {
	reactor: Reactor;
	slug: string;
	product: { typeId: number };
}

/** An old URL and the v3 path (+ query) it must end on; `path === target` means it must answer 200 as is. */
export interface LegacyUrl {
	path: string;
	target: string;
}

export type CheckResult = { url: string; ok: true } | { url: string; ok: false; reason: string };

/**
 * Every v2 URL: the reactor listings (same path in v3), `/<reactor>/<type>/<productTypeId>` for each
 * legacy type of the reaction's reactor, and `/hybrid/<productTypeId>`.
 */
export function buildLegacyUrls(reactions: readonly ReactionRef[]): LegacyUrl[] {
	const urls: LegacyUrl[] = REACTORS.map((reactor) => ({ path: `/${reactor}`, target: `/${reactor}` }));
	for (const r of reactions) {
		const target = `/${r.reactor}/${r.slug}`;
		const id = r.product.typeId;
		if (r.reactor === 'hybrid') urls.push({ path: `/hybrid/${id}`, target });
		for (const [type, { query }] of Object.entries(LEGACY_TYPES[r.reactor])) {
			urls.push({ path: `/${r.reactor}/${type}/${id}`, target: `${target}${query}` });
		}
	}
	return urls;
}

const pathOf = (href: string) => {
	const u = new URL(href);
	return u.pathname + u.search;
};

/**
 * Requests `url.path` on `origin` without following redirects and walks the chain by hand: every hop
 * must be a 301 with a same-origin `Location`, no URL may repeat, at most {@link MAX_REDIRECTS} hops,
 * and the chain must end with a 200 on `url.target`.
 */
export async function checkUrl(url: LegacyUrl, origin: string, fetchFn: typeof fetch): Promise<CheckResult> {
	const start = new URL(url.path, origin).href;
	const expected = new URL(url.target, origin).href;
	const fail = (reason: string): CheckResult => ({ url: start, ok: false, reason });
	const chain = [start];
	let current = start;
	for (;;) {
		let res: Response;
		try {
			res = await fetchFn(current, { redirect: 'manual' });
		} catch (e) {
			return fail(`request to ${current} failed: ${(e as Error).message}`);
		}
		await res.body?.cancel();
		const at = current === start ? '' : ` at ${current}`;
		if (res.status < 300 || res.status >= 400) {
			if (res.status !== 200) {
				return fail(
					current === start ? `HTTP ${res.status}` : `target ${current} answered HTTP ${res.status}`
				);
			}
			if (current !== expected) {
				return fail(
					current === start
						? `HTTP 200 without redirect, expected 301 to ${url.target}`
						: `redirected to ${pathOf(current)}, expected ${url.target}`
				);
			}
			return { url: start, ok: true };
		}
		if (res.status !== 301) return fail(`HTTP ${res.status} instead of 301${at}`);
		const location = res.headers.get('location');
		if (!location) return fail(`301 without Location header${at}`);
		const next = new URL(location, current);
		if (next.origin !== new URL(origin).origin) return fail(`cross-origin redirect to ${next.href}${at}`);
		if (chain.includes(next.href)) {
			return fail(`redirect loop: ${[...chain, next.href].map(pathOf).join(' -> ')}`);
		}
		chain.push(next.href);
		if (chain.length - 1 > MAX_REDIRECTS) {
			return fail(`more than ${MAX_REDIRECTS} redirects: ${chain.map(pathOf).join(' -> ')}`);
		}
		current = next.href;
	}
}

/** Runs `fn` over `items` with at most `limit` calls in flight; results keep the input order. */
export async function mapPool<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

function isReactionRef(value: unknown): value is ReactionRef {
	const r = value as ReactionRef | null;
	return (
		typeof r === 'object' &&
		r !== null &&
		REACTORS.includes(r.reactor) &&
		typeof r.slug === 'string' &&
		Number.isInteger(r.product?.typeId)
	);
}

/** The reaction list of the deployed site (`GET /api/v2/reactions`, a JSON array of recipes). */
export async function fetchReactions(origin: string, fetchFn: typeof fetch): Promise<ReactionRef[]> {
	const url = new URL('/api/v2/reactions', origin).href;
	const res = await fetchFn(url);
	if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
	const body: unknown = await res.json();
	if (!Array.isArray(body) || body.length === 0 || !body.every(isReactionRef)) {
		throw new Error(`${url} did not return a non-empty array of reactions`);
	}
	return body;
}

export interface CliDeps {
	fetch: typeof fetch;
	log: (line: string) => void;
	error: (line: string) => void;
}

const USAGE = 'Usage: node scripts/check-legacy-urls.ts <baseUrl> [--concurrency N]';

/** CLI entry: returns the process exit code (0 all passed, 1 any failure, 2 bad arguments). */
export async function main(args: string[], deps: CliDeps): Promise<number> {
	let baseUrl: string | undefined;
	let concurrency = DEFAULT_CONCURRENCY;
	try {
		const parsed = parseArgs({ args, options: { concurrency: { type: 'string' } }, allowPositionals: true });
		baseUrl = parsed.positionals[0];
		if (parsed.positionals.length !== 1 || !URL.canParse(baseUrl)) throw new Error('expected one base URL');
		if (parsed.values.concurrency !== undefined) {
			concurrency = Number(parsed.values.concurrency);
			if (!Number.isInteger(concurrency) || concurrency < 1)
				throw new Error('--concurrency must be a positive integer');
		}
	} catch (e) {
		deps.error(`${(e as Error).message}\n${USAGE}`);
		return 2;
	}
	const origin = new URL(baseUrl).origin;

	let reactions: ReactionRef[];
	try {
		reactions = await fetchReactions(origin, deps.fetch);
	} catch (e) {
		deps.error(`FAIL reaction list: ${(e as Error).message}`);
		return 1;
	}
	const urls = buildLegacyUrls(reactions);
	deps.log(
		`Checking ${urls.length} legacy URLs for ${reactions.length} reactions on ${origin} (concurrency ${concurrency})`
	);
	const results = await mapPool(urls, concurrency, async (url) => {
		const result = await checkUrl(url, origin, deps.fetch);
		if (!result.ok) deps.error(`FAIL ${result.url}: ${result.reason}`);
		return result;
	});
	const failed = results.filter((r) => !r.ok).length;
	deps.log(`${results.length - failed} passed, ${failed} failed of ${results.length} legacy URLs`);
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	process.exitCode = await main(process.argv.slice(2), { fetch, log: console.log, error: console.error });
}
