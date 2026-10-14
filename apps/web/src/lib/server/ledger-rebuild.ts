import { sql } from 'drizzle-orm';
import { getCoreDb } from '@reactions/db';
import type { UpdaterApi } from './updater.ts';

/**
 * After a change that alters a user's ledger (tracking settings, a switch, wallet divisions, a price
 * correction): marks the ledger dirty, then asks the updater to rebuild it now. The mark comes first so
 * the change is never lost: a rebuild that loaded its rows before the change cannot clear it, and when
 * the updater is missing, fails or does not answer, the next cron tick (every 10 minutes) rebuilds it.
 * `rebuilt: true` only when the new results are already stored (the rebuild then cleared the mark).
 */
export async function requestLedgerRebuild(env: Env, userId: string): Promise<{ rebuilt: boolean }> {
	await getCoreDb(env.DB).run(
		sql`INSERT INTO ledger_state (user_id, dirty) VALUES (${userId}, 1)
			ON CONFLICT (user_id) DO UPDATE SET dirty = 1`
	);
	// `wrangler types` declares the binding as an untyped `Service`; its RPC surface is `UpdaterApi`.
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	if (!updater) {
		console.error('UPDATER binding missing: ledger rebuild not started');
		return { rebuilt: false };
	}
	try {
		const result = await updater.rebuildLedger(userId);
		return { rebuilt: !('error' in result) };
	} catch (e) {
		console.error('UPDATER.rebuildLedger failed', e);
		return { rebuilt: false };
	}
}
