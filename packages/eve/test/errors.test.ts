import { describe, expect, it } from 'vitest';
import {
	ERROR_INTERNAL,
	SsoError,
	SsoInvalidGrantError,
	TOKEN_ERROR_APP_RETIRED,
	TOKEN_ERROR_REVOKED,
	TOKEN_ERROR_SSO_DOWN,
	tokenErrorHttp,
	tokenRefreshFailure,
	userFacingError
} from '../src/index.ts';

/** The text the account page showed (owner report). */
const REPORTED =
	'character 96440041: Error: Failed query: update "characters" set "refresh_token_enc" = ?, "last_refreshed_at" = ?, "last_error" = ? where "characters"."character_id" = ? params: djEuYWJjZGVm,1791830022248,,96440041';

describe('userFacingError', () => {
	it('keeps user sentences and reader notes', () => {
		for (const text of [
			TOKEN_ERROR_REVOKED,
			TOKEN_ERROR_APP_RETIRED,
			TOKEN_ERROR_SSO_DOWN,
			tokenErrorHttp(400),
			ERROR_INTERNAL,
			'sync did not finish',
			'Industry jobs not readable: Corp Pilot needs the Factory Manager role',
			'No character can read Reaction Corp: Corp Pilot needs the Director role; Outsider is not in the corporation',
			'ESI answered HTTP 503 for assets page 2; the next sync tries again.',
			'too many assets (501 pages, the limit is 500)'
		])
			expect(userFacingError(text)).toBe(text);
		expect(userFacingError(null)).toBeNull();
	});

	it('replaces database, exception and stack texts with the generic sentence', () => {
		for (const text of [
			REPORTED,
			'D1_ERROR: database is locked',
			'SQLITE_CONSTRAINT: UNIQUE constraint failed',
			'TypeError: fetch failed',
			'Error: workflows unavailable',
			'boom\n    at refresh (tokens.ts:12:3)',
			'character 1001: structure market HTTP 403',
			'SSO_APP_UNKNOWN: token issued by EVE SSO app retired-app',
			'x'.repeat(401)
		])
			expect(userFacingError(text)).toBe(ERROR_INTERNAL);
	});
});

describe('tokenRefreshFailure', () => {
	it('maps SSO failures to user sentences', () => {
		expect(tokenRefreshFailure(new SsoInvalidGrantError(400, 'Invalid refresh token'))).toEqual({
			invalid: true,
			message: TOKEN_ERROR_REVOKED
		});
		expect(tokenRefreshFailure(new SsoError(401, null))).toEqual({
			invalid: true,
			message: TOKEN_ERROR_REVOKED
		});
		expect(tokenRefreshFailure(new SsoError(403, 'invalid_client'))).toEqual({
			invalid: false,
			message: tokenErrorHttp(403)
		});
		expect(tokenRefreshFailure(new SsoError(502, null))).toEqual({
			invalid: false,
			message: TOKEN_ERROR_SSO_DOWN
		});
		expect(tokenRefreshFailure(new TypeError('fetch failed'))).toEqual({
			invalid: false,
			message: TOKEN_ERROR_SSO_DOWN
		});
	});
});
