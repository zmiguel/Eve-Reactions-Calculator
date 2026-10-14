import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SdeDataset } from '@reactions/sde';
import { asEnv, fakeEnv } from '../../test/fakes';
import { insertUser, loadSde, putKv } from '../../test/fixtures';
import { insertSource } from '../../test/inventory';
import {
	corrections,
	insertContract,
	insertCorrection,
	insertJob,
	insertTransaction
} from '../../test/ledger';
import {
	correctionRef,
	parseCorrectionTarget,
	saveCorrection,
	undoCorrection,
	type CorrectionTarget
} from './price-corrections';

let sde: SdeDataset;
beforeAll(async () => {
	sde = await loadSde();
});

const TRANSACTION: CorrectionTarget = { kind: 'transaction', transactionId: 11 };
const CONTRACT_ITEM: CorrectionTarget = { kind: 'contract_item', contractId: 21, typeId: 16634 };

/** u1 owns transaction 11, contract 21 (items 16634, 16635) and job 31; u2 owns transaction 12. */
async function setup(rebuildResult: unknown = { rebuiltAt: 1, lots: 0, jobs: 0, needsReview: 0 }) {
	const rebuildLedger = vi.fn(async (_userId: string) => rebuildResult);
	const env = fakeEnv({ UPDATER: { rebuildLedger } });
	await putKv(env, sde);
	insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
	insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000002, name: 'Beta' }]);
	const mine = insertSource(env.DB, { userId: 'u1', characterId: 90000001, trackingEnabled: true });
	const theirs = insertSource(env.DB, { userId: 'u2', characterId: 90000002, trackingEnabled: true });
	insertTransaction(env.DB, { userId: 'u1', sourceId: mine, transactionId: 11, typeId: 16634 });
	insertTransaction(env.DB, { userId: 'u2', sourceId: theirs, transactionId: 12, typeId: 16634 });
	insertContract(env.DB, {
		userId: 'u1',
		sourceId: mine,
		contractId: 21,
		items: [
			[16634, 100],
			[16635, 50]
		]
	});
	const reaction = sde.dataset.reactions.find((r) => r.materials.length > 1)!;
	insertJob(env.DB, 'u1', mine, 31, reaction.blueprintTypeId);
	return { env, rebuildLedger, reaction };
}

describe('parseCorrectionTarget', () => {
	it.each<CorrectionTarget>([
		{ kind: 'transaction', transactionId: 5 },
		{ kind: 'contract_item', contractId: 6, typeId: 7 },
		{ kind: 'job_input', jobId: 8, typeId: 9 }
	])('reads back the ref it writes (%o)', (target) => {
		expect(parseCorrectionTarget(target.kind, correctionRef(target))).toEqual(target);
	});

	it.each([
		['transaction', 'contract:1:2'],
		['contract_item', 'contract:1'],
		['transaction', 'transaction:0'],
		['transaction', 'transaction:-1'],
		['transaction', 'transaction:1.5'],
		['job_input', 'job:1:x'],
		['other', 'transaction:1'],
		['transaction', null]
	])('rejects kind %s with ref %s', (kind, ref) => {
		expect(parseCorrectionTarget(kind, ref)).toBeNull();
	});
});

describe('saveCorrection', () => {
	it.each([
		['empty', ''],
		['negative', '-1'],
		['not a number', 'abc'],
		['above 1e13', '20000000000000']
	])('rejects a %s price with 400 and stores nothing', async (_case, unitPrice) => {
		const { env, rebuildLedger } = await setup();
		const outcome = await saveCorrection(asEnv(env), 'u1', TRANSACTION, { unitPrice, note: '' });
		expect(outcome).toMatchObject({ ok: false, status: 400 });
		expect(corrections(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it('rejects a note over 200 characters with 400', async () => {
		const { env } = await setup();
		const outcome = await saveCorrection(asEnv(env), 'u1', TRANSACTION, {
			unitPrice: '5',
			note: 'x'.repeat(201)
		});
		expect(outcome).toMatchObject({ ok: false, status: 400 });
		expect(corrections(env.DB, 'u1')).toEqual([]);
	});

	it.each<[string, CorrectionTarget]>([
		["another user's transaction", { kind: 'transaction', transactionId: 12 }],
		['an unknown transaction', { kind: 'transaction', transactionId: 99 }],
		['a type not in the contract', { kind: 'contract_item', contractId: 21, typeId: 99 }],
		['an unknown contract', { kind: 'contract_item', contractId: 99, typeId: 16634 }],
		['an unknown job', { kind: 'job_input', jobId: 99, typeId: 16634 }]
	])('answers 404 for %s', async (_case, target) => {
		const { env, rebuildLedger } = await setup();
		const outcome = await saveCorrection(asEnv(env), 'u1', target, { unitPrice: '5', note: '' });
		expect(outcome).toMatchObject({ ok: false, status: 404 });
		expect(corrections(env.DB, 'u1')).toEqual([]);
		expect(corrections(env.DB, 'u2')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it('accepts a job input only for a material of the job formula', async () => {
		const { env, reaction } = await setup();
		const material = reaction.materials[0].typeId;
		expect(
			await saveCorrection(
				asEnv(env),
				'u1',
				{ kind: 'job_input', jobId: 31, typeId: reaction.product.typeId },
				{ unitPrice: '5', note: '' }
			)
		).toMatchObject({ ok: false, status: 404 });
		expect(
			await saveCorrection(
				asEnv(env),
				'u1',
				{ kind: 'job_input', jobId: 31, typeId: material },
				{ unitPrice: '5', note: '' }
			)
		).toEqual({ ok: true, rebuilt: true });
		expect(corrections(env.DB, 'u1')).toEqual([
			{ target_kind: 'job_input', target_ref: `job:31:${material}`, unit_price: 5, note: null }
		]);
	});

	it('stores the price and note, replaces them on a second save and asks for a rebuild each time', async () => {
		const { env, rebuildLedger } = await setup();
		expect(
			await saveCorrection(asEnv(env), 'u1', CONTRACT_ITEM, { unitPrice: ' 1,250.5 ', note: '  agreed  ' })
		).toEqual({ ok: true, rebuilt: true });
		expect(await saveCorrection(asEnv(env), 'u1', CONTRACT_ITEM, { unitPrice: '1300', note: '' })).toEqual({
			ok: true,
			rebuilt: true
		});
		expect(corrections(env.DB, 'u1')).toEqual([
			{ target_kind: 'contract_item', target_ref: 'contract:21:16634', unit_price: 1300, note: null }
		]);
		expect(rebuildLedger.mock.calls).toEqual([['u1'], ['u1']]);
	});

	it('accepts 0 ISK and reports not rebuilt when the updater could not rebuild', async () => {
		const { env } = await setup({ error: 'unavailable' });
		expect(await saveCorrection(asEnv(env), 'u1', TRANSACTION, { unitPrice: '0', note: '' })).toEqual({
			ok: true,
			rebuilt: false
		});
		expect(corrections(env.DB, 'u1')).toEqual([
			{ target_kind: 'transaction', target_ref: 'transaction:11', unit_price: 0, note: null }
		]);
	});
});

describe('undoCorrection', () => {
	it('answers 404 when there is no correction, also for another user’s one', async () => {
		const { env, rebuildLedger } = await setup();
		insertCorrection(env.DB, 'u2', 'transaction', 'transaction:11', 5);
		expect(await undoCorrection(asEnv(env), 'u1', TRANSACTION)).toMatchObject({ ok: false, status: 404 });
		expect(corrections(env.DB, 'u2')).toHaveLength(1);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it('removes only that correction and asks for a rebuild', async () => {
		const { env, rebuildLedger } = await setup();
		insertCorrection(env.DB, 'u1', 'transaction', 'transaction:11', 5);
		insertCorrection(env.DB, 'u1', 'contract_item', 'contract:21:16634', 7);
		expect(await undoCorrection(asEnv(env), 'u1', TRANSACTION)).toEqual({ ok: true, rebuilt: true });
		expect(corrections(env.DB, 'u1').map((c) => c.target_ref)).toEqual(['contract:21:16634']);
		expect(rebuildLedger).toHaveBeenCalledWith('u1');
	});
});
