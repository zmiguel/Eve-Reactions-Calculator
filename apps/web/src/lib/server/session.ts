import { characters, getCoreDb, userSessions, users } from '@reactions/db';
import { GRANTABLE_FEATURES, grantedFeatures, type GrantableFeature } from '@reactions/eve';
import type { Cookies } from '@sveltejs/kit';
import { and, asc, eq, gt } from 'drizzle-orm';
import { SESSION_COOKIE, SESSION_MAX_AGE, deleteCookie, setSessionCookie } from './cookies.ts';
import { randomToken, sha256Hex } from './crypto.ts';

export const DAY_MS = 86_400_000;
const SESSION_TTL_MS = SESSION_MAX_AGE * 1000;
const RENEW_BELOW_MS = 15 * DAY_MS;
const LAST_SEEN_RESOLUTION_MS = 3_600_000;

export interface SessionUser {
	userId: string;
	/** Character the session logged in with; the account's first character when that one was removed. */
	characterId: number | null;
	characters: { characterId: number; name: string }[];
	isAdmin: boolean;
}

/** Account facts for the analytics identity, read by the same queries as the session. */
export interface AccountFacts {
	createdAt: number;
	/** Features granted to at least one of the account's characters, in registry order. */
	features: GrantableFeature[];
	/** Main (first) character's corporation and alliance; null until the updater's daily refresh. */
	corporation: string | null;
	alliance: string | null;
}

export interface LoadedSession {
	user: SessionUser;
	account: AccountFacts;
	settingsJson: string | null;
}

export function adminCharacterIds(env: Pick<Env, 'ADMIN_CHARACTER_IDS'>): Set<number> {
	return new Set(
		(env.ADMIN_CHARACTER_IDS ?? '')
			.split(',')
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isInteger(n) && n > 0)
	);
}

/**
 * Resolves the `rc_session` cookie to a user. Unknown/expired sessions clear the cookie; sessions with
 * less than 15 days left are extended to 30 days; `last_seen_at` is refreshed at most hourly.
 */
export async function loadSession(
	env: Env,
	cookies: Cookies,
	now = Date.now()
): Promise<LoadedSession | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const db = getCoreDb(env.DB);
	const sessionHash = await sha256Hex(token);
	const [row] = await db
		.select({
			userId: users.userId,
			expiresAt: userSessions.expiresAt,
			characterId: userSessions.characterId,
			lastSeenAt: users.lastSeenAt,
			createdAt: users.createdAt,
			settingsJson: users.settingsJson
		})
		.from(userSessions)
		.innerJoin(users, eq(users.userId, userSessions.userId))
		.where(and(eq(userSessions.sessionHash, sessionHash), gt(userSessions.expiresAt, now)));
	if (!row) {
		deleteCookie(cookies, SESSION_COOKIE);
		return null;
	}
	if (row.expiresAt - now < RENEW_BELOW_MS) {
		await db
			.update(userSessions)
			.set({ expiresAt: now + SESSION_TTL_MS })
			.where(eq(userSessions.sessionHash, sessionHash));
		setSessionCookie(cookies, token);
	}
	if (now - row.lastSeenAt > LAST_SEEN_RESOLUTION_MS) {
		await db.update(users).set({ lastSeenAt: now }).where(eq(users.userId, row.userId));
	}
	const chars = await db
		.select({
			characterId: characters.characterId,
			name: characters.name,
			scopes: characters.scopes,
			corporation: characters.corporationName,
			alliance: characters.allianceName
		})
		.from(characters)
		.where(eq(characters.userId, row.userId))
		.orderBy(asc(characters.createdAt), asc(characters.characterId));
	const admins = adminCharacterIds(env);
	const granted = new Set(chars.flatMap((c) => grantedFeatures(c.scopes)));
	return {
		user: {
			userId: row.userId,
			characterId: row.characterId ?? chars[0]?.characterId ?? null,
			characters: chars.map((c) => ({ characterId: c.characterId, name: c.name })),
			isAdmin: chars.some((c) => admins.has(c.characterId))
		},
		account: {
			createdAt: row.createdAt,
			features: GRANTABLE_FEATURES.filter((f) => granted.has(f)),
			corporation: chars[0]?.corporation ?? null,
			alliance: chars[0]?.alliance ?? null
		},
		settingsJson: row.settingsJson
	};
}

/** Creates a session row for `userId` (logged in as `characterId`) and sets the `rc_session` cookie. */
export async function createSession(
	env: Env,
	cookies: Cookies,
	userId: string,
	characterId: number | null,
	now = Date.now()
): Promise<void> {
	const token = randomToken();
	await getCoreDb(env.DB)
		.insert(userSessions)
		.values({
			sessionHash: await sha256Hex(token),
			userId,
			characterId,
			createdAt: now,
			expiresAt: now + SESSION_TTL_MS
		});
	setSessionCookie(cookies, token);
}

/** Deletes the session row of the `rc_session` cookie (if any) and expires the cookie. */
export async function endSession(env: Env, cookies: Cookies): Promise<void> {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await getCoreDb(env.DB)
			.delete(userSessions)
			.where(eq(userSessions.sessionHash, await sha256Hex(token)));
	}
	deleteCookie(cookies, SESSION_COOKIE);
}
