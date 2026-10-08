import { decryptToken } from '@reactions/eve';
import { describe, expect, it, vi } from 'vitest';
import { asEnv, type FakeEnv } from '../../../test/fakes';
import { NOW, insertUser } from '../../../test/fixtures';
import { CLIENT_ID, TOKEN_KEY, fakeEve, grantStructures, ssoEnv } from '../../../test/sso';
import { getCharacter } from './accounts';
import { TOKEN_INVALID, TOKEN_UNAVAILABLE, getAccessToken } from './tokens';

async function pilot(refreshToken = 'refresh-0', ssoClientId: string | null = null) {
	const env = ssoEnv({
		EVE_SSO_EXTRA_CLIENT_ID: 'preview-client',
		EVE_SSO_EXTRA_CLIENT_SECRET: 'preview-secret'
	});
	insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
	await grantStructures(env.DB, 90000001, refreshToken);
	env.DB.sqlite.prepare('UPDATE characters SET sso_client_id = ?').run(ssoClientId);
	return { env, character: (await getCharacter(asEnv(env), 90000001))! };
}

const stored = (env: FakeEnv) =>
	env.DB.rows<{
		token_status: string;
		refresh_token_enc: string;
		sso_client_id: string | null;
		last_refreshed_at: number;
		last_error: string;
	}>(
		'SELECT token_status, refresh_token_enc, sso_client_id, last_refreshed_at, last_error FROM characters WHERE character_id = 90000001'
	)[0]!;

describe('getAccessToken', () => {
	it('refreshes with the stored token and stores the rotated one encrypted', async () => {
		const { env, character } = await pilot('refresh-0');
		const eve = fakeEve({ token: { refreshToken: 'refresh-rotated' } });

		expect(await getAccessToken(asEnv(env), character, eve.fetch, NOW)).toEqual({
			ok: true,
			accessToken: 'access-1'
		});

		expect(new URLSearchParams(eve.calls[0]!.body!).get('refresh_token')).toBe('refresh-0');
		const row = stored(env);
		expect(row.token_status).toBe('ok');
		expect(row.last_refreshed_at).toBe(NOW);
		expect(row.last_error).toBeNull();
		expect(await decryptToken(row.refresh_token_enc, TOKEN_KEY)).toBe('refresh-rotated');
		expect(eve.calls[0]!.auth).toBe(`Basic ${btoa(`${CLIENT_ID}:test-secret`)}`);
	});

	it('refreshes with the app that issued the token and keeps its client id on rotation', async () => {
		const { env, character } = await pilot('refresh-0', 'preview-client');
		const eve = fakeEve({ token: { refreshToken: 'refresh-rotated' } });

		expect(await getAccessToken(asEnv(env), character, eve.fetch, NOW)).toMatchObject({ ok: true });

		expect(eve.calls[0]!.auth).toBe(`Basic ${btoa('preview-client:preview-secret')}`);
		const row = stored(env);
		expect(row.sso_client_id).toBe('preview-client');
		expect(await decryptToken(row.refresh_token_enc, TOKEN_KEY)).toBe('refresh-rotated');
	});

	it('a token of an app without credentials is invalid (SSO_APP_UNKNOWN) without a request', async () => {
		const { env, character } = await pilot('refresh-0', 'retired-client');
		const eve = fakeEve();
		expect(await getAccessToken(asEnv(env), character, eve.fetch)).toEqual({
			ok: false,
			invalid: true,
			message: TOKEN_INVALID
		});
		expect(eve.calls).toEqual([]);
		expect(stored(env).token_status).toBe('invalid');
		expect(stored(env).last_error).toMatch(/^SSO_APP_UNKNOWN: .*retired-client/);
	});

	it('invalid_grant marks the token invalid with the reason', async () => {
		const { env, character } = await pilot();
		const result = await getAccessToken(asEnv(env), character, fakeEve({ token: { status: 400 } }).fetch);
		expect(result).toEqual({ ok: false, invalid: true, message: TOKEN_INVALID });
		expect(stored(env).token_status).toBe('invalid');
		expect(stored(env).last_error).toMatch(/invalid_grant/);
	});

	it('a token that does not decrypt is invalid; other SSO failures only record the error', async () => {
		const { env, character } = await pilot();
		const wrongKey = { ...character, refreshTokenEnc: 'garbage' };
		expect(await getAccessToken(asEnv(env), wrongKey, fakeEve().fetch)).toMatchObject({ invalid: true });
		expect(stored(env).token_status).toBe('invalid');

		const again = await pilot();
		const down = vi.fn(async () => new Response('bad gateway', { status: 502 }));
		expect(await getAccessToken(asEnv(again.env), again.character, down)).toEqual({
			ok: false,
			invalid: false,
			message: TOKEN_UNAVAILABLE
		});
		expect(stored(again.env).token_status).toBe('ok');
		expect(stored(again.env).last_error).toMatch(/502/);
	});

	it('makes no request for characters without a working token', async () => {
		const { env, character } = await pilot();
		const eve = fakeEve();
		for (const c of [
			{ ...character, tokenStatus: 'invalid' },
			{ ...character, refreshTokenEnc: null }
		]) {
			expect(await getAccessToken(asEnv(env), c, eve.fetch)).toMatchObject({ ok: false, invalid: true });
		}
		expect(eve.calls).toEqual([]);
	});
});
