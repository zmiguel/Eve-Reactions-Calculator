import { DEFAULT_SETTINGS, Settings, decodeSettings, encodeSettings } from '@reactions/engine';
import {
	ESI_FEATURES,
	STRUCTURE_SCOPES,
	decryptToken,
	formatScopes,
	type GrantableFeature
} from '@reactions/eve';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeCookies, asEnv, type FakeEnv } from '../../../test/fakes';
import { NOW, insertStructureHub, insertUser, linkStructure } from '../../../test/fixtures';
import { addReader, insertSource, poolOf } from '../../../test/inventory';
import {
	CLIENT_ID,
	SESSION_SECRET,
	TOKEN_KEY,
	fakeSso,
	sessionUser,
	ssoEnv,
	type FakeEsi,
	type FakeSso,
	type TokenCharacter
} from '../../../test/sso';
import { LOGIN_AFFILIATION_TIMEOUT_MS } from '../affiliations';
import { sha256Hex } from '../crypto';
import { loadSession, type SessionUser } from '../session';
import { signOauthState, type LoginFlow } from './oauth';
import { handleCallback } from './sso';

const STATE = 'state-0123456789abcdef';
const WALLET = 'esi-wallet.read_character_wallet.v1';
let sso: FakeSso;

beforeAll(async () => {
	sso = await fakeSso(NOW);
});

interface Run {
	env?: FakeEnv;
	cookies?: FakeCookies;
	user?: SessionUser | null;
	flow?: Partial<LoginFlow>;
	character?: TokenCharacter;
	/** Override the `rc_oauth` cookie value (`null` = no cookie). */
	oauthCookie?: string | null;
	state?: string;
	exp?: number;
	tokenStatus?: number;
	esi?: FakeEsi;
}

async function callback(opts: Run = {}) {
	const env = opts.env ?? ssoEnv();
	const cookies = opts.cookies ?? new FakeCookies();
	const flow: LoginFlow = {
		purpose: 'login',
		feature: null,
		features: null,
		characterId: null,
		returnTo: '/account',
		...opts.flow
	};
	if (opts.oauthCookie !== null) {
		cookies.jar.set(
			'rc_oauth',
			opts.oauthCookie ??
				(await signOauthState(SESSION_SECRET, { ...flow, state: STATE, exp: opts.exp ?? NOW + 600_000 }))
		);
	}
	const url = new URL(
		`https://reactions.coalition.space/auth/callback?code=code-1&state=${opts.state ?? STATE}`
	);
	const character = opts.character ?? { characterId: 90000001, name: 'Alpha' };
	try {
		await handleCallback(
			{
				url,
				cookies: cookies.asCookies(),
				locals: {
					user: opts.user ?? null,
					account: null,
					settings: DEFAULT_SETTINGS,
					theme: 'dark',
					env: env as never
				}
			},
			sso.deps(character, { status: opts.tokenStatus, esi: opts.esi })
		);
		throw new Error('handleCallback returned');
	} catch (e) {
		if (isRedirect(e)) return { env, cookies, location: e.location, status: e.status };
		if (isHttpError(e)) return { env, cookies, status: e.status, message: e.body.message };
		throw e;
	}
}

const charRows = (env: FakeEnv) =>
	env.DB.rows<{
		character_id: number;
		user_id: string;
		name: string;
		owner_hash: string;
		scopes: string;
		refresh_token_enc: string | null;
		sso_client_id: string | null;
		token_status: string;
		last_refreshed_at: number | null;
	}>('SELECT * FROM characters ORDER BY character_id');
const userIds = (env: FakeEnv) =>
	env.DB.rows<{ user_id: string }>('SELECT user_id FROM users ORDER BY user_id').map((r) => r.user_id);

describe('state checks', () => {
	it.each([
		['no rc_oauth cookie', { oauthCookie: null }],
		['a forged signature', { oauthCookie: 'eyJzdGF0ZSI6IngifQ.AAAA' }],
		['an expired cookie', { exp: NOW - 1 }],
		['a state mismatch', { state: 'state-somebody-else' }]
	])('%s → 400 "Login expired" without calling SSO or touching data', async (_label, opts) => {
		const requests = sso.requests.length;
		const { env, cookies, status, message } = await callback(opts as Run);
		expect(status).toBe(400);
		expect(message).toBe('Login expired, try again.');
		expect(sso.requests.length).toBe(requests);
		expect(userIds(env)).toEqual([]);
		expect(cookies.jar.has('rc_oauth')).toBe(false);
	});

	it('503 when SSO is not configured', async () => {
		const { status } = await callback({ env: ssoEnv({ EVE_SSO_CLIENT_SECRET: '' }) });
		expect(status).toBe(503);
	});

	it('502 when EVE SSO rejects the code', async () => {
		const { env, status } = await callback({ tokenStatus: 400 });
		expect(status).toBe(502);
		expect(userIds(env)).toEqual([]);
	});
});

describe('purpose=login', () => {
	it('a new character creates a user + session and copies the cookie settings to the account', async () => {
		const settings = Settings.parse({ cycleDays: 3 });
		const cookies = new FakeCookies({ rc_settings: await encodeSettings(settings) });
		const { env, location } = await callback({ cookies, flow: { returnTo: '/composite' } });
		expect(location).toBe('/composite');
		const [user] = env.DB.rows<{ user_id: string; settings_json: string; settings_updated_at: number }>(
			'SELECT * FROM users'
		);
		expect(JSON.parse(user.settings_json)).toEqual({ v: 1, cycleDays: 3 });
		expect(user.settings_updated_at).toBe(NOW);
		expect(charRows(env)).toMatchObject([
			{
				character_id: 90000001,
				user_id: user.user_id,
				name: 'Alpha',
				owner_hash: 'hash-90000001',
				scopes: '',
				refresh_token_enc: null,
				token_status: 'none'
			}
		]);
		const [session] = env.DB.rows<{ session_hash: string; user_id: string; character_id: number }>(
			'SELECT * FROM user_sessions'
		);
		expect(session).toMatchObject({ user_id: user.user_id, character_id: 90000001 });
		expect(session.session_hash).toBe(await sha256Hex(cookies.jar.get('rc_session')!));
	});

	it('an existing account with settings overwrites the rc_settings cookie', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1', settings: Settings.parse({ cycleDays: 2 }) }, [
			{ characterId: 90000001, name: 'Alpha' }
		]);
		const cookies = new FakeCookies({ rc_settings: await encodeSettings(Settings.parse({ cycleDays: 5 })) });
		await callback({ env, cookies });
		expect((await decodeSettings(cookies.jar.get('rc_settings')!))?.cycleDays).toBe(2);
		expect(env.DB.rows('SELECT user_id FROM user_sessions')).toEqual([{ user_id: 'u1' }]);
		expect(userIds(env)).toEqual(['u1']);
	});

	it('account settings equal to the defaults delete the cookie', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1', settings: DEFAULT_SETTINGS }, [
			{ characterId: 90000001, name: 'Alpha' }
		]);
		const cookies = new FakeCookies({ rc_settings: await encodeSettings(Settings.parse({ cycleDays: 5 })) });
		await callback({ env, cookies });
		expect(cookies.jar.has('rc_settings')).toBe(false);
	});

	it('does not store a refresh token for a scope-less login, even when SSO returns one', async () => {
		const { env } = await callback();
		expect(charRows(env)[0]).toMatchObject({ refresh_token_enc: null, token_status: 'none', scopes: '' });
	});

	it('an owner-hash change removes the old character row and its links before re-adding', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'seller' }, [{ characterId: 90000001, name: 'Alpha' }]);
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Seed Market' });
		linkStructure(env.DB, 'seller', 1044752365771, 90000001);
		const { location } = await callback({
			env,
			character: { characterId: 90000001, name: 'Alpha', ownerHash: 'new-owner' }
		});
		expect(location).toBe('/account');
		expect(env.DB.rows('SELECT * FROM structure_links')).toEqual([]);
		// The seller's account had no other character and is gone; the buyer got a fresh account.
		const users = userIds(env);
		expect(users).toHaveLength(1);
		expect(users).not.toContain('seller');
		expect(charRows(env)).toMatchObject([{ user_id: users[0], owner_hash: 'new-owner' }]);
	});

	it('logging in with another account’s character switches to that account and ends the old session', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000002, name: 'Beta' }]);
		const cookies = new FakeCookies({ rc_session: 'old-token' });
		env.DB.sqlite
			.prepare(
				'INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
			)
			.run(await sha256Hex('old-token'), 'u1', NOW, NOW + 1e9);
		await callback({
			env,
			cookies,
			user: sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]),
			character: { characterId: 90000002, name: 'Beta' }
		});
		expect(env.DB.rows('SELECT user_id, character_id FROM user_sessions')).toEqual([
			{ user_id: 'u2', character_id: 90000002 }
		]);
	});
});

describe('purpose=add_character', () => {
	const alpha = sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]);

	it('attaches the new character to the session user without a token or a new session', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		const { location } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'add_character' },
			character: { characterId: 90000002, name: 'Beta' }
		});
		expect(location).toBe('/account');
		expect(charRows(env)).toMatchObject([
			{ character_id: 90000001, user_id: 'u1' },
			{ character_id: 90000002, user_id: 'u1', token_status: 'none', refresh_token_enc: null }
		]);
		expect(env.DB.rows('SELECT * FROM user_sessions')).toEqual([]);
	});

	it('a character owned by another account → 409, nothing changes', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000002, name: 'Beta' }]);
		const before = charRows(env);
		const { status, message } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'add_character' },
			character: { characterId: 90000002, name: 'Beta' }
		});
		expect(status).toBe(409);
		expect(message).toMatch(/linked to another account/);
		expect(charRows(env)).toEqual(before);
	});

	it('needs a session', async () => {
		const { status, env } = await callback({ flow: { purpose: 'add_character' } });
		expect(status).toBe(400);
		expect(userIds(env)).toEqual([]);
	});
});

describe('affiliations at login', () => {
	/** ESI knowing the corporation of every character and the alliance of 90000001's. */
	const esi: FakeEsi = (path, ids) => {
		if (path === '/characters/affiliation') {
			return Response.json(
				ids.map((id) =>
					id === 90000001
						? { character_id: id, corporation_id: 98000001, alliance_id: 99000001 }
						: { character_id: id, corporation_id: 98000002 }
				)
			);
		}
		const names: Record<number, string> = {
			98000001: 'Moon Corp',
			98000002: 'Solo Corp',
			99000001: 'Moon Alliance'
		};
		return Response.json(ids.map((id) => ({ id, name: names[id], category: 'corporation' })));
	};
	const affiliations = (env: FakeEnv) =>
		env.DB.rows(
			'SELECT character_id, corporation_name, alliance_name, affiliation_updated_at FROM characters ORDER BY character_id'
		);

	it('a new user’s first session already has the corporation and alliance', async () => {
		const { env, cookies, location } = await callback({ esi });
		expect(location).toBe('/account');
		expect(affiliations(env)).toEqual([
			{
				character_id: 90000001,
				corporation_name: 'Moon Corp',
				alliance_name: 'Moon Alliance',
				affiliation_updated_at: NOW
			}
		]);
		const session = await loadSession(asEnv(env), cookies.asCookies(), NOW);
		expect(session?.account).toMatchObject({ corporation: 'Moon Corp', alliance: 'Moon Alliance' });
	});

	it('looks up only the account’s characters never looked up, in one call', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [
			{ characterId: 90000001, name: 'Alpha' },
			{ characterId: 90000003, name: 'Gamma' }
		]);
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000004, name: 'Delta' }]);
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_name = 'Old Corp', affiliation_updated_at = 5 WHERE character_id = 90000001`
		);
		const esiRequests = sso.esiRequests.length;
		const { location } = await callback({
			env,
			esi,
			user: sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]),
			flow: { purpose: 'add_character' },
			character: { characterId: 90000002, name: 'Beta' }
		});
		expect(location).toBe('/account');
		expect(sso.esiRequests.slice(esiRequests)).toEqual([
			'/characters/affiliation [90000002,90000003]',
			'/universe/names [98000002]'
		]);
		expect(affiliations(env)).toEqual([
			{
				character_id: 90000001,
				corporation_name: 'Old Corp',
				alliance_name: null,
				affiliation_updated_at: 5
			},
			{
				character_id: 90000002,
				corporation_name: 'Solo Corp',
				alliance_name: null,
				affiliation_updated_at: NOW
			},
			{
				character_id: 90000003,
				corporation_name: 'Solo Corp',
				alliance_name: null,
				affiliation_updated_at: NOW
			},
			{ character_id: 90000004, corporation_name: null, alliance_name: null, affiliation_updated_at: null }
		]);
	});

	it('asks ESI nothing when every character was looked up', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		env.DB.sqlite.exec(`UPDATE characters SET affiliation_updated_at = 5`);
		const esiRequests = sso.esiRequests.length;
		const { location } = await callback({ env, esi });
		expect(location).toBe('/account');
		expect(sso.esiRequests.length).toBe(esiRequests);
	});

	it.each([
		['ESI down', () => new Response('down', { status: 503 })],
		['a network failure', () => Promise.reject(new TypeError('fetch failed'))]
	])('%s still logs in and leaves the affiliation to the daily job', async (_label, failing) => {
		const esiRequests = sso.esiRequests.length;
		const { env, cookies, location } = await callback({ esi: failing });
		expect(location).toBe('/account');
		// One attempt only: a login does not wait for retries.
		expect(sso.esiRequests.length - esiRequests).toBe(1);
		expect(affiliations(env)).toEqual([
			{ character_id: 90000001, corporation_name: null, alliance_name: null, affiliation_updated_at: null }
		]);
		const session = await loadSession(asEnv(env), cookies.asCookies(), NOW);
		expect(session?.account).toMatchObject({ corporation: null, alliance: null });
	});

	describe('bounded and failure-proof', () => {
		afterEach(() => vi.restoreAllMocks());

		it.each([
			['the lookup of the characters', /"affiliation_updated_at" is null/i],
			['storing the affiliations', /^update "characters" set "corporation_id"/i]
		])('a database failure in %s still logs in', async (_label, failingSql) => {
			const env = ssoEnv();
			const prepare = env.DB.prepare.bind(env.DB);
			let failed = 0;
			vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
				if (failingSql.test(sql)) {
					failed++;
					throw new Error('D1_ERROR');
				}
				return prepare(sql);
			});
			const { cookies, location } = await callback({ env, esi });
			expect(failed).toBeGreaterThan(0);
			expect(location).toBe('/account');
			const session = await loadSession(asEnv(env), cookies.asCookies(), NOW);
			expect(session?.user.characterId).toBe(90000001);
		});

		it('a hanging ESI is abandoned after the login timeout', async () => {
			const timeout = AbortSignal.timeout.bind(AbortSignal);
			const timeouts: number[] = [];
			// The real 3 s, shortened so the test does not wait for it.
			vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
				timeouts.push(ms);
				return timeout(10);
			});
			const hanging: FakeEsi = (_path, _ids, signal) => {
				const { promise, reject } = Promise.withResolvers<Response>();
				signal?.addEventListener('abort', () => reject(signal.reason));
				return promise;
			};
			const { env, location } = await callback({ esi: hanging });
			expect(location).toBe('/account');
			expect(timeouts).toEqual([LOGIN_AFFILIATION_TIMEOUT_MS]);
			expect(LOGIN_AFFILIATION_TIMEOUT_MS).toBe(3000);
			expect(affiliations(env)).toEqual([
				{ character_id: 90000001, corporation_name: null, alliance_name: null, affiliation_updated_at: null }
			]);
		});
	});
});

describe('purpose=feature', () => {
	const alpha = sessionUser('u1', [
		{ characterId: 90000001, name: 'Alpha' },
		{ characterId: 90000002, name: 'Beta' }
	]);
	function account() {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [
			{ characterId: 90000001, name: 'Alpha' },
			{ characterId: 90000002, name: 'Beta' }
		]);
		return env;
	}

	it('stores the encrypted refresh token, granted scopes, issuing app and token status', async () => {
		const env = account();
		const { location } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'feature', feature: 'structures', characterId: 90000001, returnTo: '/account' },
			character: { characterId: 90000001, name: 'Alpha', scopes: [...STRUCTURE_SCOPES] }
		});
		expect(location).toBe('/account');
		const row = charRows(env)[0];
		expect(row).toMatchObject({
			scopes: [...STRUCTURE_SCOPES].sort().join(' '),
			token_status: 'ok',
			last_refreshed_at: NOW,
			sso_client_id: CLIENT_ID
		});
		expect(await decryptToken(row.refresh_token_enc!, TOKEN_KEY)).toBe('refresh-token-1');
		expect(env.DB.rows('SELECT * FROM user_sessions')).toEqual([]);
	});

	it('wrong character → mismatch error naming both, data unchanged', async () => {
		const env = account();
		const before = charRows(env);
		const { status, message } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'feature', feature: 'structures', characterId: 90000001 },
			character: { characterId: 90000002, name: 'Beta', scopes: [...STRUCTURE_SCOPES] }
		});
		expect(status).toBe(400);
		expect(message).toContain('You logged in as Beta but were changing the permissions of Alpha');
		expect(charRows(env)).toEqual(before);
	});

	it('refuses a grant that would drop scopes the character already has', async () => {
		const env = account();
		env.DB.sqlite.exec(`UPDATE characters SET scopes = '${WALLET}' WHERE character_id = 90000002`);
		const before = charRows(env);
		const { status, message } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'feature', feature: 'structures', characterId: null },
			character: { characterId: 90000002, name: 'Beta', scopes: [...STRUCTURE_SCOPES] }
		});
		expect(status).toBe(400);
		expect(message).toContain(WALLET);
		expect(charRows(env)).toEqual(before);
	});

	it('a character of another account → 409', async () => {
		const env = account();
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000003, name: 'Gamma' }]);
		const { status } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'feature', feature: 'structures', characterId: null },
			character: { characterId: 90000003, name: 'Gamma', scopes: [...STRUCTURE_SCOPES] }
		});
		expect(status).toBe(409);
	});
});

describe('purpose=features', () => {
	const alpha = sessionUser('u1', [
		{ characterId: 90000001, name: 'Alpha' },
		{ characterId: 90000002, name: 'Beta' }
	]);
	const scopesOf = (features: GrantableFeature[]) => features.flatMap((f) => [...ESI_FEATURES[f]]);
	function account() {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [
			{ characterId: 90000001, name: 'Alpha' },
			{ characterId: 90000002, name: 'Beta' }
		]);
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000003, name: 'Gamma' }]);
		return env;
	}
	const grant = (env: FakeEnv, characterId: number, features: GrantableFeature[]) =>
		env.DB.sqlite
			.prepare(
				"UPDATE characters SET scopes = ?, refresh_token_enc = 'enc', token_status = 'ok' WHERE character_id = ?"
			)
			.run(formatScopes(scopesOf(features)), characterId);
	const relogin = (env: FakeEnv, features: GrantableFeature[], characterId = 90000001) =>
		callback({
			env,
			user: alpha,
			flow: { purpose: 'features', features, characterId, returnTo: '/account' },
			character: {
				characterId,
				name: characterId === 90000001 ? 'Alpha' : 'Beta',
				scopes: scopesOf(features)
			}
		});
	const switches = (env: FakeEnv, sourceId: number) =>
		env.DB.rows<{ inventory_enabled: number; tracking_enabled: number; character_id: number }>(
			'SELECT inventory_enabled, tracking_enabled, character_id FROM inventory_sources WHERE source_id = ?',
			sourceId
		)[0];
	const dirty = (env: FakeEnv, userId: string) =>
		env.DB.rows<{ dirty: number }>('SELECT dirty FROM ledger_state WHERE user_id = ?', userId)[0]?.dirty ??
		null;

	it('stores fewer scopes than before and returns with the permissions notice', async () => {
		const env = account();
		grant(env, 90000001, ['structures', 'tracking']);
		const { location } = await relogin(env, ['tracking']);
		expect(location).toBe('/account?notice=permissions&characterId=90000001&added=&removed=structures');
		const row = charRows(env)[0];
		expect(row).toMatchObject({ scopes: formatScopes(scopesOf(['tracking'])), token_status: 'ok' });
		expect(await decryptToken(row.refresh_token_enc!, TOKEN_KEY)).toBe('refresh-token-1');
	});

	it('an empty set stores no scopes and no token', async () => {
		const env = account();
		grant(env, 90000001, ['assets']);
		const { location } = await relogin(env, []);
		expect(location).toBe('/account?notice=permissions&characterId=90000001&added=&removed=assets');
		expect(charRows(env)[0]).toMatchObject({
			scopes: '',
			refresh_token_enc: null,
			sso_client_id: null,
			token_status: 'none'
		});
	});

	it('lists added features in the notice', async () => {
		const env = account();
		const { location } = await relogin(env, ['assets', 'corp_assets']);
		expect(location).toBe(
			'/account?notice=permissions&characterId=90000001&added=assets%2Ccorp_assets&removed='
		);
	});

	it('a returnTo whose dot segments collapse to another host returns to /account', async () => {
		const env = account();
		for (const returnTo of [
			'/.//evil.example',
			'/..//evil.example',
			'/%2e//evil.example',
			'/.\\/evil.example'
		]) {
			const { location } = await callback({
				env,
				user: alpha,
				flow: { purpose: 'features', features: [], characterId: 90000001, returnTo },
				character: { characterId: 90000001, name: 'Alpha' }
			});
			expect(location, returnTo).toBe('/account?notice=permissions&characterId=90000001&added=&removed=');
		}
	});

	it('another character than expected, not on the session: the error names no id', async () => {
		const env = account();
		const { status, message } = await callback({
			env,
			user: alpha,
			flow: { purpose: 'features', features: [], characterId: 90000003 },
			character: { characterId: 90000002, name: 'Beta' }
		});
		expect(status).toBe(400);
		expect(message).toContain('You logged in as Beta but were changing the permissions of another character');
		expect(message).not.toMatch(/\d/);
	});

	it('only the expected character of the session account, data unchanged otherwise', async () => {
		const env = account();
		grant(env, 90000001, ['assets']);
		const before = charRows(env);
		const wrong = await callback({
			env,
			user: alpha,
			flow: { purpose: 'features', features: [], characterId: 90000001 },
			character: { characterId: 90000002, name: 'Beta' }
		});
		expect(wrong.status).toBe(400);
		const foreign = await callback({
			env,
			user: alpha,
			flow: { purpose: 'features', features: [], characterId: 90000003 },
			character: { characterId: 90000003, name: 'Gamma' }
		});
		expect(foreign.status).toBe(409);
		const unknown = await callback({
			env,
			user: alpha,
			flow: { purpose: 'features', features: [], characterId: 90000009 },
			character: { characterId: 90000009, name: 'Delta' }
		});
		expect(unknown.status).toBe(400);
		expect(charRows(env)).toEqual(before);
	});

	it('removed assets and tracking switch the personal connection off and rebuild the ledger', async () => {
		const env = account();
		grant(env, 90000001, ['assets', 'tracking']);
		grant(env, 90000003, ['assets', 'tracking']);
		const mine = insertSource(env.DB, { userId: 'u1', characterId: 90000001, trackingEnabled: true });
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: 90000003, trackingEnabled: true });
		await relogin(env, ['tracking']);
		expect(switches(env, mine)).toMatchObject({ inventory_enabled: 0, tracking_enabled: 1 });
		expect(dirty(env, 'u1')).toBeNull();
		await relogin(env, []);
		expect(switches(env, mine)).toMatchObject({ inventory_enabled: 0, tracking_enabled: 0 });
		expect(dirty(env, 'u1')).toBe(1);
		expect(switches(env, theirs)).toMatchObject({ inventory_enabled: 1, tracking_enabled: 1 });
		expect(dirty(env, 'u2')).toBeNull();
	});

	it('corporation switches stay on while another pool member can read them', async () => {
		const env = account();
		grant(env, 90000001, ['corp_assets', 'corp_tracking']);
		grant(env, 90000002, ['corp_assets']);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 98000001,
			trackingEnabled: true
		});
		addReader(env.DB, corp, 90000002, NOW + 1);
		await relogin(env, ['corp_assets']);
		// Beta cannot read tracking: it goes off; inventory stays on; Alpha keeps a corporation feature.
		expect(switches(env, corp)).toMatchObject({
			inventory_enabled: 1,
			tracking_enabled: 0,
			character_id: 90000001
		});
		expect(poolOf(env.DB, corp)).toEqual([90000001, 90000002]);
		expect(dirty(env, 'u1')).toBe(1);
	});

	it('without either corporation feature the character leaves the pool, handing over the preferred reader', async () => {
		const env = account();
		grant(env, 90000001, ['corp_assets']);
		grant(env, 90000002, ['corp_assets']);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 98000001
		});
		addReader(env.DB, corp, 90000002, NOW + 1);
		await relogin(env, ['assets']);
		expect(poolOf(env.DB, corp)).toEqual([90000002]);
		expect(switches(env, corp)).toMatchObject({ inventory_enabled: 1, character_id: 90000002 });
	});

	it('the only pool member stays and both switches go off; the connection is kept', async () => {
		const env = account();
		grant(env, 90000001, ['corp_assets', 'corp_tracking']);
		grant(env, 90000003, ['corp_assets', 'corp_tracking']);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 98000001,
			trackingEnabled: true
		});
		const theirs = insertSource(env.DB, {
			userId: 'u2',
			characterId: 90000003,
			kind: 'corporation',
			ownerId: 98000001,
			trackingEnabled: true
		});
		await relogin(env, []);
		expect(poolOf(env.DB, corp)).toEqual([90000001]);
		expect(switches(env, corp)).toMatchObject({ inventory_enabled: 0, tracking_enabled: 0 });
		expect(switches(env, theirs)).toMatchObject({ inventory_enabled: 1, tracking_enabled: 1 });
	});

	it('removed structures drops the character’s structure links and cleans up their hubs', async () => {
		const env = account();
		grant(env, 90000001, ['structures']);
		grant(env, 90000002, ['structures']);
		insertStructureHub(env.DB, { structureId: 1001, name: 'Alpha Market' });
		insertStructureHub(env.DB, { structureId: 1002, name: 'Beta Market' });
		linkStructure(env.DB, 'u1', 1001, 90000001);
		linkStructure(env.DB, 'u1', 1002, 90000002);
		await relogin(env, []);
		expect(
			env.DB.rows<{ structure_id: number }>('SELECT structure_id FROM structure_links').map(
				(r) => r.structure_id
			)
		).toEqual([1002]);
		expect(
			env.DB.rows<{ hub_id: string }>("SELECT hub_id FROM market_hubs WHERE kind = 'structure'").map(
				(r) => r.hub_id
			)
		).toEqual(['structure-1002']);
	});

	it('a grant from before a feature gained a scope still counts as held', async () => {
		const env = account();
		// Personal assets without its structures scope: the exclusive assets scope marks it as held.
		env.DB.sqlite.exec(
			"UPDATE characters SET scopes = 'esi-assets.read_assets.v1', token_status = 'ok' WHERE character_id = 90000001"
		);
		const mine = insertSource(env.DB, { userId: 'u1', characterId: 90000001 });
		const { location } = await relogin(env, []);
		expect(location).toContain('removed=assets');
		expect(switches(env, mine)).toMatchObject({ inventory_enabled: 0 });
	});
});
