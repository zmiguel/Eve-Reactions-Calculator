import { DEFAULT_SETTINGS } from '@reactions/engine';
import type { SdeDataset } from '@reactions/sde';
import { isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerPageData, LedgerRow } from '$lib/ledger/types';
import { clearDataMemo } from '$lib/server/data';
import { correctionNotice } from '$lib/server/price-corrections';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../../test/fakes';
import { NOW, insertUser, loadSde, putKv } from '../../../test/fixtures';
import { insertSource } from '../../../test/inventory';
import {
	corrections,
	insertContract,
	insertCorrection,
	insertJob,
	insertManualEntry,
	insertPrice,
	insertTransaction
} from '../../../test/ledger';
import { insertLot } from '../../../test/ledger-item';
import { sessionUser } from '../../../test/sso';
import { actions, load } from './+page.server';

const alpha = { characterId: 90000001, name: 'Alpha' };
const bravo = { characterId: 90000004, name: 'Bravo' };
const gamma = { characterId: 90000003, name: 'Gamma' };
const CORP = 98000001;
const OUTSIDER = 95000000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let sde: SdeDataset;
/** Two materials of the first reaction (names from the dataset) and its formula. */
let X: number;
let Y: number;
let FORMULA: number;
beforeAll(async () => {
	sde = await loadSde();
	const reaction = sde.dataset.reactions.find((r) => r.materials.length > 1)!;
	[X, Y] = reaction.materials.map((m) => m.typeId);
	FORMULA = reaction.blueprintTypeId;
});
beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

function updaterStub(result: unknown = { rebuiltAt: NOW, lots: 0, jobs: 0, needsReview: 0 }) {
	return { rebuildLedger: vi.fn(async (_userId: string) => result) };
}

async function accounts(extra: Record<string, unknown> = {}) {
	const env = fakeEnv({ UPDATER: updaterStub(), ...extra } as never);
	await putKv(env, sde);
	insertUser(env.DB, { userId: 'u1' }, [alpha, bravo]);
	insertUser(env.DB, { userId: 'u2' }, [gamma]);
	return { env, user: sessionUser('u1', [alpha, bravo]), other: sessionUser('u2', [gamma]) };
}

/**
 * u1: personal Alpha (tracked), corporation Moon Corp (tracked, wallet 2 named "Industry"), personal
 * Bravo (tracking off). Entries, newest first: contract 201 (Alpha buys X and Y, Y needs review),
 * trade 101 (Alpha buys X, corrected), trade 102 (corp division 2 sells Y, needs review), trade 103
 * (corp division 3, transfer of X), contract 202 (transfer of X from Alpha to the corporation).
 * Never listed: contract 203 (no prices, not a transfer), trade 104 (tracking off), u2's trade 105.
 */
async function ledgerAccounts(extra: Record<string, unknown> = {}) {
	const setup = await accounts(extra);
	const { env } = setup;
	const db = env.DB;
	const personal = insertSource(db, {
		userId: 'u1',
		characterId: alpha.characterId,
		ownerName: 'Alpha',
		trackingEnabled: true
	});
	const corp = insertSource(db, {
		userId: 'u1',
		characterId: alpha.characterId,
		kind: 'corporation',
		ownerId: CORP,
		ownerName: 'Moon Corp',
		trackingEnabled: true,
		walletNames: { '2': 'Industry' }
	});
	const off = insertSource(db, { userId: 'u1', characterId: bravo.characterId, ownerName: 'Bravo' });
	const theirs = insertSource(db, {
		userId: 'u2',
		characterId: gamma.characterId,
		ownerName: 'Gamma',
		trackingEnabled: true
	});

	insertTransaction(db, { userId: 'u1', sourceId: personal, transactionId: 101, typeId: X, unitPrice: 95 });
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:101',
		typeId: X,
		at: NOW - HOUR,
		unitPrice: 90,
		sourceKind: 'correction',
		sourceText: 'Your correction',
		tax: 0,
		taxSource: 'none',
		brokerFee: 12,
		brokerFeeSource: 'journal'
	});
	insertCorrection(db, 'u1', 'transaction', 'transaction:101', 90, 'Paid in cash');

	insertTransaction(db, {
		userId: 'u1',
		sourceId: corp,
		transactionId: 102,
		typeId: Y,
		isBuy: false,
		division: 2
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:102',
		typeId: Y,
		incoming: false,
		at: NOW - 2 * HOUR,
		needsReview: true,
		tax: 30,
		taxSource: 'estimated',
		brokerFee: 0,
		brokerFeeSource: 'none'
	});

	insertTransaction(db, { userId: 'u1', sourceId: corp, transactionId: 103, typeId: X, division: 3 });
	insertPrice(db, { userId: 'u1', ref: 'transaction:103', typeId: X, at: NOW - 3 * HOUR, transfer: true });

	insertContract(db, {
		userId: 'u1',
		sourceId: personal,
		contractId: 201,
		acceptorId: alpha.characterId,
		issuerId: OUTSIDER,
		price: 1_000_000,
		title: 'Moon goo https://janice.e-351.com/a/AbC',
		janiceCode: 'AbC',
		items: [
			[X, 100],
			[Y, 50]
		]
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'contract:201',
		typeId: X,
		at: NOW - HOUR / 2,
		quantity: 100,
		unitPrice: 6000,
		sourceKind: 'janice',
		sourceText: 'Janice appraisal AbC'
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'contract:201',
		typeId: Y,
		at: NOW - HOUR / 2,
		quantity: 50,
		unitPrice: 8000,
		sourceKind: 'review',
		sourceText: 'Items went both ways: check',
		needsReview: true
	});
	insertCorrection(db, 'u1', 'contract_item', `contract:201:${Y}`, 8000);

	insertContract(db, {
		userId: 'u1',
		sourceId: corp,
		contractId: 202,
		issuerId: alpha.characterId,
		acceptorId: CORP,
		dateIssued: NOW - 5 * HOUR,
		dateCompleted: NOW - 4 * HOUR,
		items: [[X, 10]]
	});
	insertContract(db, {
		userId: 'u1',
		sourceId: personal,
		contractId: 203,
		issuerId: alpha.characterId,
		acceptorId: OUTSIDER,
		items: [[X, 5]]
	});

	insertTransaction(db, { userId: 'u1', sourceId: off, transactionId: 104, typeId: Y });
	insertPrice(db, { userId: 'u1', ref: 'transaction:104', typeId: Y, needsReview: true });

	insertTransaction(db, { userId: 'u2', sourceId: theirs, transactionId: 105, typeId: X });
	insertPrice(db, { userId: 'u2', ref: 'transaction:105', typeId: X, needsReview: true });

	return { ...setup, personal, corp, off, theirs };
}

function event(env: FakeEnv, user: SessionUser | null, search = '', fields?: Record<string, string>) {
	const url = new URL(`https://reactions.coalition.space/profits/ledger${search}`);
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
	}
	return {
		url,
		params: {},
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function settle(
	promise: unknown
): Promise<{ status?: number; data?: unknown; redirect?: string; error?: number }> {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		if (isHttpError(e)) return { error: e.status };
		throw e;
	}
}

const pageData = async (env: FakeEnv, user: SessionUser | null, search = '') =>
	(await load(event(env, user, search))) as LedgerPageData;

const keys = (rows: LedgerRow[]) =>
	rows.map((r) =>
		r.kind === 'market' ? `t${r.transactionId}` : r.kind === 'contract' ? `c${r.contractId}` : `m${r.entryId}`
	);

/** A journal row of `sourceId` (contract fees: context `contract_id`). */
function insertJournal(
	env: FakeEnv,
	userId: string,
	sourceId: number,
	refId: number,
	refType: string,
	amount: number,
	contractId: number | null = null
) {
	env.DB.sqlite
		.prepare(
			`INSERT INTO tracked_journal (user_id, ref_id, source_id, division, date, ref_type, amount, context_id,
				context_id_type) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			refId,
			sourceId,
			NOW - HOUR,
			refType,
			amount,
			contractId,
			contractId === null ? null : 'contract_id'
		);
}

/** A market fee no order matched (journal row `refId` of `sourceId`). */
function insertOtherFee(
	env: FakeEnv,
	userId: string,
	sourceId: number,
	refId: number,
	amount: number,
	date = NOW - HOUR
) {
	insertJournal(env, userId, sourceId, refId, 'brokers_fee', -amount);
	env.DB.sqlite
		.prepare('INSERT INTO ledger_unallocated_fees (user_id, ref_id, date, amount) VALUES (?, ?, ?, ?)')
		.run(userId, refId, date, amount);
}

/**
 * Fees on top of `ledgerAccounts`: contract 201 cost a 500 ISK contract broker fee (203, not in the
 * ledger, and u2's contract fee never count); an unmatched broker fee of 70 ISK on Alpha's wallet, one of
 * 40 ISK 60 days ago, and one of 1,000 ISK on the tracking-off connection.
 */
async function feeAccounts() {
	const setup = await ledgerAccounts();
	const { env, personal, off, theirs } = setup;
	insertJournal(env, 'u1', personal, 1, 'contract_brokers_fee', -500, 201);
	insertJournal(env, 'u1', personal, 2, 'contract_brokers_fee', -800, 203);
	insertJournal(env, 'u1', personal, 3, 'contract_price', -1_000_000, 201);
	insertJournal(env, 'u2', theirs, 1, 'contract_sales_tax', -900, 201);
	insertOtherFee(env, 'u1', personal, 10, 70);
	insertOtherFee(env, 'u1', personal, 11, 40, NOW - 60 * DAY);
	insertOtherFee(env, 'u1', off, 12, 1000);
	return setup;
}

/** A type no reaction uses (a module). */
const MODULE = 4405;

/**
 * "Not tracked" prices on top of `feeAccounts`: trade 106 (Alpha buys 5 modules at 1,000, broker fee
 * 50), contract 204 of only modules (contract fee 300) and contract 205 of 10 X at 100 plus a module
 * (contract fee 200).
 */
async function untrackedAccounts() {
	const setup = await feeAccounts();
	const { env, personal } = setup;
	const db = env.DB;
	const untracked = { sourceKind: 'untracked', sourceText: 'Not tracked: not used by any reaction' };
	insertTransaction(db, { userId: 'u1', sourceId: personal, transactionId: 106, typeId: MODULE });
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:106',
		typeId: MODULE,
		at: NOW - 6 * HOUR,
		quantity: 5,
		unitPrice: 1000,
		brokerFee: 50,
		brokerFeeSource: 'estimated',
		...untracked
	});
	for (const [contractId, items] of [
		[204, [[MODULE, 2]]],
		[
			205,
			[
				[X, 10],
				[MODULE, 1]
			]
		]
	] as [number, [number, number][]][]) {
		insertContract(db, {
			userId: 'u1',
			sourceId: personal,
			contractId,
			acceptorId: alpha.characterId,
			issuerId: OUTSIDER,
			price: 5000,
			dateIssued: NOW - 7 * HOUR,
			items
		});
	}
	insertPrice(db, {
		userId: 'u1',
		ref: 'contract:204',
		typeId: MODULE,
		quantity: 2,
		unitPrice: 2500,
		...untracked
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'contract:205',
		typeId: X,
		quantity: 10,
		unitPrice: 100,
		sourceKind: 'contract_mixed',
		sourceText: 'Contract with untracked items'
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'contract:205',
		typeId: MODULE,
		quantity: 1,
		unitPrice: 4000,
		...untracked
	});
	insertJournal(env, 'u1', personal, 4, 'contract_brokers_fee', -300, 204);
	insertJournal(env, 'u1', personal, 5, 'contract_brokers_fee', -200, 205);
	return setup;
}

describe('/profits/ledger load', () => {
	it('returns empty data without work for anonymous visitors and accounts without tracking (the layout shows the gate)', async () => {
		const { env, user } = await accounts();
		const off = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		insertTransaction(env.DB, { userId: 'u1', sourceId: off, transactionId: 1, typeId: 1 });
		insertPrice(env.DB, { userId: 'u1', ref: 'transaction:1', typeId: 1, needsReview: true });
		for (const visitor of [null, user]) {
			const data = await pageData(env, visitor, '?review=1');
			expect(data).toMatchObject({
				tracked: false,
				rows: { rows: [], total: 0 },
				summary: { bought: 0, sold: 0, reviewCount: 0 },
				types: [],
				connections: []
			});
			expect(data.filters.review).toBe(true);
		}
	});

	it('sends a filter form submitted without JS to the address without its empty fields', async () => {
		const { env, user } = await accounts();
		expect(await settle(load(event(env, user, '?period=&direction=out&kind=&type=')))).toEqual({
			redirect: '/profits/ledger?direction=out'
		});
		expect(await settle(load(event(env, user, '?period=&kind=')))).toEqual({ redirect: '/profits/ledger' });
		expect((await settle(load(event(env, user, '?direction=out')))).redirect).toBeUndefined();
	});

	it('lists trades and contracts of tracked connections only, newest first', async () => {
		const { env, user, personal, corp } = await ledgerAccounts();
		const data = await pageData(env, user);
		expect(keys(data.rows.rows)).toEqual(['c201', 't101', 't102', 't103', 'c202']);
		expect(data).toMatchObject({ tracked: true, rows: { total: 5, page: 1, pageCount: 1 } });
		expect(data.summary.reviewCount).toBe(2);
		expect(data.connections).toEqual([
			{ sourceId: personal, name: 'Alpha', kind: 'character' },
			{ sourceId: corp, name: 'Moon Corp', kind: 'corporation' }
		]);
		const name = (typeId: number) => sde.dataset.types[typeId].name;
		expect(data.types).toEqual(
			[X, Y]
				.map((typeId) => ({ typeId, name: name(typeId), formula: false }))
				.sort((a, b) => a.name.localeCompare(b.name))
		);
	});

	it('is tracked but empty when the filters match nothing', async () => {
		const { env, user, off } = await ledgerAccounts();
		const data = await pageData(env, user, `?connection=${off}`);
		expect(data).toMatchObject({ tracked: true, rows: { rows: [], total: 0 } });
	});

	it('describes trades: owner and wallet division, direction, prices, fees and corrections', async () => {
		const { env, user } = await ledgerAccounts();
		const rows = (await pageData(env, user, '?kind=market')).rows.rows;
		expect(rows[0]).toEqual({
			kind: 'market',
			transactionId: 101,
			at: NOW - HOUR,
			owner: { name: 'Alpha', division: null },
			direction: 'bought',
			typeId: X,
			name: sde.dataset.types[X].name,
			formula: false,
			quantity: 10,
			grossUnitPrice: 95,
			tax: 0,
			taxSource: 'none',
			brokerFee: 12,
			brokerFeeSource: 'journal',
			price: {
				kind: 'transaction',
				ref: 'transaction:101',
				unitPrice: 90,
				total: 900,
				sourceKind: 'correction',
				sourceText: 'Your correction',
				needsReview: false,
				correction: { unitPrice: 90, note: 'Paid in cash' }
			}
		});
		expect(rows[1]).toMatchObject({
			owner: { name: 'Moon Corp', division: 'Industry' },
			direction: 'sold',
			taxSource: 'estimated',
			price: { needsReview: true, correction: null }
		});
		expect(rows[2]).toMatchObject({
			owner: { name: 'Moon Corp', division: 'Division 3' },
			direction: 'transfer'
		});
	});

	it('describes contracts with their items, and transfers without ledger prices', async () => {
		const { env, user } = await ledgerAccounts();
		const rows = (await pageData(env, user, '?kind=contract')).rows.rows;
		expect(rows[0]).toMatchObject({
			kind: 'contract',
			contractId: 201,
			at: NOW - HOUR / 2,
			owner: { name: 'Alpha', division: null },
			direction: 'buy',
			title: 'Moon goo https://janice.e-351.com/a/AbC',
			janiceCode: 'AbC',
			janiceOwn: false,
			titleJanice: true,
			total: 1_000_000,
			itemCount: 2,
			needsReview: true
		});
		expect(rows[0].kind === 'contract' && rows[0].items).toEqual(
			[X, Y].map((typeId) =>
				expect.objectContaining({
					typeId,
					incoming: true,
					price: expect.objectContaining({
						kind: 'contract_item',
						ref: `contract:201:${typeId}`,
						correction: typeId === Y ? { unitPrice: 8000, note: null } : null
					})
				})
			)
		);
		expect(rows[1]).toMatchObject({
			contractId: 202,
			at: NOW - 4 * HOUR,
			owner: { name: 'Moon Corp', division: null },
			direction: 'transfer',
			itemCount: 1,
			needsReview: false,
			items: [{ typeId: X, quantity: 10, incoming: null, price: null }]
		});
		expect(rows).toHaveLength(2);
	});

	it('lists a contract assigned to an own corporation and accepted by another member as a transfer', async () => {
		const { env, user, corp } = await ledgerAccounts();
		const own = { userId: 'u1', sourceId: corp, issuerId: alpha.characterId, assigneeId: CORP };
		const items: [number, number][] = [[X, 5]];
		insertContract(env.DB, {
			...own,
			items,
			contractId: 204,
			acceptorId: OUTSIDER,
			dateIssued: NOW - 6 * HOUR
		});
		// Not accepted yet: nobody received the items.
		insertContract(env.DB, { ...own, items, contractId: 205, acceptorId: 0, dateIssued: NOW - 7 * HOUR });
		const rows = (await pageData(env, user, '?kind=contract&direction=transfer')).rows.rows;
		expect(rows.map((r) => r.kind === 'contract' && r.contractId)).toEqual([202, 204]);
	});

	it.each([
		['?type=X', ['c201', 't101', 't103', 'c202']],
		['?type=Y', ['c201', 't102']],
		['?direction=in', ['c201', 't101']],
		['?direction=out', ['t102']],
		['?direction=transfer', ['t103', 'c202']],
		['?kind=market', ['t101', 't102', 't103']],
		['?kind=contract', ['c201', 'c202']],
		['?connection=CORP', ['t102', 't103', 'c202']],
		['?connection=PERSONAL', ['c201', 't101']],
		['?connection=OFF', []],
		['?connection=THEIRS', []],
		['?review=1', ['c201', 't102']],
		['?kind=market&connection=CORP', ['t102', 't103']],
		['?direction=transfer&kind=contract', ['c202']],
		['?type=X&review=1', ['c201']],
		['?type=Y&direction=out&kind=market&connection=CORP&review=1', ['t102']],
		['?period=7', ['c201', 't101', 't102', 't103', 'c202']],
		['?direction=sideways&kind=other&type=abc&period=12', ['c201', 't101', 't102', 't103', 'c202']]
	])('filters %s', async (search, expected) => {
		const { env, user, personal, corp, off, theirs } = await ledgerAccounts();
		const query = search
			.replace('type=X', `type=${X}`)
			.replace('type=Y', `type=${Y}`)
			.replace('CORP', String(corp))
			.replace('PERSONAL', String(personal))
			.replace('OFF', String(off))
			.replace('THEIRS', String(theirs));
		const data = await pageData(env, user, query);
		expect(keys(data.rows.rows)).toEqual(expected);
		expect(data.rows.total).toBe(expected.length);
	});

	it.each([
		['', ['t5', 't20', 't40']],
		['?period=7', ['t5']],
		['?period=30', ['t5', 't20']],
		['?period=90', ['t5', 't20', 't40']],
		['?period=365', ['t5', 't20', 't40']]
	])('period %s keeps the rows of the last days only', async (search, expected) => {
		const { env, user } = await accounts();
		const source = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			trackingEnabled: true
		});
		for (const days of [5, 20, 40]) {
			insertTransaction(env.DB, { userId: 'u1', sourceId: source, transactionId: days, typeId: X });
			insertPrice(env.DB, { userId: 'u1', ref: `transaction:${days}`, typeId: X, at: NOW - days * DAY });
		}
		const data = await pageData(env, user, search);
		expect(keys(data.rows.rows)).toEqual(expected);
		expect(data.summary.bought).toBe(expected.length * 1000);
	});

	it('pages 10 rows newest first and clamps a page past the end', async () => {
		const { env, user } = await accounts();
		const source = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			trackingEnabled: true
		});
		for (let id = 1; id <= 25; id++) {
			insertTransaction(env.DB, { userId: 'u1', sourceId: source, transactionId: id, typeId: FORMULA });
			insertPrice(env.DB, { userId: 'u1', ref: `transaction:${id}`, typeId: FORMULA, at: NOW - id * 1000 });
		}
		const first = await pageData(env, user);
		expect(first.rows).toMatchObject({ total: 25, page: 1, pageCount: 3 });
		expect(keys(first.rows.rows)).toEqual(Array.from({ length: 10 }, (_, i) => `t${i + 1}`));
		expect(first.rows.rows[0]).toMatchObject({ formula: true });
		const last = await pageData(env, user, '?page=3');
		expect(keys(last.rows.rows)).toEqual(['t21', 't22', 't23', 't24', 't25']);
		expect((await pageData(env, user, '?page=9')).rows).toEqual(last.rows);
		// The totals cover every page.
		expect(last.summary.bought).toBe(25 * 1000);
	});

	it("never shows another user's rows", async () => {
		const { env, other } = await ledgerAccounts();
		const data = await pageData(env, other);
		expect(keys(data.rows.rows)).toEqual(['t105']);
		expect(data.summary.reviewCount).toBe(1);
	});

	it('reports when results were recalculated or are waiting', async () => {
		const { env, user } = await ledgerAccounts();
		expect(await pageData(env, user)).toMatchObject({ rebuiltAt: null, dirty: false });
		env.DB.sqlite
			.prepare('INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES (?, ?, 0)')
			.run('u1', NOW);
		expect(await pageData(env, user)).toMatchObject({ rebuiltAt: NOW, dirty: false });
		env.DB.sqlite.prepare('UPDATE ledger_state SET dirty = 1').run();
		expect(await pageData(env, user)).toMatchObject({ dirty: true });
	});
});

describe('/profits/ledger summary', () => {
	// Prices of `ledgerAccounts`: trade 101 bought 10 at 90 (broker fee 12 from the journal), trade 102 sold
	// 10 at 100 (sales tax 30, estimated), trade 103 a transfer, contract 201 bought 100 X at 6,000 and 50 Y
	// at 8,000, contract 202 a transfer.
	it.each([
		[
			'everything',
			'',
			{
				bought: 900 + 1_000_000,
				sold: 1000,
				reviewCount: 2,
				fees: {
					brokerFees: 12,
					salesTax: 30,
					contractFees: 500,
					otherMarketFees: 110,
					total: 652,
					estimated: true
				}
			}
		],
		[
			'one item: only its prices, no unmatched market fees',
			'?type=X',
			{
				bought: 900 + 600_000,
				sold: 0,
				reviewCount: 1,
				fees: {
					brokerFees: 12,
					salesTax: 0,
					contractFees: 500,
					otherMarketFees: 0,
					total: 512,
					estimated: false
				}
			}
		],
		[
			'sales',
			'?direction=out',
			{
				bought: 0,
				sold: 1000,
				reviewCount: 1,
				fees: { brokerFees: 0, salesTax: 30, contractFees: 0, otherMarketFees: 0, total: 30, estimated: true }
			}
		],
		[
			'contracts',
			'?kind=contract',
			{
				bought: 1_000_000,
				sold: 0,
				reviewCount: 1,
				fees: {
					brokerFees: 0,
					salesTax: 0,
					contractFees: 500,
					otherMarketFees: 0,
					total: 500,
					estimated: false
				}
			}
		],
		[
			'purchases you entered: no unmatched market fees',
			'?kind=manual',
			{ fees: expect.objectContaining({ brokerFees: 0, otherMarketFees: 0 }) }
		],
		[
			'market trades: with the unmatched market fees',
			'?kind=market',
			{ fees: expect.objectContaining({ otherMarketFees: 110 }) }
		],
		[
			'the corporation',
			'?connection=CORP',
			{
				bought: 0,
				sold: 1000,
				reviewCount: 1,
				fees: { brokerFees: 0, salesTax: 30, contractFees: 0, otherMarketFees: 0, total: 30, estimated: true }
			}
		],
		[
			'the last 30 days (without the 60-day-old unmatched fee)',
			'?period=30',
			{ bought: 900 + 1_000_000, fees: expect.objectContaining({ otherMarketFees: 70, total: 612 }) }
		]
	])('sums %s', async (_case, search, expected) => {
		const { env, user, corp } = await feeAccounts();
		const query = search.replace('type=X', `type=${X}`).replace('CORP', String(corp));
		expect((await pageData(env, user, query)).summary).toMatchObject(expected);
	});

	it('counts only what needs review among the filtered rows', async () => {
		const { env, user, personal } = await feeAccounts();
		expect((await pageData(env, user, `?connection=${personal}`)).summary.reviewCount).toBe(1);
		expect((await pageData(env, user, '?direction=transfer')).summary.reviewCount).toBe(0);
		expect((await pageData(env, user, '?review=1')).summary.reviewCount).toBe(2);
	});

	it('lists "Not tracked" prices but leaves them out of every total and of the review count', async () => {
		const { env, user } = await untrackedAccounts();
		const data = await pageData(env, user);
		expect(keys(data.rows.rows)).toEqual(expect.arrayContaining(['t106', 'c204', 'c205']));
		expect(data.summary).toMatchObject({
			bought: 900 + 1_000_000 + 1000,
			sold: 1000,
			reviewCount: 2,
			fees: { brokerFees: 12, salesTax: 30, contractFees: 500 + 200, otherMarketFees: 110, total: 852 }
		});
		for (const id of [204, 205]) {
			const contract = data.rows.rows.find((r) => r.kind === 'contract' && r.contractId === id);
			expect(contract).toMatchObject({ needsReview: false });
		}
		expect(keys((await pageData(env, user, '?review=1')).rows.rows)).toEqual(['c201', 't102']);
		// Only the untracked trade: nothing to sum, no estimated fees.
		expect((await pageData(env, user, `?type=${MODULE}&kind=market`)).summary).toMatchObject({
			bought: 0,
			fees: expect.objectContaining({ brokerFees: 0, estimated: false })
		});
	});
});

describe('/profits/ledger actions', () => {
	const CORRECT = { kind: 'transaction', ref: 'transaction:102', unitPrice: '150', note: 'Sold to a friend' };

	it('sends anonymous visitors to log in and back to the same page', async () => {
		const { env } = await accounts();
		const login = '/auth/login?purpose=login&returnTo=%2Fprofits%2Fledger%3Freview%3D1';
		expect(await settle(actions.correct(event(env, null, '?review=1', CORRECT)))).toEqual({
			redirect: login
		});
		expect(await settle(actions.undo(event(env, null, '?review=1', CORRECT)))).toEqual({ redirect: login });
	});

	it('answers 404 to an account without Profit tracking and stores nothing', async () => {
		const { env, user } = await accounts();
		expect(await settle(actions.correct(event(env, user, '', CORRECT)))).toEqual({ error: 404 });
		expect(corrections(env.DB, 'u1')).toEqual([]);
	});

	it.each([
		['rebuilt', { rebuiltAt: NOW, lots: 0, jobs: 0, needsReview: 0 }, true],
		['not rebuilt', { error: 'unavailable' }, false]
	])('correct stores the price and notes when the results were %s', async (_case, result, rebuilt) => {
		const UPDATER = updaterStub(result);
		const { env, user } = await ledgerAccounts({ UPDATER });
		expect(await settle(actions.correct(event(env, user, '', CORRECT)))).toEqual({
			data: { action: 'correct', ref: 'transaction:102', notice: correctionNotice('saved', rebuilt) }
		});
		expect(corrections(env.DB, 'u1')).toContainEqual({
			target_kind: 'transaction',
			target_ref: 'transaction:102',
			unit_price: 150,
			note: 'Sold to a friend'
		});
		expect(UPDATER.rebuildLedger).toHaveBeenCalledWith('u1');
	});

	it('correcting a contract item says the other items share the rest of the total', async () => {
		const { env, user } = await ledgerAccounts();
		const fields = { kind: 'contract_item', ref: `contract:201:${X}`, unitPrice: '5000', note: '' };
		const outcome = await settle(actions.correct(event(env, user, '', fields)));
		const saved = correctionNotice('saved', true);
		expect(outcome.data).toMatchObject({ action: 'correct', notice: expect.stringContaining(saved) });
		// More than the plain notice: the re-split of the other items is explained.
		expect(outcome.data).not.toMatchObject({ notice: saved });
		expect(corrections(env.DB, 'u1').map((c) => [c.target_ref, c.unit_price])).toContainEqual([
			`contract:201:${X}`,
			5000
		]);
	});

	it.each([
		['rebuilt', { rebuiltAt: NOW, lots: 0, jobs: 0, needsReview: 0 }, true],
		['not rebuilt', { error: 'unavailable' }, false]
	])('undo removes a contract item correction when the results were %s', async (_case, result, rebuilt) => {
		const { env, user } = await ledgerAccounts({ UPDATER: updaterStub(result) });
		const fields = { kind: 'contract_item', ref: `contract:201:${Y}` };
		const outcome = await settle(actions.undo(event(env, user, '', fields)));
		expect(outcome.data).toMatchObject({ action: 'undo', ref: `contract:201:${Y}` });
		expect(outcome.data).toMatchObject({
			notice: expect.stringContaining(correctionNotice('removed', rebuilt))
		});
		expect(outcome.data).not.toMatchObject({ notice: correctionNotice('removed', rebuilt) });
		expect(corrections(env.DB, 'u1').map((c) => c.target_ref)).toEqual(['transaction:101']);
	});

	it.each([
		['a negative price', { ...CORRECT, unitPrice: '-1' }],
		['an absurd price', { ...CORRECT, unitPrice: '1e14' }],
		['no price', { ...CORRECT, unitPrice: '' }],
		['not a number', { ...CORRECT, unitPrice: 'abc' }],
		['a long note', { ...CORRECT, note: 'x'.repeat(201) }]
	])('correct rejects %s with 400, a message and the values typed', async (_case, fields) => {
		const { env, user } = await ledgerAccounts();
		const outcome = await settle(actions.correct(event(env, user, '', fields)));
		expect(outcome).toMatchObject({
			status: 400,
			data: {
				action: 'correct',
				ref: 'transaction:102',
				error: expect.any(String),
				values: { unitPrice: fields.unitPrice, note: fields.note }
			}
		});
		expect(corrections(env.DB, 'u1').map((c) => c.target_ref)).not.toContain('transaction:102');
	});

	it.each([
		["another user's trade", { kind: 'transaction', ref: 'transaction:105' }],
		['an unknown contract item', { kind: 'contract_item', ref: 'contract:201:1' }],
		['a malformed ref', { kind: 'transaction', ref: 'transaction:abc' }],
		['a job input (not on this page)', { kind: 'job_input', ref: 'job:1:1' }]
	])('correct answers 404 for %s', async (_case, target) => {
		const { env, user } = await ledgerAccounts();
		const outcome = await settle(
			actions.correct(event(env, user, '', { ...target, unitPrice: '5', note: '' }))
		);
		expect(outcome).toMatchObject({
			status: 404,
			data: { action: 'correct', ref: target.ref, error: expect.any(String) }
		});
		expect(corrections(env.DB, 'u2')).toEqual([]);
		expect(corrections(env.DB, 'u1')).toHaveLength(2);
	});

	it.each([
		['an untracked trade', { kind: 'transaction', ref: 'transaction:106' }],
		['an untracked contract item', { kind: 'contract_item', ref: `contract:205:${MODULE}` }]
	])('correct refuses %s with 400 and stores nothing', async (_case, target) => {
		const { env, user } = await untrackedAccounts();
		const outcome = await settle(
			actions.correct(event(env, user, '', { ...target, unitPrice: '5', note: '' }))
		);
		expect(outcome).toMatchObject({
			status: 400,
			data: { action: 'correct', ref: target.ref, error: expect.any(String) }
		});
		expect(corrections(env.DB, 'u1').map((c) => c.target_ref)).not.toContain(target.ref);
	});

	it("undo answers 404 when there is no correction, and leaves another user's correction alone", async () => {
		const { env, user } = await ledgerAccounts();
		insertCorrection(env.DB, 'u2', 'transaction', 'transaction:102', 1);
		const outcome = await settle(
			actions.undo(event(env, user, '', { kind: 'transaction', ref: 'transaction:102' }))
		);
		expect(outcome).toMatchObject({ status: 404, data: { action: 'undo', ref: 'transaction:102' } });
		expect(corrections(env.DB, 'u2')).toHaveLength(1);
	});

	it('rate limits per account with a 429 notice and stores nothing', async () => {
		const limit = vi.fn(async (_options: { key: string }) => ({ success: false }));
		const { env, user } = await ledgerAccounts({ ACCOUNT_RATE_LIMITER: { limit } });
		const outcome = await settle(actions.correct(event(env, user, '', CORRECT)));
		expect(outcome).toMatchObject({ status: 429, data: { action: 'correct', ref: 'transaction:102' } });
		expect(limit).toHaveBeenCalledWith({ key: 'inventory:u1' });
		expect(corrections(env.DB, 'u1').map((c) => c.target_ref)).not.toContain('transaction:102');
		expect(
			await settle(actions.undo(event(env, user, '', { kind: 'transaction', ref: 'transaction:101' })))
		).toMatchObject({ status: 429 });
		expect(corrections(env.DB, 'u1').map((c) => c.target_ref)).toContain('transaction:101');
	});
});

describe('/profits/ledger purchases entered by the user', () => {
	/** On top of `ledgerAccounts`: u1 entered 4 X at 25 (90 min ago), u2 entered one too. */
	async function withManual() {
		const setup = await ledgerAccounts();
		const entryId = insertManualEntry(setup.env.DB, 'u1', {
			typeId: X,
			date: NOW - 1.5 * HOUR,
			quantity: 4,
			unitPrice: 25,
			note: 'From a friend'
		});
		insertManualEntry(setup.env.DB, 'u2', { typeId: X, date: NOW - HOUR });
		return { ...setup, entryId };
	}

	it('lists them as purchases in date order with their own source', async () => {
		const { env, user, entryId } = await withManual();
		const data = await pageData(env, user);
		expect(keys(data.rows.rows)).toEqual(['c201', 't101', `m${entryId}`, 't102', 't103', 'c202']);
		expect(data.rows.rows[2]).toEqual({
			kind: 'manual',
			entryId,
			at: NOW - 1.5 * HOUR,
			typeId: X,
			name: sde.dataset.types[X].name,
			formula: false,
			quantity: 4,
			unitPrice: 25,
			total: 100,
			note: 'From a friend'
		});
	});

	it('filters them by kind, item and direction; a connection filter leaves them out', async () => {
		const { env, user, personal, entryId } = await withManual();
		const manual = await pageData(env, user, '?kind=manual');
		expect(keys(manual.rows.rows)).toEqual([`m${entryId}`]);
		expect(manual.summary).toMatchObject({ bought: 100, sold: 0, reviewCount: 0 });
		expect(keys((await pageData(env, user, `?type=${Y}&direction=in`)).rows.rows)).toEqual(['c201']);
		expect(keys((await pageData(env, user, `?type=${X}&direction=in`)).rows.rows)).toContain(`m${entryId}`);
		expect(keys((await pageData(env, user, '?direction=out')).rows.rows)).not.toContain(`m${entryId}`);
		expect(keys((await pageData(env, user, `?connection=${personal}`)).rows.rows)).not.toContain(
			`m${entryId}`
		);
	});

	it('counts the prices to reconcile for the "Missing prices" button', async () => {
		const { env, user, personal } = await withManual();
		expect((await pageData(env, user)).missingCount).toBe(0);
		insertJob(env.DB, 'u1', personal, 77, FORMULA);
		insertLot(env.DB, 'u1', {
			lotId: 1,
			typeId: X,
			acquiredAt: NOW - 2 * HOUR,
			quantity: 5,
			remaining: 0,
			unitCost: 7,
			origin: 'market',
			originRef: 'job:77'
		});
		expect((await pageData(env, user)).missingCount).toBe(1);
	});
});

describe('/profits/ledger Janice link of a contract', () => {
	const APPRAISAL = JSON.stringify({ code: 'AbC', items: [] });

	/** `ledgerAccounts` plus contract 204 (title link AbC, appraised) and u2's contract 301. */
	async function janiceAccounts(setContractJanice = vi.fn(async () => ({ rebuilt: true }))) {
		const UPDATER = { ...updaterStub(), setContractJanice };
		const setup = await ledgerAccounts({ UPDATER });
		const db = setup.env.DB;
		insertContract(db, {
			userId: 'u1',
			sourceId: setup.personal,
			contractId: 204,
			title: 'More https://janice.e-351.com/a/AbC',
			janiceCode: 'AbC',
			items: [[X, 1]]
		});
		insertContract(db, { userId: 'u2', sourceId: setup.theirs, contractId: 301, items: [[X, 1]] });
		db.sqlite
			.prepare("UPDATE tracked_contracts SET janice_json = ? WHERE janice_code = 'AbC'")
			.run(APPRAISAL);
		return { ...setup, UPDATER };
	}

	const stored = (env: FakeEnv, contractId: number) =>
		env.DB.sqlite
			.prepare('SELECT janice_code, janice_json FROM tracked_contracts WHERE contract_id = ?')
			.get(contractId);
	const contractRow = async (env: FakeEnv, user: SessionUser, contractId: number) =>
		(await pageData(env, user, '?kind=contract')).rows.rows.find(
			(r) => r.kind === 'contract' && r.contractId === contractId
		);

	it('asks the updater for the first appraisal linked in the text and confirms', async () => {
		const { env, user, UPDATER } = await janiceAccounts();
		const fields = { ref: 'contract:201', link: 'see https://janice.e-351.com/a/XyZ9 and /a/Other' };
		expect(await settle(actions.contractJanice(event(env, user, '?review=1', fields)))).toEqual({
			data: { action: 'contractJanice', ref: 'contract:201', notice: expect.any(String) }
		});
		expect(UPDATER.setContractJanice.mock.calls).toEqual([['u1', 201, 'XyZ9']]);
	});

	it.each([
		["another user's contract", 'contract:301'],
		['an unknown contract', 'contract:999'],
		['a malformed reference', 'contract:abc']
	])('answers 404 for %s without asking the updater', async (_case, ref) => {
		const { env, user, UPDATER } = await janiceAccounts();
		const fields = { ref, link: 'https://janice.e-351.com/a/XyZ9' };
		expect(await settle(actions.contractJanice(event(env, user, '', fields)))).toMatchObject({
			status: 404,
			data: { action: 'contractJanice', ref, error: expect.any(String) }
		});
		expect(UPDATER.setContractJanice).not.toHaveBeenCalled();
	});

	it.each([['nothing'], ['XyZ9'], ['https://example.com/a/XyZ9']])(
		'answers 400 to "%s" (not a Janice link), giving it back',
		async (link) => {
			const { env, user, UPDATER } = await janiceAccounts();
			const outcome = await settle(
				actions.contractJanice(event(env, user, '', { ref: 'contract:201', link }))
			);
			expect(outcome).toMatchObject({
				status: 400,
				data: { ref: 'contract:201', error: expect.any(String), link }
			});
			expect(UPDATER.setContractJanice).not.toHaveBeenCalled();
		}
	);

	it.each([
		['Janice has no such appraisal', async () => ({ error: 'unknown' }), 400],
		['the fetch failed', async () => ({ error: 'failed' }), 502],
		['the updater has no Janice key', async () => ({ error: 'unavailable' }), 503],
		['the updater does not answer', () => Promise.reject(new Error('down')), 502]
	])('shows an error when %s', async (_case, answer, status) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env, user } = await janiceAccounts(vi.fn(answer) as never);
		const fields = { ref: 'contract:201', link: 'https://janice.e-351.com/a/XyZ9' };
		expect(await settle(actions.contractJanice(event(env, user, '', fields)))).toMatchObject({
			status,
			data: { action: 'contractJanice', ref: 'contract:201', error: expect.any(String) }
		});
	});

	it('is rate limited like the other ledger actions', async () => {
		const limit = vi.fn(async (_options: { key: string }) => ({ success: false }));
		const setContractJanice = vi.fn(async () => ({ rebuilt: true }));
		const setup = await ledgerAccounts({
			ACCOUNT_RATE_LIMITER: { limit },
			UPDATER: { ...updaterStub(), setContractJanice }
		});
		const fields = { ref: 'contract:201', link: 'https://janice.e-351.com/a/XyZ9' };
		expect(await settle(actions.contractJanice(event(setup.env, setup.user, '', fields)))).toMatchObject({
			status: 429
		});
		expect(setContractJanice).not.toHaveBeenCalled();
	});

	it("marks the user's appraisal and removing it restores the title's link with its appraisal", async () => {
		const { env, user, UPDATER } = await janiceAccounts();
		env.DB.sqlite
			.prepare(
				"UPDATE tracked_contracts SET janice_code = 'XyZ9', janice_json = '{}' WHERE contract_id = 201"
			)
			.run();
		expect(await contractRow(env, user, 201)).toMatchObject({ janiceCode: 'XyZ9', janiceOwn: true });

		const outcome = await settle(actions.removeContractJanice(event(env, user, '', { ref: 'contract:201' })));
		expect(outcome).toEqual({
			data: { action: 'removeContractJanice', ref: 'contract:201', notice: expect.any(String) }
		});
		// Contract 204 has the title's appraisal: 201 takes it again at once.
		expect(stored(env, 201)).toEqual({ janice_code: 'AbC', janice_json: APPRAISAL });
		expect(UPDATER.rebuildLedger).toHaveBeenCalledWith('u1');
		expect(await contractRow(env, user, 201)).toMatchObject({ janiceCode: 'AbC', janiceOwn: false });
	});

	it('removing it from a contract without a title link leaves no appraisal', async () => {
		const { env, user } = await janiceAccounts();
		env.DB.sqlite
			.prepare(
				"UPDATE tracked_contracts SET janice_code = 'XyZ9', janice_json = '{}' WHERE contract_id = 203"
			)
			.run();
		await settle(actions.removeContractJanice(event(env, user, '', { ref: 'contract:203' })));
		expect(stored(env, 203)).toEqual({ janice_code: null, janice_json: null });
	});

	it("answers 404 to removing the title's appraisal or another user's", async () => {
		const { env, user, UPDATER } = await janiceAccounts();
		env.DB.sqlite.prepare("UPDATE tracked_contracts SET janice_code = 'XyZ9' WHERE contract_id = 301").run();
		for (const ref of ['contract:201', 'contract:301']) {
			expect(await settle(actions.removeContractJanice(event(env, user, '', { ref })))).toMatchObject({
				status: 404,
				data: { action: 'removeContractJanice', ref }
			});
		}
		expect(stored(env, 201)).toEqual({ janice_code: 'AbC', janice_json: APPRAISAL });
		expect(stored(env, 301)).toEqual({ janice_code: 'XyZ9', janice_json: null });
		expect(UPDATER.rebuildLedger).not.toHaveBeenCalled();
	});
});
