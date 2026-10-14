/** The `/profits/ledger/reconcile` scenario: job inputs without a purchase and contract items to check. */
import { fakeEnv, type FakeEnv } from './fakes.ts';
import { NOW, insertUser, loadSde, putKv } from './fixtures.ts';
import { insertSource } from './inventory.ts';
import { insertLot } from './ledger-item.ts';
import { insertContract, insertJob, insertPrice, insertTransaction } from './ledger.ts';

export const HOUR = 3_600_000;
export const ALPHA = { characterId: 90000001, name: 'Alpha' };
export const BETA = { characterId: 90000002, name: 'Beta' };
export const GAMMA = { characterId: 90000003, name: 'Gamma' };

/**
 * u1 tracks Alpha (and has Beta with tracking off); u2 tracks Gamma. X and Y are two materials of the
 * first reaction with two or more materials. u1's estimated job inputs:
 * - job 31 (started 3 h ago): 30 X at 15 (buy value), 20 Y with no price (0);
 * - job 32 (started 2 h ago): 10 X at 16 (buy value);
 * never listed: X of job 33 on the tracking-off connection, X of manufacturing job 34, a bought lot of X,
 * u2's estimated X of job 41. Contract items: contract 21 (X, needs review) is listed; contract 22 (no
 * review), contract 23 (tracking off) and u2's contract 21 are not.
 */
export async function reconcileScenario(env: FakeEnv = fakeEnv()) {
	const sde = await loadSde();
	await putKv(env, sde);
	const reaction = sde.dataset.reactions.find((r) => r.materials.length > 1)!;
	const [X, Y] = reaction.materials.map((m) => m.typeId);
	const db = env.DB;
	insertUser(db, { userId: 'u1' }, [ALPHA, BETA]);
	insertUser(db, { userId: 'u2' }, [GAMMA]);
	const mine = insertSource(db, { userId: 'u1', characterId: ALPHA.characterId, trackingEnabled: true });
	const off = insertSource(db, { userId: 'u1', characterId: BETA.characterId, trackingEnabled: false });
	const theirs = insertSource(db, { userId: 'u2', characterId: GAMMA.characterId, trackingEnabled: true });

	const bp = reaction.blueprintTypeId;
	insertJob(db, 'u1', mine, 31, bp, { startDate: NOW - 3 * HOUR });
	insertJob(db, 'u1', mine, 32, bp, { startDate: NOW - 2 * HOUR });
	insertJob(db, 'u1', off, 33, bp);
	insertJob(db, 'u1', mine, 34, 999, { activityId: 1, productTypeId: 998 });
	insertJob(db, 'u2', theirs, 41, bp);
	insertTransaction(db, { userId: 'u1', sourceId: mine, transactionId: 901, typeId: X });

	const lot = (
		userId: string,
		lotId: number,
		typeId: number,
		quantity: number,
		unitCost: number,
		origin: 'market' | 'transaction',
		originRef: string
	) =>
		insertLot(db, userId, {
			lotId,
			typeId,
			acquiredAt: NOW - 3 * HOUR,
			quantity,
			remaining: 0,
			unitCost,
			origin,
			originRef,
			priceSource:
				unitCost > 0
					? 'No purchase found: buy value at job start (Jita 4-4 buy)'
					: 'No purchase found and no buy value at job start (2026-10-06 09:00 UTC)'
		});
	lot('u1', 1, X, 30, 15, 'market', 'job:31');
	lot('u1', 2, Y, 20, 0, 'market', 'job:31');
	lot('u1', 3, X, 10, 16, 'market', 'job:32');
	lot('u1', 4, X, 100, 9, 'transaction', 'transaction:901');
	lot('u1', 5, X, 5, 15, 'market', 'job:33');
	lot('u1', 6, X, 5, 15, 'market', 'job:34');
	lot('u2', 1, X, 7, 99, 'market', 'job:41');

	insertContract(db, { userId: 'u1', sourceId: mine, contractId: 21, items: [[X, 40]], title: 'Moon goo' });
	insertContract(db, { userId: 'u1', sourceId: mine, contractId: 22, items: [[X, 40]] });
	insertContract(db, { userId: 'u1', sourceId: off, contractId: 23, items: [[X, 40]] });
	insertContract(db, { userId: 'u2', sourceId: theirs, contractId: 21, items: [[X, 40]] });
	const price = { typeId: X, quantity: 40, unitPrice: 12, sourceKind: 'rule_outside' };
	insertPrice(db, {
		...price,
		userId: 'u1',
		ref: 'contract:21',
		needsReview: true,
		sourceText: 'Outside your rule (140.0% of Jita 4-4 buy): check'
	});
	insertPrice(db, { ...price, userId: 'u1', ref: 'contract:22' });
	insertPrice(db, { ...price, userId: 'u1', ref: 'contract:23', needsReview: true });
	insertPrice(db, { ...price, userId: 'u2', ref: 'contract:21', needsReview: true });

	const name = (typeId: number) => sde.dataset.types[typeId].name;
	return { env, sde, reaction, X, Y, name, mine, off, theirs };
}
