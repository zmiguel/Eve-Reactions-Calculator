import { exchangeCode, verifyAccessToken } from '@reactions/eve';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { OAUTH_COOKIE, deleteCookie } from '../cookies.ts';
import { userAgent } from '../user-agent.ts';
import { completeLogin } from './accounts.ts';
import { readOauthState } from './oauth.ts';

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

/** Outbound dependencies of the callback; tests inject a fake token endpoint and a local JWKS key. */
export interface SsoDeps {
	fetch: typeof fetch;
	getKey?: NonNullable<Parameters<typeof verifyAccessToken>[2]>['getKey'];
	now?: () => number;
}

const defaultDeps: SsoDeps = { fetch: (input, init) => fetch(input, init) };

/**
 * `GET /auth/callback`: verifies the signed `rc_oauth` cookie against the returned `state` (one use: the
 * cookie is always cleared), exchanges the code, verifies the access token and applies the login.
 * Failures render the auth error page; success redirects to the flow's `returnTo`.
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
	redirect(303, result.location);
}
