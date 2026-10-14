import { and, eq } from 'drizzle-orm';
import {
	getCoreDb,
	priceCorrections,
	trackedContractItems,
	trackedJobs,
	trackedTransactions
} from '@reactions/db';
import { formatNumber } from '$lib/format';
import { getDataset } from './data.ts';
import { requestLedgerRebuild } from './ledger-rebuild.ts';

/**
 * What a correction fixes; the `target_ref` formats are the ones the engine ledger reads
 * (`LedgerCorrection` in `@reactions/engine`):
 * - `transaction`: `transaction:<transactionId>` (the net unit price of a market trade);
 * - `contract_item`: `contract:<contractId>:<typeId>` (one item type of a contract; the rest of the
 *   contract total is split again over the other types);
 * - `job_input`: `job:<jobId>:<typeId>` (the unit cost of a job input that had no purchase record).
 */
export type CorrectionTarget =
	| { kind: 'transaction'; transactionId: number }
	| { kind: 'contract_item'; contractId: number; typeId: number }
	| { kind: 'job_input'; jobId: number; typeId: number };

/** The largest unit price a correction accepts (well above any EVE item). */
export const MAX_CORRECTION_PRICE = 1e13;
export const MAX_NOTE_LENGTH = 200;

export function correctionRef(target: CorrectionTarget): string {
	switch (target.kind) {
		case 'transaction':
			return `transaction:${target.transactionId}`;
		case 'contract_item':
			return `contract:${target.contractId}:${target.typeId}`;
		case 'job_input':
			return `job:${target.jobId}:${target.typeId}`;
	}
}

/** Parses the `kind` + `ref` form fields (`ref` as written by `correctionRef`); null when malformed. */
export function parseCorrectionTarget(kind: unknown, ref: unknown): CorrectionTarget | null {
	if (typeof ref !== 'string') return null;
	const ids = ref.split(':').slice(1).map(Number);
	if (ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) return null;
	if (kind === 'transaction' && /^transaction:\d+$/.test(ref)) return { kind, transactionId: ids[0] };
	if (kind === 'contract_item' && /^contract:\d+:\d+$/.test(ref))
		return { kind, contractId: ids[0], typeId: ids[1] };
	if (kind === 'job_input' && /^job:\d+:\d+$/.test(ref)) return { kind, jobId: ids[0], typeId: ids[1] };
	return null;
}

/** Whether `target` is one of the user's tracked rows (a job input must be a material of the job's formula). */
async function targetExists(env: Env, userId: string, target: CorrectionTarget): Promise<boolean> {
	const db = getCoreDb(env.DB);
	switch (target.kind) {
		case 'transaction': {
			const [row] = await db
				.select({ id: trackedTransactions.transactionId })
				.from(trackedTransactions)
				.where(
					and(
						eq(trackedTransactions.userId, userId),
						eq(trackedTransactions.transactionId, target.transactionId)
					)
				)
				.limit(1);
			return row !== undefined;
		}
		case 'contract_item': {
			const [row] = await db
				.select({ id: trackedContractItems.recordId })
				.from(trackedContractItems)
				.where(
					and(
						eq(trackedContractItems.userId, userId),
						eq(trackedContractItems.contractId, target.contractId),
						eq(trackedContractItems.typeId, target.typeId)
					)
				)
				.limit(1);
			return row !== undefined;
		}
		case 'job_input': {
			const [job] = await db
				.select({ blueprintTypeId: trackedJobs.blueprintTypeId })
				.from(trackedJobs)
				.where(and(eq(trackedJobs.userId, userId), eq(trackedJobs.jobId, target.jobId)))
				.limit(1);
			if (!job) return false;
			const dataset = await getDataset(env);
			const reaction = dataset?.reactions.find((r) => r.blueprintTypeId === job.blueprintTypeId);
			return reaction?.materials.some((m) => m.typeId === target.typeId) ?? false;
		}
	}
}

export type CorrectionOutcome =
	{ ok: true; rebuilt: boolean } | { ok: false; status: 400 | 404; message: string };

const NOT_FOUND = 'That price is not in your ledger.';

/** Notice after a saved or removed correction (the ledger may only be recalculated at the next tick). */
export function correctionNotice(saved: 'saved' | 'removed', rebuilt: boolean): string {
	const what = saved === 'saved' ? 'Price corrected.' : 'Correction removed.';
	return rebuilt ? `${what} Results recalculated.` : `${what} Results are recalculated within 10 minutes.`;
}

/**
 * Stores (replaces) the user's unit price for `target` and asks for a ledger rebuild. The price must be
 * a finite number from 0 to `MAX_CORRECTION_PRICE`; the note is optional, trimmed, at most
 * `MAX_NOTE_LENGTH` characters.
 */
export async function saveCorrection(
	env: Env,
	userId: string,
	target: CorrectionTarget,
	input: { unitPrice: unknown; note: unknown },
	now = Date.now()
): Promise<CorrectionOutcome> {
	const raw = typeof input.unitPrice === 'string' ? input.unitPrice.trim().replace(/[\s,]/g, '') : '';
	const unitPrice = raw === '' ? NaN : Number(raw);
	if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_CORRECTION_PRICE) {
		return {
			ok: false,
			status: 400,
			message: `Enter a unit price from 0 to ${formatNumber(MAX_CORRECTION_PRICE)} ISK.`
		};
	}
	const note = typeof input.note === 'string' ? input.note.trim() : '';
	if (note.length > MAX_NOTE_LENGTH) {
		return { ok: false, status: 400, message: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };
	}
	if (!(await targetExists(env, userId, target))) return { ok: false, status: 404, message: NOT_FOUND };
	const values = {
		userId,
		targetKind: target.kind,
		targetRef: correctionRef(target),
		unitPrice,
		note: note || null,
		createdAt: now
	};
	await getCoreDb(env.DB)
		.insert(priceCorrections)
		.values(values)
		.onConflictDoUpdate({
			target: [priceCorrections.userId, priceCorrections.targetKind, priceCorrections.targetRef],
			set: { unitPrice, note: values.note, createdAt: now }
		});
	return { ok: true, ...(await requestLedgerRebuild(env, userId)) };
}

/** Removes the user's correction of `target` (404 when there is none) and asks for a ledger rebuild. */
export async function undoCorrection(
	env: Env,
	userId: string,
	target: CorrectionTarget
): Promise<CorrectionOutcome> {
	const deleted = await getCoreDb(env.DB)
		.delete(priceCorrections)
		.where(
			and(
				eq(priceCorrections.userId, userId),
				eq(priceCorrections.targetKind, target.kind),
				eq(priceCorrections.targetRef, correctionRef(target))
			)
		)
		.returning({ ref: priceCorrections.targetRef });
	if (deleted.length === 0) return { ok: false, status: 404, message: 'There is no correction to remove.' };
	return { ok: true, ...(await requestLedgerRebuild(env, userId)) };
}
