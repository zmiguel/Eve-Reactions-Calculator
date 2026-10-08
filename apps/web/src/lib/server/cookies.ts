import type { Cookies } from '@sveltejs/kit';

export const SETTINGS_COOKIE = 'rc_settings';
export const SESSION_COOKIE = 'rc_session';
export const OAUTH_COOKIE = 'rc_oauth';
export const THEME_COOKIE = 'rc_theme';

export const SETTINGS_MAX_AGE = 31_536_000;
export const SESSION_MAX_AGE = 2_592_000;
export const OAUTH_MAX_AGE = 600;

const BASE = { path: '/', sameSite: 'lax', secure: true, httpOnly: true } as const;

export function setSettingsCookie(cookies: Cookies, value: string) {
	cookies.set(SETTINGS_COOKIE, value, { ...BASE, maxAge: SETTINGS_MAX_AGE });
}

export function setSessionCookie(cookies: Cookies, token: string) {
	cookies.set(SESSION_COOKIE, token, { ...BASE, maxAge: SESSION_MAX_AGE });
}

export function setOauthCookie(cookies: Cookies, value: string) {
	cookies.set(OAUTH_COOKIE, value, { ...BASE, maxAge: OAUTH_MAX_AGE });
}

export function deleteCookie(cookies: Cookies, name: string) {
	cookies.delete(name, BASE);
}
