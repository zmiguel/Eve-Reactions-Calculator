import { fetchJaniceAppraisal } from '@reactions/eve';
import { httpFetch, userAgent } from './http.ts';
import { errorMessage } from './jobs.ts';
import { markLedgerDirty, rebuildLedger } from './ledger.ts';

/**
 * Outcome of `setContractJanice`: `rebuilt` once the ledger already shows the new prices (false: it is
 * marked dirty and rebuilt at the next cron tick). `missing`: no such contract of the user;
 * `unavailable`: no `JANICE_API_KEY`; `unknown`: Janice has no appraisal with that code (404);
 * `failed`: any other failure (status, network, timeout, invalid body).
 */
export type ContractJaniceResult =
	{ rebuilt: boolean } | { error: 'missing' | 'unavailable' | 'unknown' | 'failed' };

/**
 * Prices the user's contract `contractId` by the Janice appraisal `code` the user gave: fetches it and
 * stores code and appraisal on that contract only, then rebuilds the ledger. Nothing is stored unless the
 * fetch succeeded. The tracking sync never replaces it: stored contracts are never written again
 * (`ON CONFLICT DO NOTHING`), and the `janice` step only fills contracts of a code without a valid
 * appraisal. The code is never logged.
 */
export async function setContractJanice(
	env: Env,
	userId: string,
	contractId: number,
	code: string
): Promise<ContractJaniceResult> {
	const found = await env.DB.prepare(
		'SELECT 1 AS found FROM tracked_contracts WHERE user_id = ?1 AND contract_id = ?2'
	)
		.bind(userId, contractId)
		.first();
	if (!found) return { error: 'missing' };
	if (!env.JANICE_API_KEY) return { error: 'unavailable' };
	const res = await fetchJaniceAppraisal(
		httpFetch,
		{ apiKey: env.JANICE_API_KEY, userAgent: userAgent(env) },
		code
	);
	if (!res.ok) {
		console.error(`[janice] appraisal for contract ${contractId} failed (status ${res.status})`);
		return { error: res.status === 404 ? 'unknown' : 'failed' };
	}
	await env.DB.prepare(
		'UPDATE tracked_contracts SET janice_code = ?3, janice_json = ?4 WHERE user_id = ?1 AND contract_id = ?2'
	)
		.bind(userId, contractId, code, JSON.stringify(res.appraisal))
		.run();
	await markLedgerDirty(env, userId);
	try {
		await rebuildLedger(env, userId, Date.now());
		return { rebuilt: true };
	} catch (error) {
		console.error(`[janice] ledger rebuild after a contract appraisal failed: ${errorMessage(error)}`);
		return { rebuilt: false };
	}
}
