import { characters, getCoreDb } from '@reactions/db';
import { createEsiClient, fetchAffiliations, fetchNames, type FetchFn } from '@reactions/eve';
import { and, eq, isNull } from 'drizzle-orm';
import { userAgent } from './user-agent.ts';

/** Affiliation columns of `characters` as one public ESI lookup fills them. */
export interface StoredAffiliation {
	corporationId: number;
	corporationName: string;
	allianceId: number | null;
	allianceName: string | null;
	affiliationUpdatedAt: number;
}

/** Longest a login waits for the affiliation lookup of its new characters (both ESI calls). */
export const LOGIN_AFFILIATION_TIMEOUT_MS = 3000;

/**
 * Corporation and alliance of `characterIds` by one public ESI bulk lookup (`/characters/affiliation` +
 * `/universe/names`), stored on `characters` like the updater's daily affiliations job. Characters ESI
 * does not answer for, or whose corporation has no name, are left as they are; an ESI failure (or
 * `timeoutMs` running out across both calls, which then get no retries) writes nothing. Never throws.
 */
export async function lookUpAffiliations(
	env: Env,
	fetch: FetchFn,
	characterIds: readonly number[],
	now: number,
	options: { timeoutMs?: number } = {}
): Promise<Map<number, StoredAffiliation>> {
	const found = new Map<number, StoredAffiliation>();
	if (characterIds.length === 0) return found;
	try {
		const { timeoutMs } = options;
		const signal = timeoutMs === undefined ? null : AbortSignal.timeout(timeoutMs);
		const client = createEsiClient({
			fetch: signal ? (input, init) => fetch(input, { ...init, signal }) : fetch,
			userAgent: userAgent(env),
			...(signal && { attempts: 1 })
		});
		const affiliations = (await fetchAffiliations(client, characterIds)).items;
		const ids = affiliations.flatMap((a) =>
			a.allianceId === null ? [a.corporationId] : [a.corporationId, a.allianceId]
		);
		const names = new Map(
			ids.length === 0 ? [] : (await fetchNames(client, ids)).items.map((n) => [n.id, n.name])
		);
		for (const a of affiliations) {
			const corporationName = names.get(a.corporationId);
			if (!corporationName) continue;
			found.set(a.characterId, {
				corporationId: a.corporationId,
				corporationName,
				allianceId: a.allianceId,
				allianceName: a.allianceId === null ? null : (names.get(a.allianceId) ?? null),
				affiliationUpdatedAt: now
			});
		}
	} catch {
		return new Map();
	}
	try {
		const db = getCoreDb(env.DB);
		for (const [characterId, affiliation] of found) {
			await db.update(characters).set(affiliation).where(eq(characters.characterId, characterId));
		}
	} catch {
		// Not stored: the daily affiliations job looks them up again; the caller still gets the lookup.
	}
	return found;
}

/**
 * At login: looks up (bounded by {@link LOGIN_AFFILIATION_TIMEOUT_MS}) the characters of `userId`'s
 * account never looked up yet (`affiliation_updated_at` null), so the first page after the login sends
 * the right analytics traits. Whatever ESI does not answer stays for the daily affiliations job. Never
 * throws: a database failure only skips the lookup.
 */
export async function lookUpNewAffiliations(
	env: Env,
	fetch: FetchFn,
	userId: string,
	now: number
): Promise<void> {
	let characterIds: number[];
	try {
		const rows = await getCoreDb(env.DB)
			.select({ characterId: characters.characterId })
			.from(characters)
			.where(and(eq(characters.userId, userId), isNull(characters.affiliationUpdatedAt)));
		characterIds = rows.map((r) => r.characterId);
	} catch {
		return;
	}
	await lookUpAffiliations(env, fetch, characterIds, now, { timeoutMs: LOGIN_AFFILIATION_TIMEOUT_MS });
}
