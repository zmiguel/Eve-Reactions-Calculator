import { getCoreDb, trackedContracts } from '@reactions/db';
import { parseJaniceCodes } from '@reactions/eve';
import { and, eq, sql } from 'drizzle-orm';
import { requestLedgerRebuild } from './ledger-rebuild.ts';
import type { ContractJaniceResult, UpdaterApi } from './updater.ts';

/**
 * A contract's Janice appraisal comes from the first Janice link of its title (stored by the tracking
 * sync), or from a link the user gave on the ledger: then `tracked_contracts.janice_code` differs from
 * the title's code. The sync never writes a stored contract again, so the user's code stays.
 */
export function isUserJanice(title: string | null, janiceCode: string | null): boolean {
	return janiceCode !== null && janiceCode !== (parseJaniceCodes(title)[0] ?? null);
}

/** Parses the `ref` form field (`contract:<contractId>`); null when malformed. */
export function parseContractRef(ref: unknown): number | null {
	if (typeof ref !== 'string' || !/^contract:\d+$/.test(ref)) return null;
	const id = Number(ref.slice('contract:'.length));
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type ContractJaniceOutcome =
	{ ok: true; rebuilt: boolean } | { ok: false; status: 400 | 404 | 502 | 503; message: string };

const NOT_FOUND = 'That contract is not in your ledger.';
const NOT_A_LINK = 'Enter a Janice appraisal link, like https://janice.e-351.com/a/AbCdEf.';
const UNKNOWN = 'Janice has no appraisal at that link.';
const FAILED = 'The appraisal could not be fetched. Try again later.';
const UNAVAILABLE = 'Janice appraisals are not available right now.';

/** Notice after a Janice appraisal was applied to or removed from a contract. */
export function contractJaniceNotice(applied: boolean, rebuilt: boolean): string {
	const what = applied ? 'Janice appraisal applied.' : 'Your Janice appraisal was removed.';
	return rebuilt ? `${what} Results recalculated.` : `${what} Results are recalculated within 10 minutes.`;
}

async function contractOf(env: Env, userId: string, contractId: number) {
	const [row] = await getCoreDb(env.DB)
		.select({ title: trackedContracts.title, janiceCode: trackedContracts.janiceCode })
		.from(trackedContracts)
		.where(and(eq(trackedContracts.userId, userId), eq(trackedContracts.contractId, contractId)))
		.limit(1);
	return row ?? null;
}

/**
 * Prices the user's contract by the Janice appraisal linked in `link` (the first link when there are
 * several). The updater holds the Janice API key: it fetches the appraisal, stores it on the contract
 * and rebuilds the ledger (`UpdaterApi.setContractJanice`); nothing changes when the fetch fails.
 */
export async function applyContractJanice(
	env: Env,
	userId: string,
	contractId: number,
	link: unknown
): Promise<ContractJaniceOutcome> {
	const code = parseJaniceCodes(typeof link === 'string' ? link : '')[0];
	if (!code) return { ok: false, status: 400, message: NOT_A_LINK };
	if (!(await contractOf(env, userId, contractId))) return { ok: false, status: 404, message: NOT_FOUND };
	// `wrangler types` declares the binding as an untyped `Service`; its RPC surface is `UpdaterApi`.
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	if (!updater) {
		console.error('UPDATER binding missing: Janice appraisal not fetched');
		return { ok: false, status: 503, message: UNAVAILABLE };
	}
	let result: ContractJaniceResult;
	try {
		result = await updater.setContractJanice(userId, contractId, code);
	} catch (e) {
		console.error('UPDATER.setContractJanice failed', e);
		return { ok: false, status: 502, message: FAILED };
	}
	if (!('error' in result)) return { ok: true, rebuilt: result.rebuilt };
	switch (result.error) {
		case 'missing':
			return { ok: false, status: 404, message: NOT_FOUND };
		case 'unavailable':
			return { ok: false, status: 503, message: UNAVAILABLE };
		case 'unknown':
			return { ok: false, status: 400, message: UNKNOWN };
		case 'failed':
			return { ok: false, status: 502, message: FAILED };
	}
}

/**
 * Removes the appraisal the user gave a contract: the contract goes back to the first Janice link of
 * its title (with the appraisal another contract of the user has for it, else none yet: the tracking
 * sync fetches it), or to no appraisal (the contract price rule). 404 when the user gave none.
 */
export async function removeContractJanice(
	env: Env,
	userId: string,
	contractId: number
): Promise<ContractJaniceOutcome> {
	const contract = await contractOf(env, userId, contractId);
	if (!contract) return { ok: false, status: 404, message: NOT_FOUND };
	if (!isUserJanice(contract.title, contract.janiceCode)) {
		return { ok: false, status: 404, message: 'This contract has no appraisal of yours to remove.' };
	}
	const titleCode = parseJaniceCodes(contract.title)[0] ?? null;
	const json =
		titleCode === null
			? null
			: sql`(SELECT janice_json FROM tracked_contracts
				WHERE user_id = ${userId} AND janice_code = ${titleCode} AND contract_id <> ${contractId}
					AND janice_json IS NOT NULL LIMIT 1)`;
	await getCoreDb(env.DB)
		.update(trackedContracts)
		.set({ janiceCode: titleCode, janiceJson: json })
		.where(and(eq(trackedContracts.userId, userId), eq(trackedContracts.contractId, contractId)));
	return { ok: true, ...(await requestLedgerRebuild(env, userId)) };
}
