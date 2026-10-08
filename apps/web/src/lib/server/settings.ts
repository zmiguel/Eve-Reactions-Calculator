import { getCoreDb, users } from '@reactions/db';
import {
	DEFAULT_SETTINGS,
	Settings,
	decodeSettings,
	encodeSettings,
	isDefaultSettings,
	storedSettings
} from '@reactions/engine';
import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { SETTINGS_COOKIE, deleteCookie, setSettingsCookie } from './cookies.ts';
import { convertLegacySettings, takeLegacyCookies } from './legacy-cookies.ts';
import type { LoadedSession } from './session.ts';

/**
 * `users.settings_json` → settings. The column holds the sparse diff from the defaults (older rows may
 * hold a full object); both are merged onto the current defaults. `null` when missing or invalid.
 */
export function parseStoredSettings(json: string | null): Settings | null {
	if (!json) return null;
	try {
		const parsed = Settings.safeParse(JSON.parse(json));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** Settings from the `rc_settings` cookie; an undecodable cookie is deleted and `null` returned. */
export async function cookieSettings(cookies: Cookies): Promise<Settings | null> {
	const raw = cookies.get(SETTINGS_COOKIE);
	if (!raw) return null;
	const decoded = await decodeSettings(raw);
	if (!decoded) deleteCookie(cookies, SETTINGS_COOKIE);
	return decoded;
}

/** Stores the sparse diff (see `storedSettings`) on the account. */
export async function writeAccountSettings(env: Env, userId: string, settings: Settings, now = Date.now()) {
	await getCoreDb(env.DB)
		.update(users)
		.set({ settingsJson: JSON.stringify(storedSettings(settings)), settingsUpdatedAt: now })
		.where(eq(users.userId, userId));
}

/**
 * The browser's settings: the `rc_settings` cookie; without one, the settings of the v2 site's
 * cookies (`legacy`), written to `rc_settings` unless they equal the defaults.
 */
async function browserSettings(
	env: Env | undefined,
	cookies: Cookies,
	legacy: ReadonlyMap<string, string>
): Promise<Settings | null> {
	if (!env || legacy.size === 0 || cookies.get(SETTINGS_COOKIE)) return cookieSettings(cookies);
	const converted = await convertLegacySettings(env, legacy);
	if (isDefaultSettings(converted)) return null;
	setSettingsCookie(cookies, await encodeSettings(converted));
	return converted;
}

/**
 * Logged in: the account's settings win; an account without valid settings adopts the browser's
 * settings (or defaults) and stores them. Anonymous: the browser's settings, else defaults. The v2
 * site's cookies are deleted on every request carrying them; they are converted only when this
 * browser has no `rc_settings` cookie and no account settings apply.
 */
export async function resolveSettings(
	env: Env | undefined,
	cookies: Cookies,
	session: LoadedSession | null,
	now = Date.now()
): Promise<Settings> {
	const legacy = takeLegacyCookies(cookies);
	if (env && session) {
		const stored = parseStoredSettings(session.settingsJson);
		if (stored) return stored;
		const adopted = (await browserSettings(env, cookies, legacy)) ?? DEFAULT_SETTINGS;
		await writeAccountSettings(env, session.user.userId, adopted, now);
		return adopted;
	}
	return (await browserSettings(env, cookies, legacy)) ?? DEFAULT_SETTINGS;
}

/** Writes `settings` to the `rc_settings` cookie as the sparse diff; the defaults delete the cookie. */
async function writeSettingsCookie(cookies: Cookies, settings: Settings): Promise<void> {
	if (isDefaultSettings(settings)) deleteCookie(cookies, SETTINGS_COOKIE);
	else setSettingsCookie(cookies, await encodeSettings(settings));
}

/**
 * Saves settings to the `rc_settings` cookie and, when logged in, to the account (the cookie is still
 * written so the device keeps them after logging out). Settings equal to the defaults delete the cookie.
 *
 * The cookie is a functional preference cookie set only on an explicit save/reset/import by the
 * visitor, or once from the preferences the visitor saved on the v2 site (see `resolveSettings`), so it
 * needs no consent banner. It carries the sparse diff from the defaults only.
 */
export async function persistSettings(
	env: Env | undefined,
	cookies: Cookies,
	userId: string | null,
	settings: Settings,
	now = Date.now()
): Promise<void> {
	await writeSettingsCookie(cookies, settings);
	if (env && userId) await writeAccountSettings(env, userId, settings, now);
}

/**
 * On login: an account without (valid) settings adopts this browser's `rc_settings` cookie (or the
 * defaults); an account with settings overwrites the cookie, so the device shows the account's settings.
 */
export async function adoptSettingsOnLogin(env: Env, cookies: Cookies, userId: string, now = Date.now()) {
	const [row] = await getCoreDb(env.DB)
		.select({ settingsJson: users.settingsJson })
		.from(users)
		.where(eq(users.userId, userId));
	const stored = parseStoredSettings(row?.settingsJson ?? null);
	if (stored) await writeSettingsCookie(cookies, stored);
	else await writeAccountSettings(env, userId, (await cookieSettings(cookies)) ?? DEFAULT_SETTINGS, now);
}
