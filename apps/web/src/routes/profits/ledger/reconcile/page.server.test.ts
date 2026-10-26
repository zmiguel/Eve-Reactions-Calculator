import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReconcileContractRow, ReconcileInputRow, ReconcilePageData } from '#lib/ledger/types.js';
import type { Paged } from '#lib/paging.js';
import { clearDataMemo } from '#lib/server/data.js';
import { CONFIRMED_NOTE } from '#lib/server/ledger-reconcile.js';
import { correctionNotice } from '#lib/server/price-corrections.js';
import type { SessionUser } from '#lib/server/session.js';
import { requestEvent, settle } from '../../../../test/actions';
import { fakeEnv, type FakeEnv } from '../../../../test/fakes';
import { NOW } from '../../../../test/fixtures';
import { corrections } from '../../../../test/ledger';
import { ALPHA, GAMMA, reconcileScenario } from '../../../../test/reconcile';
import { sessionUser } from '../../../../test/sso';
import { GET as contractsGET } from '../../data/reconcile-contracts/+server';
import { GET as inputsGET } from '../../data/reconcile-inputs/+server';
import { actions, load } from './+page.server';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

const PATH = '/profits/ledger/reconcile';

async function setup() {
	const rebuildLedger = vi.fn(async (_userId: string) => ({
		rebuiltAt: NOW,
		lots: 0,
		jobs: 0,
		needsReview: 0
	}));
	const s = await reconcileScenario(fakeEnv({ UPDATER: { rebuildLedger } } as never));
	// A logged-in account without any tracking connection.
	s.env.DB.sqlite.prepare("UPDATE inventory_sources SET tracking_enabled = 0 WHERE user_id = 'u2'").run();
	return { ...s, rebuildLedger, user: sessionUser('u1', [ALPHA]), other: sessionUser('u2', [GAMMA]) };
}

const pageData = async (s: { env: FakeEnv; user: SessionUser }, search = '') =>
	(await load(requestEvent(s.env, s.user, `${PATH}${search}`))) as ReconcilePageData;

describe('/profits/ledger/reconcile load', () => {
	it('returns empty data for anonymous visitors and accounts without tracking', async () => {
		const s = await setup();
		for (const visitor of [null, s.other]) {
			const data = (await load(requestEvent(s.env, visitor, PATH))) as ReconcilePageData;
			expect(data).toEqual({
				counts: { estimated: 0, unpriced: 0, items: 0, contracts: 0, total: 0 },
				inputs: { rows: [], page: 1, pageCount: 1, total: 0 },
				contracts: { rows: [], page: 1, pageCount: 1, total: 0 },
				dirty: false
			});
		}
	});

	it('counts and lists what is missing for the user', async () => {
		const s = await setup();
		const data = await pageData(s);
		expect(data.counts).toEqual({ estimated: 2, unpriced: 1, items: 2, contracts: 1, total: 4 });
		expect(data.inputs.total).toBe(3);
		expect(data.contracts.rows.map((r) => r.ref)).toEqual([`contract:21:${s.X}`]);
	});
});

describe('reconcile endpoints', () => {
	it('401 for anonymous visitors, 403 without a tracking connection', async () => {
		const s = await setup();
		for (const GET of [inputsGET, contractsGET]) {
			expect(await settle(GET(requestEvent(s.env, null, '/profits/data/x')))).toEqual({ error: 401 });
			expect(await settle(GET(requestEvent(s.env, s.other, '/profits/data/x')))).toEqual({ error: 403 });
		}
	});

	it.each(['', '?inputs=2', '?contracts=3&inputs=1'])(
		'answer the same pages as the load for %s',
		async (search) => {
			const s = await setup();
			const data = await pageData(s, search);
			const inputs = (await (
				await inputsGET(requestEvent(s.env, s.user, `/profits/data/reconcile-inputs${search}`))
			).json()) as Paged<ReconcileInputRow>;
			const contracts = (await (
				await contractsGET(requestEvent(s.env, s.user, `/profits/data/reconcile-contracts${search}`))
			).json()) as Paged<ReconcileContractRow>;
			expect(inputs).toEqual(data.inputs);
			expect(contracts).toEqual(data.contracts);
		}
	);
});

describe('/profits/ledger/reconcile actions', () => {
	it('sends anonymous visitors to log in and answers 404 without tracking', async () => {
		const s = await setup();
		const fields = { ref: `job:31:${s.X}` };
		const anonymous = await settle(actions.confirm(requestEvent(s.env, null, `${PATH}?/confirm`, fields)));
		expect(anonymous.redirect).toMatch(/^\/auth\/login/);
		expect(await settle(actions.confirm(requestEvent(s.env, s.other, `${PATH}?/confirm`, fields)))).toEqual({
			error: 404
		});
		expect(corrections(s.env.DB, 'u2')).toEqual([]);
	});

	it('saves a typed unit price for a job input and a contract item', async () => {
		const s = await setup();
		const input = await settle(
			actions.correct(
				requestEvent(s.env, s.user, `${PATH}?/correct`, {
					kind: 'job_input',
					ref: `job:31:${s.Y}`,
					unitPrice: '1,234.5',
					note: ''
				})
			)
		);
		expect(input.data).toEqual({
			action: 'correct',
			ref: `job:31:${s.Y}`,
			notice: correctionNotice('saved', true)
		});
		const contract = await settle(
			actions.correct(
				requestEvent(s.env, s.user, `${PATH}?/correct`, {
					kind: 'contract_item',
					ref: `contract:21:${s.X}`,
					unitPrice: '11',
					note: ''
				})
			)
		);
		expect(contract.data).toMatchObject({ action: 'correct', ref: `contract:21:${s.X}` });
		expect(corrections(s.env.DB, 'u1')).toEqual([
			{ target_kind: 'contract_item', target_ref: `contract:21:${s.X}`, unit_price: 11, note: null },
			{ target_kind: 'job_input', target_ref: `job:31:${s.Y}`, unit_price: 1234.5, note: null }
		]);
		// Saved rows say so until the rebuild replaces the estimate.
		const data = await pageData(s);
		expect(data.counts).toMatchObject({ unpriced: 0, contracts: 0, total: 2 });
		expect(data.inputs.rows.find((r) => r.ref === `job:31:${s.Y}`)?.saved).toEqual({
			unitPrice: 1234.5,
			note: null
		});
	});

	it('rejects a bad price and a trade (not on this page)', async () => {
		const s = await setup();
		const bad = await settle(
			actions.correct(
				requestEvent(s.env, s.user, `${PATH}?/correct`, {
					kind: 'job_input',
					ref: `job:31:${s.X}`,
					unitPrice: '-1',
					note: ''
				})
			)
		);
		expect(bad.status).toBe(400);
		const trade = await settle(
			actions.correct(
				requestEvent(s.env, s.user, `${PATH}?/correct`, {
					kind: 'transaction',
					ref: 'transaction:901',
					unitPrice: '1',
					note: ''
				})
			)
		);
		expect(trade.status).toBe(404);
		expect(corrections(s.env.DB, 'u1')).toEqual([]);
	});

	it('"Use buy value" confirms the estimate; refuses another user’s job', async () => {
		const s = await setup();
		const ok = await settle(
			actions.confirm(requestEvent(s.env, s.user, `${PATH}?/confirm`, { ref: `job:32:${s.X}` }))
		);
		expect(ok.data).toEqual({
			action: 'confirm',
			ref: `job:32:${s.X}`,
			notice: correctionNotice('saved', true)
		});
		const foreign = await settle(
			actions.confirm(requestEvent(s.env, s.user, `${PATH}?/confirm`, { ref: `job:41:${s.X}` }))
		);
		expect(foreign.status).toBe(404);
		const malformed = await settle(
			actions.confirm(requestEvent(s.env, s.user, `${PATH}?/confirm`, { ref: 'job:x' }))
		);
		expect(malformed.status).toBe(404);
		expect(corrections(s.env.DB, 'u1')).toEqual([
			{ target_kind: 'job_input', target_ref: `job:32:${s.X}`, unit_price: 16, note: CONFIRMED_NOTE }
		]);
		expect(s.rebuildLedger).toHaveBeenCalledTimes(1);
	});

	it('"Use buy value for all" confirms every estimate of the item with one rebuild', async () => {
		const s = await setup();
		const result = await settle(
			actions.confirmAll(requestEvent(s.env, s.user, `${PATH}?/confirmAll`, { typeId: String(s.X) }))
		);
		expect(result.data).toEqual({
			action: 'confirmAll',
			ref: `type:${s.X}`,
			notice: '2 prices confirmed. Results recalculated.'
		});
		expect(corrections(s.env.DB, 'u1').map((c) => [c.target_ref, c.unit_price, c.note])).toEqual([
			[`job:31:${s.X}`, 15, CONFIRMED_NOTE],
			[`job:32:${s.X}`, 16, CONFIRMED_NOTE]
		]);
		expect(s.rebuildLedger).toHaveBeenCalledTimes(1);
		const again = await settle(
			actions.confirmAll(requestEvent(s.env, s.user, `${PATH}?/confirmAll`, { typeId: String(s.X) }))
		);
		expect(again.status).toBe(404);
	});
});
