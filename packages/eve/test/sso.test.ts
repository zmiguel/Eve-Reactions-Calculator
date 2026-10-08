import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	STRUCTURE_SCOPES,
	SsoError,
	SsoInvalidGrantError,
	buildAuthorizeUrl,
	exchangeCode,
	refreshAccessToken,
	verifyAccessToken
} from '../src/index.ts';
import type { JWTVerifyGetKey } from 'jose';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

describe('buildAuthorizeUrl', () => {
	it('builds the v2 authorize URL with scopes', () => {
		const url = new URL(
			buildAuthorizeUrl({
				clientId: 'client-1',
				redirectUri: 'http://localhost:5173/auth/callback',
				scopes: STRUCTURE_SCOPES,
				state: 'st4te'
			})
		);
		expect(url.origin + url.pathname).toBe('https://login.eveonline.com/v2/oauth/authorize');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: 'code',
			redirect_uri: 'http://localhost:5173/auth/callback',
			client_id: 'client-1',
			scope:
				'esi-markets.structure_markets.v1 esi-universe.read_structures.v1 esi-search.search_structures.v1',
			state: 'st4te'
		});
	});

	it('omits scope for plain login', () => {
		const url = new URL(
			buildAuthorizeUrl({ clientId: 'c', redirectUri: 'https://x/cb', scopes: [], state: 's' })
		);
		expect(url.searchParams.has('scope')).toBe(false);
	});
});

describe('token requests', () => {
	const tokenBody = { access_token: 'at', refresh_token: 'rt2', expires_in: 1199, token_type: 'Bearer' };

	it('exchangeCode posts the code with Basic auth', async () => {
		const { fetch, calls } = fakeFetch(() => json(tokenBody));
		const res = await exchangeCode({
			fetch,
			userAgent: TEST_UA,
			clientId: 'id',
			clientSecret: 'secret',
			code: 'abc'
		});
		expect(res).toEqual({ accessToken: 'at', refreshToken: 'rt2', expiresIn: 1199, tokenType: 'Bearer' });
		expect(calls[0].url).toBe('https://login.eveonline.com/v2/oauth/token');
		expect(calls[0].method).toBe('POST');
		expect(calls[0].headers.get('Authorization')).toBe(`Basic ${btoa('id:secret')}`);
		expect(calls[0].headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
		expect(Object.fromEntries(new URLSearchParams(calls[0].body!))).toEqual({
			grant_type: 'authorization_code',
			code: 'abc'
		});
	});

	it('refreshAccessToken posts the refresh token', async () => {
		const { fetch, calls } = fakeFetch(() => json(tokenBody));
		const res = await refreshAccessToken({
			fetch,
			userAgent: TEST_UA,
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'rt1'
		});
		expect(res.refreshToken).toBe('rt2');
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
		expect(Object.fromEntries(new URLSearchParams(calls[0].body!))).toEqual({
			grant_type: 'refresh_token',
			refresh_token: 'rt1'
		});
	});

	it('surfaces invalid_grant as SsoInvalidGrantError', async () => {
		const { fetch } = fakeFetch(() =>
			json({ error: 'invalid_grant', error_description: 'Invalid refresh token.' }, { status: 400 })
		);
		const promise = refreshAccessToken({
			fetch,
			userAgent: TEST_UA,
			clientId: 'id',
			clientSecret: 's',
			refreshToken: 'old'
		});
		await expect(promise).rejects.toBeInstanceOf(SsoInvalidGrantError);
		await expect(promise).rejects.toMatchObject({ status: 400, code: 'invalid_grant' });
	});

	it('other failures are SsoError with status', async () => {
		const { fetch } = fakeFetch(() => new Response('oops', { status: 500 }));
		const promise = exchangeCode({ fetch, userAgent: TEST_UA, clientId: 'id', clientSecret: 's', code: 'c' });
		await expect(promise).rejects.toBeInstanceOf(SsoError);
		await expect(promise).rejects.not.toBeInstanceOf(SsoInvalidGrantError);
		await expect(promise).rejects.toMatchObject({ status: 500, code: null });
	});
});

describe('verifyAccessToken', () => {
	let privateKey: CryptoKey;
	let getKey: JWTVerifyGetKey;
	const now = new Date('2026-10-06T12:00:00Z');
	const nowSec = Math.floor(now.getTime() / 1000);

	beforeAll(async () => {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey;
		const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'JWT-Signature-Key', alg: 'RS256', use: 'sig' };
		getKey = createLocalJWKSet({ keys: [jwk] });
	});

	function sign(claims: { aud?: string[]; exp?: number; iss?: string; scp?: string | string[] }) {
		const jwt = new SignJWT({
			scp: claims.scp ?? ['esi-markets.structure_markets.v1', 'esi-universe.read_structures.v1'],
			name: 'Oxed G',
			owner: 'owner-hash=',
			tenant: 'tranquility'
		})
			.setProtectedHeader({ alg: 'RS256', kid: 'JWT-Signature-Key', typ: 'JWT' })
			.setSubject('CHARACTER:EVE:90000001')
			.setIssuer(claims.iss ?? 'https://login.eveonline.com')
			.setAudience(claims.aud ?? ['client-1', 'EVE Online'])
			.setIssuedAt(nowSec - 60)
			.setExpirationTime(claims.exp ?? nowSec + 1200);
		return jwt.sign(privateKey);
	}

	it('accepts a valid token and returns the character', async () => {
		const res = await verifyAccessToken(await sign({}), 'client-1', {
			userAgent: TEST_UA,
			getKey,
			currentDate: now
		});
		expect(res).toEqual({
			characterId: 90000001,
			name: 'Oxed G',
			scopes: ['esi-markets.structure_markets.v1', 'esi-universe.read_structures.v1'],
			ownerHash: 'owner-hash='
		});
	});

	it('accepts the bare issuer and a single-string scope', async () => {
		const res = await verifyAccessToken(
			await sign({ iss: 'login.eveonline.com', scp: 'publicData' }),
			'client-1',
			{
				userAgent: TEST_UA,
				getKey,
				currentDate: now
			}
		);
		expect(res.scopes).toEqual(['publicData']);
	});

	it('rejects a token for another client', async () => {
		await expect(
			verifyAccessToken(await sign({ aud: ['client-2', 'EVE Online'] }), 'client-1', {
				userAgent: TEST_UA,
				getKey,
				currentDate: now
			})
		).rejects.toThrow(/audience/);
	});

	it('rejects a token without the EVE Online audience', async () => {
		await expect(
			verifyAccessToken(await sign({ aud: ['client-1'] }), 'client-1', {
				userAgent: TEST_UA,
				getKey,
				currentDate: now
			})
		).rejects.toThrow(/audience/);
	});

	it('rejects an expired token', async () => {
		await expect(
			verifyAccessToken(await sign({ exp: nowSec - 10 }), 'client-1', {
				userAgent: TEST_UA,
				getKey,
				currentDate: now
			})
		).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
	});

	it('rejects a foreign issuer', async () => {
		await expect(
			verifyAccessToken(await sign({ iss: 'https://evil.example' }), 'client-1', {
				userAgent: TEST_UA,
				getKey,
				currentDate: now
			})
		).rejects.toMatchObject({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED' });
	});
});
