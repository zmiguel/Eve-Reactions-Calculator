import { introspectWorkflow } from 'cloudflare:test';
import type { WorkflowIntrospector } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { DATASET_KV_KEY, MARKET_KV_KEY } from '@reactions/db';
import { vi } from 'vitest';

export interface RecordedCall {
	url: string;
	headers: Headers;
	/** Request body when it was sent as a string (SSO token form). */
	body: string | null;
}

export type Route = (url: URL, call: RecordedCall) => Response | Promise<Response>;

/** Replaces the isolate's global `fetch`; every request is recorded and answered by `route`. */
export function installFetch(route: Route): RecordedCall[] {
	const calls: RecordedCall[] = [];
	vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		const call = {
			url,
			headers: new Headers(init?.headers),
			body: typeof init?.body === 'string' ? init.body : null
		};
		calls.push(call);
		return route(new URL(url), call);
	});
	return calls;
}

export function json(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers }
	});
}

/** ESI-style caching headers. */
export function cacheHeaders(etag: string, expiresAt: number): Record<string, string> {
	return { ETag: etag, Expires: new Date(expiresAt).toUTCString() };
}

export function notModified(headers: Record<string, string> = {}): Response {
	return new Response(null, { status: 304, headers });
}

/** Raw ESI market order (`system_id` omitted for structure markets). */
export function order(
	typeId: number,
	locationId: number,
	systemId: number | null,
	isBuyOrder: boolean,
	price: number,
	volumeRemain: number
): Record<string, unknown> {
	return {
		order_id: Math.floor(Math.random() * 1e12),
		type_id: typeId,
		location_id: locationId,
		...(systemId === null ? {} : { system_id: systemId }),
		is_buy_order: isBuyOrder,
		price,
		volume_remain: volumeRemain,
		range: 'region'
	};
}

/** Fuzzwork aggregates body for the `types` of a request: buy max 50, sell min 60. */
export function fuzzwork(url: URL): Response {
	const side = (max: string, min: string, volume: string) => ({
		max,
		min,
		percentile: max,
		volume,
		orderCount: '3'
	});
	const typeIds = url.searchParams.get('types')!.split(',');
	return json(
		Object.fromEntries(
			typeIds.map((t) => [t, { buy: side('50', '1', '100'), sell: side('90', '60', '200') }])
		)
	);
}

export function fixtureZip(): Uint8Array {
	const binary = atob(env.SDE_FIXTURE_B64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Build number of `sde-mini.zip`. */
export const FIXTURE_BUILD = 3421648;

const RESET_SQL = [
	'DELETE FROM adjusted_prices',
	'DELETE FROM cost_indices',
	'DELETE FROM latest_prices',
	'DELETE FROM http_cache',
	'DELETE FROM job_runs',
	'DELETE FROM sde_state',
	'DELETE FROM reaction_materials',
	'DELETE FROM reprocess_materials',
	'DELETE FROM reactions',
	'DELETE FROM types',
	'DELETE FROM systems',
	'DELETE FROM regions',
	"DELETE FROM market_hubs WHERE kind = 'structure'",
	"UPDATE market_hubs SET enabled = 1, visibility = 'public', last_success_at = NULL, last_error = NULL",
	'DELETE FROM market_stats',
	'DELETE FROM structure_links',
	'DELETE FROM characters',
	'DELETE FROM users'
];

const RESET_HISTORY_SQL = [
	'DELETE FROM price_snapshots',
	'DELETE FROM price_daily',
	'DELETE FROM esi_market_history',
	'DELETE FROM adjusted_price_daily',
	'DELETE FROM cost_index_daily',
	'DELETE FROM archive_manifest'
];

/** Empties every table the updater writes (seeded NPC hubs are restored), the KV keys and R2. */
export async function resetState(): Promise<void> {
	await env.DB.batch(RESET_SQL.map((q) => env.DB.prepare(q)));
	await env.HISTORY_DB.batch(RESET_HISTORY_SQL.map((q) => env.HISTORY_DB.prepare(q)));
	await env.CACHE.delete(DATASET_KV_KEY);
	await env.CACHE.delete(MARKET_KV_KEY);
	const archived = await env.ARCHIVE.list();
	if (archived.objects.length > 0) await env.ARCHIVE.delete(archived.objects.map((o) => o.key));
}

/** Minimal reaction so the tracked type set is {46166, 16663, 4312, 16643, 16647}. */
export async function seedTrackedReaction(): Promise<void> {
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO reactions (blueprint_type_id, slug, formula_name, name, product_type_id, product_quantity,
				reactor, tier, base_time_seconds, max_runs, required_skill_level)
			VALUES (46166, 'caesarium-cadmide', 'Caesarium Cadmide Reaction Formula', 'Caesarium Cadmide', 16663, 200,
				'composite', 'intermediate', 10800, 1000, 2)`
		),
		env.DB.prepare(
			'INSERT INTO reaction_materials (blueprint_type_id, type_id, quantity) VALUES (46166, 4312, 5), (46166, 16643, 100), (46166, 16647, 100)'
		)
	]);
}

/** A reaction `blueprintTypeId` → `productTypeId` from `materialTypeIds` (all tracked afterwards). */
export async function seedReaction(
	blueprintTypeId: number,
	productTypeId: number,
	materialTypeIds: number[]
): Promise<void> {
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO reactions (blueprint_type_id, slug, formula_name, name, product_type_id, product_quantity,
				reactor, tier, base_time_seconds, max_runs, required_skill_level)
			VALUES (?1, 'r-' || ?1, 'Formula', 'Product', ?2, 1, 'composite', 'composite', 3600, 100, 1)`
		).bind(blueprintTypeId, productTypeId),
		...materialTypeIds.map((typeId) =>
			env.DB.prepare(
				'INSERT INTO reaction_materials (blueprint_type_id, type_id, quantity) VALUES (?, ?, 1)'
			).bind(blueprintTypeId, typeId)
		)
	]);
}

/**
 * Every `SDE_SYNC` instance created while the returned introspector lives completes at once with
 * mocked step results (no download, no writes besides the `job_runs` start row).
 */
export async function mockedSdeWorkflow(): Promise<WorkflowIntrospector> {
	const introspector = await introspectWorkflow(env.SDE_SYNC);
	await introspector.modifyAll(async (m) => {
		// The engine cannot store `undefined` as a mocked result.
		for (const name of ['download-parse', 'write-reference', 'write-reactions', 'publish'])
			await m.mockStepResult({ name }, {});
	});
	return introspector;
}

/** `PRICE_REFRESH` instances complete at once: an empty plan and a mocked publish (no requests). */
export async function mockedPriceWorkflow(): Promise<WorkflowIntrospector> {
	const introspector = await introspectWorkflow(env.PRICE_REFRESH);
	await introspector.modifyAll(async (m) => {
		await m.mockStepResult({ name: 'plan' }, { snapshotAt: 1, regions: [], structureHubIds: [] });
		await m.mockStepResult({ name: 'publish' }, {});
	});
	return introspector;
}

/** `DAILY` instances complete at once: no regions and mocked rollup/archive/retention steps. */
export async function mockedDailyWorkflow(): Promise<WorkflowIntrospector> {
	const introspector = await introspectWorkflow(env.DAILY);
	await introspector.modifyAll(async (m) => {
		await m.mockStepResult({ name: 'plan' }, { regionIds: [] });
		await m.mockStepResult({ name: 'rollup-prices' }, 0);
		await m.mockStepResult({ name: 'rollup-indices' }, { adjusted: 0, costIndices: 0 });
		await m.mockStepResult({ name: 'archive-verify' }, { objects: 0, bytes: 0 });
		await m.mockStepResult({ name: 'retention' }, { dates: 0, deleted: 0 });
	});
	return introspector;
}

/** Waits for every instance created under `introspector` to complete; returns how many there were. */
export async function completedInstanceCount(introspector: WorkflowIntrospector): Promise<number> {
	const instances = await introspector.get();
	for (const instance of instances) await instance.waitForStatus('complete');
	return instances.length;
}

/** `latest.jsonl` body announcing `build`. */
export function sdeLatest(build: number, headers: Record<string, string> = {}): Response {
	return new Response(`{"_key":"sde","buildNumber":${build},"releaseDate":"2026-10-01T11:00:00Z"}\n`, {
		headers
	});
}
