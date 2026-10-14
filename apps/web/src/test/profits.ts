/** The `/profits` overview scenario: the jobs scenario plus sales over two periods, a resale and failures. */
import { NOW } from './fixtures.ts';
import { insertStream, insertSource } from './inventory.ts';
import { JOB, jobsScenario } from './jobs.ts';
import { DAY, insertLot, insertUse } from './ledger-item.ts';
import { insertPrice, insertTransaction } from './ledger.ts';

/**
 * On top of {@link jobsScenario} (sale 902: 60 of `JOB.final`'s product at 50 net a day ago, realized
 * 1,680; `JOB.cancelled` lost 330 twenty days ago; purchase 901 of 100 at 8, dated now):
 * - `JOB.old`'s 10 units (unit cost 10) sold as 4 at 30 ten days ago (sale 905, +80) and 6 at 35 three
 *   days ago (sale 906, +150): one job sold over two 7-day periods;
 * - 50 of the intermediate's first material bought at 9 four days ago (907), 20 of them resold at 12 two
 *   days ago (908, +60, needs review);
 * - a failed `orders` stream on the corporation connection; a denied stream on the tracking-off one;
 * - a sale of the tracking-off connection (909) and u2 rows with u1's refs, which never count.
 */
export async function overviewScenario() {
	const s = await jobsScenario();
	const db = s.env.DB;
	const product = s.final.product.typeId;
	const material = s.intermediate.materials[0].typeId;
	const own = { userId: 'u1', sourceId: s.mine };

	insertLot(db, 'u1', {
		lotId: 5,
		typeId: product,
		acquiredAt: NOW - 60 * DAY,
		quantity: 10,
		remaining: 0,
		unitCost: 10,
		origin: 'job',
		originRef: `job:${JOB.old}`
	});
	const sale = (
		id: number,
		typeId: number,
		quantity: number,
		unitPrice: number,
		at: number,
		review = false
	) => {
		insertTransaction(db, { ...own, transactionId: id, typeId, quantity, isBuy: false, date: at });
		insertPrice(db, {
			userId: 'u1',
			ref: `transaction:${id}`,
			typeId,
			incoming: false,
			quantity,
			unitPrice,
			at,
			needsReview: review
		});
	};
	sale(905, product, 4, 30, NOW - 10 * DAY);
	insertUse(db, 'u1', { lotId: 5, kind: 'sale', ref: 'transaction:905', quantity: 4, unitCost: 10 });
	sale(906, product, 6, 35, NOW - 3 * DAY);
	insertUse(db, 'u1', { lotId: 5, kind: 'sale', ref: 'transaction:906', quantity: 6, unitCost: 10 });

	insertTransaction(db, { ...own, transactionId: 907, typeId: material, quantity: 50, date: NOW - 4 * DAY });
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:907',
		typeId: material,
		quantity: 50,
		unitPrice: 9,
		at: NOW - 4 * DAY
	});
	insertLot(db, 'u1', {
		lotId: 6,
		typeId: material,
		acquiredAt: NOW - 4 * DAY,
		quantity: 50,
		remaining: 30,
		unitCost: 9,
		origin: 'transaction',
		originRef: 'transaction:907'
	});
	sale(908, material, 20, 12, NOW - 2 * DAY, true);
	insertUse(db, 'u1', { lotId: 6, kind: 'sale', ref: 'transaction:908', quantity: 20, unitCost: 9 });

	insertStream(db, 'u1', s.other, 'orders', 'error', 'boom');
	insertStream(db, 'u1', s.off, 'jobs', 'denied');

	insertTransaction(db, {
		userId: 'u1',
		sourceId: s.off,
		transactionId: 909,
		typeId: product,
		quantity: 1,
		isBuy: false,
		date: NOW - DAY
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:909',
		typeId: product,
		incoming: false,
		quantity: 1,
		unitPrice: 1e9,
		at: NOW - DAY
	});

	const theirs = insertSource(db, {
		userId: 'u2',
		characterId: 90000003,
		ownerId: 98000009,
		kind: 'corporation',
		ownerName: 'Gamma Corp',
		trackingEnabled: true
	});
	insertTransaction(db, {
		userId: 'u2',
		sourceId: theirs,
		transactionId: 902,
		typeId: product,
		isBuy: false,
		date: NOW - DAY
	});
	insertPrice(db, {
		userId: 'u2',
		ref: 'transaction:902',
		typeId: product,
		incoming: false,
		quantity: 1000,
		unitPrice: 1e6,
		at: NOW - DAY
	});
	insertLot(db, 'u2', {
		lotId: 4,
		typeId: product,
		acquiredAt: NOW - 3 * DAY,
		quantity: 1000,
		remaining: 500,
		unitCost: 1,
		origin: 'job',
		originRef: `job:${JOB.intermediate}`
	});
	insertUse(db, 'u2', { lotId: 4, kind: 'sale', ref: 'transaction:902', quantity: 500, unitCost: 1 });
	insertStream(db, 'u2', theirs, 'orders', 'error');

	return { ...s, product, material };
}
