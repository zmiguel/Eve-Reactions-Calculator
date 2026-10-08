/**
 * EVE SSO doubles for `web-unit` tests: a locally generated RS256 key (served as the JWKS), signed access
 * tokens, a fake token endpoint and the env vars/secrets the auth routes need. Never calls EVE Online.
 */
import type { SessionUser } from '$lib/server/session';
import type { SsoDeps } from '$lib/server/auth/sso';
import { STRUCTURE_SCOPES, encryptToken, formatScopes } from '@reactions/eve';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { fakeEnv, type FakeD1, type FakeEnv } from './fakes.ts';

export const CLIENT_ID = 'test-client';
/** base64 of 32 bytes 0..31 / 32..63. */
export const SESSION_SECRET = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
export const TOKEN_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 32)));

export function ssoEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
	return fakeEnv({
		EVE_SSO_CLIENT_ID: CLIENT_ID,
		EVE_SSO_CLIENT_SECRET: 'test-secret',
		EVE_SSO_CALLBACK_URL: 'https://reactions.coalition.space/auth/callback',
		SESSION_SECRET,
		TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
		...overrides
	});
}

export interface TokenCharacter {
	characterId: number;
	name: string;
	ownerHash?: string;
	scopes?: string[];
}

export interface FakeSso {
	/** Deps whose token endpoint answers with an access token for `character`. */
	deps(character: TokenCharacter, opts?: { refreshToken?: string; status?: number }): SsoDeps;
	/** Token requests made (form bodies). */
	requests: URLSearchParams[];
}

export async function fakeSso(now: number): Promise<FakeSso> {
	const pair = await generateKeyPair('RS256');
	const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'JWT-Signature-Key', alg: 'RS256', use: 'sig' };
	const getKey = createLocalJWKSet({ keys: [jwk] });
	const requests: URLSearchParams[] = [];
	const sign = (c: TokenCharacter) =>
		new SignJWT({ scp: c.scopes ?? [], name: c.name, owner: c.ownerHash ?? `hash-${c.characterId}` })
			.setProtectedHeader({ alg: 'RS256', kid: 'JWT-Signature-Key' })
			.setSubject(`CHARACTER:EVE:${c.characterId}`)
			.setIssuer('https://login.eveonline.com')
			.setAudience([CLIENT_ID, 'EVE Online'])
			.setExpirationTime(Math.floor(now / 1000) + 1200)
			.sign(pair.privateKey);
	return {
		requests,
		deps(character, opts = {}) {
			return {
				getKey,
				now: () => now,
				fetch: async (_input, init) => {
					requests.push(new URLSearchParams(String(init?.body)));
					if (opts.status && opts.status >= 400) {
						return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: opts.status });
					}
					return Response.json({
						access_token: await sign(character),
						refresh_token: opts.refreshToken ?? 'refresh-token-1',
						expires_in: 1199,
						token_type: 'Bearer'
					});
				}
			};
		}
	};
}

/** `locals.user` for a stored account. */
export function sessionUser(
	userId: string,
	characters: { characterId: number; name: string }[],
	isAdmin = false
): SessionUser {
	return { userId, characterId: characters[0]?.characterId ?? null, characters, isAdmin };
}

/** Gives a stored character the structure-market scopes and an encrypted refresh token (`TOKEN_KEY`). */
export async function grantStructures(
	db: FakeD1,
	characterId: number,
	refreshToken = 'refresh-0',
	scopes: readonly string[] = STRUCTURE_SCOPES
) {
	db.sqlite
		.prepare(
			"UPDATE characters SET scopes = ?, refresh_token_enc = ?, token_status = 'ok' WHERE character_id = ?"
		)
		.run(formatScopes(scopes), await encryptToken(refreshToken, TOKEN_KEY), characterId);
}

export interface EveAnswers {
	/** Token endpoint: HTTP status (≥ 400 answers `invalid_grant`) and the rotated refresh token. */
	token?: { status?: number; refreshToken?: string };
	/** `/characters/{id}/search`: structure ids, or an HTTP status. */
	search?: number[] | number;
	/** `/universe/structures/{id}`: info, or an HTTP status (unlisted ids → 404). */
	structures?: Record<number, { name: string; solarSystemId: number } | number>;
	/** `/markets/structures/{id}` status (default 200). */
	markets?: Record<number, number>;
	/**
	 * Public `/universe/systems|constellations|regions/{id}` answers keyed by system id, or an HTTP status
	 * for the system request. The fake constellation id of a system is its system id. Unlisted ids → 404.
	 */
	systems?: Record<
		number,
		{ name: string; securityStatus: number; regionId: number; regionName: string } | number
	>;
}

/** Fake EVE SSO token endpoint + ESI for the structure-market routes; records every requested URL. */
export function fakeEve(answers: EveAnswers = {}) {
	const calls: { url: string; body: string | null; auth: string | null }[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const headers = new Headers(init?.headers);
		calls.push({
			url: url.href,
			body: init?.body ? String(init.body) : null,
			auth: headers.get('Authorization')
		});
		if (url.host === 'login.eveonline.com') {
			const status = answers.token?.status ?? 200;
			if (status >= 400) return Response.json({ error: 'invalid_grant' }, { status });
			return Response.json({
				access_token: 'access-1',
				refresh_token: answers.token?.refreshToken ?? 'refresh-1',
				expires_in: 1199,
				token_type: 'Bearer'
			});
		}
		const path = url.pathname;
		if (/^\/characters\/\d+\/search$/.test(path)) {
			const search = answers.search ?? [];
			return typeof search === 'number'
				? Response.json({ error: 'nope' }, { status: search })
				: Response.json({ structure: search });
		}
		const info = /^\/universe\/structures\/(\d+)$/.exec(path);
		if (info) {
			const answer = answers.structures?.[Number(info[1])] ?? 404;
			return typeof answer === 'number'
				? Response.json({ error: 'nope' }, { status: answer })
				: Response.json({
						name: answer.name,
						solar_system_id: answer.solarSystemId,
						owner_id: 1,
						type_id: 35832
					});
		}
		const system = /^\/universe\/systems\/(\d+)$/.exec(path);
		if (system) {
			const answer = answers.systems?.[Number(system[1])] ?? 404;
			return typeof answer === 'number'
				? Response.json({ error: 'nope' }, { status: answer })
				: Response.json({
						system_id: Number(system[1]),
						name: answer.name,
						constellation_id: Number(system[1]),
						security_status: answer.securityStatus
					});
		}
		const constellation = /^\/universe\/constellations\/(\d+)$/.exec(path);
		if (constellation) {
			const answer = answers.systems?.[Number(constellation[1])];
			return typeof answer === 'object'
				? Response.json({ constellation_id: Number(constellation[1]), name: 'C', region_id: answer.regionId })
				: Response.json({ error: 'nope' }, { status: 404 });
		}
		const region = /^\/universe\/regions\/(\d+)$/.exec(path);
		if (region) {
			const answer = Object.values(answers.systems ?? {}).find(
				(s) => typeof s === 'object' && s.regionId === Number(region[1])
			);
			return typeof answer === 'object'
				? Response.json({ region_id: answer.regionId, name: answer.regionName })
				: Response.json({ error: 'nope' }, { status: 404 });
		}
		const market = /^\/markets\/structures\/(\d+)$/.exec(path);
		if (market) {
			const status = answers.markets?.[Number(market[1])] ?? 200;
			return status === 200
				? Response.json([], { headers: { 'X-Pages': '1' } })
				: Response.json({ error: 'nope' }, { status });
		}
		return new Response('unexpected request', { status: 418 });
	};
	return { fetch, calls };
}
