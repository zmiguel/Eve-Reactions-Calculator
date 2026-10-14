import { characters, getCoreDb, structureLinks, users } from '@reactions/db';
import {
	encryptToken,
	formatScopes,
	grantedFeatures,
	missingScopes,
	type GrantableFeature,
	type VerifiedCharacter
} from '@reactions/eve';
import type { Cookies } from '@sveltejs/kit';
import { asc, eq, type SQL } from 'drizzle-orm';
import { createSession, endSession, type SessionUser } from '../session.ts';
import { adoptSettingsOnLogin } from '../settings.ts';
import { releaseStructureHubs } from '../structures.ts';
import { applyFeatureChange, heldFeatures } from './feature-change.ts';
import { safeReturnTo, type LoginFlow } from './oauth.ts';

export type CharacterRow = typeof characters.$inferSelect;

export type LoginResult = { ok: true; location: string } | { ok: false; status: 400 | 409; message: string };

export const LINKED_ELSEWHERE =
	'This character is linked to another account. Log in with it to use that account.';
export const SESSION_ENDED = 'Your session has ended. Log in and try again.';
export const NOT_YOUR_CHARACTER = 'That character is not on your account.';

/**
 * `returnTo` (re-checked with `safeReturnTo`) with the `/account` notice of a permissions change:
 * `notice=permissions`, the character and the features added and removed (comma-separated).
 */
export function permissionsNoticeLocation(
	returnTo: string,
	characterId: number,
	added: readonly GrantableFeature[],
	removed: readonly GrantableFeature[]
): string {
	const url = new URL(safeReturnTo(returnTo), 'https://notice.invalid');
	url.searchParams.set('notice', 'permissions');
	url.searchParams.set('characterId', String(characterId));
	url.searchParams.set('added', added.join(','));
	url.searchParams.set('removed', removed.join(','));
	return url.pathname + url.search + url.hash;
}

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

/** Pool members of source `inventory_sources` row other than `?2`, all of account `?1`. */
const OTHER_POOL_MEMBERS = `
	FROM inventory_source_readers r
	JOIN characters c ON c.character_id = r.character_id
	WHERE r.source_id = inventory_sources.source_id AND r.character_id <> ?2 AND c.user_id = ?1`;

/**
 * Corporation sources of account `?1` preferring character `?2` (only source `?3` unless NULL) move to
 * another member of their reader pool: a working token first, then a known membership of the
 * corporation (unknown before another corporation), then the order they were added. A source without
 * another pool member keeps `?2`.
 */
const HAND_OVER_SQL = `
	UPDATE inventory_sources SET character_id = (
		SELECT r.character_id ${OTHER_POOL_MEMBERS}
		ORDER BY c.token_status = 'ok' DESC,
			CASE WHEN c.corporation_id = inventory_sources.owner_id THEN 0 WHEN c.corporation_id IS NULL THEN 1 ELSE 2 END,
			r.created_at, r.character_id
		LIMIT 1
	)
	WHERE user_id = ?1 AND character_id = ?2 AND kind = 'corporation' AND (?3 IS NULL OR source_id = ?3)
		AND EXISTS (SELECT 1 ${OTHER_POOL_MEMBERS})`;

/**
 * Hands the corporation sources character `characterId` of account `userId` prefers (only `sourceId`
 * when given) to another member of their reader pool (`HAND_OVER_SQL`); never to a character outside
 * the pool or of another account.
 */
export function handOverPreferredReader(
	env: Env,
	userId: string,
	characterId: number,
	sourceId: number | null = null
): D1PreparedStatement {
	return env.DB.prepare(HAND_OVER_SQL).bind(userId, characterId, sourceId);
}

/**
 * Deletes a character (its structure links, pool memberships and personal inventory cascade; corporation
 * inventories it prefers move to another member of their reader pool first, `handOverPreferredReader`,
 * and cascade away without one). An account left without characters can no longer be logged into, so it
 * is deleted too (`accountDeleted`).
 */
export async function removeCharacter(
	env: Env,
	characterId: number
): Promise<{ userId: string; accountDeleted: boolean } | null> {
	const character = await getCharacter(env, characterId);
	if (!character) return null;
	const db = getCoreDb(env.DB);
	const structureIds = await linkedStructureIds(env, eq(structureLinks.characterId, characterId));
	await env.DB.batch([
		handOverPreferredReader(env, character.userId, characterId),
		env.DB.prepare('DELETE FROM characters WHERE character_id = ?').bind(characterId)
	]);
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
 * - `feature` with an expected character, and `features`, reject any other character before touching data.
 * - A stored character whose owner hash changed (the character was sold/transferred) is removed first
 *   and the login continues as for a new character.
 * - `login`: the character's account, else the session's account, else a new account; creates a session
 *   and syncs settings between the account and the `rc_settings` cookie.
 * - `add_character`: attaches the character to the session's account (scope-less, no token).
 * - `feature`: stores the encrypted refresh token and the granted scopes on the character (attaching it
 *   to the session's account when new). Refuses grants that would drop scopes the character has.
 * - `features`: the session account's own character only. Stores the token and exactly the granted
 *   scopes (fewer than before is the point; none = no token), cleans up what removed features drove
 *   (`applyFeatureChange`) and returns with the `permissions` notice.
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

	const expectsCharacter =
		flow.purpose === 'features' || (flow.purpose === 'feature' && flow.characterId !== null);
	if (expectsCharacter && verified.characterId !== flow.characterId) {
		const expected = user?.characters.find((c) => c.characterId === flow.characterId)?.name;
		return {
			ok: false,
			status: 400,
			message: expected
				? `You logged in as ${verified.name} but were changing the permissions of ${expected}. Nothing was changed: try again and pick ${expected} on the EVE login screen.`
				: `You logged in as ${verified.name} but were changing the permissions of another character. Nothing was changed: try again and pick that character on the EVE login screen.`
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

	/** The stored token and scopes of this login (no scopes: no token). */
	const grantOf = async () => {
		if (verified.scopes.length === 0) {
			return {
				name: verified.name,
				scopes: '',
				refreshTokenEnc: null,
				ssoClientId: null,
				tokenStatus: 'none',
				lastRefreshedAt: null,
				lastError: null
			};
		}
		if (!refreshToken) return null;
		if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
		return {
			name: verified.name,
			scopes: formatScopes(verified.scopes),
			refreshTokenEnc: await encryptToken(refreshToken, env.TOKEN_ENCRYPTION_KEY),
			// Refresh tokens can only be refreshed by the app that issued them: this deployment's.
			ssoClientId: env.EVE_SSO_CLIENT_ID,
			tokenStatus: 'ok',
			lastRefreshedAt: now,
			lastError: null
		};
	};
	const NO_REFRESH_TOKEN = 'EVE SSO returned no refresh token.';

	if (flow.purpose === 'features') {
		if (!existing) return { ok: false, status: 400, message: NOT_YOUR_CHARACTER };
		const grant = await grantOf();
		if (!grant) return { ok: false, status: 400, message: NO_REFRESH_TOKEN };
		await db.update(characters).set(grant).where(eq(characters.characterId, existing.characterId));
		const before = heldFeatures(existing.scopes);
		const after = grantedFeatures(verified.scopes);
		await applyFeatureChange(env, existing.userId, existing.characterId, before, after);
		return {
			ok: true,
			location: permissionsNoticeLocation(
				flow.returnTo,
				existing.characterId,
				after.filter((f) => !before.includes(f)),
				before.filter((f) => !after.includes(f))
			)
		};
	}

	if (flow.purpose === 'feature') {
		const dropped = missingScopes(existing?.scopes, verified.scopes);
		if (dropped.length) {
			return {
				ok: false,
				status: 400,
				message: `This login grants fewer permissions than ${verified.name} already has (${dropped.join(', ')}), so it was not saved. Use the Permissions button on your account page for this character.`
			};
		}
		const grant = verified.scopes.length && refreshToken ? await grantOf() : null;
		if (!grant) return { ok: false, status: 400, message: NO_REFRESH_TOKEN };
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
