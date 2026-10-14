import { DEFAULT_SETTINGS, stockUnitValue, type Settings } from '@reactions/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { asEnv, fakeEnv } from '../../test/fakes';
import { NOW, defaults, insertUser, loadSde, putKv } from '../../test/fixtures';
import {
	CORRECTED_JOB,
	DAY,
	FALLBACK_JOB,
	JOB_START,
	insertLot,
	insertUse,
	ledgerItemScenario
} from '../../test/ledger-item';
import { insertJob, insertManualEntry } from '../../test/ledger';
import { loadCalc } from './context';
import { clearDataMemo } from './data';
import { ledgerItemBatches, ledgerItemPage, ledgerItemTrades } from './ledger-item';

beforeEach(() => clearDataMemo());

const locals = (settings: Settings = DEFAULT_SETTINGS) => ({ user: null, settings });
const FIRST = { batches: 1, trades: 1 };

describe('ledgerItemPage', () => {
	it('is null for a type outside the dataset', async () => {
		const { env } = await ledgerItemScenario();
		expect(await ledgerItemPage(asEnv(env), locals(), 'u1', 999_999_999, FIRST)).toBeNull();
		expect(await ledgerItemPage(asEnv(env), locals(), 'u1', 0, FIRST)).toBeNull();
		expect(await ledgerItemBatches(asEnv(env), 'u1', 999_999_999, 1)).toBeNull();
		expect(await ledgerItemTrades(asEnv(env), 'u1', 999_999_999, 1)).toBeNull();
	});

	it('is an empty page for a dataset type the user never tracked', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		await putKv(env, sde);
		insertUser(env.DB, { userId: 'u3' });
		const typeId = sde.dataset.reactions[0].product.typeId;
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u3', typeId, FIRST))!;
		expect(page).toMatchObject({
			item: { typeId, name: sde.dataset.types[typeId].name, formula: false },
			heldQuantity: 0,
			averagePaid: null,
			gain: null,
			points: [],
			batches: { rows: [], total: 0, page: 1, pageCount: 1 },
			trades: { rows: [], total: 0, page: 1, pageCount: 1 }
		});
	});

	it('holds the remaining quantities at their average cost, valued today with the visitor settings', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u1', typeId, FIRST))!;
		// Remaining: 40 at 10, 50 at 13, 10 at 20 → 100 units that cost 1,250.
		expect(page.heldQuantity).toBe(100);
		expect(page.averagePaid).toBe(12.5);
		const value = stockUnitValue((await loadCalc(asEnv(env), locals()))!.ctx, typeId);
		expect(value).not.toBeNull();
		expect(page.unitValue).toBe(value);
		expect(page.gain).toBeCloseTo(100 * value! - 1250, 6);

		// A lower output price % in the visitor's settings lowers today's value and the gain with it.
		const cheap = defaults();
		cheap.shared.market.outputPricePct = 50;
		clearDataMemo();
		const lower = (await ledgerItemPage(asEnv(env), locals(cheap), 'u1', typeId, FIRST))!;
		expect(lower.unitValue!).toBeLessThan(page.unitValue!);
		expect(lower.gain).toBeCloseTo(100 * lower.unitValue! - 1250, 6);
	});

	it('charts every batch with its acquired date and unit cost, oldest first', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u1', typeId, FIRST))!;
		expect(page.points.map((p) => [p.unitCost, p.quantity, p.origin])).toEqual([
			[10, 100, 'transaction'],
			[13, 50, 'contract'],
			[15, 30, 'market'],
			[9, 25, 'correction'],
			[20, 10, 'job']
		]);
		expect(page.points.map((p) => p.at)).toEqual([0, 1, 2, 3, 4].map((i) => NOW - 10 * DAY + i * DAY));
	});
});

describe('ledgerItemBatches', () => {
	it('lists the batches oldest first with their origins and uses, only from tracking-on connections', async () => {
		const { env, typeId, reaction } = await ledgerItemScenario();
		const page = (await ledgerItemBatches(asEnv(env), 'u1', typeId, 1))!;
		expect(page).toMatchObject({ page: 1, pageCount: 1, total: 5 });
		expect(
			page.rows.map((l) => ({
				lotId: l.lotId,
				origin: l.origin,
				jobId: l.jobId,
				remaining: l.remaining,
				unitCost: l.unitCost,
				priceSource: l.priceSource,
				correction: [l.correctionRef, l.corrected],
				uses: l.uses.map((u) => [u.kind, u.ref, u.jobId, u.quantity, u.unitCost])
			}))
		).toEqual([
			{
				lotId: 1,
				origin: 'transaction',
				jobId: null,
				remaining: 40,
				unitCost: 10,
				priceSource: 'Source of lot 1',
				correction: [null, false],
				uses: [
					['job', `job:${FALLBACK_JOB}`, FALLBACK_JOB, 50, 10],
					['sale', 'transaction:902', null, 10, 10]
				]
			},
			{
				lotId: 2,
				origin: 'contract',
				jobId: null,
				remaining: 50,
				unitCost: 13,
				priceSource: 'Source of lot 2',
				correction: [null, false],
				uses: []
			},
			{
				lotId: 3,
				origin: 'market',
				jobId: FALLBACK_JOB,
				remaining: 0,
				unitCost: 15,
				priceSource: 'Source of lot 3',
				correction: [`job:${FALLBACK_JOB}:${typeId}`, false],
				uses: [['job', `job:${FALLBACK_JOB}`, FALLBACK_JOB, 30, 15]]
			},
			{
				lotId: 4,
				origin: 'correction',
				jobId: CORRECTED_JOB,
				remaining: 0,
				unitCost: 9,
				priceSource: 'Source of lot 4',
				correction: [`job:${CORRECTED_JOB}:${typeId}`, true],
				uses: [['job', `job:${CORRECTED_JOB}`, CORRECTED_JOB, 25, 9]]
			},
			{
				lotId: 5,
				origin: 'job',
				jobId: 5003,
				remaining: 10,
				unitCost: 20,
				priceSource: 'Source of lot 5',
				correction: [null, false],
				uses: []
			}
		]);
		// The job that made a batch or whose input it priced is named by its formula.
		expect(page.rows.map((l) => l.jobFormula)).toEqual([
			null,
			null,
			reaction.formulaName,
			reaction.formulaName,
			reaction.formulaName
		]);
		// Job uses name their formula and start; sales their date and net unit value.
		expect(page.rows[0].uses).toEqual([
			expect.objectContaining({
				formula: { blueprintTypeId: reaction.blueprintTypeId, name: reaction.formulaName },
				at: JOB_START,
				saleUnitPrice: null
			}),
			expect.objectContaining({ formula: null, at: NOW - 2 * DAY, saleUnitPrice: 14.5 })
		]);
	});

	it('pages 10 batches and clamps a page past the end', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const db = env.DB.sqlite;
		for (let lotId = 10; lotId < 22; lotId++) {
			db.prepare(
				`INSERT INTO ledger_lots (user_id, lot_id, type_id, acquired_at, quantity, remaining, unit_cost, origin,
					origin_ref, price_source) VALUES ('u1', ?, ?, ?, 1, 1, 1, 'transaction', 'transaction:901', 'x')`
			).run(lotId, typeId, NOW + lotId);
		}
		const second = (await ledgerItemBatches(asEnv(env), 'u1', typeId, 2))!;
		expect(second).toMatchObject({ page: 2, pageCount: 2, total: 17 });
		expect(second.rows.map((l) => l.lotId)).toEqual([15, 16, 17, 18, 19, 20, 21]);
		expect(await ledgerItemBatches(asEnv(env), 'u1', typeId, 9)).toEqual(second);
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u1', typeId, { batches: 2, trades: 1 }))!;
		expect(page.batches).toEqual(second);
	});
});

describe('ledgerItemTrades', () => {
	it('lists purchases, sales and transfer contracts newest first, without other users or tracking-off rows', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const page = (await ledgerItemTrades(asEnv(env), 'u1', typeId, 1))!;
		expect(
			page.rows.map((t) => [t.ref, t.direction, t.kind, t.at, t.quantity, t.unitPrice, t.needsReview])
		).toEqual([
			['contract:802', 'transfer', 'contract', NOW - DAY, 5, null, false],
			['transaction:902', 'out', 'market', NOW - 2 * DAY, 10, 14.5, false],
			['contract:801', 'in', 'contract', NOW - 9 * DAY, 50, 13, true],
			['transaction:901', 'in', 'market', NOW - 10 * DAY, 100, 10, false]
		]);
		expect(page.rows[0]).toMatchObject({ sourceKind: null, sourceText: null, estimatedFees: false });
		expect(page.rows[1]).toMatchObject({ sourceKind: 'market', sourceText: 'Market trade' });
	});

	it('marks market trades with an estimated broker fee or sales tax', async () => {
		const { env, typeId } = await ledgerItemScenario();
		env.DB.sqlite
			.prepare(
				"UPDATE ledger_prices SET tax_source = 'estimated' WHERE user_id = 'u1' AND ref = 'transaction:902'"
			)
			.run();
		env.DB.sqlite
			.prepare(
				"UPDATE ledger_prices SET broker_fee_source = 'journal' WHERE user_id = 'u1' AND ref = 'transaction:901'"
			)
			.run();
		const rows = (await ledgerItemTrades(asEnv(env), 'u1', typeId, 1))!.rows;
		expect(Object.fromEntries(rows.map((t) => [t.ref, t.estimatedFees]))).toEqual({
			'contract:802': false,
			'transaction:902': true,
			'contract:801': false,
			'transaction:901': false
		});
	});

	it('pages 10 trades, the same page as the item page', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const db = env.DB.sqlite;
		for (let id = 1000; id < 1010; id++) {
			db.prepare(
				`INSERT INTO tracked_transactions (user_id, transaction_id, source_id, division, date, type_id, quantity,
					unit_price, is_buy, client_id, location_id, journal_ref_id, is_personal)
				SELECT 'u1', ?, source_id, NULL, ?, ?, 1, 1, 1, 1, 1, 1, 1 FROM tracked_transactions
				WHERE user_id = 'u1' AND transaction_id = 901`
			).run(id, NOW + id, typeId);
			db.prepare(
				`INSERT INTO ledger_prices (user_id, ref, type_id, incoming, at, quantity, unit_price, source_kind,
					source_text, needs_review, transfer) VALUES ('u1', ?, ?, 1, ?, 1, 1, 'market', 'x', 0, 0)`
			).run(`transaction:${id}`, typeId, NOW + id);
		}
		const second = (await ledgerItemTrades(asEnv(env), 'u1', typeId, 2))!;
		expect(second).toMatchObject({ page: 2, pageCount: 2, total: 14 });
		// The ten new trades are the newest: the first page.
		expect(second.rows.map((t) => t.ref)).toEqual([
			'contract:802',
			'transaction:902',
			'contract:801',
			'transaction:901'
		]);
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u1', typeId, { batches: 1, trades: 2 }))!;
		expect(page.trades).toEqual(second);
	});
});

describe('isolation', () => {
	it('shows another user only their own rows', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u2', typeId, FIRST))!;
		expect(page.heldQuantity).toBe(7);
		expect(page.averagePaid).toBe(99);
		expect(page.batches.rows.map((l) => l.lotId)).toEqual([1, 2]);
		expect(page.batches.rows[1].uses.map((u) => [u.jobId, u.quantity])).toEqual([[6001, 3]]);
		expect(page.trades.rows.map((t) => [t.ref, t.unitPrice])).toEqual([['transaction:901', 99]]);
	});
});

describe('purchases entered by the user and manufacturing uses', () => {
	/**
	 * On top of the scenario: u1 entered 20 of the item (lot 7, 5 of it taken by manufacturing job 7001,
	 * which makes a reaction product, counted at 30 each); manufacturing job 7002 makes an item outside
	 * the dataset and took 2 of lot 7 with no stored value; lot 8 belongs to an entry since deleted.
	 */
	async function scenario() {
		const s = await ledgerItemScenario();
		const db = s.env.DB;
		const mine = db.rows<{ source_id: number }>(
			"SELECT source_id FROM inventory_sources WHERE user_id = 'u1' AND tracking_enabled = 1"
		)[0].source_id;
		const product = s.sde.dataset.reactions[1].product.typeId;
		insertJob(db, 'u1', mine, 7001, 99001, { activityId: 1, productTypeId: product });
		insertJob(db, 'u1', mine, 7002, 99002, { activityId: 1, productTypeId: 99999999 });
		const entryId = insertManualEntry(db, 'u1', { typeId: s.typeId, quantity: 20, unitPrice: 11 });
		const lot = { typeId: s.typeId, acquiredAt: NOW - DAY, quantity: 20, unitCost: 11 };
		insertLot(db, 'u1', {
			...lot,
			lotId: 7,
			remaining: 13,
			origin: 'manual',
			originRef: `manual:${entryId}`
		});
		insertLot(db, 'u1', { ...lot, lotId: 8, remaining: 20, origin: 'manual', originRef: 'manual:999' });
		insertUse(db, 'u1', {
			lotId: 7,
			kind: 'manufacturing',
			ref: 'job:7001',
			quantity: 5,
			unitCost: 11,
			unitValue: 30
		});
		insertUse(db, 'u1', { lotId: 7, kind: 'manufacturing', ref: 'job:7002', quantity: 2, unitCost: 11 });
		return { ...s, product };
	}

	it('lists the batch of an entered purchase and what manufacturing jobs took from it', async () => {
		const { env, typeId, sde, product } = await scenario();
		const page = (await ledgerItemBatches(asEnv(env), 'u1', typeId, 1))!;
		const manual = page.rows.filter((l) => l.origin === 'manual');
		expect(manual.map((l) => l.lotId)).toEqual([7]);
		expect(manual[0]).toMatchObject({ jobId: null, correctionRef: null, remaining: 13 });
		expect(manual[0].uses).toEqual([
			{
				kind: 'manufacturing',
				ref: 'job:7001',
				jobId: 7001,
				formula: null,
				product: { typeId: product, name: sde.dataset.types[product].name },
				at: JOB_START,
				saleUnitPrice: null,
				unitValue: 30,
				quantity: 5,
				unitCost: 11
			},
			expect.objectContaining({
				kind: 'manufacturing',
				jobId: 7002,
				product: null,
				unitValue: 11,
				quantity: 2
			})
		]);
	});

	it('holds the remaining units of entered purchases', async () => {
		const { env, typeId } = await scenario();
		const page = (await ledgerItemPage(asEnv(env), locals(), 'u1', typeId, FIRST))!;
		// 100 from the base scenario plus 13 left of lot 7.
		expect(page.heldQuantity).toBe(113);
	});
});
