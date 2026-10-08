import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { MARKET_KV_KEY } from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { STRUCTURE_SCOPES, decryptToken, encryptToken } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planPriceRefresh, refreshStructureHub } from '../src/workflows/price-refresh.ts';
import { fuzzwork, installFetch, json, order, resetState, seedTrackedReaction } from './helpers.ts';
import type { RecordedCall } from './helpers.ts';

const STRUCTURE = 1042508032148;
const HUB = `structure-${STRUCTURE}`;
const DAY = 86_400_000;

async function seedStructureHub(hubId: string, locationId: number, visibility: 'public' | 'private') {
	await env.DB.prepare(
		`INSERT INTO market_hubs (hub_id, name, kind, region_id, system_id, location_id, fuzzwork_location_id,
			visibility, share_status, enabled, sort_order, created_at)
		VALUES (?1, 'Seed Market', 'structure', 10000002, 30000144, ?2, ?2, ?3, 'none', 1, 100, 1)`
	)
		.bind(hubId, locationId, visibility)
		.run();
}

/** User `userId` (last seen `lastSeenAt`) with character `characterId` linked to structure `structureId`. */
async function seedLink(
	userId: string,
	characterId: number,
	refreshToken: string,
	lastRefreshedAt: number,
	options: {
		structureId?: number;
		lastSeenAt?: number;
		scopes?: readonly string[];
		ssoClientId?: string;
	} = {}
) {
	const encrypted = await encryptToken(refreshToken, env.TOKEN_ENCRYPTION_KEY);
	await env.DB.batch([
		env.DB.prepare('INSERT INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, ?)').bind(
			userId,
			options.lastSeenAt ?? Date.now()
		),
		env.DB.prepare(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, scopes, refresh_token_enc, sso_client_id,
				token_status, last_refreshed_at, created_at)
			VALUES (?, ?, 'Pilot', 'hash', ?, ?, ?, 'ok', ?, 1)`
		).bind(
			characterId,
			userId,
			(options.scopes ?? STRUCTURE_SCOPES).join(' '),
			encrypted,
			options.ssoClientId ?? null,
			lastRefreshedAt
		),
		env.DB.prepare(
			'INSERT INTO structure_links (user_id, structure_id, character_id, created_at) VALUES (?, ?, ?, 1)'
		).bind(userId, options.structureId ?? STRUCTURE, characterId)
	]);
}

type TokenAnswer = 'invalid_grant' | { access: string; refresh: string };

/**
 * Fake SSO + ESI: refresh tokens answer per `tokens`; the structure market answers per access token
 * (`'forbidden'` → 403); Fuzzwork answers every request.
 */
function installEve(tokens: Record<string, TokenAnswer>, markets: Record<string, 'forbidden' | unknown[]>) {
	return installFetch((url, call) => {
		if (url.hostname === 'login.eveonline.com') {
			const answer = tokens[new URLSearchParams(call.body ?? '').get('refresh_token') ?? ''];
			if (!answer || answer === 'invalid_grant')
				return json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, {}, 400);
			return json({ access_token: answer.access, refresh_token: answer.refresh, expires_in: 1199 });
		}
		if (url.hostname === 'market.fuzzwork.co.uk') return fuzzwork(url);
		if (url.pathname.startsWith('/markets/structures/')) {
			const market = markets[call.headers.get('Authorization')?.replace('Bearer ', '') ?? ''];
			if (market === undefined || market === 'forbidden') return json({ error: 'Forbidden' }, {}, 403);
			return json(market);
		}
		if (url.pathname.endsWith('/orders')) return json([]);
		return new Response('unexpected', { status: 500 });
	});
}

const structureOrders = (locationId = STRUCTURE) => [
	order(16663, locationId, null, true, 200, 5),
	order(16663, locationId, null, false, 250, 7),
	order(99999, locationId, null, false, 1, 1)
];

const ssoCalls = (calls: RecordedCall[]) =>
	calls
		.filter((c) => c.url.startsWith('https://login.eveonline.com/'))
		.map((c) => new URLSearchParams(c.body ?? '').get('refresh_token'));
const marketCalls = (calls: RecordedCall[]) =>
	calls.filter((c) => c.url.includes('/markets/structures/')).map((c) => c.headers.get('Authorization'));

async function character(characterId: number) {
	return env.DB.prepare(
		'SELECT token_status, refresh_token_enc, sso_client_id, last_refreshed_at, last_error FROM characters WHERE character_id = ?'
	)
		.bind(characterId)
		.first<{
			token_status: string;
			refresh_token_enc: string;
			sso_client_id: string | null;
			last_refreshed_at: number;
			last_error: string | null;
		}>();
}

async function hubState(hubId = HUB) {
	return env.DB.prepare('SELECT last_success_at, last_error FROM market_hubs WHERE hub_id = ?')
		.bind(hubId)
		.first<{ last_success_at: number | null; last_error: string | null }>();
}

async function hubPrices(hubId = HUB) {
	const { results } = await env.DB.prepare(
		'SELECT type_id, buy_max, sell_min, source, observed_at FROM latest_prices WHERE hub_id = ? ORDER BY type_id'
	)
		.bind(hubId)
		.all();
	return results;
}

describe('PriceRefreshWorkflow structure step', () => {
	beforeEach(async () => {
		await resetState();
		await seedTrackedReaction();
	});
	afterEach(() => vi.unstubAllGlobals());

	it('skips a character whose token is revoked and stores the next one’s rotated token', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200);
		await seedLink('u2', 1002, 'rt-2', 100);
		const calls = installEve(
			{ 'rt-1': 'invalid_grant', 'rt-2': { access: 'at-2', refresh: 'rt-2b' } },
			{ 'at-2': structureOrders() }
		);

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts).toEqual({
			hubId: HUB,
			candidates: 2,
			source: 'esi_structure',
			esi: 5,
			fuzzwork: 0,
			missing: 0
		});
		expect(ssoCalls(calls)).toEqual(['rt-1', 'rt-2']);
		expect(marketCalls(calls)).toEqual(['Bearer at-2']);
		const revoked = await character(1001);
		expect(revoked?.token_status).toBe('invalid');
		expect(revoked?.last_error).toMatch(/invalid_grant|Invalid refresh token/);
		const used = await character(1002);
		expect(used?.token_status).toBe('ok');
		expect(used?.last_refreshed_at).toBeGreaterThan(100);
		expect(await decryptToken(used!.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY)).toBe('rt-2b');
		const prices = await hubPrices();
		expect(prices).toHaveLength(5);
		expect(prices.every((p) => p.source === 'esi_structure' && p.observed_at === 5000)).toBe(true);
		expect(prices.find((p) => p.type_id === 16663)).toMatchObject({ buy_max: 200, sell_min: 250 });
		const snapshots = await env.HISTORY_DB.prepare(
			"SELECT COUNT(*) AS n FROM price_snapshots WHERE hub_id = ? AND snapshot_at = 5000 AND source = 'esi_structure'"
		)
			.bind(HUB)
			.first();
		expect(snapshots).toEqual({ n: 5 });
		const hub = await hubState();
		expect(hub?.last_success_at).not.toBeNull();
		expect(hub?.last_error).toBeNull();
	});

	it('marks only the link that got 403 as denied', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200);
		await seedLink('u2', 1002, 'rt-2', 100);
		const calls = installEve(
			{ 'rt-1': { access: 'at-1', refresh: 'rt-1b' }, 'rt-2': { access: 'at-2', refresh: 'rt-2b' } },
			{ 'at-1': 'forbidden', 'at-2': structureOrders() }
		);

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts.source).toBe('esi_structure');
		expect(marketCalls(calls)).toEqual(['Bearer at-1', 'Bearer at-2']);
		const { results } = await env.DB.prepare(
			'SELECT user_id, access_status FROM structure_links ORDER BY user_id'
		).all();
		expect(results).toEqual([
			{ user_id: 'u1', access_status: 'denied' },
			{ user_id: 'u2', access_status: 'ok' }
		]);
		expect((await character(1001))?.token_status).toBe('ok');
	});

	it('skips characters whose token lacks a structure-market scope', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200, { scopes: ['esi-markets.structure_markets.v1'] });
		await seedLink('u2', 1002, 'rt-2', 100);
		const calls = installEve(
			{ 'rt-1': { access: 'at-1', refresh: 'rt-1b' }, 'rt-2': { access: 'at-2', refresh: 'rt-2b' } },
			{ 'at-1': structureOrders(), 'at-2': structureOrders() }
		);

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts).toMatchObject({ candidates: 1, source: 'esi_structure' });
		expect(ssoCalls(calls)).toEqual(['rt-2']);
		expect((await character(1001))?.token_status).toBe('ok');
	});

	it('stores the rotated token with the shared TOKEN_ENCRYPTION_KEY (the web app decrypts it)', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200);
		installEve({ 'rt-1': { access: 'at-1', refresh: 'rt-1b' } }, { 'at-1': structureOrders() });

		await refreshStructureHub(env, HUB, 5000);

		const stored = (await character(1001))!.refresh_token_enc;
		expect(await decryptToken(stored, env.TOKEN_ENCRYPTION_KEY)).toBe('rt-1b');
		const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
		await expect(decryptToken(stored, otherKey)).rejects.toThrow();
	});

	it('refreshes each token with the SSO app that issued it; NULL is the primary app', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200);
		await seedLink('u2', 1002, 'rt-2', 100, { ssoClientId: 'extra-client' });
		const calls = installEve(
			{ 'rt-1': { access: 'at-1', refresh: 'rt-1b' }, 'rt-2': { access: 'at-2', refresh: 'rt-2b' } },
			{ 'at-1': 'forbidden', 'at-2': structureOrders() }
		);

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts.source).toBe('esi_structure');
		const basicAuth = calls
			.filter((c) => c.url.startsWith('https://login.eveonline.com/'))
			.map((c) => atob(c.headers.get('Authorization')!.replace('Basic ', '')));
		expect(basicAuth).toEqual([`${env.EVE_SSO_CLIENT_ID}:test-client-secret`, 'extra-client:extra-secret']);
		const rotated = await character(1002);
		expect(rotated?.sso_client_id).toBe('extra-client');
		expect(await decryptToken(rotated!.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY)).toBe('rt-2b');
		expect((await character(1001))?.sso_client_id).toBeNull();
	});

	it('marks a token of an unknown SSO app invalid without a request and tries the next candidate', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200, { ssoClientId: 'retired-app' });
		await seedLink('u2', 1002, 'rt-2', 100);
		const calls = installEve(
			{ 'rt-1': { access: 'at-1', refresh: 'rt-1b' }, 'rt-2': { access: 'at-2', refresh: 'rt-2b' } },
			{ 'at-1': structureOrders(), 'at-2': structureOrders() }
		);

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts).toMatchObject({ candidates: 2, source: 'esi_structure' });
		expect(ssoCalls(calls)).toEqual(['rt-2']);
		const unknown = await character(1001);
		expect(unknown?.token_status).toBe('invalid');
		expect(unknown?.last_error).toMatch(/^character 1001: SSO_APP_UNKNOWN: .*retired-app/);
	});

	it('falls back to Fuzzwork for a public hub when every candidate fails', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'public');
		await seedLink('u1', 1001, 'rt-1', 200);
		await seedLink('u2', 1002, 'rt-2', 100);
		const calls = installEve({}, {});

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts).toMatchObject({ source: 'fuzzwork', esi: 0, fuzzwork: 5, missing: 0 });
		expect(marketCalls(calls)).toEqual([]);
		expect(calls.filter((c) => c.url.startsWith('https://market.fuzzwork.co.uk/')).map((c) => c.url)).toEqual(
			[`https://market.fuzzwork.co.uk/aggregates/?region=${STRUCTURE}&types=4312,16643,16647,16663,46166`]
		);
		const prices = await hubPrices();
		expect(prices).toHaveLength(5);
		expect(prices.every((p) => p.source === 'fuzzwork' && p.buy_max === 50 && p.sell_min === 60)).toBe(true);
		const hub = await hubState();
		expect(hub?.last_error).toMatch(/character 1001: .*character 1002: /);
		expect(hub?.last_success_at).toBeNull();
	});

	it('keeps a private hub’s previous prices and records the error when every candidate fails', async () => {
		await seedStructureHub(HUB, STRUCTURE, 'private');
		await seedLink('u1', 1001, 'rt-1', 200);
		await env.DB.prepare(
			`INSERT INTO latest_prices (hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, buy_orders,
				sell_orders, source, observed_at) VALUES (?, 16663, 1, 2, 3, 4, 1, 1, 'esi_structure', 42)`
		)
			.bind(HUB)
			.run();
		const calls = installEve({}, {});

		const counts = await refreshStructureHub(env, HUB, 5000);

		expect(counts).toEqual({ hubId: HUB, candidates: 1, source: null, esi: 0, fuzzwork: 0, missing: 5 });
		expect(calls.filter((c) => c.url.startsWith('https://market.fuzzwork.co.uk/'))).toEqual([]);
		expect(await hubPrices()).toEqual([
			{ type_id: 16663, buy_max: 1, sell_min: 2, source: 'esi_structure', observed_at: 42 }
		]);
		expect((await hubState())?.last_error).toMatch(/character 1001/);
		const snapshots = await env.HISTORY_DB.prepare('SELECT COUNT(*) AS n FROM price_snapshots').first();
		expect(snapshots).toEqual({ n: 0 });
	});

	it('treats a hub deleted after the plan step as nothing to refresh, not a failure', async () => {
		const calls = installEve({}, {});
		expect(await refreshStructureHub(env, 'structure-404', 5000)).toEqual({
			hubId: 'structure-404',
			candidates: 0,
			source: null,
			esi: 0,
			fuzzwork: 0,
			missing: 0
		});
		expect(calls).toEqual([]);
	});

	it('refreshes private hubs only for recently seen users and never publishes them', async () => {
		await seedStructureHub('structure-1', 1, 'private');
		await seedStructureHub('structure-2', 2, 'private');
		await seedStructureHub('structure-3', 3, 'public');
		await seedLink('u1', 1001, 'rt-1', 200, { structureId: 1 });
		await seedLink('u2', 1002, 'rt-2', 200, { structureId: 2, lastSeenAt: Date.now() - 31 * DAY });
		const calls = installEve(
			{ 'rt-1': { access: 'at-1', refresh: 'rt-1b' }, 'rt-2': { access: 'at-2', refresh: 'rt-2b' } },
			{ 'at-1': structureOrders(1), 'at-2': structureOrders(2) }
		);

		const plan = await planPriceRefresh(env, Date.now());
		expect(plan.structureHubIds).toEqual(['structure-1', 'structure-3']);

		const id = 'prices-test-structures';
		await using instance = await introspectWorkflowInstance(env.PRICE_REFRESH, id);
		await instance.modify(async (m) => m.disableRetryDelays());
		await env.PRICE_REFRESH.create({ id, params: {} });
		await instance.waitForStatus('complete');

		expect(ssoCalls(calls)).toEqual(['rt-1']);
		expect(
			calls.filter((c) => c.url.includes('/markets/structures/')).map((c) => new URL(c.url).pathname)
		).toEqual(['/markets/structures/1']);
		expect(await hubPrices('structure-1')).toHaveLength(5);
		expect(await hubPrices('structure-2')).toEqual([]);
		expect(await hubPrices('structure-3')).toHaveLength(5);
		const market = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');
		expect(market!.hubs.map((h) => h.hubId)).toContain('structure-3');
		expect(market!.hubs.map((h) => h.hubId)).not.toContain('structure-1');
		expect(Object.keys(market!.prices)).not.toContain('structure-1');
		expect(Object.keys(market!.prices)).not.toContain('structure-2');
	});
});
