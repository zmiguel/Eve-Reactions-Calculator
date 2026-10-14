import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv } from '../../test/fakes';
import { NOW } from '../../test/fixtures';
import { corrections, insertCorrection } from '../../test/ledger';
import { HOUR, reconcileScenario } from '../../test/reconcile';
import { clearDataMemo } from './data';
import {
	CONFIRMED_NOTE,
	confirmAllBuyValues,
	confirmBuyValue,
	reconcileContracts,
	reconcileCounts,
	reconcileInputs,
	reconcilePage
} from './ledger-reconcile';

beforeEach(() => clearDataMemo());

async function setup() {
	const rebuildLedger = vi.fn(async (_userId: string) => ({
		rebuiltAt: NOW,
		lots: 0,
		jobs: 0,
		needsReview: 0
	}));
	const s = await reconcileScenario(fakeEnv({ UPDATER: { rebuildLedger } } as never));
	return { ...s, rebuildLedger };
}

describe('reconcile lists', () => {
	it("lists only the user's estimated inputs of tracked reaction jobs, grouped by item then job", async () => {
		const { env, X, Y, name } = await setup();
		const inputs = await reconcileInputs(asEnv(env), 'u1', 1);
		const [first, second] = name(X).localeCompare(name(Y)) <= 0 ? [X, Y] : [Y, X];
		const expected = [
			...(first === X ? ['job:31:X', 'job:32:X'] : ['job:31:Y']),
			...(second === X ? ['job:31:X', 'job:32:X'] : ['job:31:Y'])
		].map((r) => r.replace('X', String(X)).replace('Y', String(Y)));
		expect(inputs.rows.map((r) => r.ref)).toEqual(expected);
		expect(inputs.total).toBe(3);
		const x31 = inputs.rows.find((r) => r.ref === `job:31:${X}`)!;
		expect(x31).toMatchObject({
			item: { typeId: X, name: name(X) },
			jobId: 31,
			startedAt: NOW - 3 * HOUR,
			quantity: 30,
			estimate: 15,
			estimateText: 'No purchase found: buy value at job start (Jita 4-4 buy)',
			saved: null,
			itemRows: 2,
			itemQuantity: 40,
			itemConfirmable: 2
		});
		expect(inputs.rows.find((r) => r.ref === `job:31:${Y}`)).toMatchObject({
			estimate: null,
			itemConfirmable: 0
		});
		// The item heading goes above the first row of each item on the page.
		expect(inputs.rows.map((r) => r.first)).toEqual(first === X ? [true, false, true] : [true, true, false]);
	});

	it('lists contract items needing review of tracked connections only', async () => {
		const { env, X } = await setup();
		const contracts = await reconcileContracts(asEnv(env), 'u1', 1);
		expect(contracts.rows).toEqual([
			expect.objectContaining({
				ref: `contract:21:${X}`,
				contractId: 21,
				title: 'Moon goo',
				incoming: true,
				quantity: 40,
				unitPrice: 12,
				sourceText: 'Outside your rule (140.0% of Jita 4-4 buy): check',
				saved: null
			})
		]);
	});

	it('counts what is still missing; a saved price stays listed as saved until the rebuild', async () => {
		const { env, X } = await setup();
		expect(await reconcileCounts(asEnv(env), 'u1')).toEqual({
			estimated: 2,
			unpriced: 1,
			items: 2,
			contracts: 1,
			total: 4
		});
		insertCorrection(env.DB, 'u1', 'job_input', `job:31:${X}`, 14);
		insertCorrection(env.DB, 'u1', 'contract_item', `contract:21:${X}`, 11);
		const page = await reconcilePage(asEnv(env), 'u1', { inputs: 1, contracts: 1 });
		expect(page.counts).toEqual({ estimated: 1, unpriced: 1, items: 2, contracts: 0, total: 2 });
		expect(page.inputs.rows.find((r) => r.ref === `job:31:${X}`)?.saved).toEqual({
			unitPrice: 14,
			note: null
		});
		expect(page.contracts.rows[0].saved).toEqual({ unitPrice: 11, note: null });
		expect(page.inputs.rows.find((r) => r.ref === `job:32:${X}`)?.itemConfirmable).toBe(1);
	});

	it('is empty for a user with nothing to reconcile', async () => {
		const { env } = await setup();
		env.DB.sqlite.prepare('DELETE FROM ledger_lots WHERE user_id = ?').run('u1');
		env.DB.sqlite.prepare('DELETE FROM ledger_prices WHERE user_id = ?').run('u1');
		const page = await reconcilePage(asEnv(env), 'u1', { inputs: 1, contracts: 1 });
		expect(page.counts.total).toBe(0);
		expect(page.inputs.total + page.contracts.total).toBe(0);
	});
});

describe('Use buy value', () => {
	it("stores the input's estimate as a confirmed correction and asks for a rebuild", async () => {
		const { env, X, rebuildLedger } = await setup();
		expect(await confirmBuyValue(asEnv(env), 'u1', { jobId: 31, typeId: X })).toEqual({
			ok: true,
			rebuilt: true
		});
		expect(corrections(env.DB, 'u1')).toEqual([
			{ target_kind: 'job_input', target_ref: `job:31:${X}`, unit_price: 15, note: CONFIRMED_NOTE }
		]);
		expect(rebuildLedger).toHaveBeenCalledTimes(1);
	});

	it('refuses an input without a buy value (400) and inputs that are not the user’s estimates (404)', async () => {
		const { env, X, Y, rebuildLedger } = await setup();
		expect(await confirmBuyValue(asEnv(env), 'u1', { jobId: 31, typeId: Y })).toMatchObject({ status: 400 });
		for (const target of [
			{ jobId: 41, typeId: X },
			{ jobId: 33, typeId: X },
			{ jobId: 34, typeId: X },
			{ jobId: 99, typeId: X }
		]) {
			expect(await confirmBuyValue(asEnv(env), 'u1', target)).toMatchObject({ ok: false, status: 404 });
		}
		expect(corrections(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it('confirms every estimate of an item in one go, keeps saved prices and rebuilds once', async () => {
		const { env, X, rebuildLedger } = await setup();
		insertCorrection(env.DB, 'u1', 'job_input', `job:31:${X}`, 14, 'mine');
		expect(await confirmAllBuyValues(asEnv(env), 'u1', X, NOW)).toEqual({
			ok: true,
			count: 1,
			rebuilt: true
		});
		expect(corrections(env.DB, 'u1')).toEqual([
			{ target_kind: 'job_input', target_ref: `job:31:${X}`, unit_price: 14, note: 'mine' },
			{ target_kind: 'job_input', target_ref: `job:32:${X}`, unit_price: 16, note: CONFIRMED_NOTE }
		]);
		expect(rebuildLedger).toHaveBeenCalledTimes(1);
		expect(corrections(env.DB, 'u2')).toEqual([]);
	});

	it('answers 404 when nothing is left to confirm for the item', async () => {
		const { env, Y, rebuildLedger } = await setup();
		expect(await confirmAllBuyValues(asEnv(env), 'u1', Y, NOW)).toMatchObject({ ok: false, status: 404 });
		expect(rebuildLedger).not.toHaveBeenCalled();
	});
});
