import { GRANTABLE_FEATURES, type GrantableFeature } from '@reactions/eve';
import { z } from 'zod';
import { base64UrlToBytes, bytesToBase64Url, hmacKey } from '../crypto.ts';

export const LOGIN_PURPOSES = ['login', 'add_character', 'feature', 'features'] as const;
export type LoginPurpose = (typeof LOGIN_PURPOSES)[number];

const Feature = z.enum(GRANTABLE_FEATURES as [GrantableFeature, ...GrantableFeature[]]);

/** What the SSO round trip is for; carried in the signed `rc_oauth` cookie. */
export const LoginFlow = z.object({
	purpose: z.enum(LOGIN_PURPOSES),
	/** `purpose=feature` only: the feature added to the character's grants. */
	feature: Feature.nullable(),
	/** `purpose=features` only: the character's complete feature set after the login (may be empty). */
	features: z.array(Feature).nullable().default(null),
	/**
	 * Character being upgraded (`purpose=feature`, optional) or re-granted (`purpose=features`,
	 * required); the callback rejects any other character.
	 */
	characterId: z.number().int().positive().nullable(),
	returnTo: z.string()
});
export type LoginFlow = z.infer<typeof LoginFlow>;

const OauthPayload = LoginFlow.extend({ state: z.string().min(16), exp: z.number() });
type OauthPayload = z.infer<typeof OauthPayload>;

const encoder = new TextEncoder();

const RETURN_BASE = 'https://return.invalid';

/**
 * A same-site path to return to, normalized (dot segments resolved); `fallback` for anything that is
 * not a plain absolute path or could resolve to another host: backslashes and control characters
 * (URL parsers turn them into `/` or drop them) and paths whose dot segments (also `%2e`) collapse
 * to `//`.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/account'): string {
	if (!value || !value.startsWith('/')) return fallback;
	if ([...value].some((c) => c === '\\' || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
		return fallback;
	}
	let url: URL;
	try {
		url = new URL(value, RETURN_BASE);
	} catch {
		return fallback;
	}
	if (url.origin !== RETURN_BASE || url.pathname.startsWith('//')) return fallback;
	return url.pathname + url.search + url.hash;
}

/** `rc_oauth` value: base64url(JSON payload) `.` base64url(HMAC-SHA256 over the first part). */
export async function signOauthState(secret: string, payload: OauthPayload): Promise<string> {
	const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
	return `${body}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/**
 * Verifies the `rc_oauth` cookie: signature, expiry and the `state` echoed by EVE SSO. Any mismatch
 * (missing cookie, tampering, expired, other state) → `null`.
 */
export async function readOauthState(
	secret: string,
	cookie: string | undefined,
	state: string | null,
	now = Date.now()
): Promise<LoginFlow | null> {
	if (!cookie || !state) return null;
	const [body, sig, extra] = cookie.split('.');
	if (!body || !sig || extra !== undefined) return null;
	try {
		const valid = await crypto.subtle.verify(
			'HMAC',
			await hmacKey(secret),
			base64UrlToBytes(sig),
			encoder.encode(body)
		);
		if (!valid) return null;
		const parsed = OauthPayload.safeParse(JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))));
		if (!parsed.success || parsed.data.exp <= now || parsed.data.state !== state) return null;
		const { purpose, feature, features, characterId, returnTo } = parsed.data;
		return { purpose, feature, features, characterId, returnTo: safeReturnTo(returnTo) };
	} catch {
		return null;
	}
}
