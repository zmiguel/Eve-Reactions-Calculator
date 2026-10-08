import { DEFAULT_SETTINGS, Settings, decodeSettings, encodeSettings } from '@reactions/engine';
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FORM_BYTES, handle } from './hooks.server';
import { sha256Hex } from '$lib/server/crypto';
import { V2_COOKIES } from '$lib/server/legacy-cookies';
import { FakeCookies, fakeEnv, type FakeEnv } from './test/fakes';
import { NOW, V2_DEFAULT_COOKIES, insertSystems, insertUser } from './test/fixtures';

const DAY = 86_400_000;

async function run(cookies: FakeCookies, env: FakeEnv | null = fakeEnv(), path = '/') {
	const event = {
		cookies: cookies.asCookies(),
		platform: env ? { env } : undefined,
		locals: {},
		url: new URL(`https://reactions.coalition.space${path}`),
		request: new Request(`https://reactions.coalition.space${path}`)
	} as unknown as RequestEvent;
	const response = await handle({
		event,
		resolve: async (_event, opts) =>
			new Response(await opts!.transformPageChunk!({ html: '<html class="%theme%">', done: true }))
	});
	return { locals: event.locals, response, html: await response.text() };
}

async function withSession(
	env: FakeEnv,
	userId: string,
	expiresAt: number,
	characterId: number | null = null
) {
	const token = `token-${userId}`;
	env.DB.sqlite
		.prepare(
			'INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at, character_id) VALUES (?, ?, ?, ?, ?)'
		)
		.run(await sha256Hex(token), userId, NOW, expiresAt, characterId);
	return token;
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

describe('theme', () => {
	it('defaults to dark and injects the class', async () => {
		const { locals, html } = await run(new FakeCookies());
		expect(locals.theme).toBe('dark');
		expect(html).toBe('<html class="dark">');
	});

	it('honours rc_theme=light', async () => {
		const { locals, html } = await run(new FakeCookies({ rc_theme: 'light' }));
		expect(locals.theme).toBe('light');
		expect(html).toBe('<html class="light">');
	});
});

describe('security headers', () => {
	it('are added to every response', async () => {
		const { response } = await run(new FakeCookies());
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
		expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
	});

	it('keeps the preview deployment out of search engines, never production', async () => {
		const preview = Object.assign(fakeEnv(), { DEPLOY_ENV: 'preview' });
		expect((await run(new FakeCookies(), preview)).response.headers.get('X-Robots-Tag')).toBe(
			'noindex, nofollow'
		);
		const production = Object.assign(fakeEnv(), { DEPLOY_ENV: 'production' });
		expect((await run(new FakeCookies(), production)).response.headers.get('X-Robots-Tag')).toBeNull();
		expect((await run(new FakeCookies())).response.headers.get('X-Robots-Tag')).toBeNull();
	});
});

describe('form post size', () => {
	async function post(path: string, body: BodyInit | null, headers: Record<string, string> = {}) {
		const request = new Request(`https://reactions.coalition.space${path}`, {
			method: 'POST',
			body,
			headers,
			// Streams need half-duplex; plain bodies ignore it.
			...(body instanceof ReadableStream ? { duplex: 'half' } : {})
		} as RequestInit);
		const resolve = vi.fn(async () => new Response('ok'));
		const event = {
			cookies: new FakeCookies().asCookies(),
			platform: { env: fakeEnv() },
			locals: {},
			url: new URL(request.url),
			request
		} as unknown as RequestEvent;
		return { response: await handle({ event, resolve }), resolve };
	}

	it('rejects page form posts over 64 KiB or without a declared length, before any action runs', async () => {
		const big = await post('/settings?/import', 'code=x', { 'content-length': String(MAX_FORM_BYTES + 1) });
		expect(big.response.status).toBe(413);
		expect(big.resolve).not.toHaveBeenCalled();

		const chunked = await post(
			'/settings?/import',
			new ReadableStream({
				start(c) {
					c.enqueue(new TextEncoder().encode('code=x'));
					c.close();
				}
			})
		);
		expect(chunked.response.status).toBe(411);
		expect(chunked.resolve).not.toHaveBeenCalled();
	});

	it('lets normal form posts, bodiless posts and API v2 requests through', async () => {
		expect((await post('/settings?/save', 'a=1', { 'content-length': '3' })).resolve).toHaveBeenCalled();
		expect((await post('/auth/logout', null)).resolve).toHaveBeenCalled();
		const api = await post('/api/v2/plan', '{}', { 'content-length': String(MAX_FORM_BYTES + 1) });
		expect(api.resolve).toHaveBeenCalled();
	});
});

describe('anonymous settings', () => {
	it('decodes a valid rc_settings cookie', async () => {
		const settings = Settings.parse({ cycleDays: 3, shared: { structure: 'athanor' } });
		const { locals } = await run(new FakeCookies({ rc_settings: await encodeSettings(settings) }));
		expect(locals.settings).toEqual(settings);
		expect(locals.user).toBeNull();
	});

	it('falls back to defaults and deletes a garbage cookie', async () => {
		const cookies = new FakeCookies({ rc_settings: 'garbage!!' });
		const { locals } = await run(cookies);
		expect(locals.settings).toEqual(DEFAULT_SETTINGS);
		expect(cookies.deleted).toContain('rc_settings');
	});

	it('uses defaults without platform (prerendering)', async () => {
		const { locals } = await run(new FakeCookies(), null);
		expect(locals.settings).toEqual(DEFAULT_SETTINGS);
		expect(locals.user).toBeNull();
	});
});

describe('sessions', () => {
	it('resolves a valid session with characters and admin flag', async () => {
		const env = fakeEnv({ ADMIN_CHARACTER_IDS: '90000002, 123' });
		insertUser(env.DB, { userId: 'u1' }, [
			{ characterId: 90000001, name: 'Alpha' },
			{ characterId: 90000002, name: 'Beta' }
		]);
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const { locals } = await run(new FakeCookies({ rc_session: token }), env);
		expect(locals.user).toEqual({
			userId: 'u1',
			characterId: 90000001,
			characters: [
				{ characterId: 90000001, name: 'Alpha' },
				{ characterId: 90000002, name: 'Beta' }
			],
			isAdmin: true
		});
	});

	it('reports the character the session logged in with, falling back to the first once it is removed', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' }, [
			{ characterId: 90000001, name: 'Alpha' },
			{ characterId: 90000002, name: 'Beta' }
		]);
		const token = await withSession(env, 'u1', NOW + 20 * DAY, 90000002);
		expect((await run(new FakeCookies({ rc_session: token }), env)).locals.user?.characterId).toBe(90000002);
		env.DB.sqlite.exec('DELETE FROM characters WHERE character_id = 90000002');
		expect(env.DB.rows('SELECT character_id FROM user_sessions')).toEqual([{ character_id: null }]);
		expect((await run(new FakeCookies({ rc_session: token }), env)).locals.user?.characterId).toBe(90000001);
	});

	it('is not admin without a listed character', async () => {
		const env = fakeEnv({ ADMIN_CHARACTER_IDS: '1' });
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		expect((await run(new FakeCookies({ rc_session: token }), env)).locals.user?.isAdmin).toBe(false);
	});

	it('are ignored by API v2: no user, default settings, no cookie writes', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		// Close to expiry, so a page request would slide it and re-set the cookie.
		const token = await withSession(env, 'u1', NOW + 2 * DAY);
		const settings = await encodeSettings(Settings.parse({ cycleDays: 3 }));
		const cookies = new FakeCookies({ rc_session: token, rc_settings: settings });
		const { locals } = await run(cookies, env, '/api/v2/profits');
		expect(locals.user).toBeNull();
		expect(locals.settings).toEqual(DEFAULT_SETTINGS);
		expect(cookies.set_calls).toEqual([]);
		const page = new FakeCookies({ rc_session: token, rc_settings: settings });
		expect((await run(page, env, '/composite')).locals.user?.userId).toBe('u1');
		expect(page.set_calls.map((c) => c.name)).toContain('rc_session');
	});

	it('expired and unknown sessions resolve to null and clear the cookie', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' });
		const expired = await withSession(env, 'u1', NOW - 1);
		const cookies = new FakeCookies({ rc_session: expired });
		expect((await run(cookies, env)).locals.user).toBeNull();
		expect(cookies.deleted).toContain('rc_session');
		expect((await run(new FakeCookies({ rc_session: 'unknown' }), env)).locals.user).toBeNull();
	});

	it('renews sessions with less than 15 days left and re-sets the cookie', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' });
		const token = await withSession(env, 'u1', NOW + 10 * DAY);
		const cookies = new FakeCookies({ rc_session: token });
		await run(cookies, env);
		const [row] = env.DB.rows<{ expires_at: number }>('SELECT expires_at FROM user_sessions');
		expect(row.expires_at).toBe(NOW + 30 * DAY);
		expect(cookies.set_calls.find((c) => c.name === 'rc_session')).toMatchObject({
			value: token,
			opts: { maxAge: 2_592_000, httpOnly: true, secure: true, sameSite: 'lax', path: '/' }
		});
	});

	it('does not renew sessions with more than 15 days left', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' });
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const cookies = new FakeCookies({ rc_session: token });
		await run(cookies, env);
		expect(env.DB.rows<{ expires_at: number }>('SELECT expires_at FROM user_sessions')[0].expires_at).toBe(
			NOW + 20 * DAY
		);
		expect(cookies.set_calls).toHaveLength(0);
	});

	it('updates last_seen_at only when older than an hour', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'old', lastSeenAt: NOW - 2 * 3_600_000 });
		insertUser(env.DB, { userId: 'recent', lastSeenAt: NOW - 60_000 });
		await run(new FakeCookies({ rc_session: await withSession(env, 'old', NOW + 20 * DAY) }), env);
		await run(new FakeCookies({ rc_session: await withSession(env, 'recent', NOW + 20 * DAY) }), env);
		const seen = Object.fromEntries(
			env.DB.rows<{ user_id: string; last_seen_at: number }>('SELECT user_id, last_seen_at FROM users').map(
				(r) => [r.user_id, r.last_seen_at]
			)
		);
		expect(seen).toEqual({ old: NOW, recent: NOW - 60_000 });
	});
});

describe('account settings', () => {
	it('account settings override the cookie', async () => {
		const env = fakeEnv();
		const account = Settings.parse({ cycleDays: 2 });
		insertUser(env.DB, { userId: 'u1', settings: account });
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const cookie = await encodeSettings(Settings.parse({ cycleDays: 9 }));
		const { locals } = await run(new FakeCookies({ rc_session: token, rc_settings: cookie }), env);
		expect(locals.settings).toEqual(account);
	});

	it('an account without settings adopts the cookie and stores it', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1', settings: null });
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const cookieSettings = Settings.parse({ cycleDays: 9 });
		const { locals } = await run(
			new FakeCookies({ rc_session: token, rc_settings: await encodeSettings(cookieSettings) }),
			env
		);
		expect(locals.settings).toEqual(cookieSettings);
		const [row] = env.DB.rows<{ settings_json: string; settings_updated_at: number }>(
			'SELECT settings_json, settings_updated_at FROM users'
		);
		expect(JSON.parse(row.settings_json)).toEqual({ v: 1, cycleDays: 9 });
		expect(row.settings_updated_at).toBe(NOW);
	});

	it('invalid stored settings are replaced by defaults when no cookie exists', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' });
		env.DB.sqlite.exec(`UPDATE users SET settings_json = '{"v":99}'`);
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const { locals } = await run(new FakeCookies({ rc_session: token }), env);
		expect(locals.settings).toEqual(DEFAULT_SETTINGS);
		expect(
			JSON.parse(env.DB.rows<{ settings_json: string }>('SELECT settings_json FROM users')[0].settings_json)
		).toEqual({ v: 1 });
	});

	it('sparse stored settings are merged onto the defaults', async () => {
		const env = fakeEnv();
		insertUser(env.DB, { userId: 'u1' });
		env.DB.sqlite.exec(`UPDATE users SET settings_json = '{"v":1,"shared":{"structure":"athanor"}}'`);
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const { locals } = await run(new FakeCookies({ rc_session: token }), env);
		expect(locals.settings).toEqual(Settings.parse({ shared: { structure: 'athanor' } }));
	});
});

describe('v2 cookies', () => {
	/** Every cookie name v2 could set, holding v2's defaults (suffixed ones copy the unsuffixed value). */
	const allV2Defaults = Object.fromEntries(
		[...V2_COOKIES].map((name) => [name, V2_DEFAULT_COOKIES[name] ?? V2_DEFAULT_COOKIES[name.split('_')[0]]])
	);
	const chosen = { brokers: '2.5', system: '671-ST', duration: '1440' };
	const converted = Settings.parse({
		shared: { market: { brokerFeePct: 2.5 }, systemId: 30004604 },
		cycleDays: 1
	});

	function seeded() {
		const env = fakeEnv();
		insertSystems(env.DB);
		return env;
	}
	const settingsWrites = (cookies: FakeCookies) => cookies.set_calls.filter((c) => c.name === 'rc_settings');

	it('converts chosen v2 settings into rc_settings and deletes every v2 cookie', async () => {
		const cookies = new FakeCookies({ ...allV2Defaults, ...chosen, rc_theme: 'light' });
		const { locals } = await run(cookies, seeded());
		expect(locals.settings).toEqual(converted);
		const [write] = settingsWrites(cookies);
		expect(await decodeSettings(write.value)).toEqual(converted);
		expect(write.opts.maxAge).toBe(31_536_000);
		expect(new Set(cookies.deleted)).toEqual(V2_COOKIES);
		for (const c of cookies.set_calls.filter((s) => s.name !== 'rc_settings'))
			expect(c.opts).toMatchObject({ path: '/', maxAge: 0 });
		expect(cookies.jar.has('rc_theme')).toBe(true);
	});

	it('v2 defaults write no rc_settings but are deleted', async () => {
		const cookies = new FakeCookies(allV2Defaults);
		const { locals } = await run(cookies, seeded());
		expect(locals.settings).toEqual(DEFAULT_SETTINGS);
		expect(settingsWrites(cookies)).toEqual([]);
		expect(new Set(cookies.deleted)).toEqual(V2_COOKIES);
	});

	it('an existing rc_settings cookie wins; the v2 cookies are still deleted', async () => {
		const own = Settings.parse({ cycleDays: 3 });
		const cookies = new FakeCookies({ ...chosen, partner: 'true', rc_settings: await encodeSettings(own) });
		const { locals } = await run(cookies, seeded());
		expect(locals.settings).toEqual(own);
		expect(settingsWrites(cookies)).toEqual([]);
		expect(cookies.deleted.sort()).toEqual(['brokers', 'duration', 'partner', 'system']);
	});

	it('API requests neither convert nor delete v2 cookies', async () => {
		for (const path of ['/api/v2/profits', '/api/v1/composite']) {
			const cookies = new FakeCookies({ ...chosen, partner: 'true' });
			const { locals } = await run(cookies, seeded(), path);
			expect(locals.settings).toEqual(DEFAULT_SETTINGS);
			expect(cookies.set_calls).toEqual([]);
		}
	});

	it('account settings win over v2 cookies, which are deleted without conversion', async () => {
		const env = seeded();
		const account = Settings.parse({ cycleDays: 2 });
		insertUser(env.DB, { userId: 'u1', settings: account });
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const cookies = new FakeCookies({ ...chosen, rc_session: token });
		const { locals } = await run(cookies, env);
		expect(locals.settings).toEqual(account);
		expect(settingsWrites(cookies)).toEqual([]);
		expect(cookies.deleted.sort()).toEqual(['brokers', 'duration', 'system']);
		expect(env.DB.rows<{ settings_json: string }>('SELECT settings_json FROM users')[0].settings_json).toBe(
			JSON.stringify(account)
		);
	});

	it('an account without settings adopts the converted v2 settings', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'u1', settings: null });
		const token = await withSession(env, 'u1', NOW + 20 * DAY);
		const cookies = new FakeCookies({ ...chosen, rc_session: token });
		const { locals } = await run(cookies, env);
		expect(locals.settings).toEqual(converted);
		expect(await decodeSettings(settingsWrites(cookies)[0].value)).toEqual(converted);
		const [row] = env.DB.rows<{ settings_json: string }>('SELECT settings_json FROM users');
		expect(Settings.parse(JSON.parse(row.settings_json))).toEqual(converted);
	});
});
