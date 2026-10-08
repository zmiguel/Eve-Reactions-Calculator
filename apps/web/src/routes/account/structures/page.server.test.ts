import { DEFAULT_SETTINGS } from '@reactions/engine';
import { decryptToken } from '@reactions/eve';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/server/session';
import { STRUCTURE_LINK_LIMIT } from '$lib/server/structures';
import { SYSTEM_LOOKUP_FAILED } from '$lib/server/systems';
import { FakeCookies, type FakeEnv } from '../../../test/fakes';
import { NOW, insertStructureHub, insertSystems, insertUser, linkStructure } from '../../../test/fixtures';
import { resetPage, setPage } from '../../../test/shims/app/state';
import { TOKEN_KEY, fakeEve, grantStructures, sessionUser, ssoEnv, type EveAnswers } from '../../../test/sso';
import { actions, load } from './+page.server';
import Page from './+page.svelte';
import type { PageServerData } from './$types';

const alpha = { characterId: 90000001, name: 'Alpha' };
const beta = { characterId: 90000002, name: 'Beta' };
const STRUCTURE = 1044752365771;
const HUB = `structure-${STRUCTURE}`;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	resetPage();
});

async function account(granted = true) {
	const env = ssoEnv();
	insertSystems(env.DB);
	env.DB.sqlite.exec(`
		INSERT INTO regions VALUES (10000002, 'The Forge'), (10000032, 'Sinq Laison');
		INSERT INTO systems VALUES (30000144, 'Perimeter', 10000002, 0.95, 'highsec');
	`);
	insertUser(env.DB, { userId: 'u1' }, [alpha, beta]);
	if (granted) await grantStructures(env.DB, alpha.characterId);
	return { env, user: sessionUser('u1', [alpha, beta]) };
}

function event(
	env: FakeEnv,
	user: SessionUser | null,
	path: string,
	fields?: Record<string, string>,
	eve = fakeEve()
) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
	}
	return {
		url,
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		fetch: eve.fetch,
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function settle(promise: unknown): Promise<{ status?: number; data?: unknown; redirect?: string }> {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

const PERIMETER_MARKET: EveAnswers = {
	structures: { [STRUCTURE]: { name: 'Perimeter - Tranquility Trading Tower', solarSystemId: 30000144 } }
};

/** `results` of a successful search action. */
function searchResults(data: unknown): unknown[] {
	const search = data && typeof data === 'object' && 'search' in data ? data.search : null;
	if (!search || typeof search !== 'object' || !('results' in search) || !Array.isArray(search.results)) {
		throw new Error(`no search results in ${JSON.stringify(data)}`);
	}
	return search.results;
}

const add = (env: FakeEnv, user: SessionUser, answers: EveAnswers, structureId = STRUCTURE) => {
	const eve = fakeEve(answers);
	return {
		eve,
		result: settle(
			actions.add(
				event(
					env,
					user,
					'/account/structures?/add',
					{ characterId: '90000001', structureId: String(structureId) },
					eve
				)
			)
		)
	};
};

const hubs = (env: FakeEnv) =>
	env.DB.rows(
		"SELECT hub_id, name, region_id, system_id, location_id, fuzzwork_location_id, visibility, share_status, enabled, sort_order, last_error FROM market_hubs WHERE kind = 'structure'"
	);

describe('/account/structures load', () => {
	it('sends anonymous visitors to log in and back', async () => {
		expect(await settle(load(event(ssoEnv(), null, '/account/structures')))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Fstructures'
		});
	});

	it('lists characters with their readiness and the links with hub state', async () => {
		const { env, user } = await account();
		insertStructureHub(env.DB, { structureId: STRUCTURE, name: 'Seed Market', shareStatus: 'pending' });
		linkStructure(env.DB, 'u1', STRUCTURE, alpha.characterId, true);
		const data = (await load(event(env, user, '/account/structures'))) as PageServerData;
		expect(data.limit).toBe(STRUCTURE_LINK_LIMIT);
		expect(data.characters).toEqual([
			{ ...alpha, ready: true, tokenStatus: 'ok' },
			{ ...beta, ready: false, tokenStatus: 'none' }
		]);
		expect(data.links).toEqual([
			{
				structureId: STRUCTURE,
				hubId: HUB,
				name: 'Seed Market',
				systemName: 'Perimeter',
				regionName: 'The Forge',
				visibility: 'private',
				shareStatus: 'pending',
				enabled: true,
				lastSuccessAt: null,
				lastError: null,
				accessStatus: 'ok',
				shareRequested: true,
				characterId: alpha.characterId,
				characterName: 'Alpha'
			}
		]);
	});

	it('renders noindex, the link row and the search form; without a ready character only Enable links', async () => {
		const { env, user } = await account();
		insertStructureHub(env.DB, { structureId: STRUCTURE, name: 'Seed Market' });
		linkStructure(env.DB, 'u1', STRUCTURE, alpha.characterId);
		setPage({ url: 'https://reactions.coalition.space/account/structures' });
		const data = (await load(event(env, user, '/account/structures'))) as PageServerData;
		const { head, body } = render(Page, { props: { data, form: null, params: {} } as never });
		expect(head).toContain('<meta name="robots" content="noindex"');
		expect(body).toContain('Seed Market');
		expect(body).toContain('Prices pending');
		expect(body).toContain('action="?/search"');
		expect(body).not.toContain('Enable structure markets');

		const none = await account(false);
		const empty = (await load(event(none.env, none.user, '/account/structures'))) as PageServerData;
		const page = render(Page, { props: { data: empty, form: null, params: {} } as never }).body;
		expect(page).not.toContain('action="?/search"');
		expect(page.match(/Enable structure markets<\/a>/g)).toHaveLength(2);
		expect(page).toContain(
			'feature=structures&amp;characterId=90000002&amp;returnTo=%2Faccount%2Fstructures'
		);
	});
});

describe('search', () => {
	const search = (
		env: FakeEnv,
		user: SessionUser,
		fields: Record<string, string>,
		answers: EveAnswers = {}
	) => {
		const eve = fakeEve(answers);
		return {
			eve,
			result: settle(actions.search(event(env, user, '/account/structures?/search', fields, eve)))
		};
	};

	it('needs a character with every structure scope (and makes no request otherwise)', async () => {
		const { env, user } = await account();
		await grantStructures(env.DB, beta.characterId, 'refresh-b', ['esi-markets.structure_markets.v1']);
		const { eve, result } = search(env, user, { characterId: '90000002', q: 'Perimeter' });
		expect(await result).toMatchObject({
			status: 400,
			data: { search: { error: expect.stringMatching(/^Enable/) } }
		});
		expect(eve.calls).toEqual([]);
	});

	it('is limited per account: over the limit it answers 429 without calling SSO or ESI', async () => {
		const { env, user } = await account();
		const limit = vi.fn(async () => ({ success: false }));
		Object.assign(env, { ACCOUNT_RATE_LIMITER: { limit } });
		const { eve, result } = search(env, user, { characterId: '90000001', q: 'Perimeter' });
		expect(await result).toMatchObject({
			status: 429,
			data: { search: { error: 'Too many requests. Wait a minute and try again.' } }
		});
		expect(limit).toHaveBeenCalledWith({ key: 'structures:u1' });
		expect(eve.calls).toEqual([]);

		const added = add(env, user, PERIMETER_MARKET);
		expect(await added.result).toMatchObject({ status: 429 });
		expect(added.eve.calls).toEqual([]);
	});

	it('refreshes the token, searches and lists name, system and region of up to 20 hits', async () => {
		const { env, user } = await account();
		linkStructure(env.DB, 'u1', 1001, alpha.characterId);
		const ids = Array.from({ length: 25 }, (_, i) => 1000 + i);
		const structures = Object.fromEntries(
			ids.map((id) => [id, { name: `Market ${id}`, solarSystemId: id % 2 ? 30000144 : 30002647 }])
		);
		const { eve, result } = search(
			env,
			user,
			{ characterId: '90000001', q: ' Market ' },
			{ search: ids, structures }
		);
		const results = searchResults((await result).data);
		expect(results).toHaveLength(20);
		expect(results[0]).toEqual({
			structureId: 1000,
			name: 'Market 1000',
			systemName: 'Ignoitton',
			regionName: 'Sinq Laison',
			linked: false
		});
		expect(results[1]).toMatchObject({
			structureId: 1001,
			systemName: 'Perimeter',
			regionName: 'The Forge',
			linked: true
		});
		const searchCall = eve.calls.find((c) => c.url.includes('/search'))!;
		expect(new URL(searchCall.url).searchParams.get('search')).toBe('Market');
		expect(searchCall.auth).toBe('Bearer access-1');
		expect(eve.calls.filter((c) => c.url.includes('/universe/structures/'))).toHaveLength(20);
		const stored = env.DB.rows<{ refresh_token_enc: string }>(
			'SELECT refresh_token_enc FROM characters WHERE character_id = 90000001'
		)[0]!;
		expect(await decryptToken(stored.refresh_token_enc, TOKEN_KEY)).toBe('refresh-1');
	});

	it('an ESI 403 or no hits are "no results"; short text is a form error', async () => {
		const { env, user } = await account();
		for (const answers of [{ search: 403 }, { search: [] }, { search: [5], structures: { 5: 403 } }]) {
			expect(
				searchResults((await search(env, user, { characterId: '90000001', q: 'Jita' }, answers).result).data)
			).toEqual([]);
		}
		const short = await search(env, user, { characterId: '90000001', q: 'ab' }).result;
		expect(short).toMatchObject({ status: 400, data: { search: { error: 'Type at least 3 characters.' } } });
	});

	it('names systems missing from D1 through public ESI', async () => {
		const { env, user } = await account();
		const { result } = search(
			env,
			user,
			{ characterId: '90000001', q: 'Market' },
			{
				search: [7],
				structures: { 7: { name: 'G-M Market', solarSystemId: 30004605 } },
				systems: {
					30004605: { name: 'G-M4I8', securityStatus: -0.05, regionId: 10000058, regionName: 'Fountain' }
				}
			}
		);
		expect(searchResults((await result).data)).toEqual([
			{ structureId: 7, name: 'G-M Market', systemName: 'G-M4I8', regionName: 'Fountain', linked: false }
		]);
	});

	it('an invalid_grant marks the token invalid and reports it', async () => {
		const { env, user } = await account();
		const { result } = search(env, user, { characterId: '90000001', q: 'Jita' }, { token: { status: 400 } });
		expect(await result).toMatchObject({
			status: 400,
			data: { search: { error: expect.stringMatching(/expired/) } }
		});
		expect(env.DB.rows('SELECT token_status FROM characters WHERE character_id = 90000001')).toEqual([
			{ token_status: 'invalid' }
		]);
	});
});

describe('add', () => {
	it('creates the private hub and the link after a successful probe', async () => {
		const { env, user } = await account();
		const { eve, result } = add(env, user, PERIMETER_MARKET);
		expect(await result).toEqual({
			data: {
				notice: 'Perimeter - Tranquility Trading Tower added. Prices arrive with the next price refresh.'
			}
		});
		expect(eve.calls.map((c) => new URL(c.url).pathname)).toEqual([
			'/v2/oauth/token',
			`/universe/structures/${STRUCTURE}`,
			`/markets/structures/${STRUCTURE}`
		]);
		expect(new URL(eve.calls[2]!.url).searchParams.get('page')).toBe('1');
		expect(hubs(env)).toEqual([
			{
				hub_id: HUB,
				name: 'Perimeter - Tranquility Trading Tower',
				region_id: 10000002,
				system_id: 30000144,
				location_id: STRUCTURE,
				fuzzwork_location_id: STRUCTURE,
				visibility: 'private',
				share_status: 'none',
				enabled: 1,
				sort_order: 100,
				last_error: null
			}
		]);
		expect(
			env.DB.rows(
				'SELECT user_id, structure_id, character_id, share_requested, access_status FROM structure_links'
			)
		).toEqual([
			{
				user_id: 'u1',
				structure_id: STRUCTURE,
				character_id: 90000001,
				share_requested: 0,
				access_status: 'ok'
			}
		]);
	});

	it('adds a market in a system missing from D1 and stores the system and region', async () => {
		const { env, user } = await account();
		const { eve, result } = add(env, user, {
			structures: { [STRUCTURE]: { name: 'G-M4I8 - Keepstar', solarSystemId: 30004605 } },
			systems: {
				30004605: { name: 'G-M4I8', securityStatus: -0.05, regionId: 10000058, regionName: 'Fountain' }
			}
		});
		expect(await result).toEqual({
			data: { notice: 'G-M4I8 - Keepstar added. Prices arrive with the next price refresh.' }
		});
		expect(eve.calls.map((c) => new URL(c.url).pathname)).toEqual([
			'/v2/oauth/token',
			`/universe/structures/${STRUCTURE}`,
			`/markets/structures/${STRUCTURE}`,
			'/universe/systems/30004605',
			'/universe/constellations/30004605',
			'/universe/regions/10000058'
		]);
		expect(hubs(env)).toMatchObject([{ hub_id: HUB, region_id: 10000058, system_id: 30004605 }]);
		expect(env.DB.rows('SELECT * FROM systems WHERE system_id = 30004605')).toEqual([
			{
				system_id: 30004605,
				name: 'G-M4I8',
				region_id: 10000058,
				security_status: -0.05,
				security_band: 'nullsec'
			}
		]);
		expect(env.DB.rows('SELECT * FROM regions WHERE region_id = 10000058')).toEqual([
			{ region_id: 10000058, name: 'Fountain' }
		]);
	});

	it('reports a failed system lookup and writes nothing', async () => {
		const { env, user } = await account();
		const result = await add(env, user, {
			structures: { [STRUCTURE]: { name: 'G-M4I8 - Keepstar', solarSystemId: 30004605 } },
			systems: { 30004605: 503 }
		}).result;
		expect(result).toEqual({ status: 400, data: { error: SYSTEM_LOOKUP_FAILED } });
		expect(hubs(env)).toEqual([]);
		expect(env.DB.rows('SELECT structure_id FROM structure_links')).toEqual([]);
	});

	it('a 403 probe is a form error and writes nothing; other statuses are reported', async () => {
		const { env, user } = await account();
		const denied = await add(env, user, { ...PERIMETER_MARKET, markets: { [STRUCTURE]: 403 } }).result;
		expect(denied).toEqual({ status: 400, data: { error: 'This character cannot see that market' } });
		const missing = await add(env, user, { ...PERIMETER_MARKET, markets: { [STRUCTURE]: 404 } }).result;
		expect(missing).toMatchObject({ status: 400, data: { error: expect.stringContaining('HTTP 404') } });
		expect(hubs(env)).toEqual([]);
		expect(env.DB.rows('SELECT * FROM structure_links')).toEqual([]);
	});

	it(`rejects link number ${STRUCTURE_LINK_LIMIT + 1} before calling EVE Online`, async () => {
		const { env, user } = await account();
		for (let i = 1; i <= STRUCTURE_LINK_LIMIT; i++) linkStructure(env.DB, 'u1', i, alpha.characterId);
		const { eve, result } = add(env, user, PERIMETER_MARKET);
		expect(await result).toEqual({
			status: 400,
			data: { error: `You can link up to ${STRUCTURE_LINK_LIMIT} markets.` }
		});
		expect(eve.calls).toEqual([]);
		expect(env.DB.rows('SELECT count(*) AS n FROM structure_links')).toEqual([{ n: STRUCTURE_LINK_LIMIT }]);
	});

	it('re-enables a disabled hub (e.g. NO_CONTRIBUTOR) and clears its error', async () => {
		const { env, user } = await account();
		insertStructureHub(env.DB, {
			structureId: STRUCTURE,
			name: 'Old Name',
			visibility: 'public',
			enabled: false
		});
		env.DB.sqlite.exec(`UPDATE market_hubs SET last_error = 'NO_CONTRIBUTOR' WHERE hub_id = '${HUB}'`);
		expect((await add(env, user, PERIMETER_MARKET).result).data).toHaveProperty('notice');
		expect(hubs(env)).toEqual([
			expect.objectContaining({
				hub_id: HUB,
				name: 'Old Name',
				visibility: 'public',
				enabled: 1,
				last_error: null
			})
		]);
	});

	it('refuses other accounts’ characters, duplicates and characters without the feature', async () => {
		const { env, user } = await account();
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 5, name: 'Other' }]);
		const other = await settle(
			actions.add(
				event(env, user, '/account/structures?/add', { characterId: '5', structureId: String(STRUCTURE) })
			)
		);
		expect(other).toMatchObject({ status: 400 });
		const notReady = await settle(
			actions.add(event(env, user, '/account/structures?/add', { characterId: '90000002', structureId: '7' }))
		);
		expect(notReady).toMatchObject({ status: 400, data: { error: expect.stringMatching(/^Enable/) } });
		linkStructure(env.DB, 'u1', STRUCTURE, alpha.characterId);
		expect(await add(env, user, PERIMETER_MARKET).result).toMatchObject({
			status: 400,
			data: { error: 'This market is already on your list.' }
		});
	});
});

describe('share and remove', () => {
	it('toggles sharing through the form and removes the last link of a private hub with its prices', async () => {
		const { env, user } = await account();
		insertStructureHub(env.DB, { structureId: STRUCTURE, name: 'Seed Market' });
		linkStructure(env.DB, 'u1', STRUCTURE, alpha.characterId);
		env.DB.sqlite.exec(
			`INSERT INTO latest_prices (hub_id, type_id, buy_volume, sell_volume, buy_orders, sell_orders, source, observed_at) VALUES ('${HUB}', 34, 1, 1, 1, 1, 'esi_structure', 1)`
		);
		const share = (value: string) =>
			settle(
				actions.share(
					event(env, user, '/account/structures?/share', { structureId: String(STRUCTURE), share: value })
				)
			);
		expect(await share('1')).toEqual({ data: { notice: 'Sharing requested.' } });
		expect(env.DB.rows('SELECT share_status FROM market_hubs WHERE hub_id = ?', HUB)).toEqual([
			{ share_status: 'pending' }
		]);
		expect(await share('0')).toEqual({ data: { notice: 'Sharing turned off.' } });
		expect(env.DB.rows('SELECT visibility, share_status FROM market_hubs WHERE hub_id = ?', HUB)).toEqual([
			{ visibility: 'private', share_status: 'none' }
		]);

		const removed = await settle(
			actions.remove(event(env, user, '/account/structures?/remove', { structureId: String(STRUCTURE) }))
		);
		expect(removed).toEqual({ data: { notice: 'Market removed.' } });
		expect(hubs(env)).toEqual([]);
		expect(env.DB.rows('SELECT * FROM latest_prices WHERE hub_id = ?', HUB)).toEqual([]);
		const again = await settle(
			actions.remove(event(env, user, '/account/structures?/remove', { structureId: String(STRUCTURE) }))
		);
		expect(again).toMatchObject({ status: 400 });
	});
});
