import { buildAuthorizeUrl, exchangeCode, verifyAccessToken } from '@reactions/eve';
import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { OAUTH_COOKIE, OAUTH_MAX_AGE, deleteCookie, setOauthCookie } from '../cookies.ts';
import { randomToken } from '../crypto.ts';
import { userAgent } from '../user-agent.ts';
import { lookUpNewAffiliations } from '../affiliations.ts';
import { completeLogin, getCharacter } from './accounts.ts';
import { readOauthState, signOauthState, type LoginFlow } from './oauth.ts';

export const LOGIN_EXPIRED = 'Login expired, try again.';
export const SSO_NOT_CONFIGURED = 'Logging in with EVE Online is not configured on this server.';

export interface SsoConfig {
	clientId: string;
	clientSecret: string;
	callbackUrl: string;
	sessionSecret: string;
}

/** SSO settings from vars/secrets; `null` (and a log line naming the gaps) when any is missing. */
export function ssoConfig(env: Env): SsoConfig | null {
	const config = {
		clientId: env.EVE_SSO_CLIENT_ID,
		clientSecret: env.EVE_SSO_CLIENT_SECRET ?? '',
		callbackUrl: env.EVE_SSO_CALLBACK_URL,
		sessionSecret: env.SESSION_SECRET ?? ''
	};
	const missing = Object.entries(config).filter(([, v]) => !v);
	if (!missing.length) return config;
	console.error(`EVE SSO is not configured, missing: ${missing.map(([k]) => k).join(', ')}`);
	return null;
}

/**
 * Starts an EVE SSO round trip for `flow` asking for `scopes`: sets the signed, short-lived `rc_oauth`
 * cookie (bound to a fresh `state`) and returns the authorize URL to redirect to.
 */
export async function startSso(
	config: SsoConfig,
	cookies: Cookies,
	flow: LoginFlow,
	scopes: string[]
): Promise<string> {
	const state = randomToken(16);
	const signed = await signOauthState(config.sessionSecret, {
		...flow,
		state,
		exp: Date.now() + OAUTH_MAX_AGE * 1000
	});
	setOauthCookie(cookies, signed);
	return buildAuthorizeUrl({ clientId: config.clientId, redirectUri: config.callbackUrl, scopes, state });
}

/** Outbound dependencies of the callback; tests inject a fake token endpoint and a local JWKS key. */
export interface SsoDeps {
	fetch: typeof fetch;
	getKey?: NonNullable<Parameters<typeof verifyAccessToken>[2]>['getKey'];
	now?: () => number;
}

const defaultDeps: SsoDeps = { fetch: (input, init) => fetch(input, init) };

/**
 * `GET /auth/callback`: verifies the signed `rc_oauth` cookie against the returned `state` (one use: the
 * cookie is always cleared), exchanges the code, verifies the access token and applies the login, then
 * looks up the affiliation of the account's characters never looked up (bounded; failures leave them to
 * the daily job). Failures render the auth error page; success redirects to the flow's `returnTo`.
 */
export async function handleCallback(
	event: Pick<RequestEvent, 'url' | 'cookies' | 'locals' | 'platform'>,
	deps: SsoDeps = defaultDeps
): Promise<never> {
	const { url, cookies, locals, platform } = event;
	const env = platform?.env;
	const config = env ? ssoConfig(env) : null;
	if (!env || !config) error(503, SSO_NOT_CONFIGURED);
	const now = deps.now?.() ?? Date.now();

	const raw = cookies.get(OAUTH_COOKIE);
	deleteCookie(cookies, OAUTH_COOKIE);
	const flow = await readOauthState(config.sessionSecret, raw, url.searchParams.get('state'), now);
	const code = url.searchParams.get('code');
	if (!flow || !code) error(400, LOGIN_EXPIRED);

	let verified;
	let refreshToken: string;
	try {
		const tokens = await exchangeCode({
			fetch: deps.fetch,
			userAgent: userAgent(env),
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			code
		});
		refreshToken = tokens.refreshToken;
		verified = await verifyAccessToken(tokens.accessToken, config.clientId, {
			userAgent: userAgent(env),
			getKey: deps.getKey,
			currentDate: deps.now ? new Date(now) : undefined
		});
	} catch (e) {
		console.error('EVE SSO callback failed', e);
		error(502, 'EVE Online did not confirm the login. Try again.');
	}

	const result = await completeLogin(
		{ env, cookies, user: locals.user, now },
		flow,
		verified,
		refreshToken || null
	);
	if (!result.ok) error(result.status, result.message);
	// The first page after the login identifies the account for analytics: give it the affiliation of
	// characters never looked up (new ones). Dev logins skip this and stay offline.
	const character = await getCharacter(env, verified.characterId);
	if (character) await lookUpNewAffiliations(env, deps.fetch, character.userId, now);
	redirect(303, result.location);
}
