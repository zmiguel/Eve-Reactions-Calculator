import { characters, getCoreDb, structureLinks, users } from '@reactions/db';
import { encryptToken, formatScopes, missingScopes, type VerifiedCharacter } from '@reactions/eve';
import type { Cookies } from '@sveltejs/kit';
import { asc, eq, type SQL } from 'drizzle-orm';
import { createSession, endSession, type SessionUser } from '../session.ts';
import { adoptSettingsOnLogin } from '../settings.ts';
import { releaseStructureHubs } from '../structures.ts';
import type { LoginFlow } from './oauth.ts';

export type CharacterRow = typeof characters.$inferSelect;

export type LoginResult = { ok: true; location: string } | { ok: false; status: 400 | 409; message: string };

export const LINKED_ELSEWHERE =
	'This character is linked to another account. Log in with it to use that account.';
export const SESSION_ENDED = 'Your session has ended. Log in and try again.';

export async function getCharacter(env: Env, characterId: number): Promise<CharacterRow | undefined> {
	const [row] = await getCoreDb(env.DB)
		.select()
		.from(characters)
		.where(eq(characters.characterId, characterId));
	return row;
}

export async function listCharacters(env: Env, userId: string): Promise<CharacterRow[]> {
	return getCoreDb(env.DB)
		.select()
		.from(characters)
		.where(eq(characters.userId, userId))
		.orderBy(asc(characters.createdAt), asc(characters.characterId));
}

/** Structure ids of the links that deleting these rows would cascade away. */
async function linkedStructureIds(env: Env, where: SQL): Promise<number[]> {
	const rows = await getCoreDb(env.DB)
		.select({ structureId: structureLinks.structureId })
		.from(structureLinks)
		.where(where);
	return rows.map((r) => r.structureId);
}

/** Deletes the user; sessions, characters and structure links cascade. */
export async function deleteAccount(env: Env, userId: string): Promise<void> {
	const structureIds = await linkedStructureIds(env, eq(structureLinks.userId, userId));
	await getCoreDb(env.DB).delete(users).where(eq(users.userId, userId));
	await releaseStructureHubs(env, structureIds);
}

/**
 * Deletes a character (its structure links cascade). An account left without characters can no longer
 * be logged into, so it is deleted too (`accountDeleted`).
 */
export async function removeCharacter(
	env: Env,
	characterId: number
): Promise<{ userId: string; accountDeleted: boolean } | null> {
	const character = await getCharacter(env, characterId);
	if (!character) return null;
	const db = getCoreDb(env.DB);
	const structureIds = await linkedStructureIds(env, eq(structureLinks.characterId, characterId));
	await db.delete(characters).where(eq(characters.characterId, characterId));
	const [remaining] = await db
		.select({ characterId: characters.characterId })
		.from(characters)
		.where(eq(characters.userId, character.userId))
		.limit(1);
	if (!remaining) await db.delete(users).where(eq(users.userId, character.userId));
	await releaseStructureHubs(env, structureIds);
	return { userId: character.userId, accountDeleted: !remaining };
}

interface LoginContext {
	env: Env;
	cookies: Cookies;
	/** Session user of the request (`locals.user`). */
	user: SessionUser | null;
	now?: number;
}

/**
 * Applies a verified EVE SSO (or dev) login:
 * - `feature` with an expected character rejects any other character before touching data.
 * - A stored character whose owner hash changed (the character was sold/transferred) is removed first
 *   and the login continues as for a new character.
 * - `login`: the character's account, else the session's account, else a new account; creates a session
 *   and syncs settings between the account and the `rc_settings` cookie.
 * - `add_character`: attaches the character to the session's account (scope-less, no token).
 * - `feature`: stores the encrypted refresh token and the granted scopes on the character (attaching it
 *   to the session's account when new). Refuses grants that would drop scopes the character has.
 */
export async function completeLogin(
	ctx: LoginContext,
	flow: LoginFlow,
	verified: VerifiedCharacter,
	refreshToken: string | null
): Promise<LoginResult> {
	const { env, cookies } = ctx;
	const now = ctx.now ?? Date.now();
	let user = ctx.user;
	const db = getCoreDb(env.DB);

	if (flow.purpose === 'feature' && flow.characterId !== null && verified.characterId !== flow.characterId) {
		const expected =
			user?.characters.find((c) => c.characterId === flow.characterId)?.name ?? `#${flow.characterId}`;
		return {
			ok: false,
			status: 400,
			message: `You logged in as ${verified.name} but were upgrading ${expected}. Nothing was changed: try again and pick ${expected} on the EVE login screen.`
		};
	}
	if (flow.purpose !== 'login' && !user) return { ok: false, status: 400, message: SESSION_ENDED };

	let existing = await getCharacter(env, verified.characterId);
	if (existing && existing.ownerHash !== verified.ownerHash) {
		const removed = await removeCharacter(env, existing.characterId);
		if (removed?.accountDeleted && removed.userId === user?.userId) user = null;
		existing = undefined;
	}
	const sessionUserId = user?.userId ?? null;
	if (flow.purpose !== 'login') {
		if (!sessionUserId) return { ok: false, status: 400, message: SESSION_ENDED };
		if (existing && existing.userId !== sessionUserId) {
			return { ok: false, status: 409, message: LINKED_ELSEWHERE };
		}
	}

	const newCharacter = {
		characterId: verified.characterId,
		name: verified.name,
		ownerHash: verified.ownerHash,
		scopes: '',
		tokenStatus: 'none',
		createdAt: now
	};

	if (flow.purpose === 'feature') {
		const dropped = missingScopes(existing?.scopes, verified.scopes);
		if (dropped.length) {
			return {
				ok: false,
				status: 400,
				message: `This login grants fewer permissions than ${verified.name} already has (${dropped.join(', ')}), so it was not saved. Use the Enable button on your account page for this character.`
			};
		}
		if (!refreshToken) return { ok: false, status: 400, message: 'EVE SSO returned no refresh token.' };
		if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
		const grant = {
			name: verified.name,
			scopes: formatScopes(verified.scopes),
			refreshTokenEnc: await encryptToken(refreshToken, env.TOKEN_ENCRYPTION_KEY),
			// Refresh tokens can only be refreshed by the app that issued them: this deployment's.
			ssoClientId: env.EVE_SSO_CLIENT_ID,
			tokenStatus: 'ok',
			lastRefreshedAt: now,
			lastError: null
		};
		await db
			.insert(characters)
			.values({ ...newCharacter, ...grant, userId: sessionUserId! })
			.onConflictDoUpdate({ target: characters.characterId, set: grant });
		return { ok: true, location: flow.returnTo };
	}

	if (existing) {
		// Character names can change; keep scopes and tokens of earlier feature grants untouched.
		await db
			.update(characters)
			.set({ name: verified.name })
			.where(eq(characters.characterId, existing.characterId));
	}

	if (flow.purpose === 'add_character') {
		if (!existing) await db.insert(characters).values({ ...newCharacter, userId: sessionUserId! });
		return { ok: true, location: flow.returnTo };
	}

	let userId = existing?.userId ?? sessionUserId;
	if (!userId) {
		userId = crypto.randomUUID();
		await db.batch([
			db.insert(users).values({ userId, createdAt: now, lastSeenAt: now }),
			db.insert(characters).values({ ...newCharacter, userId })
		]);
	} else if (!existing) {
		await db.insert(characters).values({ ...newCharacter, userId });
	}
	// A login replaces the browser's current session (possibly of another account).
	await endSession(env, cookies);
	await createSession(env, cookies, userId, verified.characterId, now);
	await adoptSettingsOnLogin(env, cookies, userId, now);
	return { ok: true, location: flow.returnTo };
}
