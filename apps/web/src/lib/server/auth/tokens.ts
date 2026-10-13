import { characters, getCoreDb, retryWrite } from '@reactions/db';
import {
	TOKEN_ERROR_APP_RETIRED,
	TOKEN_ERROR_REVOKED,
	decryptToken,
	encryptToken,
	refreshAccessToken,
	ssoCredentialsFor,
	tokenRefreshFailure,
	type FetchFn,
	type TokenResponse
} from '@reactions/eve';
import { eq } from 'drizzle-orm';
import type { CharacterRow } from './accounts.ts';
import { userAgent } from '../user-agent.ts';

export type AccessTokenResult =
	| { ok: true; accessToken: string }
	/** `invalid`: the stored token can no longer be used (`token_status` is now `invalid`). */
	| { ok: false; invalid: boolean; message: string };

export const TOKEN_INVALID = 'The login of this character expired. Enable structure markets for it again.';
export const TOKEN_UNAVAILABLE = 'EVE Online did not answer. Try again in a minute.';

/**
 * A fresh ESI access token for a character with a stored refresh token, refreshed with the SSO app that
 * issued it (`sso_client_id`, NULL = this deployment's app). EVE rotates refresh tokens, so the new one is
 * stored (encrypted with `TOKEN_ENCRYPTION_KEY`, the key the updater uses too); that write is retried and
 * thrown when it keeps failing. A token that cannot be decrypted, was issued by an app this deployment
 * has no credentials for (`SSO_APP_UNKNOWN`), `invalid_grant` or a 401 mark the character
 * `token_status='invalid'`; other failures only record `last_error`. `last_error` only ever holds a
 * user-facing sentence (`@reactions/eve/errors`); the cause is logged.
 */
export async function getAccessToken(
	env: Env,
	character: Pick<CharacterRow, 'characterId' | 'refreshTokenEnc' | 'tokenStatus' | 'ssoClientId'>,
	fetch: FetchFn,
	now = Date.now()
): Promise<AccessTokenResult> {
	if (character.tokenStatus !== 'ok' || !character.refreshTokenEnc) {
		return { ok: false, invalid: true, message: TOKEN_INVALID };
	}
	const key = env.TOKEN_ENCRYPTION_KEY;
	const app = ssoCredentialsFor(env, character.ssoClientId);
	if (!key || (!app.ok && app.kind === 'unconfigured')) {
		console.error('Token refresh needs TOKEN_ENCRYPTION_KEY, EVE_SSO_CLIENT_ID and EVE_SSO_CLIENT_SECRET');
		return { ok: false, invalid: false, message: TOKEN_UNAVAILABLE };
	}
	const db = getCoreDb(env.DB);
	const byCharacter = eq(characters.characterId, character.characterId);
	const label = `Token refresh of character ${character.characterId}`;
	const fail = async (invalid: boolean, lastError: string, cause: unknown): Promise<AccessTokenResult> => {
		console.error(`${label} failed${invalid ? ' (token invalid)' : ''}`, cause);
		await db
			.update(characters)
			.set(invalid ? { tokenStatus: 'invalid', lastError } : { lastError })
			.where(byCharacter);
		return invalid
			? { ok: false, invalid: true, message: TOKEN_INVALID }
			: { ok: false, invalid: false, message: TOKEN_UNAVAILABLE };
	};

	if (!app.ok) return fail(true, TOKEN_ERROR_APP_RETIRED, app.message);
	let refreshToken: string;
	try {
		refreshToken = await decryptToken(character.refreshTokenEnc, key);
	} catch (e) {
		return fail(true, TOKEN_ERROR_REVOKED, e);
	}
	let token: TokenResponse;
	try {
		token = await refreshAccessToken({
			fetch,
			userAgent: userAgent(env),
			clientId: app.clientId,
			clientSecret: app.clientSecret,
			refreshToken
		});
	} catch (e) {
		const failure = tokenRefreshFailure(e);
		return fail(failure.invalid, failure.message, e);
	}
	const refreshTokenEnc = await encryptToken(token.refreshToken || refreshToken, key);
	try {
		await retryWrite(() =>
			db.update(characters).set({ refreshTokenEnc, lastRefreshedAt: now, lastError: null }).where(byCharacter)
		);
	} catch (e) {
		console.error(`${label}: rotated refresh token not stored`, e);
		throw e;
	}
	return { ok: true, accessToken: token.accessToken };
}
