import { DEFAULT_SETTINGS, Settings } from '@reactions/engine';
import { STRUCTURE_SCOPES } from '@reactions/eve';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, insertStructureHub, insertUser, linkStructure } from '../../test/fixtures';
import { sessionUser } from '../../test/sso';
import { actions, load } from './+page.server';
import type { PageServerData } from './$types';

const alpha = { characterId: 90000001, name: 'Alpha' };
const beta = { characterId: 90000002, name: 'Beta' };

function event(
	env: FakeEnv,
	cookies: FakeCookies,
	user: SessionUser | null,
	path = '/account',
	form?: FormData
) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	return {
		url,
		request: new Request(url, form ? { method: 'POST', body: form } : undefined),
		cookies: cookies.asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function settle(promise: unknown) {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

function account(characters = [alpha, beta]) {
	const env = fakeEnv();
	insertUser(env.DB, { userId: 'u1', settings: Settings.parse({ cycleDays: 3 }) }, characters);
	env.DB.sqlite.exec(`UPDATE users SET settings_updated_at = ${NOW}`);
	const cookies = new FakeCookies({ rc_session: 'tok' });
	env.DB.sqlite.exec(
		`INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at, character_id) VALUES ('h', 'u1', 0, 9e12, ${characters[0].characterId})`
	);
	return { env, cookies, user: sessionUser('u1', characters) };
}

const form = (fields: Record<string, string> = {}) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

describe('load', () => {
	it('redirects anonymous visitors to a scope-less login that returns here', async () => {
		expect(await settle(load(event(fakeEnv(), new FakeCookies(), null)))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount'
		});
	});

	it('lists characters with login marker, granted features and token state', async () => {
		const { env, cookies, user } = account();
		env.DB.sqlite.exec(
			`UPDATE characters SET scopes = '${STRUCTURE_SCOPES.join(' ')}', token_status = 'ok', last_refreshed_at = ${NOW}, last_error = 'boom' WHERE character_id = 90000002`
		);
		const data = (await load(event(env, cookies, user))) as PageServerData;
		expect(data.characters).toEqual([
			{ ...alpha, isLogin: true, features: [], tokenStatus: 'none', lastRefreshedAt: null, lastError: null },
			{
				...beta,
				isLogin: false,
				features: ['structures'],
				tokenStatus: 'ok',
				lastRefreshedAt: NOW,
				lastError: 'boom'
			}
		]);
		expect(data.offeredFeatures).toEqual(['structures']);
		expect(data.settingsUpdatedAt).toBe(NOW);
		expect(data.notice).toBeNull();
	});
});

describe('remove', () => {
	it('removes one character and its links, keeping the account', async () => {
		const { env, cookies, user } = account();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market' });
		linkStructure(env.DB, 'u1', 1001, 90000002);
		const result = await settle(
			actions.remove(event(env, cookies, user, '/account?/remove', form({ characterId: '90000002' })))
		);
		expect(result).toEqual({ redirect: '/account?notice=removed' });
		expect(env.DB.rows('SELECT character_id FROM characters')).toEqual([{ character_id: 90000001 }]);
		expect(env.DB.rows('SELECT * FROM structure_links')).toEqual([]);
		expect(cookies.jar.has('rc_session')).toBe(true);
	});

	it('cleans up the hubs of the removed character’s links', async () => {
		const { env, cookies, user } = account();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Private' });
		insertStructureHub(env.DB, {
			structureId: 1002,
			name: 'Public',
			visibility: 'public',
			shareStatus: 'approved'
		});
		linkStructure(env.DB, 'u1', 1001, 90000002);
		linkStructure(env.DB, 'u1', 1002, 90000002, true);
		await settle(
			actions.remove(event(env, cookies, user, '/account?/remove', form({ characterId: '90000002' })))
		);
		expect(
			env.DB.rows("SELECT hub_id, enabled, last_error FROM market_hubs WHERE kind = 'structure'")
		).toEqual([{ hub_id: 'structure-1002', enabled: 0, last_error: 'NO_CONTRIBUTOR' }]);
	});

	it('removing the last character deletes the account and expires the session cookie', async () => {
		const { env, cookies, user } = account([alpha]);
		const result = await settle(
			actions.remove(event(env, cookies, user, '/account?/remove', form({ characterId: '90000001' })))
		);
		expect(result).toEqual({ redirect: '/' });
		expect(env.DB.rows('SELECT * FROM users')).toEqual([]);
		expect(env.DB.rows('SELECT * FROM user_sessions')).toEqual([]);
		expect(cookies.set_calls.find((c) => c.name === 'rc_session')?.opts.maxAge).toBe(0);
	});

	it('refuses characters of other accounts', async () => {
		const { env, cookies, user } = account();
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000003, name: 'Gamma' }]);
		const result = await settle(
			actions.remove(event(env, cookies, user, '/account?/remove', form({ characterId: '90000003' })))
		);
		expect(result.status).toBe(400);
		expect(env.DB.rows('SELECT character_id FROM characters WHERE user_id = ?', 'u2')).toHaveLength(1);
	});
});

describe('deleteAccount', () => {
	it('deletes the user with everything it owns and expires the session cookie', async () => {
		const { env, cookies, user } = account();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market' });
		linkStructure(env.DB, 'u1', 1001, 90000001);
		expect(
			await settle(actions.deleteAccount(event(env, cookies, user, '/account?/deleteAccount', form())))
		).toEqual({
			redirect: '/'
		});
		for (const table of ['users', 'characters', 'user_sessions', 'structure_links']) {
			expect(env.DB.rows(`SELECT * FROM ${table}`)).toEqual([]);
		}
		expect(cookies.jar.has('rc_session')).toBe(false);
		expect(cookies.set_calls.find((c) => c.name === 'rc_session')?.opts.maxAge).toBe(0);
	});

	it('cleans up the hubs of every former link', async () => {
		const { env, cookies, user } = account();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Private' });
		linkStructure(env.DB, 'u1', 1001, 90000001);
		await settle(actions.deleteAccount(event(env, cookies, user, '/account?/deleteAccount', form())));
		expect(env.DB.rows("SELECT hub_id FROM market_hubs WHERE kind = 'structure'")).toEqual([]);
	});

	it('anonymous posts are sent to log in', async () => {
		expect(
			await settle(actions.deleteAccount(event(fakeEnv(), new FakeCookies(), null, '/account', form())))
		).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount'
		});
	});
});
