import { env } from 'cloudflare:workers';
import { TOKEN_ERROR_SSO_DOWN, decryptToken, encryptToken } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { refreshCharacterToken } from '../src/tokens.ts';
import { installFetch, json, resetState } from './helpers.ts';

const CHARACTER = 1001;
const D1_FAILURE = 'D1_ERROR: database is locked: SQLITE_BUSY';

async function seedCharacter() {
	const refreshTokenEnc = await encryptToken('rt-1', env.TOKEN_ENCRYPTION_KEY);
	await env.DB.batch([
		env.DB.prepare("INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('u1', 1, 1)"),
		env.DB.prepare(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, scopes, refresh_token_enc, token_status,
				last_refreshed_at, last_error, created_at)
			VALUES (?, 'u1', 'Pilot', 'hash', '', ?, 'ok', 100, 'EVE Online did not answer; it will be retried.', 1)`
		).bind(CHARACTER, refreshTokenEnc)
	]);
	return { characterId: CHARACTER, refreshTokenEnc, ssoClientId: null };
}

function stored() {
	return env.DB.prepare(
		'SELECT token_status, refresh_token_enc, last_refreshed_at, last_error FROM characters WHERE character_id = ?'
	)
		.bind(CHARACTER)
		.first<{
			token_status: string;
			refresh_token_enc: string;
			last_refreshed_at: number;
			last_error: string | null;
		}>();
}

/** `env` whose D1 fails the first `failures` writes of a rotated refresh token. */
function failingTokenWrites(failures: number): Env {
	let left = failures;
	const db = new Proxy(env.DB, {
		get(target, key) {
			if (key !== 'prepare') return Reflect.get(target, key);
			return (query: string) => {
				if (!/^update "characters" set "refresh_token_enc"/.test(query) || left-- <= 0)
					return target.prepare(query);
				const fail = () => Promise.reject(new Error(D1_FAILURE));
				return { bind: () => ({ run: fail, all: fail, raw: fail, first: fail }) };
			};
		}
	});
	return new Proxy(env, { get: (target, key) => (key === 'DB' ? db : Reflect.get(target, key)) });
}

describe('refreshCharacterToken', () => {
	let logged: MockInstance<typeof console.error>;
	beforeEach(async () => {
		await resetState();
		logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const sso = (answer: () => Response) =>
		installFetch((url) =>
			url.hostname === 'login.eveonline.com' ? answer() : new Response('unexpected', { status: 500 })
		);

	it('retries storing the rotated refresh token after a failed write', async () => {
		const character = await seedCharacter();
		sso(() => json({ access_token: 'at-1', refresh_token: 'rt-2', expires_in: 1199 }));

		expect(await refreshCharacterToken(failingTokenWrites(1), character)).toEqual({
			ok: true,
			accessToken: 'at-1'
		});

		const row = await stored();
		expect(row?.last_error).toBeNull();
		expect(row?.last_refreshed_at).toBeGreaterThan(100);
		expect(await decryptToken(row!.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY)).toBe('rt-2');
	});

	it('throws when the rotated token cannot be stored, without writing the error to last_error', async () => {
		const character = await seedCharacter();
		sso(() => json({ access_token: 'at-1', refresh_token: 'rt-2', expires_in: 1199 }));

		// Drizzle wraps the D1 error as `Failed query: … params: …`, the text that must never reach users.
		await expect(refreshCharacterToken(failingTokenWrites(3), character)).rejects.toThrow('Failed query');

		expect(await stored()).toMatchObject({
			token_status: 'ok',
			last_refreshed_at: 100,
			last_error: 'EVE Online did not answer; it will be retried.'
		});
		expect(logged.mock.calls.flat().join(' ')).toContain(`character ${CHARACTER}`);
	});

	it('stores a user-facing sentence when EVE SSO answers 5xx', async () => {
		const character = await seedCharacter();
		await env.DB.prepare('UPDATE characters SET last_error = NULL').run();
		sso(() => new Response('bad gateway', { status: 502 }));

		expect(await refreshCharacterToken(env, character)).toEqual({
			ok: false,
			invalid: false,
			message: TOKEN_ERROR_SSO_DOWN
		});
		expect(await stored()).toMatchObject({ token_status: 'ok', last_error: TOKEN_ERROR_SSO_DOWN });
	});
});
