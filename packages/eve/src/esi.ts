export const APP_NAME = 'EVE-Reactions-Calculator';

export interface UserAgentParts {
	version: string;
	/** The tool's public URL or source repository. */
	url?: string;
	/** Free-text contact, e.g. `mail:you@example.com; eve:Character Name; discord:name`. */
	contact?: string;
}

/** `EVE-Reactions-Calculator/<version> (+<url>; <contact>)` per the ESI best practices; empty parts are left out. */
export function buildUserAgent({ version, url, contact }: UserAgentParts): string {
	const details = [url?.trim() ? `+${url.trim()}` : '', contact?.trim() ?? ''].filter(Boolean);
	const product = `${APP_NAME}/${version.trim()}`;
	return details.length ? `${product} (${details.join('; ')})` : product;
}

export const ESI_COMPAT_DATE = '2026-08-18';
export const ESI_BASE_URL = 'https://esi.evetech.net';

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RateLimit {
	remaining: number;
	limit: number;
}

export interface EsiResponse<T = unknown> {
	status: number;
	/** Parsed JSON body; `null` for 304 or a non-JSON body. */
	data: T | null;
	etag: string | null;
	/** `Expires` header as unix ms. */
	expiresAt: number | null;
	/** `X-Pages`, 1 when absent. */
	pages: number;
	rateLimit: RateLimit | null;
	errorLimitRemain: number | null;
	/** `Retry-After` in seconds. */
	retryAfter: number | null;
	/** `Last-Modified` header as unix ms. */
	lastModified: number | null;
}

export interface EsiGetOptions {
	etag?: string | null;
	accessToken?: string;
	/** Overrides the client's attempt count for this request. */
	attempts?: number;
}

export interface EsiClientOptions {
	fetch: FetchFn;
	/** Sent as `User-Agent` on every request (see `buildUserAgent`). */
	userAgent: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	/** Total attempts for 5xx/420/429 or network errors (default 2). */
	attempts?: number;
	baseUrl?: string;
	/**
	 * Awaited before every attempt; `false` throws `EsiDowntimeError` without sending the request
	 * (the updater closes ESI around the daily downtime).
	 */
	gate?: () => Promise<boolean>;
}

export interface EsiClient {
	get<T = unknown>(path: string, options?: EsiGetOptions): Promise<EsiResponse<T>>;
	/** POST with a JSON body (bulk lookups such as `/characters/affiliation`); same retries as `get`. */
	post<T = unknown>(
		path: string,
		body: unknown,
		options?: Omit<EsiGetOptions, 'etag'>
	): Promise<EsiResponse<T>>;
	readonly guard: EsiGuard;
	now(): number;
}

export class EsiError extends Error {
	readonly status: number;
	readonly path: string;
	constructor(status: number, path: string, message?: string) {
		super(message ?? `ESI ${status} for ${path}`);
		this.name = 'EsiError';
		this.status = status;
		this.path = path;
	}
}

/** Thrown instead of sending a request while the client's gate is closed (ESI's daily downtime). */
export class EsiDowntimeError extends Error {
	constructor(message = 'ESI is in its daily downtime') {
		super(message);
		this.name = 'EsiDowntimeError';
	}
}

/** Also matches by name: errors crossing a Workflow step boundary can lose their prototype. */
export function isEsiDowntime(error: unknown): boolean {
	if (error instanceof EsiDowntimeError) return true;
	return typeof error === 'object' && error !== null && 'name' in error && error.name === 'EsiDowntimeError';
}

/** Remembers the latest ESI rate-limit headers and whether ESI asked us to back off. */
export class EsiGuard {
	rateLimit: RateLimit | null = null;
	errorLimitRemain: number | null = null;
	throttled = false;
	retryAfter: number | null = null;

	update(response: Pick<EsiResponse, 'status' | 'rateLimit' | 'errorLimitRemain' | 'retryAfter'>): void {
		if (response.rateLimit) this.rateLimit = response.rateLimit;
		if (response.errorLimitRemain != null) this.errorLimitRemain = response.errorLimitRemain;
		if (response.status === 420 || response.status === 429) {
			this.throttled = true;
			this.retryAfter = response.retryAfter;
		}
	}

	tripped(): boolean {
		if (this.throttled) return true;
		if (this.rateLimit && this.rateLimit.remaining < this.rateLimit.limit * 0.1) return true;
		return this.errorLimitRemain != null && this.errorLimitRemain < 20;
	}
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseIntHeader(headers: Headers, name: string): number | null {
	const value = headers.get(name);
	if (value == null || value.trim() === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/** Parses `X-Ratelimit-Limit` values like `12000/15m`. */
export function parseRateLimit(headers: Headers): RateLimit | null {
	const remaining = parseIntHeader(headers, 'X-Ratelimit-Remaining');
	const limitHeader = headers.get('X-Ratelimit-Limit');
	if (remaining == null || !limitHeader) return null;
	const limit = Number(limitHeader.split('/')[0]);
	return Number.isFinite(limit) ? { remaining, limit } : null;
}

/** `Retry-After` as seconds (delta-seconds or HTTP date). */
export function parseRetryAfter(headers: Headers, now: number): number | null {
	const value = headers.get('Retry-After');
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds);
	const date = Date.parse(value);
	return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

export function parseExpires(headers: Headers): number | null {
	return parseDateHeader(headers, 'Expires');
}

function parseDateHeader(headers: Headers, name: string): number | null {
	const value = headers.get(name);
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text === '') return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Longest `Retry-After` the client waits out before retrying; longer waits return the response as is. */
export const MAX_RETRY_WAIT_SECONDS = 30;

export function createEsiClient(options: EsiClientOptions): EsiClient {
	const fetchFn = options.fetch;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	const defaultAttempts = Math.max(1, options.attempts ?? 2);
	const baseUrl = options.baseUrl ?? ESI_BASE_URL;
	const guard = new EsiGuard();

	async function request<T>(
		method: 'GET' | 'POST',
		path: string,
		opts: EsiGetOptions,
		body?: unknown
	): Promise<EsiResponse<T>> {
		const attempts = Math.max(1, opts.attempts ?? defaultAttempts);
		const headers: Record<string, string> = { ...baseHeaders(options.userAgent) };
		if (opts.etag) headers['If-None-Match'] = opts.etag;
		if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
		if (method === 'POST') headers['Content-Type'] = 'application/json';
		const init: RequestInit = { method, headers };
		if (method === 'POST') init.body = JSON.stringify(body);
		const url = baseUrl + path;

		for (let attempt = 1; ; attempt++) {
			if (options.gate && !(await options.gate())) throw new EsiDowntimeError();
			let response: Response;
			try {
				response = await fetchFn(url, init);
			} catch (error) {
				if (attempt >= attempts) throw error;
				await sleep(1000);
				continue;
			}
			const result: EsiResponse<T> = {
				status: response.status,
				data: response.status === 304 ? null : ((await readJson(response)) as T | null),
				etag: response.headers.get('ETag'),
				expiresAt: parseExpires(response.headers),
				pages: parseIntHeader(response.headers, 'X-Pages') ?? 1,
				rateLimit: parseRateLimit(response.headers),
				errorLimitRemain: parseIntHeader(response.headers, 'X-ESI-Error-Limit-Remain'),
				retryAfter: parseRetryAfter(response.headers, now()),
				lastModified: parseDateHeader(response.headers, 'Last-Modified')
			};
			guard.update(result);
			const retryable = result.status >= 500 || result.status === 420 || result.status === 429;
			if (!retryable || attempt >= attempts) return result;
			// A long throttle wait (ESI's floating window can ask for minutes) would outlast a workflow step;
			// hand the response back so the caller's guard/fallback decides instead.
			if ((result.retryAfter ?? 0) > MAX_RETRY_WAIT_SECONDS) return result;
			await sleep((result.retryAfter ?? 1) * 1000);
		}
	}

	return {
		get: (path, opts = {}) => request('GET', path, opts),
		post: (path, body, opts = {}) => request('POST', path, opts, body),
		guard,
		now
	};
}

function baseHeaders(userAgent: string): Record<string, string> {
	return { 'User-Agent': userAgent, 'X-Compatibility-Date': ESI_COMPAT_DATE, Accept: 'application/json' };
}

/**
 * One ungated `GET /status` (the probe that decides when the downtime is over). Network errors,
 * non-2XX answers and unexpected bodies return `null`; it never throws.
 */
export async function fetchServerStatus(
	fetch: FetchFn,
	userAgent: string,
	baseUrl: string = ESI_BASE_URL
): Promise<{ players: number; vip: boolean } | null> {
	try {
		const response = await fetch(`${baseUrl}/status`, { method: 'GET', headers: baseHeaders(userAgent) });
		if (!response.ok) return null;
		const body = await readJson(response);
		if (typeof body !== 'object' || body === null || !('players' in body)) return null;
		const { players } = body;
		if (typeof players !== 'number' || !Number.isFinite(players)) return null;
		return { players, vip: 'vip' in body && body.vip === true };
	} catch {
		return null;
	}
}

/** Non-2XX answer of a client function: returned, never thrown. */
export type EsiFailure = { ok: false; status: number; retryAfter: number | null };

export type PagedResult<T> = { ok: true; status: number; items: T[]; expiresAt: number | null } | EsiFailure;

/** Fetches page 1, then every remaining `X-Pages` page. A non-2XX first page is returned, later failures throw. */
export async function fetchAllPages<T>(
	client: EsiClient,
	path: string,
	options: Omit<EsiGetOptions, 'etag'> = {}
): Promise<PagedResult<T>> {
	const separator = path.includes('?') ? '&' : '?';
	const first = await client.get<T[]>(`${path}${separator}page=1`, options);
	if (first.status < 200 || first.status >= 300) {
		return { ok: false, status: first.status, retryAfter: first.retryAfter };
	}
	const items: T[] = [...(first.data ?? [])];
	for (let page = 2; page <= first.pages; page++) {
		const res = await client.get<T[]>(`${path}${separator}page=${page}`, options);
		if (res.status < 200 || res.status >= 300)
			throw new EsiError(res.status, path, `ESI ${res.status} on page ${page} of ${path}`);
		items.push(...(res.data ?? []));
	}
	return { ok: true, status: first.status, items, expiresAt: first.expiresAt };
}
