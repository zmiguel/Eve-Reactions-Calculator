import { GRANTABLE_FEATURES, type GrantableFeature } from '@reactions/eve';
import { z } from 'zod';
import { base64UrlToBytes, bytesToBase64Url, hmacKey } from '../crypto.ts';

export const LOGIN_PURPOSES = ['login', 'add_character', 'feature'] as const;
export type LoginPurpose = (typeof LOGIN_PURPOSES)[number];

/** What the SSO round trip is for; carried in the signed `rc_oauth` cookie. */
export const LoginFlow = z.object({
	purpose: z.enum(LOGIN_PURPOSES),
	/** `purpose=feature` only. */
	feature: z.enum(GRANTABLE_FEATURES as [GrantableFeature, ...GrantableFeature[]]).nullable(),
	/** Character being upgraded (`purpose=feature`); the callback rejects any other character. */
	characterId: z.number().int().positive().nullable(),
	returnTo: z.string()
});
export type LoginFlow = z.infer<typeof LoginFlow>;

const OauthPayload = LoginFlow.extend({ state: z.string().min(16), exp: z.number() });
type OauthPayload = z.infer<typeof OauthPayload>;

const encoder = new TextEncoder();

/** A same-site path to return to: must start with `/` but not `//` or `/\` (both mean another host). */
export function safeReturnTo(value: string | null | undefined, fallback = '/account'): string {
	if (!value || !value.startsWith('/') || value[1] === '/' || value[1] === '\\') return fallback;
	// Control characters (e.g. a tab inside `/\t/evil`) are stripped by URL parsers; refuse them.
	const hasControl = [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
	return hasControl ? fallback : value;
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
		const { purpose, feature, characterId, returnTo } = parsed.data;
		return { purpose, feature, characterId, returnTo: safeReturnTo(returnTo) };
	} catch {
		return null;
	}
}
