import { characters, getCoreDb, retryWrite } from '@reactions/db';
import {
	ERROR_INTERNAL,
	TOKEN_ERROR_APP_RETIRED,
	TOKEN_ERROR_REVOKED,
	decryptToken,
	encryptToken,
	refreshAccessToken,
	ssoCredentialsFor,
	tokenRefreshFailure
} from '@reactions/eve';
import type { TokenResponse } from '@reactions/eve';
import { eq } from 'drizzle-orm';
import { httpFetch, userAgent } from './http.ts';
import { errorMessage } from './jobs.ts';

/** The stored refresh token of a character (`characters` columns). */
export interface StoredToken {
	characterId: number;
	refreshTokenEnc: string | null;
	/** Client id of the SSO app that issued the token; `null` = the primary app. */
	ssoClientId: string | null;
}

export type AccessTokenResult =
	| { ok: true; accessToken: string }
	/**
	 * `message` is the user-facing sentence stored in `characters.last_error` (`@reactions/eve/errors`);
	 * `invalid` means the character is now `token_status = 'invalid'` and the token can never be
	 * refreshed again.
	 */
	| { ok: false; invalid: boolean; message: string };

/**
 * Refreshes a character's access token with the SSO app that issued it and stores the rotated refresh
 * token (`last_refreshed_at`, `last_error` cleared). An undecryptable token, a token of an app without
 * configured credentials (`SSO_APP_UNKNOWN`), `invalid_grant` and HTTP 401 mark the character
 * `token_status = 'invalid'`; any other SSO failure (missing primary credentials, network, SSO 5xx) only
 * records `last_error`. `last_error` only ever holds a user-facing sentence; the cause is logged.
 *
 * EVE has rotated the refresh token once SSO answered, so storing it is retried; when that keeps
 * failing the error is logged and thrown (the workflow step retries) and `last_error` is left alone.
 */
export async function refreshCharacterToken(env: Env, character: StoredToken): Promise<AccessTokenResult> {
	const db = getCoreDb(env.DB);
	const byCharacter = eq(characters.characterId, character.characterId);
	const label = `[tokens] character ${character.characterId}`;
	const fail = async (invalid: boolean, message: string, cause: unknown): Promise<AccessTokenResult> => {
		console.error(`${label}: ${invalid ? 'token is invalid' : 'refresh failed'}: ${errorMessage(cause)}`);
		await db
			.update(characters)
			.set(invalid ? { tokenStatus: 'invalid', lastError: message } : { lastError: message })
			.where(byCharacter);
		return { ok: false, invalid, message };
	};
	let refreshToken: string;
	try {
		if (character.refreshTokenEnc === null) throw new Error('no stored refresh token');
		refreshToken = await decryptToken(character.refreshTokenEnc, env.TOKEN_ENCRYPTION_KEY);
	} catch (error) {
		return fail(true, TOKEN_ERROR_REVOKED, error);
	}
	const app = ssoCredentialsFor(env, character.ssoClientId);
	if (!app.ok)
		return app.kind === 'unknown'
			? fail(true, TOKEN_ERROR_APP_RETIRED, app.message)
			: fail(false, ERROR_INTERNAL, app.message);
	let token: TokenResponse;
	try {
		token = await refreshAccessToken({
			fetch: httpFetch,
			userAgent: userAgent(env),
			clientId: app.clientId,
			clientSecret: app.clientSecret,
			refreshToken
		});
	} catch (error) {
		const failure = tokenRefreshFailure(error);
		return fail(failure.invalid, failure.message, error);
	}
	const refreshTokenEnc = await encryptToken(token.refreshToken || refreshToken, env.TOKEN_ENCRYPTION_KEY);
	try {
		await retryWrite(() =>
			db
				.update(characters)
				.set({ refreshTokenEnc, lastRefreshedAt: Date.now(), lastError: null })
				.where(byCharacter)
		);
	} catch (error) {
		console.error(`${label}: rotated refresh token not stored: ${errorMessage(error)}`);
		throw error;
	}
	return { ok: true, accessToken: token.accessToken };
}
