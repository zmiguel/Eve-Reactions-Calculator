/** Ledger lots and uses plus a shared scenario for `/profits/ledger/[typeId]` tests, written straight to D1. */
import { fakeEnv, type FakeD1 } from './fakes.ts';
import { NOW, insertUser, loadSde, putKv } from './fixtures.ts';
import { insertSource } from './inventory.ts';
import { insertContract, insertJob, insertPrice, insertTransaction } from './ledger.ts';

export function insertLot(
	db: FakeD1,
	userId: string,
	lot: {
		lotId: number;
		typeId: number;
		acquiredAt: number;
		quantity: number;
		remaining: number;
		unitCost: number;
		origin: 'transaction' | 'contract' | 'job' | 'market' | 'correction' | 'manual';
		/** Shown verbatim as the price source; default `Source of lot <lotId>`. */
		priceSource?: string;
		originRef: string;
	}
) {
	db.sqlite
		.prepare(
			`INSERT INTO ledger_lots (user_id, lot_id, type_id, acquired_at, quantity, remaining, unit_cost, origin,
				origin_ref, price_source)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			lot.lotId,
			lot.typeId,
			lot.acquiredAt,
			lot.quantity,
			lot.remaining,
			lot.unitCost,
			lot.origin,
			lot.originRef,
			lot.priceSource ?? `Source of lot ${lot.lotId}`
		);
}

export function insertUse(
	db: FakeD1,
	userId: string,
	use: {
		lotId: number;
		kind: 'job' | 'sale' | 'manufacturing' | 'consumed';
		ref: string;
		quantity: number;
		unitCost: number;
		/** Manufacturing uses: what one unit counted for (null: not stored). */
		unitValue?: number | null;
	}
) {
	db.sqlite
		.prepare(
			`INSERT INTO ledger_uses (user_id, lot_id, use_kind, use_ref, quantity, unit_cost, unit_value)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(userId, use.lotId, use.kind, use.ref, use.quantity, use.unitCost, use.unitValue ?? null);
}

export const DAY = 86_400_000;
/** `insertJob` start date. */
export const JOB_START = NOW - 7_200_000;
export const ALPHA = { characterId: 90000001, name: 'Alpha' };
export const BETA = { characterId: 90000002, name: 'Beta' };
export const GAMMA = { characterId: 90000003, name: 'Gamma' };
/** Caesarium Cadmide formula. */
export const FORMULA = 46166;
/** Jobs of u1: 5001 used a market fallback lot, 5002 a corrected one. */
export const FALLBACK_JOB = 5001;
export const CORRECTED_JOB = 5002;
/** A job of u2. */
export const FOREIGN_JOB = 6001;

/**
 * u1 tracks one connection (Alpha) and has a second one with tracking off (Beta); u2 has its own rows
 * with the same ids. Item: the first material of `FORMULA`. u1's lots of it (Σ remaining 100, worth
 * 40 × 10 + 50 × 13 + 10 × 20 = 1,250):
 * 1. bought on the market (`transaction:901`), 100 at 10, 40 left: job 5001 took 50, sale 902 took 10;
 * 2. bought by contract (`contract:801`), 50 at 13, all left;
 * 3. market fallback of job 5001, 30 at 15, used by it;
 * 4. corrected input of job 5002, 25 at 9, used by it;
 * 5. made by job 5003, 10 at 20, all left;
 * 6. from the tracking-off connection (`transaction:903`), also "used" by job 5002: left out.
 * Contract 802 is a transfer (no ledger price); 803 belongs to the tracking-off connection.
 */
export async function ledgerItemScenario(env = fakeEnv()) {
	const sde = await loadSde();
	await putKv(env, sde);
	const reaction = sde.dataset.reactions.find((r) => r.blueprintTypeId === FORMULA)!;
	const typeId = reaction.materials[0].typeId;
	insertUser(env.DB, { userId: 'u1' }, [ALPHA, BETA]);
	insertUser(env.DB, { userId: 'u2' }, [GAMMA]);
	const db = env.DB;
	const mine = insertSource(db, { userId: 'u1', characterId: ALPHA.characterId, trackingEnabled: true });
	const off = insertSource(db, { userId: 'u1', characterId: BETA.characterId, trackingEnabled: false });
	const theirs = insertSource(db, { userId: 'u2', characterId: GAMMA.characterId, trackingEnabled: true });

	for (const jobId of [FALLBACK_JOB, CORRECTED_JOB, 5003]) insertJob(db, 'u1', mine, jobId, FORMULA);
	const own = { userId: 'u1', sourceId: mine, typeId };
	insertTransaction(db, { ...own, transactionId: 901, quantity: 100, date: NOW - 10 * DAY });
	insertTransaction(db, { ...own, transactionId: 902, quantity: 10, isBuy: false, date: NOW - 2 * DAY });
	insertTransaction(db, { ...own, sourceId: off, transactionId: 903, quantity: 1000, date: NOW - 8 * DAY });
	insertContract(db, { ...own, contractId: 801, items: [[typeId, 50]], dateIssued: NOW - 9 * DAY });
	insertContract(db, { ...own, contractId: 802, items: [[typeId, 5]], dateIssued: NOW - DAY });
	insertContract(db, { ...own, sourceId: off, contractId: 803, items: [[typeId, 6]], dateIssued: NOW - DAY });

	const lot = { typeId, acquiredAt: NOW - 10 * DAY };
	const lots = [
		{
			lotId: 1,
			quantity: 100,
			remaining: 40,
			unitCost: 10,
			origin: 'transaction',
			originRef: 'transaction:901'
		},
		{ lotId: 2, quantity: 50, remaining: 50, unitCost: 13, origin: 'contract', originRef: 'contract:801' },
		{
			lotId: 3,
			quantity: 30,
			remaining: 0,
			unitCost: 15,
			origin: 'market',
			originRef: `job:${FALLBACK_JOB}`
		},
		{
			lotId: 4,
			quantity: 25,
			remaining: 0,
			unitCost: 9,
			origin: 'correction',
			originRef: `job:${CORRECTED_JOB}`
		},
		{ lotId: 5, quantity: 10, remaining: 10, unitCost: 20, origin: 'job', originRef: 'job:5003' },
		{
			lotId: 6,
			quantity: 1000,
			remaining: 1000,
			unitCost: 1,
			origin: 'transaction',
			originRef: 'transaction:903'
		}
	] as const;
	// Acquired a day apart, oldest first.
	lots.forEach((l, i) => insertLot(db, 'u1', { ...lot, ...l, acquiredAt: lot.acquiredAt + i * DAY }));
	insertUse(db, 'u1', { lotId: 1, kind: 'job', ref: `job:${FALLBACK_JOB}`, quantity: 50, unitCost: 10 });
	insertUse(db, 'u1', { lotId: 1, kind: 'sale', ref: 'transaction:902', quantity: 10, unitCost: 10 });
	insertUse(db, 'u1', { lotId: 3, kind: 'job', ref: `job:${FALLBACK_JOB}`, quantity: 30, unitCost: 15 });
	insertUse(db, 'u1', { lotId: 4, kind: 'job', ref: `job:${CORRECTED_JOB}`, quantity: 25, unitCost: 9 });
	insertUse(db, 'u1', { lotId: 6, kind: 'job', ref: `job:${CORRECTED_JOB}`, quantity: 1, unitCost: 1 });

	const price = { userId: 'u1', typeId };
	insertPrice(db, { ...price, ref: 'transaction:901', quantity: 100, unitPrice: 10, at: NOW - 10 * DAY });
	insertPrice(db, {
		...price,
		ref: 'contract:801',
		quantity: 50,
		unitPrice: 13,
		at: NOW - 9 * DAY,
		needsReview: true
	});
	insertPrice(db, {
		...price,
		ref: 'transaction:902',
		incoming: false,
		quantity: 10,
		unitPrice: 14.5,
		at: NOW - 2 * DAY
	});
	insertPrice(db, { ...price, ref: 'transaction:903', quantity: 1000, unitPrice: 1, at: NOW - 8 * DAY });

	insertJob(db, 'u2', theirs, FOREIGN_JOB, FORMULA);
	insertTransaction(db, { userId: 'u2', sourceId: theirs, typeId, transactionId: 901, quantity: 7 });
	insertLot(db, 'u2', {
		...lot,
		lotId: 1,
		quantity: 7,
		remaining: 7,
		unitCost: 99,
		origin: 'transaction',
		originRef: 'transaction:901'
	});
	insertLot(db, 'u2', {
		...lot,
		lotId: 2,
		quantity: 3,
		remaining: 0,
		unitCost: 50,
		origin: 'market',
		originRef: `job:${FOREIGN_JOB}`
	});
	insertUse(db, 'u2', { lotId: 2, kind: 'job', ref: `job:${FOREIGN_JOB}`, quantity: 3, unitCost: 50 });
	insertPrice(db, { userId: 'u2', ref: 'transaction:901', typeId, quantity: 7, unitPrice: 99 });

	return { env, sde, reaction, typeId };
}
