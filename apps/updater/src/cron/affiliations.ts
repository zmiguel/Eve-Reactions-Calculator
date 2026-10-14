import { affiliationTraits, fetchAffiliations, fetchNames } from '@reactions/eve';
import {
	AFFILIATION_ACTIVE_DAYS,
	AFFILIATION_END_MINUTE_UTC,
	AFFILIATION_START_MINUTE_UTC
} from '../config.ts';
import { DAY_MS } from '../dates.ts';
import { esiClient } from '../http.ts';
import { failJobRun, finishJobRun, inlineRunId, startJobRun } from '../jobs.ts';
import { pushAffiliationTraits } from '../rybbit.ts';
import type { RybbitPushResult, TraitUpdate } from '../rybbit.ts';

/** One looked-up affiliation: character `id`, corporation `c`/`cn`, alliance `a`/`an` (names `null` = unknown). */
export interface AffiliationRow {
	id: number;
	c: number;
	cn: string | null;
	a: number | null;
	an: string | null;
}

/**
 * Writes one JSON array of `AffiliationRow` into `characters` in a single statement. A name ESI did not
 * resolve (`null`) keeps the stored name while the id is unchanged.
 */
const UPDATE_SQL = `
	UPDATE characters SET
		corporation_id = json_extract(j.value, '$.c'),
		corporation_name = COALESCE(
			json_extract(j.value, '$.cn'),
			CASE WHEN corporation_id = json_extract(j.value, '$.c') THEN corporation_name END
		),
		alliance_id = json_extract(j.value, '$.a'),
		alliance_name = COALESCE(
			json_extract(j.value, '$.an'),
			CASE WHEN alliance_id = json_extract(j.value, '$.a') THEN alliance_name END
		),
		affiliation_updated_at = ?2
	FROM json_each(?1) AS j
	WHERE characters.character_id = json_extract(j.value, '$.id')`;

/**
 * Stored names of the main characters (first `created_at`, then `character_id`, per account; the web's
 * Rybbit identity uses them) among the characters of the `AffiliationRow` JSON array `?1`.
 */
const MAIN_NAMES_SQL = `
	SELECT c.user_id, c.corporation_name AS cn, c.alliance_name AS an, c.alliance_id AS ai
	FROM characters c
	WHERE c.character_id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
		AND c.character_id = (
			SELECT m.character_id FROM characters m WHERE m.user_id = c.user_id
			ORDER BY m.created_at, m.character_id LIMIT 1
		)
	ORDER BY c.user_id`;

interface MainNames {
	user_id: string;
	cn: string | null;
	an: string | null;
	ai: number | null;
}

/**
 * Stores looked-up affiliations on `characters` (`affiliation_updated_at` = `now`); shared with the
 * inventory and tracking syncs. Accounts whose main character's Rybbit traits (`affiliationTraits`)
 * changed get them pushed to Rybbit; `all` (the manual back-fill) pushes every account whose main
 * character is in `rows`, changed or not. Never fails because of Rybbit.
 */
export async function writeAffiliations(
	env: Env,
	rows: AffiliationRow[],
	now: number,
	all = false
): Promise<RybbitPushResult> {
	if (rows.length === 0) return { sent: 0, failed: 0 };
	const json = JSON.stringify(rows);
	const [before, , after] = await env.DB.batch<MainNames>([
		env.DB.prepare(MAIN_NAMES_SQL).bind(json),
		env.DB.prepare(UPDATE_SQL).bind(json, now),
		env.DB.prepare(MAIN_NAMES_SQL).bind(json)
	]);
	const previous = new Map(
		before!.results.map((r) => [r.user_id, affiliationTraits(r.cn, r.an, r.ai)] as const)
	);
	const updates: TraitUpdate[] = [];
	for (const r of after!.results) {
		const traits = affiliationTraits(r.cn, r.an, r.ai);
		const old = previous.get(r.user_id);
		if (all || old?.corporation !== traits.corporation || old.alliance !== traits.alliance)
			updates.push({ userId: r.user_id, traits });
	}
	return pushAffiliationTraits(env, updates);
}

/**
 * Cron step 6: once a day (the tick in 12:20–12:29 UTC), the corporation and alliance of every character
 * of an account seen in the last 30 days: `POST /characters/affiliation` and `POST /universe/names`, up
 * to 100 ids per request. Characters in a chunk ESI refuses keep their previous values. Every run is a
 * `job_runs` row (kind `affiliations`; `partial` when ESI refused a chunk); skipped ticks write none. A
 * `manual` run (admin RPC) ignores the schedule. Accounts whose main character's traits changed are
 * pushed to Rybbit; a `manual` run pushes every covered account (back-fill). Returns the log line fragment.
 */
export async function refreshAffiliations(
	env: Env,
	scheduledTime: number,
	now: number,
	manual = false
): Promise<string> {
	const at = new Date(scheduledTime);
	const minuteOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
	if (!manual && (minuteOfDay < AFFILIATION_START_MINUTE_UTC || minuteOfDay > AFFILIATION_END_MINUTE_UTC))
		return 'skipped (daily at 12:20 UTC)';
	const runId = inlineRunId('affiliations', now, manual);
	try {
		await startJobRun(env, runId, 'affiliations', now);
		const { results } = await env.DB.prepare(
			'SELECT c.character_id FROM characters c JOIN users u USING (user_id) WHERE u.last_seen_at > ?'
		)
			.bind(now - AFFILIATION_ACTIVE_DAYS * DAY_MS)
			.all<{ character_id: number }>();

		const client = esiClient(env);
		const affiliations = await fetchAffiliations(
			client,
			results.map((r) => r.character_id)
		);
		const groupIds = affiliations.items.flatMap((a) =>
			a.allianceId ? [a.corporationId, a.allianceId] : [a.corporationId]
		);
		const names = await fetchNames(client, groupIds);
		const nameOf = new Map(names.items.map((n) => [n.id, n.name]));

		const rows: AffiliationRow[] = affiliations.items.map((a) => ({
			id: a.characterId,
			c: a.corporationId,
			cn: nameOf.get(a.corporationId) ?? null,
			a: a.allianceId,
			an: a.allianceId ? (nameOf.get(a.allianceId) ?? null) : null
		}));
		const rybbit = await writeAffiliations(env, rows, now, manual);
		const pushed = rybbit.sent + rybbit.failed > 0;

		const corporations = new Set(rows.map((r) => r.c)).size;
		const alliances = new Set(rows.flatMap((r) => (r.a ? [r.a] : []))).size;
		const refused = [...affiliations.failedChunks, ...names.failedChunks].map(
			(f) => `${f.ids.length} ids HTTP ${f.status}`
		);
		await finishJobRun(env, runId, refused.length ? 'partial' : 'ok', {
			characters: results.length,
			updated: rows.length,
			corporations,
			alliances,
			...(refused.length ? { refused } : {}),
			...(pushed ? { rybbit } : {})
		});
		return (
			`${rows.length} of ${results.length} characters updated (${corporations} corporations, ${alliances} alliances)` +
			(refused.length ? `; refused chunks: ${refused.join(', ')}` : '') +
			(pushed ? `; rybbit: ${rybbit.sent} sent, ${rybbit.failed} failed` : '')
		);
	} catch (error) {
		await failJobRun(env, runId, 'affiliations', now, error);
		throw error;
	}
}
