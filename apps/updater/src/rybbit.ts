import { RYBBIT_ORIGIN } from '@reactions/eve';
import { errorMessage } from './jobs.ts';
import { RYBBIT_CONCURRENCY, RYBBIT_TIMEOUT_MS } from './config.ts';
import { httpFetch, userAgent } from './http.ts';
import { forEachConcurrent } from './pool.ts';

/** New traits of one Rybbit user (`users.user_id`, the id the web identifies with). */
export interface TraitUpdate {
	userId: string;
	traits: { corporation: string; alliance: string };
}

export interface RybbitPushResult {
	sent: number;
	failed: number;
}

/**
 * Merges `traits` into the Rybbit profile of every account (`POST /api/identify` with
 * `is_new_identify: false`: no alias, the given traits overwrite the stored ones). Only when
 * `RYBBIT_SITE_ID` (wrangler.jsonc var) is not empty: `.dev.vars` sets it empty locally, so local
 * accounts never reach the production Rybbit. Never throws: failures are counted and logged without
 * user ids or names.
 */
export async function pushAffiliationTraits(env: Env, updates: TraitUpdate[]): Promise<RybbitPushResult> {
	const result: RybbitPushResult = { sent: 0, failed: 0 };
	const siteId = env.RYBBIT_SITE_ID;
	if (typeof siteId !== 'string' || siteId === '' || updates.length === 0) return result;
	const headers = { 'Content-Type': 'application/json', 'User-Agent': userAgent(env) };
	const errors = new Map<string, number>();
	await forEachConcurrent(updates, RYBBIT_CONCURRENCY, async ({ userId, traits }) => {
		let error: string;
		try {
			const res = await httpFetch(`${RYBBIT_ORIGIN}/api/identify`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ site_id: siteId, user_id: userId, traits, is_new_identify: false }),
				signal: AbortSignal.timeout(RYBBIT_TIMEOUT_MS)
			});
			await res.body?.cancel();
			if (res.ok) {
				result.sent++;
				return;
			}
			error = `HTTP ${res.status}`;
		} catch (e) {
			error = errorMessage(e);
		}
		result.failed++;
		errors.set(error, (errors.get(error) ?? 0) + 1);
	});
	if (result.failed > 0)
		console.error(
			`[rybbit] ${result.failed} of ${updates.length} trait updates failed: ${[...errors]
				.map(([e, n]) => `${n}× ${e}`)
				.join(', ')}`
		);
	return result;
}
