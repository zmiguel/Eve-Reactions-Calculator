import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Subset of the wrangler config fields these checks read. */
interface WranglerConfig {
	name: string;
	workers_dev?: boolean;
	vars?: Record<string, string>;
	triggers?: { crons?: string[] };
	preview_urls?: boolean;
	routes?: { pattern: string; custom_domain?: boolean; previews_enabled?: boolean; enabled?: boolean }[];
	observability?: {
		enabled?: boolean;
		logs?: { enabled?: boolean; invocation_logs?: boolean };
		traces?: { enabled?: boolean };
		issues?: { enabled?: boolean };
	};
	d1_databases?: { binding: string; database_name: string; database_id: string; migrations_dir?: string }[];
	kv_namespaces?: { binding: string; id: string }[];
	r2_buckets?: { binding: string; bucket_name: string }[];
	services?: { binding: string; service: string; entrypoint?: string }[];
	ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
	workflows?: { name: string; binding: string; class_name: string }[];
	/** Cloudflare Worker Previews Base (`npx wrangler preview`): the same binding fields as the top level. */
	previews?: Omit<WranglerConfig, 'name' | 'previews'>;
}

/** Parses a `wrangler.jsonc` with TypeScript's JSONC reader (comments and trailing commas allowed). */
function readConfig(app: 'web' | 'updater'): WranglerConfig {
	const path = fileURLToPath(new URL(`../../apps/${app}/wrangler.jsonc`, import.meta.url));
	const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
	if (error) throw new Error(`${path}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
	return config as WranglerConfig;
}

const web = readConfig('web');
const updater = readConfig('updater');
const CONFIGS = { web, updater };

const D1 = [
	{ binding: 'DB', database_name: 'reactions-core', migrations_dir: '../../packages/db/migrations/core' },
	{
		binding: 'HISTORY_DB',
		database_name: 'reactions-history',
		migrations_dir: '../../packages/db/migrations/history'
	}
];

const WORKFLOWS = [
	{ binding: 'PRICE_REFRESH', name: 'reactions-price-refresh', class_name: 'PriceRefreshWorkflow' },
	{ binding: 'DAILY', name: 'reactions-daily', class_name: 'DailyWorkflow' },
	{ binding: 'SDE_SYNC', name: 'reactions-sde-sync', class_name: 'SdeSyncWorkflow' },
	{ binding: 'HISTORY_BACKFILL', name: 'reactions-history-backfill', class_name: 'HistoryBackfillWorkflow' }
];

const d1 = (config: Pick<WranglerConfig, 'd1_databases'>, binding: string) =>
	config.d1_databases?.find((d) => d.binding === binding);
const kv = (config: Pick<WranglerConfig, 'kv_namespaces'>) =>
	config.kv_namespaces?.find((k) => k.binding === 'CACHE');

describe.each(Object.entries(CONFIGS))('%s wrangler.jsonc', (_, config) => {
	it.each(D1)('binds D1 $binding to $database_name', (expected) => {
		expect(d1(config, expected.binding)).toMatchObject(expected);
	});

	it('binds KV CACHE', () => {
		expect(kv(config)?.id).toEqual(expect.any(String));
	});

	it('has no DEV_LOGIN in the production or preview vars', () => {
		expect(config.vars ?? {}).not.toHaveProperty('DEV_LOGIN');
		expect(config.previews?.vars ?? {}).not.toHaveProperty('DEV_LOGIN');
	});

	it('keeps logs (with invocation logs), traces and Issues on', () => {
		expect(config.observability).toEqual({
			enabled: true,
			logs: { enabled: true, invocation_logs: true },
			traces: { enabled: true },
			issues: { enabled: true }
		});
	});

	it('serves production on no *.workers.dev URL', () => {
		expect(config.workers_dev).toBe(false);
	});
});

/**
 * Set to true by the production cutover (PLAN B14, 2026-10-08) together with the production route. Before it the
 * web config must not touch reactions.coalition.space while the v2 Worker serves it: deploying any custom domain
 * on it (even `enabled: false`) moves the domain off the v2 Worker (that took v2 down for three minutes on
 * 2026-10-08). Rolling back to v2 sets it to false again and removes the route.
 */
const CUTOVER_DONE = true;
const productionRoute = () => web.routes?.find((r) => r.pattern === 'reactions.coalition.space');

describe('web Previews Base (preview.reactions.coalition.space)', () => {
	const previews = web.previews!;

	it('reads the same live databases and KV as production (only the production updater writes them)', () => {
		for (const { binding } of D1)
			expect(d1(previews, binding)?.database_id).toBe(d1(web, binding)?.database_id);
		expect(kv(previews)?.id).toBe(kv(web)?.id);
	});

	it('calls the production updater', () => {
		expect(previews.services).toEqual(web.services);
	});

	it('has the production vars with its own callback URL and DEPLOY_ENV', () => {
		expect(Object.keys(previews.vars ?? {}).sort()).toEqual(Object.keys(web.vars ?? {}).sort());
		for (const name of ['ADMIN_CHARACTER_IDS', 'USER_AGENT_CONTACT'])
			expect(previews.vars?.[name]).toBe(web.vars?.[name]);
		expect(previews.vars?.EVE_SSO_CALLBACK_URL).toMatch(/^https:\/\/[^/]+\/auth\/callback$/);
		expect(previews.vars?.EVE_SSO_CALLBACK_URL).not.toBe(web.vars?.EVE_SSO_CALLBACK_URL);
		expect([web.vars?.DEPLOY_ENV, previews.vars?.DEPLOY_ENV]).toEqual(['production', 'preview']);
	});

	it('logs in with its own SSO application and refreshes tokens of the production one', () => {
		// Each deployment logs in with EVE_SSO_CLIENT_ID; EVE_SSO_EXTRA_CLIENT_ID is the other application,
		// so tokens issued by either can be refreshed everywhere (a character stores its issuing app).
		const apps = (v?: Record<string, string>) => [v?.EVE_SSO_CLIENT_ID, v?.EVE_SSO_EXTRA_CLIENT_ID];
		const [production, preview] = apps(web.vars);
		expect(apps(previews.vars)).toEqual(preview ? [preview, production] : [production, undefined]);
		expect(apps(updater.vars)).toEqual(apps(web.vars));
	});

	it('counts its rate limits apart from production', () => {
		const names = (c: { ratelimits?: { name: string }[] }) => (c.ratelimits ?? []).map((r) => r.name).sort();
		expect(names(previews)).toEqual(names(web));
		const ids = new Set((web.ratelimits ?? []).map((r) => r.namespace_id));
		for (const r of previews.ratelimits ?? []) expect(ids.has(r.namespace_id)).toBe(false);
	});

	it.runIf(!CUTOVER_DONE)(
		'before the cutover: no route on reactions.coalition.space, previews on workers.dev',
		() => {
			expect(web.routes ?? []).toEqual([]);
			expect(web.preview_urls).toBe(true);
			expect(previews.vars?.EVE_SSO_CALLBACK_URL).toBe(
				'https://preview-reactions-web.zmiguel.workers.dev/auth/callback'
			);
		}
	);

	it.runIf(CUTOVER_DONE)(
		'after the cutover: production and Previews on reactions.coalition.space, nothing on workers.dev',
		() => {
			expect(productionRoute()).toEqual({
				pattern: 'reactions.coalition.space',
				custom_domain: true,
				previews_enabled: true
			});
			expect(web.preview_urls).toBe(false);
			expect(previews.vars?.EVE_SSO_CALLBACK_URL).toBe(
				'https://preview.reactions.coalition.space/auth/callback'
			);
		}
	);
});

describe('shared resources', () => {
	it.each(D1.map((d) => d.binding))('uses the same %s database id in both workers', (binding) => {
		expect(d1(web, binding)?.database_id).toBe(d1(updater, binding)?.database_id);
	});

	it('uses the same KV CACHE id in both workers', () => {
		expect(kv(web)?.id).toBe(kv(updater)?.id);
	});

	it.each(['EVE_SSO_CLIENT_ID', 'EVE_SSO_EXTRA_CLIENT_ID', 'USER_AGENT_URL', 'USER_AGENT_CONTACT'])(
		'uses the same %s in both workers',
		(name) => {
			expect(web.vars).toHaveProperty(name);
			expect(updater.vars).toHaveProperty(name);
			expect(web.vars?.[name]).toBe(updater.vars?.[name]);
		}
	);
});

describe('web bindings', () => {
	it('calls the updater over RPC', () => {
		expect(web.services).toContainEqual({
			binding: 'UPDATER',
			service: 'reactions-updater',
			entrypoint: 'UpdaterRpc'
		});
		expect(updater.name).toBe('reactions-updater');
	});

	it('rate-limits the API and account actions', () => {
		expect(web.ratelimits).toContainEqual({
			name: 'API_RATE_LIMITER',
			namespace_id: '3001',
			simple: { limit: 120, period: 60 }
		});
		expect(web.ratelimits).toContainEqual({
			name: 'ACCOUNT_RATE_LIMITER',
			namespace_id: '3002',
			simple: { limit: 10, period: 60 }
		});
	});

	it('has exactly the documented vars', () => {
		expect(Object.keys(web.vars ?? {}).sort()).toEqual(
			[
				'ADMIN_CHARACTER_IDS',
				'EVE_SSO_CALLBACK_URL',
				'EVE_SSO_CLIENT_ID',
				'EVE_SSO_EXTRA_CLIENT_ID',
				'DEPLOY_ENV',
				'USER_AGENT_CONTACT',
				'USER_AGENT_URL'
			].sort()
		);
	});

	it('has no R2 binding (the archive belongs to the updater)', () => {
		expect(web.r2_buckets ?? []).toEqual([]);
	});
});

describe('updater bindings', () => {
	it('binds the R2 archive', () => {
		expect(updater.r2_buckets).toContainEqual({ binding: 'ARCHIVE', bucket_name: 'reactions-archive' });
	});

	it.each(WORKFLOWS)('binds workflow $binding to $name ($class_name)', (expected) => {
		expect(updater.workflows).toContainEqual(expected);
	});

	it('runs the 10-minute cron', () => {
		expect(updater.triggers?.crons).toEqual(['*/10 * * * *']);
	});

	it('is not reachable on workers.dev', () => {
		expect([updater.workers_dev, updater.preview_urls]).toEqual([false, false]);
	});
});

/** Deploy gate (PLAN B13): run with `CHECK_PROD_IDS=1` once the real resource ids and vars are filled in. */
describe.runIf(process.env.CHECK_PROD_IDS === '1')('production values (CHECK_PROD_IDS=1)', () => {
	const ids = Object.entries(CONFIGS).flatMap(([app, config]) => [
		...(config.d1_databases ?? []).map((d) => [`${app} D1 ${d.binding}`, d.database_id] as const),
		...(config.kv_namespaces ?? []).map((k) => [`${app} KV ${k.binding}`, k.id] as const),
		...(config.previews?.d1_databases ?? []).map(
			(d) => [`${app} preview D1 ${d.binding}`, d.database_id] as const
		),
		...(config.previews?.kv_namespaces ?? []).map((k) => [`${app} preview KV ${k.binding}`, k.id] as const)
	]);

	it.each(ids)('%s id is not a 00000000 placeholder', (_, id) => {
		expect(id).not.toMatch(/^00000000/);
	});

	const vars = Object.entries(CONFIGS).flatMap(([app, config]) =>
		['EVE_SSO_CLIENT_ID', 'USER_AGENT_URL', 'USER_AGENT_CONTACT'].map(
			(name) => [`${app} ${name}`, config.vars?.[name]] as const
		)
	);

	it.each(vars)('%s is set', (_, value) => {
		expect(value).toMatch(/\S/);
	});

	it('web ADMIN_CHARACTER_IDS is set', () => {
		expect(web.vars?.ADMIN_CHARACTER_IDS).toMatch(/\S/);
	});

	it('web preview vars are filled in like production', () => {
		for (const name of ['EVE_SSO_CLIENT_ID', 'ADMIN_CHARACTER_IDS', 'USER_AGENT_URL', 'USER_AGENT_CONTACT'])
			expect(web.previews?.vars?.[name], name).toMatch(/\S/);
	});
});
