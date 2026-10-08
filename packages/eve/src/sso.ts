import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { FetchFn } from './esi.ts';

export const SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
export const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
export const SSO_JWKS_URL = 'https://login.eveonline.com/oauth/jwks';
export const SSO_ISSUERS = ['https://login.eveonline.com', 'login.eveonline.com'];
export const SSO_AUDIENCE = 'EVE Online';

export function buildAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	scopes: readonly string[];
	state: string;
}): string {
	const query = new URLSearchParams({
		response_type: 'code',
		redirect_uri: params.redirectUri,
		client_id: params.clientId
	});
	if (params.scopes.length) query.set('scope', params.scopes.join(' '));
	query.set('state', params.state);
	return `${SSO_AUTHORIZE_URL}?${query}`;
}

export interface TokenResponse {
	accessToken: string;
	refreshToken: string;
	/** Seconds. */
	expiresIn: number;
	tokenType: string;
}

export class SsoError extends Error {
	readonly status: number;
	/** OAuth `error` value when the server sent one. */
	readonly code: string | null;
	constructor(status: number, code: string | null, message?: string) {
		super(message ?? `EVE SSO token request failed: ${status}${code ? ` ${code}` : ''}`);
		this.name = 'SsoError';
		this.status = status;
		this.code = code;
	}
}

/** The refresh token or authorization code is no longer valid (OAuth `invalid_grant`). */
export class SsoInvalidGrantError extends SsoError {
	constructor(status: number, message?: string) {
		super(status, 'invalid_grant', message);
		this.name = 'SsoInvalidGrantError';
	}
}

interface SsoCredentials {
	fetch: FetchFn;
	userAgent: string;
	clientId: string;
	clientSecret: string;
}

async function tokenRequest(credentials: SsoCredentials, body: URLSearchParams): Promise<TokenResponse> {
	const res = await credentials.fetch(SSO_TOKEN_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': credentials.userAgent
		},
		body: body.toString()
	});
	const text = await res.text();
	let json: Record<string, unknown> = {};
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		// non-JSON error body
	}
	if (!res.ok) {
		const code = typeof json.error === 'string' ? json.error : null;
		const description = typeof json.error_description === 'string' ? json.error_description : undefined;
		if (code === 'invalid_grant') throw new SsoInvalidGrantError(res.status, description);
		throw new SsoError(res.status, code, description);
	}
	if (typeof json.access_token !== 'string')
		throw new SsoError(res.status, null, 'SSO response has no access_token');
	return {
		accessToken: json.access_token,
		refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : '',
		expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 0,
		tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer'
	};
}

export function exchangeCode(credentials: SsoCredentials & { code: string }): Promise<TokenResponse> {
	return tokenRequest(
		credentials,
		new URLSearchParams({ grant_type: 'authorization_code', code: credentials.code })
	);
}

/** Refreshes an access token; EVE rotates the refresh token, so store `refreshToken` from the result. */
export function refreshAccessToken(
	credentials: SsoCredentials & { refreshToken: string }
): Promise<TokenResponse> {
	return tokenRequest(
		credentials,
		new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken })
	);
}

/** The SSO apps a deployment holds credentials for (worker vars/secrets). */
export interface SsoAppsEnv {
	/** The app this deployment logs users in with (its tokens are stored with this client id). */
	EVE_SSO_CLIENT_ID?: string;
	EVE_SSO_CLIENT_SECRET?: string;
	/** Optional second app whose stored refresh tokens this deployment must also refresh. */
	EVE_SSO_EXTRA_CLIENT_ID?: string;
	EVE_SSO_EXTRA_CLIENT_SECRET?: string;
}

/** `last_error` prefix of a token issued by an SSO app this deployment has no credentials for. */
export const SSO_APP_UNKNOWN = 'SSO_APP_UNKNOWN';

export type SsoAppCredentials =
	| { ok: true; clientId: string; clientSecret: string }
	/**
	 * `unconfigured`: the primary app's id or secret is missing (deployment misconfiguration; the token
	 * itself may be fine). `unknown`: the token's app is not the primary app and not a configured extra
	 * app (id unknown or its secret missing); the token cannot be refreshed here.
	 */
	| { ok: false; kind: 'unconfigured' | 'unknown'; message: string };

/**
 * Credentials of the SSO app that issued a stored refresh token; `clientId` is the stored
 * `sso_client_id` (`null` = the primary app). Refresh tokens can only be refreshed by their issuing app.
 */
export function ssoCredentialsFor(env: SsoAppsEnv, clientId: string | null): SsoAppCredentials {
	const primaryId = env.EVE_SSO_CLIENT_ID ?? '';
	if (clientId === null || clientId === primaryId) {
		if (!primaryId || !env.EVE_SSO_CLIENT_SECRET)
			return {
				ok: false,
				kind: 'unconfigured',
				message: 'Token refresh needs EVE_SSO_CLIENT_ID and EVE_SSO_CLIENT_SECRET'
			};
		return { ok: true, clientId: primaryId, clientSecret: env.EVE_SSO_CLIENT_SECRET };
	}
	if (clientId === env.EVE_SSO_EXTRA_CLIENT_ID && env.EVE_SSO_EXTRA_CLIENT_SECRET)
		return { ok: true, clientId, clientSecret: env.EVE_SSO_EXTRA_CLIENT_SECRET };
	return {
		ok: false,
		kind: 'unknown',
		message: `${SSO_APP_UNKNOWN}: token issued by EVE SSO app ${clientId}, which this deployment has no credentials for`
	};
}

export interface VerifiedCharacter {
	characterId: number;
	name: string;
	scopes: string[];
	ownerHash: string;
}

/** Remote JWKS per User-Agent (one per worker in practice). */
const remoteJwks = new Map<string, JWTVerifyGetKey>();

function jwksFor(userAgent: string): JWTVerifyGetKey {
	let jwks = remoteJwks.get(userAgent);
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(SSO_JWKS_URL), { headers: { 'User-Agent': userAgent } });
		remoteJwks.set(userAgent, jwks);
	}
	return jwks;
}

/** Verifies an EVE SSO access token (signature, issuer, expiry, audience `clientId` + `EVE Online`). */
export async function verifyAccessToken(
	jwt: string,
	clientId: string,
	options: { userAgent: string; getKey?: JWTVerifyGetKey; currentDate?: Date }
): Promise<VerifiedCharacter> {
	const getKey = options.getKey ?? jwksFor(options.userAgent);
	const { payload } = await jwtVerify(jwt, getKey, {
		issuer: SSO_ISSUERS,
		currentDate: options.currentDate,
		requiredClaims: ['sub', 'exp']
	});
	const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
	if (!audience.includes(clientId) || !audience.includes(SSO_AUDIENCE)) {
		throw new Error('EVE SSO token audience mismatch');
	}
	const match = /^CHARACTER:EVE:(\d+)$/.exec(payload.sub ?? '');
	if (!match) throw new Error('EVE SSO token subject is not a character');
	const scp = payload.scp;
	const scopes = Array.isArray(scp) ? scp.map(String) : typeof scp === 'string' ? [scp] : [];
	return {
		characterId: Number(match[1]),
		name: typeof payload.name === 'string' ? payload.name : '',
		scopes,
		ownerHash: typeof payload.owner === 'string' ? payload.owner : ''
	};
}
