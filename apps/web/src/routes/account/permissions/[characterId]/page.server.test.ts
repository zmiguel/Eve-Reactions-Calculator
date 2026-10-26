import { DEFAULT_SETTINGS } from '@reactions/engine';
import { ESI_FEATURES, formatScopes } from '@reactions/eve';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import { readOauthState } from '#lib/server/auth/oauth.js';
import type { SessionUser } from '#lib/server/session.js';
import { FakeCookies, type FakeEnv } from '../../../../test/fakes';
import { insertUser } from '../../../../test/fixtures';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import { SESSION_SECRET, sessionUser, ssoEnv } from '../../../../test/sso';
import { actions, load } from './+page.server';
import Page from './+page.svelte';

afterEach(() => resetPage());

function event(
	env: FakeEnv,
	user: SessionUser | null,
	characterId: string,
	body?: [string, string][],
	cookies = new FakeCookies()
) {
	const url = new URL(`https://reactions.coalition.space/account/permissions/${characterId}`);
	return {
		url,
		params: { characterId },
		request: new Request(url, { method: 'POST', body: new URLSearchParams(body) }),
		cookies: cookies.asCookies(),
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark', env }
	} as unknown as RequestEvent as never;
}

async function settle(promise: unknown) {
	try {
		return { data: await promise };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		if (isHttpError(e)) return { status: e.status, message: e.body.message };
		throw e;
	}
}

function account() {
	const env = ssoEnv();
	insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
	insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000002, name: 'Beta' }]);
	env.DB.sqlite
		.prepare("UPDATE characters SET scopes = ?, token_status = 'ok' WHERE character_id = 90000001")
		.run(formatScopes([...ESI_FEATURES.assets, ...ESI_FEATURES.tracking]));
	return { env, user: sessionUser('u1', [{ characterId: 90000001, name: 'Alpha' }]) };
}

describe('/account/permissions/[characterId] load', () => {
	it('sends anonymous visitors to log in and back', async () => {
		expect(await settle(load(event(ssoEnv(), null, '90000001')))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Fpermissions%2F90000001'
		});
	});

	it('returns the character with its current grants and the offered features', async () => {
		const { env, user } = account();
		expect(await settle(load(event(env, user, '90000001')))).toEqual({
			data: {
				character: { characterId: 90000001, name: 'Alpha', features: ['assets', 'tracking'] },
				offeredFeatures: ['structures', 'assets', 'corp_assets', 'tracking', 'corp_tracking']
			}
		});
	});

	it.each(['90000002', '90000009', 'abc'])('404 for %s (not a character of the account)', async (id) => {
		const { env, user } = account();
		expect(await settle(load(event(env, user, id)))).toMatchObject({ status: 404 });
	});

	it('without JS the page is a plain POST form whose checkboxes each send a features value', async () => {
		const { env, user } = account();
		setPage({ url: 'https://reactions.coalition.space/account/permissions/90000001' });
		const { data } = (await settle(load(event(env, user, '90000001')))) as { data: object };
		const { head, body } = render(Page, { props: { data, params: { characterId: '90000001' } } as never });
		expect(head).toContain('<meta name="robots" content="noindex"');
		expect(body).toMatch(/<form[^>]*method="POST"[^>]*action="\/account\/permissions\/90000001\?\/save"/);
		const boxes = [...body.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
		expect(boxes).toHaveLength(5);
		expect(boxes.every((b) => b.includes('name="features"'))).toBe(true);
		expect(boxes.filter((b) => / checked/.test(b)).map((b) => /value="(\w+)"/.exec(b)?.[1])).toEqual([
			'assets',
			'tracking'
		]);
	});
});

describe('/account/permissions/[characterId] ?/save', () => {
	async function save(body: [string, string][], characterId = '90000001', ctx = account()) {
		const cookies = new FakeCookies();
		const result = await settle(actions.save(event(ctx.env, ctx.user, characterId, body, cookies)));
		const state = result.redirect?.startsWith('https://')
			? new URL(result.redirect).searchParams.get('state')
			: null;
		return {
			...result,
			cookies,
			flow: await readOauthState(SESSION_SECRET, cookies.jar.get('rc_oauth'), state)
		};
	}

	it('starts EVE SSO with exactly the scopes of the posted features and signs the set', async () => {
		const { redirect, flow } = await save([
			['features', 'tracking'],
			['features', 'assets']
		]);
		const url = new URL(redirect!);
		expect(url.origin + url.pathname).toBe('https://login.eveonline.com/v2/oauth/authorize');
		expect(url.searchParams.get('scope')!.split(' ')).toEqual(
			[...new Set([...ESI_FEATURES.assets, ...ESI_FEATURES.tracking])].sort()
		);
		expect(flow).toEqual({
			purpose: 'features',
			feature: null,
			features: ['assets', 'tracking'],
			characterId: 90000001,
			returnTo: '/account'
		});
	});

	it('accepts one comma-separated value', async () => {
		const { flow } = await save([['features', 'corp_tracking,structures']]);
		expect(flow?.features).toEqual(['structures', 'corp_tracking']);
	});

	it('no features asks for no scopes', async () => {
		const { redirect, flow } = await save([]);
		expect(new URL(redirect!).searchParams.has('scope')).toBe(false);
		expect(flow?.features).toEqual([]);
	});

	it('rejects unknown features and characters that are not the account’s own, starting nothing', async () => {
		for (const [features, id, status] of [
			['assets,wallet', '90000001', 400],
			['login', '90000001', 400],
			['assets', '90000002', 404],
			['assets', 'abc', 404]
		] as const) {
			const result = await save([['features', features]], id);
			expect(result.status, `${id} ${features}`).toBe(status);
			expect(result.cookies.jar.has('rc_oauth')).toBe(false);
		}
	});

	it('sends anonymous visitors to log in and back to the form', async () => {
		const { redirect, cookies } = await save([['features', 'assets']], '90000001', {
			env: ssoEnv(),
			user: null as unknown as SessionUser
		});
		expect(redirect).toBe('/auth/login?purpose=login&returnTo=%2Faccount%2Fpermissions%2F90000001');
		expect(cookies.jar.has('rc_oauth')).toBe(false);
	});

	it('503 when SSO is not configured', async () => {
		const { user } = account();
		const result = await save([], '90000001', { env: ssoEnv({ EVE_SSO_CLIENT_ID: '' }), user });
		expect(result.status).toBe(503);
		expect(result.cookies.jar.has('rc_oauth')).toBe(false);
	});
});
