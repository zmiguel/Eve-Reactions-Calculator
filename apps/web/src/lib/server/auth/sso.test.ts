import { DEFAULT_SETTINGS, Settings, decodeSettings, encodeSettings } from '@reactions/engine';
import { STRUCTURE_SCOPES, decryptToken } from '@reactions/eve';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeCookies, type FakeEnv } from '../../../test/fakes';
import { NOW, insertStructureHub, insertUser, linkStructure } from '../../../test/fixtures';
import {
	CLIENT_ID,
	SESSION_SECRET,
	TOKEN_KEY,
	fakeSso,
	sessionUser,
	ssoEnv,
	type FakeSso,
	type TokenCharacter
} from '../../../test/sso';
import { sha256Hex } from '../crypto';
import type { SessionUser } from '../session';
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
}

async function callback(opts: Run = {}) {
	const env = opts.env ?? ssoEnv();
	const cookies = opts.cookies ?? new FakeCookies();
	const flow: LoginFlow = {
		purpose: 'login',
		feature: null,
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
				locals: { user: opts.user ?? null, account: null, settings: DEFAULT_SETTINGS, theme: 'dark' },
				platform: { env } as never
			},
			sso.deps(character, { status: opts.tokenStatus })
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
		expect(message).toContain('You logged in as Beta but were upgrading Alpha');
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
