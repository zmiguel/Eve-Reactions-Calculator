import { DEFAULT_SETTINGS, Settings, encodeSettings } from '@reactions/engine';
import { STRUCTURE_SCOPES } from '@reactions/eve';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOauthState } from '$lib/server/auth/oauth';
import { sha256Hex } from '$lib/server/crypto';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, type FakeEnv } from '../../test/fakes';
import { NOW, insertUser } from '../../test/fixtures';
import { SESSION_SECRET, sessionUser, ssoEnv } from '../../test/sso';
import { load as devLogin } from './dev-login/+page.server';
import { load as login } from './login/+page.server';
import { POST as logout } from './logout/+server';

const WALLET = 'esi-wallet.read_character_wallet.v1';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

interface Ctx {
	env?: FakeEnv;
	cookies?: FakeCookies;
	user?: SessionUser | null;
}

async function call(handler: (event: never) => unknown, path: string, ctx: Ctx = {}, method = 'GET') {
	const env = ctx.env ?? ssoEnv();
	const cookies = ctx.cookies ?? new FakeCookies();
	const url = new URL(`https://reactions.coalition.space${path}`);
	const event = {
		url,
		request: new Request(url, { method }),
		cookies: cookies.asCookies(),
		platform: { env },
		locals: { user: ctx.user ?? null, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent;
	try {
		await handler(event as never);
		throw new Error('handler returned');
	} catch (e) {
		if (isRedirect(e)) return { env, cookies, status: e.status, location: e.location };
		if (isHttpError(e)) return { env, cookies, status: e.status, location: '', message: e.body.message };
		throw e;
	}
}

/** Reads the signed flow back from the cookie, using the `state` of the authorize URL. */
async function flowOf(cookies: FakeCookies, location: string) {
	const state = new URL(location).searchParams.get('state');
	return readOauthState(SESSION_SECRET, cookies.jar.get('rc_oauth'), state, NOW);
}

describe('GET /auth/login', () => {
	it('purpose=login → EVE SSO without a scope parameter and a signed rc_oauth cookie', async () => {
		const { cookies, status, location } = await call(login, '/auth/login?purpose=login&returnTo=/composite');
		expect(status).toBe(302);
		const url = new URL(location);
		expect(url.origin + url.pathname).toBe('https://login.eveonline.com/v2/oauth/authorize');
		expect(url.searchParams.has('scope')).toBe(false);
		expect(url.searchParams.get('client_id')).toBe('test-client');
		expect(url.searchParams.get('redirect_uri')).toBe('https://reactions.coalition.space/auth/callback');
		const set = cookies.set_calls.find((c) => c.name === 'rc_oauth');
		expect(set?.opts).toMatchObject({
			maxAge: 600,
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			path: '/'
		});
		expect(await flowOf(cookies, location)).toEqual({
			purpose: 'login',
			feature: null,
			characterId: null,
			returnTo: '/composite'
		});
	});

	it.each(['//evil.example', 'https://evil.example/x', '/\\evil.example'])(
		'returnTo=%s (open redirect attempt) → /account',
		async (returnTo) => {
			const { cookies, location } = await call(login, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
			expect((await flowOf(cookies, location))?.returnTo).toBe('/account');
		}
	);

	it('purpose=add_character asks for no scopes and needs a session', async () => {
		const user = sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]);
		const { cookies, location } = await call(login, '/auth/login?purpose=add_character', { user });
		expect(new URL(location).searchParams.has('scope')).toBe(false);
		expect((await flowOf(cookies, location))?.purpose).toBe('add_character');

		const anonymous = await call(login, '/auth/login?purpose=add_character&returnTo=/planner');
		expect(anonymous.status).toBe(303);
		expect(anonymous.location).toBe('/auth/login?purpose=login&returnTo=%2Fplanner');
	});

	it('purpose=feature requests the feature scopes ∪ the character’s current scopes', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		env.DB.sqlite.exec(`UPDATE characters SET scopes = '${WALLET}'`);
		const user = sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]);
		const { cookies, location } = await call(
			login,
			'/auth/login?purpose=feature&feature=structures&characterId=90000001&returnTo=/account',
			{ env, user }
		);
		const scopes = new URL(location).searchParams.get('scope')!.split(' ');
		expect(scopes).toEqual([...STRUCTURE_SCOPES, WALLET].sort());
		expect(await flowOf(cookies, location)).toEqual({
			purpose: 'feature',
			feature: 'structures',
			characterId: 90000001,
			returnTo: '/account'
		});
	});

	it('purpose=feature without a character asks for the feature scopes only', async () => {
		const user = sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]);
		const { location } = await call(login, '/auth/login?purpose=feature&feature=structures', { user });
		expect(new URL(location).searchParams.get('scope')!.split(' ')).toEqual([...STRUCTURE_SCOPES].sort());
	});

	it('purpose=feature without a session logs in first, then resumes the grant', async () => {
		const path = '/auth/login?purpose=feature&feature=structures&returnTo=/account';
		const { status, location } = await call(login, path);
		expect(status).toBe(303);
		expect(location).toBe(`/auth/login?purpose=login&returnTo=${encodeURIComponent(path)}`);
	});

	it('purpose=structures is an alias of purpose=feature&feature=structures', async () => {
		const user = sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]);
		const aliased = await call(login, '/auth/login?purpose=structures&characterId=90000001', { user });
		expect(aliased.status).toBe(303);
		expect(aliased.location).toBe(
			'/auth/login?purpose=feature&feature=structures&characterId=90000001&returnTo=%2Faccount%2Fstructures'
		);
		const back = await call(login, '/auth/login?purpose=structures&returnTo=//evil.example', { user });
		expect(back.location).toBe(
			'/auth/login?purpose=feature&feature=structures&returnTo=%2Faccount%2Fstructures'
		);
	});

	it('rejects unknown purposes/features and characters of other accounts', async () => {
		const user = sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]);
		expect((await call(login, '/auth/login?purpose=admin')).status).toBe(400);
		expect((await call(login, '/auth/login?purpose=feature&feature=login', { user })).status).toBe(400);
		expect((await call(login, '/auth/login?purpose=feature&feature=nope', { user })).status).toBe(400);
		// Registry features no page uses yet cannot be granted.
		expect((await call(login, '/auth/login?purpose=feature&feature=wallet', { user })).status).toBe(400);
		expect(
			(await call(login, '/auth/login?purpose=feature&feature=structures&characterId=90000002', { user }))
				.status
		).toBe(400);
	});

	it('503 when SSO is not configured', async () => {
		const result = await call(login, '/auth/login', { env: ssoEnv({ EVE_SSO_CLIENT_ID: '' }) });
		expect(result.status).toBe(503);
		expect(result.cookies.jar.has('rc_oauth')).toBe(false);
	});
});

describe('POST /auth/logout', () => {
	it('deletes the session row and expires rc_session; the settings cookie stays', async () => {
		const env = ssoEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		env.DB.sqlite
			.prepare(
				'INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
			)
			.run(await sha256Hex('tok'), 'u1', NOW, NOW + 1e9);
		const settings = await encodeSettings(Settings.parse({ cycleDays: 3 }));
		const cookies = new FakeCookies({ rc_session: 'tok', rc_settings: settings });
		const { status, location } = await call(logout as never, '/auth/logout', { env, cookies }, 'POST');
		expect([status, location]).toEqual([303, '/']);
		expect(env.DB.rows('SELECT * FROM user_sessions')).toEqual([]);
		expect(cookies.set_calls.find((c) => c.name === 'rc_session')?.opts.maxAge).toBe(0);
		expect(cookies.jar.get('rc_settings')).toBe(settings);
		expect(env.DB.rows('SELECT user_id FROM users')).toEqual([{ user_id: 'u1' }]);
	});
});

describe('GET /auth/dev-login', () => {
	it('404 unless DEV_LOGIN=1', async () => {
		for (const DEV_LOGIN of [undefined, '', '0', 'true']) {
			const { status, env } = await call(devLogin, '/auth/dev-login?characterId=90000001&name=Test', {
				env: ssoEnv({ DEV_LOGIN })
			});
			expect(status).toBe(404);
			expect(env.DB.rows('SELECT * FROM users')).toEqual([]);
		}
	});

	it('logs in without SSO: user, scope-less character and session, then /account', async () => {
		const env = ssoEnv({ DEV_LOGIN: '1' });
		const cookies = new FakeCookies();
		const { status, location } = await call(devLogin, '/auth/dev-login?characterId=90000001&name=Test', {
			env,
			cookies
		});
		expect([status, location]).toEqual([303, '/account']);
		expect(env.DB.rows('SELECT character_id, name, scopes, token_status FROM characters')).toEqual([
			{ character_id: 90000001, name: 'Test', scopes: '', token_status: 'none' }
		]);
		expect(env.DB.rows('SELECT character_id FROM user_sessions')).toEqual([{ character_id: 90000001 }]);
		expect(cookies.jar.has('rc_session')).toBe(true);
	});

	it('purpose=add_character attaches a second character to the session account', async () => {
		const env = ssoEnv({ DEV_LOGIN: '1' });
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Test' }]);
		const user = sessionUser('u1', [{ characterId: 90000001, name: 'Test' }]);
		await call(devLogin, '/auth/dev-login?characterId=90000002&name=Alt&purpose=add_character', {
			env,
			user
		});
		expect(env.DB.rows('SELECT character_id, user_id FROM characters ORDER BY character_id')).toEqual([
			{ character_id: 90000001, user_id: 'u1' },
			{ character_id: 90000002, user_id: 'u1' }
		]);
		expect(env.DB.rows('SELECT * FROM user_sessions')).toEqual([]);
	});

	it('keeps the stored owner hash (a dev login is never a character transfer)', async () => {
		const env = ssoEnv({ DEV_LOGIN: '1' });
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Test' }]);
		await call(devLogin, '/auth/dev-login?characterId=90000001', { env });
		expect(env.DB.rows('SELECT user_id, owner_hash FROM characters')).toEqual([
			{ user_id: 'u1', owner_hash: 'hash-90000001' }
		]);
	});

	it('rejects a bad characterId or purpose', async () => {
		const env = ssoEnv({ DEV_LOGIN: '1' });
		expect((await call(devLogin, '/auth/dev-login?characterId=abc', { env })).status).toBe(400);
		expect((await call(devLogin, '/auth/dev-login?characterId=1&purpose=feature', { env })).status).toBe(400);
	});
});
