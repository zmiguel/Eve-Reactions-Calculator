/** Profit tracking rows for `web-unit` tests: raw tracked rows and ledger results written straight to D1. */
import type { FakeD1 } from './fakes.ts';
import { NOW } from './fixtures.ts';

export interface TransactionFixture {
	userId: string;
	sourceId: number;
	transactionId: number;
	typeId: number;
	quantity?: number;
	unitPrice?: number;
	isBuy?: boolean;
	division?: number | null;
	date?: number;
	clientId?: number;
}

export function insertTransaction(db: FakeD1, t: TransactionFixture) {
	db.sqlite
		.prepare(
			`INSERT INTO tracked_transactions (user_id, transaction_id, source_id, division, date, type_id, quantity,
				unit_price, is_buy, client_id, location_id, journal_ref_id, is_personal)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 60003760, 1, ?)`
		)
		.run(
			t.userId,
			t.transactionId,
			t.sourceId,
			t.division ?? null,
			t.date ?? NOW,
			t.typeId,
			t.quantity ?? 10,
			t.unitPrice ?? 100,
			t.isBuy === false ? 0 : 1,
			t.clientId ?? 1000,
			t.division == null ? 1 : null
		);
}

export interface ContractFixture {
	userId: string;
	sourceId: number;
	contractId: number;
	issuerId?: number;
	issuerCorporationId?: number;
	acceptorId?: number;
	/** Default: the acceptor. */
	assigneeId?: number;
	forCorporation?: boolean;
	price?: number;
	reward?: number;
	title?: string | null;
	janiceCode?: string | null;
	dateIssued?: number;
	dateCompleted?: number | null;
	/** `[typeId, quantity, isIncluded?]` per record. */
	items?: [number, number, boolean?][];
}

export function insertContract(db: FakeD1, c: ContractFixture) {
	db.sqlite
		.prepare(
			`INSERT INTO tracked_contracts (user_id, contract_id, source_id, type, status, issuer_id, issuer_corporation_id,
				acceptor_id, assignee_id, for_corporation, price, reward, title, date_issued, date_completed, janice_code)
			VALUES (?, ?, ?, 'item_exchange', 'finished', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			c.userId,
			c.contractId,
			c.sourceId,
			c.issuerId ?? 1000,
			c.issuerCorporationId ?? 1001,
			c.acceptorId ?? 2000,
			c.assigneeId ?? c.acceptorId ?? 2000,
			c.forCorporation ? 1 : 0,
			c.price ?? 0,
			c.reward ?? 0,
			c.title ?? null,
			c.dateIssued ?? NOW,
			c.dateCompleted === undefined ? (c.dateIssued ?? NOW) : c.dateCompleted,
			c.janiceCode ?? null
		);
	(c.items ?? []).forEach(([typeId, quantity, included], i) => {
		db.sqlite
			.prepare(
				`INSERT INTO tracked_contract_items (user_id, contract_id, record_id, type_id, quantity, is_included)
				VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(c.userId, c.contractId, i + 1, typeId, quantity, included === false ? 0 : 1);
	});
}

export interface PriceFixture {
	userId: string;
	/** `transaction:<id>` or `contract:<id>`. */
	ref: string;
	typeId: number;
	incoming?: boolean;
	at?: number;
	quantity?: number;
	unitPrice?: number;
	sourceKind?: string;
	sourceText?: string;
	needsReview?: boolean;
	tax?: number | null;
	taxSource?: string | null;
	brokerFee?: number | null;
	brokerFeeSource?: string | null;
	transfer?: boolean;
}

export function insertPrice(db: FakeD1, p: PriceFixture) {
	db.sqlite
		.prepare(
			`INSERT INTO ledger_prices (user_id, ref, type_id, incoming, at, quantity, unit_price, source_kind,
				source_text, needs_review, tax, tax_source, broker_fee, broker_fee_source, transfer)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			p.userId,
			p.ref,
			p.typeId,
			p.incoming === false ? 0 : 1,
			p.at ?? NOW,
			p.quantity ?? 10,
			p.unitPrice ?? 100,
			p.sourceKind ?? 'market',
			p.sourceText ?? 'Market trade',
			p.needsReview ? 1 : 0,
			p.tax ?? null,
			p.taxSource ?? null,
			p.brokerFee ?? null,
			p.brokerFeeSource ?? null,
			p.transfer ? 1 : 0
		);
}

export function insertCorrection(
	db: FakeD1,
	userId: string,
	kind: 'transaction' | 'contract_item' | 'job_input',
	ref: string,
	unitPrice: number,
	note: string | null = null
) {
	db.sqlite
		.prepare(
			`INSERT INTO price_corrections (user_id, target_kind, target_ref, unit_price, note, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(userId, kind, ref, unitPrice, note, NOW);
}

export function insertJob(
	db: FakeD1,
	userId: string,
	sourceId: number,
	jobId: number,
	blueprintTypeId: number,
	options: { activityId?: number; productTypeId?: number | null; startDate?: number } = {}
) {
	const start = options.startDate ?? NOW - 7_200_000;
	db.sqlite
		.prepare(
			`INSERT INTO tracked_jobs (user_id, job_id, source_id, installer_id, blueprint_type_id, runs, status,
				facility_id, output_location_id, start_date, end_date, activity_id, product_type_id)
			VALUES (?, ?, ?, 1, ?, 1, 'delivered', 1, 1, ?, ?, ?, ?)`
		)
		.run(
			userId,
			jobId,
			sourceId,
			blueprintTypeId,
			start,
			start + 3_600_000,
			options.activityId ?? 9,
			options.productTypeId ?? null
		);
}

/** A purchase the user entered; returns its `entry_id`. */
export function insertManualEntry(
	db: FakeD1,
	userId: string,
	entry: { typeId: number; date?: number; quantity?: number; unitPrice?: number; note?: string | null }
): number {
	const info = db.sqlite
		.prepare(
			`INSERT INTO manual_entries (user_id, date, type_id, quantity, unit_price, note, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			entry.date ?? NOW,
			entry.typeId,
			entry.quantity ?? 10,
			entry.unitPrice ?? 100,
			entry.note ?? null,
			NOW
		);
	return Number(info.lastInsertRowid);
}

export const manualEntries = (db: FakeD1, userId: string) =>
	db.rows<{
		entry_id: number;
		date: number;
		type_id: number;
		quantity: number;
		unit_price: number;
		note: string | null;
	}>(
		'SELECT entry_id, date, type_id, quantity, unit_price, note FROM manual_entries WHERE user_id = ? ORDER BY entry_id',
		userId
	);

export const corrections = (db: FakeD1, userId: string) =>
	db.rows<{ target_kind: string; target_ref: string; unit_price: number; note: string | null }>(
		'SELECT target_kind, target_ref, unit_price, note FROM price_corrections WHERE user_id = ? ORDER BY target_ref',
		userId
	);
