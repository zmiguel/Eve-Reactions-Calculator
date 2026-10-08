import { characters, getCoreDb } from '@reactions/db';
import {
	SsoError,
	SsoInvalidGrantError,
	decryptToken,
	encryptToken,
	refreshAccessToken,
	ssoCredentialsFor,
	type FetchFn
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
 * stored (encrypted with `TOKEN_ENCRYPTION_KEY`, the key the updater uses too). A token that cannot be
 * decrypted, was issued by an app this deployment has no credentials for (`SSO_APP_UNKNOWN`),
 * `invalid_grant` or a 401 mark the character `token_status='invalid'`; other failures only record
 * `last_error`.
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
	const markInvalid = async (reason: string) => {
		await db.update(characters).set({ tokenStatus: 'invalid', lastError: reason }).where(byCharacter);
		return { ok: false, invalid: true, message: TOKEN_INVALID } as const;
	};

	if (!app.ok) return markInvalid(app.message);
	let refreshToken: string;
	try {
		refreshToken = await decryptToken(character.refreshTokenEnc, key);
	} catch {
		return markInvalid('stored token cannot be decrypted');
	}
	try {
		const token = await refreshAccessToken({
			fetch,
			userAgent: userAgent(env),
			clientId: app.clientId,
			clientSecret: app.clientSecret,
			refreshToken
		});
		await db
			.update(characters)
			.set({
				refreshTokenEnc: await encryptToken(token.refreshToken || refreshToken, key),
				lastRefreshedAt: now,
				lastError: null
			})
			.where(byCharacter);
		return { ok: true, accessToken: token.accessToken };
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		if (e instanceof SsoInvalidGrantError || (e instanceof SsoError && e.status === 401)) {
			return markInvalid(reason);
		}
		await db.update(characters).set({ lastError: reason }).where(byCharacter);
		return { ok: false, invalid: false, message: TOKEN_UNAVAILABLE };
	}
}
