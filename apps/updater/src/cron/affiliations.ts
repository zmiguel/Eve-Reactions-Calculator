import { fetchAffiliations, fetchNames } from '@reactions/eve';
import {
	AFFILIATION_ACTIVE_DAYS,
	AFFILIATION_END_MINUTE_UTC,
	AFFILIATION_START_MINUTE_UTC
} from '../config.ts';
import { DAY_MS } from '../dates.ts';
import { esiClient } from '../http.ts';
import { failJobRun, finishJobRun, inlineRunId, startJobRun } from '../jobs.ts';

/**
 * Writes one JSON array of `{ id, c, cn, a, an }` into `characters` in a single statement. A name ESI
 * did not resolve (`null`) keeps the stored name while the id is unchanged.
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
 * Cron step 6: once a day (the tick in 12:20–12:29 UTC), the corporation and alliance of every character
 * of an account seen in the last 30 days: `POST /characters/affiliation` and `POST /universe/names`, up
 * to 100 ids per request. Characters in a chunk ESI refuses keep their previous values. Every run is a
 * `job_runs` row (kind `affiliations`; `partial` when ESI refused a chunk); skipped ticks write none. A
 * `manual` run (admin RPC) ignores the schedule. Returns the log line fragment.
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

		const rows = affiliations.items.map((a) => ({
			id: a.characterId,
			c: a.corporationId,
			cn: nameOf.get(a.corporationId) ?? null,
			a: a.allianceId,
			an: a.allianceId ? (nameOf.get(a.allianceId) ?? null) : null
		}));
		if (rows.length > 0) await env.DB.prepare(UPDATE_SQL).bind(JSON.stringify(rows), now).run();

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
			...(refused.length ? { refused } : {})
		});
		return (
			`${rows.length} of ${results.length} characters updated (${corporations} corporations, ${alliances} alliances)` +
			(refused.length ? `; refused chunks: ${refused.join(', ')}` : '')
		);
	} catch (error) {
		await failJobRun(env, runId, 'affiliations', now, error);
		throw error;
	}
}
