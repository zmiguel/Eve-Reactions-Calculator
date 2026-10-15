import { env } from 'cloudflare:workers';
import { DATASET_KV_KEY } from '@reactions/db';
import {
	DEFAULT_SETTINGS,
	Settings,
	TrackingSettings,
	manufacturingMaterialModifier,
	runLedger,
	type Dataset,
	type LedgerResult,
	type Reaction,
	type RunLedgerInput
} from '@reactions/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markLedgerDirty, rebuildDirtyLedgers, rebuildLedger } from '../src/ledger.ts';
import {
	accountFees,
	facilitiesFromEve,
	ledgerResultRows,
	parseAccountSettings,
	parseJanice,
	parseTrackingSettings,
	referencePriceFn,
	referenceRequests,
	toLedgerContracts,
	toLedgerJobs,
	type JobRow
} from '../src/ledger-rows.ts';
import { resetState } from './helpers.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 12);
const START = Date.UTC(2026, 9, 5, 8);

const TITANIUM = 16638;
const CHROMIUM = 16641;
const FUEL = 4312;
const TITANIUM_CHROMIDE = 16654;
const SILICON_DIBORITE = 16658;
const TITANIUM_CARBIDE = 16671;
const CHROMIDE_FORMULA = 46182;
const CARBIDE_FORMULA = 46204;
/** Manufacturing blueprint using Titanium Chromide (100 per run) and Silicon Diborite (10 per run). */
const MFG_BLUEPRINT = 12619;
const MFG_PRODUCT = 12618;

const IGNOITTON = 30002647;
const NULLSEC_SYSTEM = 30004604;
const HIGHSEC_SYSTEM = 30000142;
const FACILITY = 1040000000001;
const MFG_FACILITY = 1040000000002;
const JITA = 60003760;
const AZBEL = 35826;
const TATARA = 35836;
/** Manufacturing ME rig for components (filter 14): 2.4 %. */
const COMPONENT_RIG = 37174;
/** Manufacturing ME rig for ships (filter 3): 2.4 %. */
const SHIP_RIG = 37156;
/** Reaction ME rig, every reaction kind: 2 %. */
const REACTOR_RIG = 46496;
const RIG_SECURITY = { highsec: 1, lowsec: 1.9, nullsec: 2.1, wormhole: 2.1 };
const REACTOR_SECURITY = { highsec: 1, lowsec: 1, nullsec: 1.1, wormhole: 1.1 };

const reaction = (
	blueprintTypeId: number,
	product: number,
	quantity: number,
	materials: [number, number][]
): Reaction => ({
	blueprintTypeId,
	slug: `r-${blueprintTypeId}`,
	name: `Product ${product}`,
	formulaName: `Formula ${blueprintTypeId}`,
	reactor: 'composite',
	tier: 'intermediate',
	baseTimeSeconds: 10800,
	maxRuns: 1000,
	requiredSkillLevel: 1,
	product: { typeId: product, quantity },
	materials: materials.map(([typeId, qty]) => ({ typeId, quantity: qty }))
});

const DATASET: Dataset = {
	sdeBuild: 1,
	reactions: [
		reaction(CHROMIDE_FORMULA, TITANIUM_CHROMIDE, 200, [
			[FUEL, 5],
			[TITANIUM, 100],
			[CHROMIUM, 100]
		]),
		reaction(CARBIDE_FORMULA, TITANIUM_CARBIDE, 10000, [
			[FUEL, 5],
			[TITANIUM_CHROMIDE, 100],
			[SILICON_DIBORITE, 100]
		])
	],
	types: {},
	reprocess: {},
	industry: {
		filters: [
			{ filterId: 3, name: 'Ships', categoryIds: [6], groupIds: [] },
			{ filterId: 14, name: 'Components', categoryIds: [], groupIds: [334] },
			{ filterId: 18, name: 'Composite Reactions', categoryIds: [], groupIds: [428, 429] }
		],
		rigs: [
			{
				typeId: COMPONENT_RIG,
				name: 'Component ME rig',
				rigSize: 3,
				groupId: 1860,
				fitsGroupIds: [1404],
				bonuses: [{ activity: 'manufacturing', material: 0.024, filterId: 14 }],
				security: RIG_SECURITY
			},
			{
				typeId: SHIP_RIG,
				name: 'Ship ME rig',
				rigSize: 3,
				groupId: 1855,
				fitsGroupIds: [1404],
				bonuses: [{ activity: 'manufacturing', material: 0.024, filterId: 3 }],
				security: RIG_SECURITY
			},
			{
				typeId: REACTOR_RIG,
				name: 'Reactor ME rig',
				rigSize: 3,
				groupId: 1934,
				fitsGroupIds: [1406],
				bonuses: [{ activity: 'reaction', material: 0.02, filterId: 18 }],
				security: REACTOR_SECURITY
			}
		],
		structures: [
			{
				typeId: AZBEL,
				name: 'Azbel',
				groupId: 1404,
				rigSize: 3,
				rigSlots: 3,
				material: { manufacturing: 0.01 }
			},
			{ typeId: TATARA, name: 'Tatara', groupId: 1406, rigSize: 3, rigSlots: 3, material: {} }
		],
		productFilters: { [MFG_PRODUCT]: [14], [TITANIUM_CHROMIDE]: [18], [TITANIUM_CARBIDE]: [18] }
	},
	manufacturing: [
		{
			blueprintTypeId: MFG_BLUEPRINT,
			productTypeId: MFG_PRODUCT,
			productQuantity: 5000,
			materials: [
				{ typeId: TITANIUM_CHROMIDE, quantity: 100 },
				{ typeId: SILICON_DIBORITE, quantity: 10 }
			]
		}
	],
	constants: {
		skillTimeBonusPerLevel: 0.04,
		structureTimeMultiplier: { athanor: 1, tatara: 0.75 },
		rig: { none: { me: 0, te: 0 }, t1: { me: 0.02, te: 0.2 }, t2: { me: 0.024, te: 0.24 } },
		securityModifier: { lowsec: 1, nullsec: 1.1, wormhole: 1.1 }
	}
};

const prepare = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values);

/** A user with one character and its personal connection (Profit tracking on, orders stream `ok`). */
async function addUser(
	userId: string,
	characterId: number,
	sourceId: number,
	json: { settings?: string; tracking?: string } = {}
): Promise<void> {
	await env.DB.batch([
		prepare(
			'INSERT INTO users (user_id, created_at, last_seen_at, settings_json, tracking_json) VALUES (?, 1, 1, ?, ?)',
			userId,
			json.settings ?? null,
			json.tracking ?? null
		),
		prepare(
			"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (?, ?, 'Pilot', 'h', 1)",
			characterId,
			userId
		),
		prepare(
			`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, created_at, tracking_enabled)
			VALUES (?, ?, ?, 'character', ?, 'Pilot', 1, 1)`,
			sourceId,
			userId,
			characterId,
			characterId
		),
		prepare(
			"INSERT INTO tracking_streams (source_id, stream, user_id, status) VALUES (?, 'orders', ?, 'ok')",
			sourceId,
			userId
		)
	]);
}

interface Tx {
	id: number;
	typeId: number;
	quantity: number;
	unitPrice: number;
	isBuy: boolean;
	date?: number;
	clientId?: number;
}

function insertTx(userId: string, sourceId: number, tx: Tx) {
	return prepare(
		`INSERT INTO tracked_transactions (user_id, transaction_id, source_id, division, date, type_id, quantity, unit_price,
			is_buy, client_id, location_id, journal_ref_id, is_personal)
		VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
		userId,
		tx.id,
		sourceId,
		tx.date ?? START - DAY,
		tx.typeId,
		tx.quantity,
		tx.unitPrice,
		tx.isBuy ? 1 : 0,
		tx.clientId ?? 3000001,
		JITA
	);
}

function insertJournal(
	userId: string,
	sourceId: number,
	refId: number,
	date: number,
	refType: string,
	amount: number,
	contextId: number | null = null,
	contextIdType: string | null = null
) {
	return prepare(
		`INSERT INTO tracked_journal (user_id, ref_id, source_id, division, date, ref_type, amount, context_id, context_id_type)
		VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
		userId,
		refId,
		sourceId,
		date,
		refType,
		amount,
		contextId,
		contextIdType
	);
}

function insertJob(
	userId: string,
	sourceId: number,
	jobId: number,
	job: {
		blueprintTypeId?: number;
		runs?: number;
		cost?: number;
		start?: number;
		facilityId?: number;
		activityId?: number;
		blueprintMe?: number | null;
	} = {}
) {
	const start = job.start ?? START;
	return prepare(
		`INSERT INTO tracked_jobs (user_id, job_id, source_id, installer_id, activity_id, blueprint_id, blueprint_me,
			blueprint_type_id, product_type_id, runs, status, cost, facility_id, output_location_id, start_date, end_date,
			completed_date)
		VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, 'delivered', ?, ?, ?, ?, ?, ?)`,
		userId,
		jobId,
		sourceId,
		job.activityId ?? 9,
		5000 + jobId,
		job.blueprintMe ?? null,
		job.blueprintTypeId ?? CHROMIDE_FORMULA,
		job.runs ?? 10,
		job.cost ?? 1000,
		job.facilityId ?? FACILITY,
		job.facilityId ?? FACILITY,
		start,
		start + DAY,
		start + DAY
	);
}

const lotsOf = async (userId: string) =>
	(
		await prepare(
			`SELECT lot_id, type_id, acquired_at, quantity, remaining, unit_cost, origin, origin_ref, price_source
			FROM ledger_lots WHERE user_id = ? ORDER BY lot_id`,
			userId
		).all()
	).results;

const usesOf = async (userId: string) =>
	(
		await prepare(
			'SELECT lot_id, use_kind, use_ref, quantity, unit_cost, unit_value FROM ledger_uses WHERE user_id = ? ORDER BY lot_id, use_ref',
			userId
		).all()
	).results;

const jobResultsOf = async (userId: string) =>
	(
		await prepare(
			`SELECT job_id, input_cost, job_cost, output_type_id, output_qty, sold_qty, sales_net, used_qty, manufactured_qty,
				manufactured_value, unsold_qty, unit_cost, realized_profit, flags_json
			FROM job_results WHERE user_id = ? ORDER BY job_id`,
			userId
		).all()
	).results;

/** `expected` (a `runLedger` result) as the rows of `ledger_lots`, `ledger_uses` and `job_results`. */
function expectedRows(expected: LedgerResult) {
	return {
		lots: expected.lots.map((l) => ({
			lot_id: l.lotId,
			type_id: l.typeId,
			acquired_at: l.acquiredAt,
			quantity: l.quantity,
			remaining: l.remaining,
			unit_cost: l.unitCost,
			origin: l.origin,
			origin_ref: l.originRef,
			price_source: l.source.text
		})),
		uses: expected.uses
			.map((u) => ({
				lot_id: u.lotId,
				use_kind: u.useKind,
				use_ref: u.useRef,
				quantity: u.quantity,
				unit_cost: u.unitCost,
				unit_value: u.unitValue ?? null
			}))
			.sort((a, b) => a.lot_id - b.lot_id || a.use_ref.localeCompare(b.use_ref)),
		jobs: expected.jobs.map((j) => ({
			job_id: j.jobId,
			input_cost: j.inputCost,
			job_cost: j.jobCost,
			output_type_id: j.outputTypeId,
			output_qty: j.outputQty,
			sold_qty: j.soldQty,
			sales_net: j.salesNet,
			used_qty: j.usedQty,
			manufactured_qty: j.manufacturedQty,
			manufactured_value: j.manufacturedValue,
			unsold_qty: j.unsoldQty,
			unit_cost: j.unitCost,
			realized_profit: j.realizedProfit,
			flags_json: JSON.stringify(j.flags)
		}))
	};
}

const pricesOf = async (userId: string) =>
	(
		await prepare(
			`SELECT ref, type_id, incoming, at, quantity, unit_price, source_kind, source_text, needs_review, tax, tax_source,
				broker_fee, broker_fee_source, transfer
			FROM ledger_prices WHERE user_id = ? ORDER BY ref, type_id, incoming`,
			userId
		).all()
	).results;

/** Market fallback lot of `typeId` (job input without a purchase). */
async function fallbackLot(userId: string, typeId: number) {
	return prepare(
		"SELECT unit_cost, price_source FROM ledger_lots WHERE user_id = ? AND type_id = ? AND origin = 'market'",
		userId,
		typeId
	).first<{ unit_cost: number; price_source: string }>();
}

beforeEach(async () => {
	await resetState();
	await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(DATASET));
	await env.DB.batch([
		prepare(
			"INSERT INTO systems (system_id, name, region_id, security_status, security_band) VALUES (?, 'Ignoitton', 10000048, 0.3, 'lowsec')",
			IGNOITTON
		),
		prepare(
			"INSERT INTO systems (system_id, name, region_id, security_status, security_band) VALUES (?, '671-ST', 10000010, -0.2, 'nullsec')",
			NULLSEC_SYSTEM
		)
	]);
	await addUser('u1', 91000001, 11);
});

describe('rebuildLedger', () => {
	/** Buys covering one Titanium Chromide job, the job, and a partial sale with its journal tax row. */
	async function seedChain(userId: string, sourceId: number, idBase: number) {
		const saleAt = START + 2 * DAY;
		await env.DB.batch([
			insertTx(userId, sourceId, {
				id: idBase + 1,
				typeId: TITANIUM,
				quantity: 1000,
				unitPrice: 10,
				isBuy: true
			}),
			insertTx(userId, sourceId, {
				id: idBase + 2,
				typeId: CHROMIUM,
				quantity: 1000,
				unitPrice: 20,
				isBuy: true
			}),
			insertTx(userId, sourceId, {
				id: idBase + 3,
				typeId: FUEL,
				quantity: 100,
				unitPrice: 500,
				isBuy: true
			}),
			insertJob(userId, sourceId, idBase + 10),
			insertTx(userId, sourceId, {
				id: idBase + 4,
				typeId: TITANIUM_CHROMIDE,
				quantity: 500,
				unitPrice: 40,
				isBuy: false,
				date: saleAt
			}),
			insertJournal(
				userId,
				sourceId,
				idBase + 101,
				saleAt,
				'market_transaction',
				20000,
				idBase + 4,
				'market_transaction_id'
			),
			insertJournal(userId, sourceId, idBase + 102, saleAt, 'transaction_tax', -720),
			// No order of the user was placed then: an unallocated fee.
			insertJournal(userId, sourceId, idBase + 103, START - 3 * DAY, 'brokers_fee', -55)
		]);
	}

	/** The `runLedger` input of `seedChain('u1', 11, 0)` with the default settings, `extra` merged over it. */
	function chainInput(extra: Partial<RunLedgerInput> = {}): RunLedgerInput {
		return {
			dataset: DATASET,
			own: { characterIds: new Set([91000001]), corporationIds: new Set() },
			settings: TrackingSettings.parse({}),
			brokerFeePct: 1.5,
			salesTaxPct: 3.6,
			ordersAvailable: new Set([11]),
			transactions: [
				[1, TITANIUM, 1000, 10, true, START - DAY],
				[2, CHROMIUM, 1000, 20, true, START - DAY],
				[3, FUEL, 100, 500, true, START - DAY],
				[4, TITANIUM_CHROMIDE, 500, 40, false, START + 2 * DAY]
			].map(([transactionId, typeId, quantity, unitPrice, isBuy, date]) => ({
				transactionId: transactionId as number,
				sourceId: 11,
				division: null,
				date: date as number,
				typeId: typeId as number,
				quantity: quantity as number,
				unitPrice: unitPrice as number,
				isBuy: isBuy as boolean,
				clientId: 3000001,
				locationId: JITA
			})),
			journal: [
				[101, START + 2 * DAY, 'market_transaction', 20000, 4, 'market_transaction_id'],
				[102, START + 2 * DAY, 'transaction_tax', -720, null, null],
				[103, START - 3 * DAY, 'brokers_fee', -55, null, null]
			].map(([refId, date, refType, amount, contextId, contextIdType]) => ({
				refId: refId as number,
				sourceId: 11,
				division: null,
				date: date as number,
				refType: refType as string,
				amount: amount as number,
				contextId: contextId as number | null,
				contextIdType: contextIdType as string | null
			})),
			orders: [],
			contracts: [],
			jobs: [
				{
					jobId: 10,
					activity: 'reaction',
					blueprintTypeId: CHROMIDE_FORMULA,
					runs: 10,
					status: 'delivered',
					cost: 1000,
					startDate: START,
					endDate: START + DAY,
					facilityId: FACILITY,
					// Default profile: Tatara, T2 ME rig, Ignoitton (lowsec).
					materialModifier: 0.976
				}
			],
			corrections: [],
			manualEntries: [],
			referencePrice: () => null,
			buyPrice: () => null,
			now: NOW,
			...extra
		};
	}

	it('writes lots, uses, job results and prices matching runLedger on the same data', async () => {
		await seedChain('u1', 11, 0);
		const summary = await rebuildLedger(env, 'u1', NOW);

		const expected: LedgerResult = runLedger(chainInput());
		const rows = expectedRows(expected);

		expect(await lotsOf('u1')).toEqual(rows.lots);
		expect(await usesOf('u1')).toEqual(rows.uses);
		expect(await jobResultsOf('u1')).toEqual(rows.jobs);
		expect(await pricesOf('u1')).toEqual(
			expected.trades
				.map((t) => ({
					ref: t.ref,
					type_id: t.typeId,
					incoming: t.isBuy ? 1 : 0,
					at: t.at,
					quantity: t.quantity,
					unit_price: t.netUnitPrice,
					source_kind: t.source.kind,
					source_text: t.source.text,
					needs_review: t.source.needsReview ? 1 : 0,
					tax: t.tax,
					tax_source: t.taxSource,
					broker_fee: t.brokerFee,
					broker_fee_source: t.brokerFeeSource,
					transfer: 0
				}))
				.sort((a, b) => a.ref.localeCompare(b.ref))
		);
		expect(
			(
				await prepare(
					'SELECT ref_id, date, amount FROM ledger_unallocated_fees WHERE user_id = ?',
					'u1'
				).all()
			).results
		).toEqual([{ ref_id: 103, date: START - 3 * DAY, amount: 55 }]);

		// The numbers themselves: 976 Ti × 10 + 976 Cr × 20 + 49 fuel × 500 = 53,780 in, 1,000 job cost,
		// 2,000 units at 27.39; 500 sold at (20,000 − 720 tax) ÷ 500 = 38.56 (no broker fee: orders readable).
		const [job] = (await jobResultsOf('u1')) as Record<string, number>[];
		expect(job).toMatchObject({
			input_cost: 53780,
			job_cost: 1000,
			output_qty: 2000,
			sold_qty: 500,
			unsold_qty: 1500
		});
		expect(job!.unit_cost).toBeCloseTo(27.39, 9);
		expect(job!.realized_profit).toBeCloseTo(500 * (38.56 - 27.39), 6);
		expect(summary).toEqual({ rebuiltAt: NOW, lots: 4, jobs: 1, needsReview: 0 });
		expect(
			await prepare('SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?', 'u1').first()
		).toEqual({
			rebuilt_at: NOW,
			dirty: 0
		});
	});

	it('replaces its own rows on every rebuild and leaves other users untouched', async () => {
		await addUser('u2', 91000002, 21);
		await seedChain('u1', 11, 0);
		await seedChain('u2', 21, 1000);
		await rebuildLedger(env, 'u2', NOW);
		const other = {
			lots: await lotsOf('u2'),
			uses: await usesOf('u2'),
			jobs: await jobResultsOf('u2'),
			prices: await pricesOf('u2')
		};
		await prepare(
			`INSERT INTO ledger_lots (user_id, lot_id, type_id, acquired_at, quantity, remaining, unit_cost, origin, origin_ref, price_source)
			VALUES ('u1', 99, 1, 1, 1, 1, 1, 'market', 'job:1', 'stale')`
		).run();

		await rebuildLedger(env, 'u1', NOW);
		const first = {
			lots: await lotsOf('u1'),
			uses: await usesOf('u1'),
			jobs: await jobResultsOf('u1'),
			prices: await pricesOf('u1')
		};
		expect(first.lots.map((l) => l.lot_id)).toEqual([1, 2, 3, 4]);
		await rebuildLedger(env, 'u1', NOW + 1);
		expect({
			lots: await lotsOf('u1'),
			uses: await usesOf('u1'),
			jobs: await jobResultsOf('u1'),
			prices: await pricesOf('u1')
		}).toEqual(first);
		expect({
			lots: await lotsOf('u2'),
			uses: await usesOf('u2'),
			jobs: await jobResultsOf('u2'),
			prices: await pricesOf('u2')
		}).toEqual(other);
		expect(other.jobs.map((j) => j.job_id)).toEqual([1010]);
	});

	it('ignores connections with Profit tracking off and counts their owner as an own party', async () => {
		await env.DB.batch([
			prepare(
				`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, created_at, tracking_enabled)
				VALUES (12, 'u1', 91000001, 'corporation', 98000001, 'Corp', 1, 0)`
			),
			insertTx('u1', 12, { id: 7, typeId: TITANIUM, quantity: 50, unitPrice: 9, isBuy: true }),
			insertJournal('u1', 12, 701, START - 3 * DAY, 'brokers_fee', -10),
			// Bought from the user's corporation: a transfer.
			insertTx('u1', 11, {
				id: 8,
				typeId: CHROMIUM,
				quantity: 5,
				unitPrice: 1,
				isBuy: true,
				clientId: 98000001
			})
		]);
		await rebuildLedger(env, 'u1', NOW);
		expect(await pricesOf('u1')).toMatchObject([
			{ ref: 'transaction:8', transfer: 1, source_kind: 'market' }
		]);
		expect(await lotsOf('u1')).toEqual([]);
		expect(
			(await prepare('SELECT count(*) AS n FROM ledger_unallocated_fees WHERE user_id = ?', 'u1').first<{
				n: number;
			}>())!.n
		).toBe(0);
	});

	it('ignores corporation rows of wallet divisions the connection does not count', async () => {
		await env.DB.batch([
			prepare(
				`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, created_at,
					tracking_enabled, wallet_divisions_json)
				VALUES (12, 'u1', 91000001, 'corporation', 98000001, 'Corp', 1, 1, '[2]')`
			),
			...[1, 2].flatMap((division) => [
				prepare(
					`INSERT INTO tracked_transactions (user_id, transaction_id, source_id, division, date, type_id, quantity,
						unit_price, is_buy, client_id, location_id, journal_ref_id, is_personal)
					VALUES ('u1', ?, 12, ?, ?, ?, 50, 9, 1, 3000001, ?, 0, 0)`,
					division,
					division,
					START - DAY,
					TITANIUM,
					JITA
				),
				prepare(
					`INSERT INTO tracked_journal (user_id, ref_id, source_id, division, date, ref_type, amount)
					VALUES ('u1', ?, 12, ?, ?, 'brokers_fee', -10)`,
					700 + division,
					division,
					START - 3 * DAY
				),
				prepare(
					`INSERT INTO tracked_orders (user_id, order_id, source_id, division, type_id, is_buy, price, volume_total,
						volume_remain, issued, location_id, state)
					VALUES ('u1', ?, 12, ?, ?, 0, 100, 10, 10, ?, ?, 'open')`,
					800 + division,
					division,
					TITANIUM_CHROMIDE,
					START - 4 * DAY,
					JITA
				)
			])
		]);
		await rebuildLedger(env, 'u1', NOW);
		expect((await pricesOf('u1')).map((p) => p.ref)).toEqual(['transaction:2']);
		const fees = await prepare('SELECT ref_id FROM ledger_unallocated_fees WHERE user_id = ?', 'u1').all();
		expect(fees.results).toEqual([{ ref_id: 702 }]);
	});

	it('applies price corrections', async () => {
		await seedChain('u1', 11, 0);
		await prepare(
			`INSERT INTO price_corrections (user_id, target_kind, target_ref, unit_price, created_at)
			VALUES ('u1', 'transaction', 'transaction:1', 12.5, 1)`
		).run();
		await rebuildLedger(env, 'u1', NOW);
		expect(
			await prepare(
				"SELECT unit_cost, origin, price_source FROM ledger_lots WHERE user_id = 'u1' AND origin_ref = 'transaction:1'"
			).first()
		).toEqual({ unit_cost: 12.5, origin: 'correction', price_source: 'Your correction' });
		const [job] = (await jobResultsOf('u1')) as Record<string, number>[];
		expect(job!.input_cost).toBe(976 * 12.5 + 976 * 20 + 49 * 500);
	});

	it('records untracked contract items as untracked rows that never need review or make lots', async () => {
		const MODULE = 4405; // no reaction uses it
		const contract = (contractId: number, price: number) =>
			prepare(
				`INSERT INTO tracked_contracts (user_id, contract_id, source_id, type, status, issuer_id, issuer_corporation_id,
					acceptor_id, assignee_id, for_corporation, price, reward, title, date_issued, date_completed)
				VALUES ('u1', ?, 11, 'item_exchange', 'finished', 3000001, 3000002, 91000001, 91000001, 0, ?, 0, 'stuff', ?, ?)`,
				contractId,
				price,
				START,
				START + DAY
			);
		const items = (contractId: number, lines: [number, number][]) =>
			lines.map(([typeId, quantity], i) =>
				prepare(
					`INSERT INTO tracked_contract_items (user_id, contract_id, record_id, type_id, quantity, is_included)
					VALUES ('u1', ?, ?, ?, ?, 1)`,
					contractId,
					i + 1,
					typeId,
					quantity
				)
			);
		await env.DB.batch([
			// Titanium 100 at the current Jita buy 12 = 1,200; Chromium has no reference price (review);
			// the module takes the 3,800 left.
			contract(900, 5000),
			...items(900, [
				[TITANIUM, 100],
				[CHROMIUM, 10],
				[MODULE, 2]
			]),
			// A free contract of untracked items only.
			contract(901, 0),
			...items(901, [
				[MODULE, 3],
				[5697, 1]
			]),
			prepare(
				`INSERT INTO latest_prices (hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, buy_orders, sell_orders, source, observed_at)
				VALUES ('jita', ${TITANIUM}, 12, 14, 1, 1, 1, 1, 'esi', 1)`
			)
		]);
		const summary = await rebuildLedger(env, 'u1', NOW);
		expect(
			(await pricesOf('u1')).map((p) => [p.ref, p.type_id, p.unit_price, p.source_kind, p.needs_review])
		).toEqual([
			['contract:900', MODULE, 1900, 'untracked', 0],
			['contract:900', TITANIUM, 12, 'contract_mixed', 0],
			['contract:900', CHROMIUM, 0, 'review', 1],
			['contract:901', MODULE, 0, 'untracked', 0],
			['contract:901', 5697, 0, 'untracked', 0]
		]);
		expect((await lotsOf('u1')).map((l) => [l.type_id, l.origin_ref, l.unit_cost])).toEqual([
			[TITANIUM, 'contract:900', 12],
			[CHROMIUM, 'contract:900', 0]
		]);
		expect(summary.needsReview).toBe(1);
	});

	it('uses the facility system from inventory_locations for the security band', async () => {
		await insertJob('u1', 11, 10).run();
		await rebuildLedger(env, 'u1', NOW);
		const lowsec = (await usesOf('u1')).map((u) => u.quantity);
		expect(lowsec).toEqual([49, 976, 976]);

		await prepare(
			"INSERT INTO inventory_locations (source_id, location_id, kind, name, system_id) VALUES (11, ?, 'structure', 'Tatara', ?)",
			FACILITY,
			NULLSEC_SYSTEM
		).run();
		await rebuildLedger(env, 'u1', NOW);
		// Nullsec: 1 − 0.024 × 1.1 = 0.9736 → ceil(973.6) = 974.
		expect((await usesOf('u1')).map((u) => u.quantity)).toEqual([49, 974, 974]);
	});

	it('takes the rigs EVE read over the facility setting, and the setting over nothing', async () => {
		const quantities = async () => {
			await rebuildLedger(env, 'u1', NOW);
			return (await usesOf('u1')).map((u) => u.quantity);
		};
		const setRigs = (rigs: string | null) =>
			prepare("UPDATE tracked_facilities SET rigs_json = ? WHERE user_id = 'u1'", rigs).run();
		await env.DB.batch([
			insertJob('u1', 11, 10),
			// A Tatara found by the lookup in lowsec; its rigs not read.
			prepare(
				`INSERT INTO tracked_facilities (user_id, facility_id, kind, name, system_id, type_id)
				VALUES ('u1', ?, 'structure', 'Tatara', ?, ?)`,
				FACILITY,
				IGNOITTON,
				TATARA
			)
		]);
		// Rigs unknown: the Tatara (no role bonus) with the profile's T2 rig, 1 − 0.024 → 976.
		expect(await quantities()).toEqual([49, 976, 976]);

		await prepare(
			'UPDATE users SET tracking_json = ? WHERE user_id = ?',
			JSON.stringify({ facilities: { [FACILITY]: { rigs: [] } } }),
			'u1'
		).run();
		// The setting: no rig fitted.
		expect(await quantities()).toEqual([50, 1000, 1000]);

		await setRigs(JSON.stringify([REACTOR_RIG]));
		// EVE's rigs win: the reactor rig, 1 − 0.02 → 980.
		expect(await quantities()).toEqual([49, 980, 980]);

		await setRigs('[]');
		expect(await quantities()).toEqual([50, 1000, 1000]);
	});

	describe('manufacturing jobs and manual purchases', () => {
		const MFG_START = START + 3 * DAY;
		const MANUAL_AT = START - 2 * DAY;
		/** Azbel with the component ME rig in nullsec, blueprint ME 8: 0.92 × 0.99 × (1 − 0.024 × 2.1). */
		const MODIFIER = manufacturingMaterialModifier(8, DATASET.industry, MFG_PRODUCT, {
			structureTypeId: AZBEL,
			rigs: [COMPONENT_RIG],
			band: 'nullsec'
		});

		/** The chain, a manual Titanium purchase, and a 5-run manufacturing job using the chain's output. */
		async function seedManufacturing(tracking: Record<string, unknown>) {
			await seedChain('u1', 11, 0);
			await env.DB.batch([
				prepare('UPDATE users SET tracking_json = ? WHERE user_id = ?', JSON.stringify(tracking), 'u1'),
				prepare(
					`INSERT INTO manual_entries (user_id, date, type_id, quantity, unit_price, note, created_at)
					VALUES ('u1', ?, ?, 500, 9, 'hauled', 1)`,
					MANUAL_AT,
					TITANIUM
				),
				insertJob('u1', 11, 20, {
					activityId: 1,
					blueprintTypeId: MFG_BLUEPRINT,
					runs: 5,
					blueprintMe: 8,
					start: MFG_START,
					facilityId: MFG_FACILITY
				}),
				prepare(
					"INSERT INTO inventory_locations (source_id, location_id, kind, name, system_id) VALUES (11, ?, 'structure', 'Azbel', ?)",
					MFG_FACILITY,
					NULLSEC_SYSTEM
				)
			]);
			await env.HISTORY_DB.prepare(
				`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES ('2026-10-08', 'jita', ?, 50, 60, 4)`
			)
				.bind(TITANIUM_CHROMIDE)
				.run();
		}

		function expectedLedger(tracking: Record<string, unknown>): LedgerResult {
			const base = chainInput();
			return runLedger({
				...base,
				settings: TrackingSettings.parse(tracking),
				jobs: [
					...base.jobs,
					{
						jobId: 20,
						activity: 'manufacturing',
						blueprintTypeId: MFG_BLUEPRINT,
						runs: 5,
						status: 'delivered',
						cost: 1000,
						startDate: MFG_START,
						endDate: MFG_START + DAY,
						facilityId: MFG_FACILITY,
						materialModifier: MODIFIER
					}
				],
				manualEntries: [{ entryId: 1, at: MANUAL_AT, typeId: TITANIUM, quantity: 500, unitPrice: 9 }],
				buyPrice: referencePriceFn(
					{ name: 'Jita 4-4', basis: 'buy' },
					{
						daily: new Map([[`${TITANIUM_CHROMIDE}:2026-10-08`, { buy: 50, sell: 60 }]]),
						regional: new Map(),
						latest: new Map()
					}
				)
			});
		}

		const FACILITIES = { facilities: { [MFG_FACILITY]: { structureTypeId: AZBEL, rigs: [COMPONENT_RIG] } } };

		it('maps manufacturing jobs, manual entries and buy prices (rows match runLedger)', async () => {
			await seedManufacturing(FACILITIES);
			const summary = await rebuildLedger(env, 'u1', NOW);

			const rows = expectedRows(expectedLedger(FACILITIES));
			expect(await lotsOf('u1')).toEqual(rows.lots);
			expect(await usesOf('u1')).toEqual(rows.uses);
			expect(await jobResultsOf('u1')).toEqual(rows.jobs);
			expect(summary.jobs).toBe(1);

			// The manual purchase is a lot of its own, used first (oldest).
			expect(await lotsOf('u1')).toContainEqual(
				expect.objectContaining({ origin: 'manual', origin_ref: 'manual:1', type_id: TITANIUM, unit_cost: 9 })
			);
			// 5 runs × 100 × 0.86489568 = 432.45 → 433 Titanium Chromide at the 50 ISK buy value of 2026-10-08;
			// Silicon Diborite has no lot (not tracked) and is left out.
			const manufacturing = (await usesOf('u1')).filter((u) => u.use_kind === 'manufacturing');
			expect(manufacturing).toEqual([
				expect.objectContaining({ use_ref: 'job:20', quantity: 433, unit_value: 50 })
			]);
			const [job] = (await jobResultsOf('u1')) as Record<string, number>[];
			expect(job).toMatchObject({
				job_id: 10,
				manufactured_qty: 433,
				manufactured_value: 433 * 50,
				unsold_qty: 1067
			});
			expect(job!.realized_profit).toBeCloseTo(500 * 38.56 + 433 * 50 - 933 * job!.unit_cost!, 6);
		});

		it("counts manufacturing use at cost with manufacturingUse 'zero'", async () => {
			const tracking = { ...FACILITIES, manufacturingUse: 'zero' };
			await seedManufacturing(tracking);
			await rebuildLedger(env, 'u1', NOW);

			const rows = expectedRows(expectedLedger(tracking));
			expect(await usesOf('u1')).toEqual(rows.uses);
			expect(await jobResultsOf('u1')).toEqual(rows.jobs);
			const [job] = (await jobResultsOf('u1')) as Record<string, number>[];
			expect(job!.manufactured_qty).toBe(433);
			expect(job!.manufactured_value).toBeCloseTo(433 * job!.unit_cost!, 6);
			// Only the sale realizes a profit.
			expect(job!.realized_profit).toBeCloseTo(500 * (38.56 - job!.unit_cost!), 6);
			const [use] = (await usesOf('u1')).filter((u) => u.use_kind === 'manufacturing');
			expect(use!.unit_value).toBeCloseTo(job!.unit_cost!, 9);
		});

		it('assumes the blueprint ME setting, else ME 10, when the blueprint was not read', async () => {
			await seedManufacturing({ blueprintMe: { [MFG_BLUEPRINT]: 4 } });
			await prepare("UPDATE tracked_jobs SET blueprint_me = NULL WHERE job_id = 20 AND user_id = 'u1'").run();
			await rebuildLedger(env, 'u1', NOW);
			const quantity = async () => (await usesOf('u1')).find((u) => u.use_kind === 'manufacturing')!.quantity;
			// ME 4, no structure setting: 500 × 0.96 = 480.
			expect(await quantity()).toBe(480);
			await prepare("UPDATE users SET tracking_json = NULL WHERE user_id = 'u1'").run();
			await rebuildLedger(env, 'u1', NOW);
			// Default ME 10: 500 × 0.9 = 450.
			expect(await quantity()).toBe(450);
		});

		it('a job under a rig matching its product uses fewer units than under a rig for other products', async () => {
			await seedManufacturing({});
			await prepare(
				`INSERT INTO tracked_facilities (user_id, facility_id, kind, system_id, type_id, rigs_json)
				VALUES ('u1', ?, 'structure', ?, ?, ?)`,
				MFG_FACILITY,
				NULLSEC_SYSTEM,
				AZBEL,
				JSON.stringify([SHIP_RIG])
			).run();
			const quantity = async () => {
				await rebuildLedger(env, 'u1', NOW);
				return (await usesOf('u1')).find((u) => u.use_kind === 'manufacturing')!.quantity;
			};
			// The ship rig does not apply: 500 × 0.92 × 0.99 (Azbel) = 455.4 → 456.
			expect(await quantity()).toBe(456);
			await prepare(
				"UPDATE tracked_facilities SET rigs_json = ? WHERE user_id = 'u1'",
				JSON.stringify([COMPONENT_RIG])
			).run();
			// The component rig applies (× (1 − 0.024 × 2.1) in nullsec): 432.45 → 433.
			expect(await quantity()).toBe(433);
		});
	});

	describe('buy prices (job inputs without a purchase)', () => {
		const DAYS = ['2026-10-05', '2026-10-02', '2026-09-20'];

		async function history() {
			await env.HISTORY_DB.batch([
				env.HISTORY_DB.prepare(
					`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES
					(?1, 'jita', ${TITANIUM}, 11, 13, 4), (?1, 'amarr', ${TITANIUM}, 31, 33, 4),
					(?2, 'jita', ${FUEL}, 400, 450, 4), (?3, 'jita', ${CHROMIUM}, 1, 1, 4)`
				).bind(...DAYS),
				env.HISTORY_DB.prepare(
					`INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
					VALUES (10000002, ${CHROMIUM}, ?1, 21, 22, 20, 1, 1), (10000043, ${CHROMIUM}, ?1, 99, 99, 99, 1, 1)`
				).bind(DAYS[0])
			]);
			await prepare(
				`INSERT INTO latest_prices (hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, buy_orders, sell_orders, source, observed_at)
				VALUES ('jita', ${CHROMIUM}, 25, 27, 1, 1, 1, 1, 'esi', 1), ('jita', ${FUEL}, 600, 610, 1, 1, 1, 1, 'esi', 1)`
			).run();
		}

		it('takes the hub daily price, else the region average, else an earlier day', async () => {
			await history();
			await insertJob('u1', 11, 10).run();
			const summary = await rebuildLedger(env, 'u1', NOW);
			expect(await fallbackLot('u1', TITANIUM)).toEqual({
				unit_cost: 11,
				price_source: 'No purchase found: buy value at job start (Jita 4-4 buy on 2026-10-05)'
			});
			expect(await fallbackLot('u1', CHROMIUM)).toEqual({
				unit_cost: 21,
				price_source: 'No purchase found: buy value at job start (Jita 4-4 region average on 2026-10-05)'
			});
			expect(await fallbackLot('u1', FUEL)).toEqual({
				unit_cost: 400,
				price_source: 'No purchase found: buy value at job start (Jita 4-4 buy on 2026-10-02)'
			});
			expect((await jobResultsOf('u1'))[0]!.flags_json).toBe('["market_fallback"]');
			expect(summary.needsReview).toBe(0);
		});

		it('falls back to the current price, and has none for a type never priced', async () => {
			await history();
			// Started 2026-10-12: the 2026-10-05 rows are 7 days back (used), 2026-10-02 is too old, so
			// fuel takes the current price. The second job's intermediates have no price anywhere.
			await insertJob('u1', 11, 10, { start: Date.UTC(2026, 9, 12, 1) }).run();
			await insertJob('u1', 11, 11, {
				blueprintTypeId: CARBIDE_FORMULA,
				runs: 1,
				start: Date.UTC(2026, 9, 12, 2)
			}).run();
			const summary = await rebuildLedger(env, 'u1', NOW + 5 * DAY);
			expect(await fallbackLot('u1', FUEL)).toMatchObject({
				price_source: 'No purchase found: buy value at job start (Jita 4-4 buy (current))'
			});
			expect(
				(
					await prepare(
						"SELECT unit_cost FROM ledger_lots WHERE user_id = 'u1' AND type_id = ? AND origin = 'market' ORDER BY lot_id",
						FUEL
					).all()
				).results
			).toEqual([{ unit_cost: 600 }, { unit_cost: 600 }]);
			expect((await fallbackLot('u1', SILICON_DIBORITE))!.unit_cost).toBe(0);
			expect((await jobResultsOf('u1')).map((j) => j.flags_json)).toEqual([
				'["market_fallback"]',
				'["market_fallback","unpriced_input"]'
			]);
			// Titanium Chromide and Silicon Diborite of the second job have no price at all.
			expect(summary.needsReview).toBe(2);
		});

		it("uses the contract rule's hub, always on the buy side", async () => {
			await history();
			await prepare(
				'UPDATE users SET tracking_json = ? WHERE user_id = ?',
				JSON.stringify({ contractRule: { hubId: 'amarr', basis: 'split' } }),
				'u1'
			).run();
			await insertJob('u1', 11, 10).run();
			await rebuildLedger(env, 'u1', NOW);
			// Amarr buy 31 (its split would be 32); Chromium has only Amarr's region average.
			expect(await fallbackLot('u1', TITANIUM)).toEqual({
				unit_cost: 31,
				price_source: 'No purchase found: buy value at job start (Amarr buy on 2026-10-05)'
			});
			expect((await fallbackLot('u1', CHROMIUM))!.unit_cost).toBe(99);
		});

		it('prices at a private hub only while the user still has it linked, else at Jita', async () => {
			const STRUCTURE = 1035000000500;
			const HUB = `structure-${STRUCTURE}`;
			await history();
			await env.HISTORY_DB.prepare(
				`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES (?, ?, ${TITANIUM}, 71, 73, 4)`
			)
				.bind(DAYS[0], HUB)
				.run();
			await env.DB.batch([
				prepare(
					`INSERT INTO market_hubs (hub_id, name, kind, region_id, system_id, location_id, visibility, sort_order, created_at)
					VALUES (?, 'My Market', 'structure', 10000002, 30000142, ?, 'private', 99, 1)`,
					HUB,
					STRUCTURE
				),
				prepare(
					"INSERT INTO structure_links (user_id, structure_id, character_id, created_at) VALUES ('u1', ?, 91000001, 1)",
					STRUCTURE
				),
				prepare(
					'UPDATE users SET tracking_json = ? WHERE user_id = ?',
					JSON.stringify({ contractRule: { hubId: HUB, basis: 'buy' } }),
					'u1'
				)
			]);
			await insertJob('u1', 11, 10).run();
			await rebuildLedger(env, 'u1', NOW);
			expect(await fallbackLot('u1', TITANIUM)).toEqual({
				unit_cost: 71,
				price_source: 'No purchase found: buy value at job start (My Market buy on 2026-10-05)'
			});

			await prepare("DELETE FROM structure_links WHERE user_id = 'u1'").run();
			await rebuildLedger(env, 'u1', NOW + 1);
			expect(await fallbackLot('u1', TITANIUM)).toEqual({
				unit_cost: 11,
				price_source: 'No purchase found: buy value at job start (Jita 4-4 buy on 2026-10-05)'
			});
		});
	});

	it('throws for an unknown user and when no dataset is published', async () => {
		await expect(rebuildLedger(env, 'nobody', NOW)).rejects.toThrow('user nobody not found');
		await env.CACHE.delete(DATASET_KV_KEY);
		await expect(rebuildLedger(env, 'u1', NOW)).rejects.toThrow('no SDE dataset');
	});
});

describe('dirty ledgers', () => {
	const stateOf = async (userId: string) =>
		prepare('SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?', userId).first();

	it('markLedgerDirty flags a ledger, with or without a state row', async () => {
		await markLedgerDirty(env, 'u1');
		expect(await stateOf('u1')).toEqual({ rebuilt_at: null, dirty: 1 });
		await rebuildLedger(env, 'u1', NOW);
		await markLedgerDirty(env, 'u1');
		expect(await stateOf('u1')).toEqual({ rebuilt_at: NOW, dirty: 1 });
	});

	it('rebuilds the least recently rebuilt first, up to the limit, stamped when each starts', async () => {
		await addUser('u2', 91000002, 21);
		await addUser('u3', 91000003, 31);
		await rebuildLedger(env, 'u1', NOW - 2 * DAY);
		await rebuildLedger(env, 'u2', NOW - 3 * DAY);
		for (const userId of ['u1', 'u2', 'u3']) await markLedgerDirty(env, userId);
		const started = Date.now();

		expect(await rebuildDirtyLedgers(env, 2)).toEqual({ rebuilt: 2, failed: 0 });
		for (const userId of ['u3', 'u2']) {
			const state = await stateOf(userId);
			expect(state).toMatchObject({ dirty: 0 });
			expect(state!.rebuilt_at).toBeGreaterThanOrEqual(started);
		}
		expect(await stateOf('u1')).toEqual({ rebuilt_at: NOW - 2 * DAY, dirty: 1 });
		expect(await rebuildDirtyLedgers(env, 10)).toEqual({ rebuilt: 1, failed: 0 });
		expect(await rebuildDirtyLedgers(env, 10)).toEqual({ rebuilt: 0, failed: 0 });
	});

	it('a rebuild that failed after loading stays dirty until a rebuild succeeds', async () => {
		await markLedgerDirty(env, 'u1');
		await env.CACHE.delete(DATASET_KV_KEY);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await rebuildDirtyLedgers(env, 10)).toEqual({ rebuilt: 0, failed: 1 });
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('[ledger] rebuild of u1 failed'));
		logged.mockRestore();
		const failed = await stateOf('u1');
		expect(failed).toMatchObject({ rebuilt_at: null });
		expect(failed!.dirty).not.toBe(0);

		await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(DATASET));
		expect(await rebuildDirtyLedgers(env, 10)).toEqual({ rebuilt: 1, failed: 0 });
		expect(await stateOf('u1')).toMatchObject({ dirty: 0 });
	});

	describe('overlapping rebuilds of one user', () => {
		const manualEntry = () =>
			prepare(
				`INSERT INTO manual_entries (user_id, date, type_id, quantity, unit_price, note, created_at)
				VALUES ('u1', ?, ?, 500, 9, NULL, 1)`,
				START - DAY,
				TITANIUM
			).run();
		const manualLots = async () => (await lotsOf('u1')).filter((l) => l.origin === 'manual').length;

		/** Runs `during` after the rebuild loaded its rows and before it stores its results. */
		function betweenLoadAndStore(during: () => Promise<unknown>) {
			const get = env.CACHE.get.bind(env.CACHE);
			let pending: (() => Promise<unknown>) | null = during;
			return vi.spyOn(env.CACHE, 'get').mockImplementation((async (...args: Parameters<typeof get>) => {
				const run = pending;
				pending = null;
				if (run) await run();
				return get(...args);
			}) as typeof env.CACHE.get);
		}

		it('a rebuild that loaded before a newer one stored its results writes nothing', async () => {
			await rebuildLedger(env, 'u1', NOW);
			await manualEntry();
			// The newer rebuild (loaded at NOW + 2) stores the entry while the older one (NOW + 1) runs.
			const spy = betweenLoadAndStore(() => rebuildLedger(env, 'u1', NOW + 2));
			await rebuildLedger(env, 'u1', NOW + 1);
			spy.mockRestore();
			expect(await manualLots()).toBe(1);
			expect(await stateOf('u1')).toEqual({ rebuilt_at: NOW + 2, dirty: 0 });
		});

		it('a change marked while a rebuild runs keeps the ledger dirty; one marked before is cleared', async () => {
			await markLedgerDirty(env, 'u1');
			const spy = betweenLoadAndStore(async () => {
				await manualEntry();
				await markLedgerDirty(env, 'u1');
			});
			await rebuildLedger(env, 'u1', NOW);
			spy.mockRestore();
			// The entry came after the rows were loaded: not in the results, and the ledger stays dirty.
			expect(await manualLots()).toBe(0);
			expect(await stateOf('u1')).toEqual({ rebuilt_at: NOW, dirty: 1 });

			expect(await rebuildDirtyLedgers(env, 10)).toEqual({ rebuilt: 1, failed: 0 });
			expect(await manualLots()).toBe(1);
			expect(await stateOf('u1')).toMatchObject({ dirty: 0 });
		});
	});
});

describe('ledger-rows mapping', () => {
	it('parses settings, falling back to defaults', () => {
		expect(parseTrackingSettings(null)).toEqual(TrackingSettings.parse({}));
		expect(parseTrackingSettings('{not json')).toEqual(TrackingSettings.parse({}));
		expect(parseTrackingSettings('{"contractRule":{"tolerancePct":99}}')).toEqual(TrackingSettings.parse({}));
		expect(parseTrackingSettings('{"contractRule":{"basis":"sell"}}').contractRule).toEqual({
			hubId: 'jita',
			basis: 'sell',
			expectedPct: 100,
			tolerancePct: 5
		});
		expect(parseAccountSettings(null)).toBe(DEFAULT_SETTINGS);
		expect(parseAccountSettings('{"cycleDays":-1}')).toBe(DEFAULT_SETTINGS);
		expect(parseAccountSettings('{"v":1,"cycleDays":3}').cycleDays).toBe(3);
	});

	it('takes the fees from the output side of the composite profile', () => {
		const shared = Settings.parse({ shared: { market: { brokerFeePct: 2, salesTaxPct: 4 } } });
		expect(accountFees(shared)).toEqual({ brokerFeePct: 2, salesTaxPct: 4 });
		const perReactor = Settings.parse({
			mode: 'per_reactor',
			shared: { market: { brokerFeePct: 9 } },
			reactors: { composite: { market: { brokerFeePct: 1, salesTaxPct: 2.5 } } }
		});
		expect(accountFees(perReactor)).toEqual({ brokerFeePct: 1, salesTaxPct: 2.5 });
	});

	it('reads a stored Janice appraisal and rejects malformed ones', () => {
		const appraisal = {
			code: 'abc123',
			created: 1,
			datasetTime: 2,
			marketId: 2,
			marketName: 'Jita 4-4',
			pricing: 'buy',
			pricingVariant: 'immediate',
			pricePercentage: 0.9,
			items: [{ typeId: TITANIUM, name: 'Titanium', amount: 5, buyPrice: 1, splitPrice: 2, sellPrice: 3 }]
		};
		expect(parseJanice(JSON.stringify(appraisal))).toEqual({
			code: 'abc123',
			marketName: 'Jita 4-4',
			pricing: 'buy',
			datasetTime: 2,
			items: [{ typeId: TITANIUM, buyPrice: 1, splitPrice: 2, sellPrice: 3 }]
		});
		expect(parseJanice(null)).toBeNull();
		expect(parseJanice('[')).toBeNull();
		expect(parseJanice(JSON.stringify({ ...appraisal, items: [{ typeId: 1 }] }))).toBeNull();
	});

	it('maps contracts with their items and the completion time', () => {
		const contracts = toLedgerContracts(
			[
				{
					contract_id: 5,
					issuer_id: 1,
					issuer_corporation_id: 2,
					acceptor_id: 3,
					assignee_id: 3,
					for_corporation: 1,
					price: 100,
					reward: null,
					title: 'x',
					date_issued: 10,
					date_completed: null,
					janice_json: null
				}
			],
			[
				{ contract_id: 5, record_id: 2, type_id: CHROMIUM, quantity: 4, is_included: 0 },
				{ contract_id: 5, record_id: 1, type_id: TITANIUM, quantity: 3, is_included: 1 },
				{ contract_id: 6, record_id: 1, type_id: FUEL, quantity: 1, is_included: 1 }
			]
		);
		expect(contracts).toEqual([
			{
				contractId: 5,
				issuerId: 1,
				issuerCorporationId: 2,
				acceptorId: 3,
				assigneeId: 3,
				forCorporation: true,
				price: 100,
				reward: null,
				title: 'x',
				dateIssued: 10,
				completedAt: 10,
				items: [
					{ recordId: 1, typeId: TITANIUM, quantity: 3, isIncluded: true },
					{ recordId: 2, typeId: CHROMIUM, quantity: 4, isIncluded: false }
				],
				janice: null
			}
		]);
	});

	it('builds what EVE tells per facility: station = no structure, band from the row else the location', () => {
		const bands = new Map([
			[NULLSEC_SYSTEM, 'nullsec'],
			[HIGHSEC_SYSTEM, 'highsec'],
			[IGNOITTON, 'lowsec']
		]);
		const facilities = facilitiesFromEve(
			[
				{ facility_id: JITA, kind: 'station', system_id: HIGHSEC_SYSTEM, type_id: 1529, rigs_json: null },
				{ facility_id: FACILITY, kind: 'unknown', system_id: null, type_id: TATARA, rigs_json: '[46496]' },
				{
					facility_id: MFG_FACILITY,
					kind: 'structure',
					system_id: NULLSEC_SYSTEM,
					type_id: AZBEL,
					rigs_json: 'x'
				}
			],
			new Map([
				[FACILITY, IGNOITTON],
				[7, IGNOITTON],
				[8, 999]
			]),
			bands
		);
		expect(Object.fromEntries(facilities)).toEqual({
			[JITA]: { typeId: 0, rigs: null, band: 'highsec' },
			[FACILITY]: { typeId: TATARA, rigs: [REACTOR_RIG], band: 'lowsec' },
			[MFG_FACILITY]: { typeId: AZBEL, rigs: null, band: 'nullsec' },
			7: { typeId: null, rigs: null, band: 'lowsec' }
		});
	});

	it('gives reaction jobs the facility from EVE and the settings over the reactor profile', () => {
		const row: JobRow = {
			job_id: 1,
			activity_id: 9,
			blueprint_type_id: CHROMIDE_FORMULA,
			blueprint_me: null,
			runs: 1,
			status: 'active',
			cost: null,
			facility_id: FACILITY,
			start_date: 1,
			end_date: 2
		};
		const ctx = {
			dataset: DATASET,
			settings: Settings.parse({ mode: 'per_reactor', reactors: { composite: { meRig: 't1' } } }),
			tracking: TrackingSettings.parse({}),
			systemBands: new Map([[IGNOITTON, 'lowsec']]),
			facilities: new Map()
		};
		const modifier = (c: typeof ctx) => toLedgerJobs([row], c)[0]!.materialModifier;
		// Nothing known: the composite profile's T1 rig in its lowsec system.
		expect(modifier(ctx)).toBeCloseTo(0.98, 12);
		// Only the band: the profile rig in nullsec.
		const nullsec = { typeId: null, rigs: null, band: 'nullsec' };
		expect(modifier({ ...ctx, facilities: new Map([[FACILITY, nullsec]]) })).toBeCloseTo(0.978, 12);
		// The settings name a Tatara with no rig.
		const noRig = TrackingSettings.parse({
			facilities: { [FACILITY]: { structureTypeId: TATARA, rigs: [] } }
		});
		expect(modifier({ ...ctx, tracking: noRig })).toBe(1);
		// EVE read the reactor rig: it wins over the settings.
		const fitted = { typeId: TATARA, rigs: [REACTOR_RIG], band: 'nullsec' };
		expect(modifier({ ...ctx, tracking: noRig, facilities: new Map([[FACILITY, fitted]]) })).toBeCloseTo(
			1 - 0.02 * 1.1,
			12
		);
		expect(toLedgerJobs([row], ctx)[0]).toEqual({
			jobId: 1,
			activity: 'reaction',
			blueprintTypeId: CHROMIDE_FORMULA,
			runs: 1,
			status: 'active',
			cost: null,
			startDate: 1,
			endDate: 2,
			facilityId: FACILITY,
			materialModifier: expect.closeTo(0.98, 12)
		});
	});

	it("gives manufacturing jobs the blueprint's ME and the bonuses of the facility for their product", () => {
		const row: JobRow = {
			job_id: 2,
			activity_id: 1,
			blueprint_type_id: MFG_BLUEPRINT,
			blueprint_me: 8,
			runs: 1,
			status: 'active',
			cost: 50,
			facility_id: MFG_FACILITY,
			start_date: 1,
			end_date: 2
		};
		const azbel = {
			facilities: { [MFG_FACILITY]: { structureTypeId: AZBEL, rigs: [COMPONENT_RIG, SHIP_RIG] } }
		};
		const ctx = {
			dataset: DATASET,
			settings: DEFAULT_SETTINGS,
			tracking: TrackingSettings.parse({ ...azbel, blueprintMe: { [MFG_BLUEPRINT]: 4 } }),
			systemBands: new Map<number, string>(),
			facilities: new Map([[MFG_FACILITY, { typeId: null, rigs: null, band: 'nullsec' as const }]])
		};
		const modifier = (r: JobRow, c: typeof ctx) => toLedgerJobs([r], c)[0]!.materialModifier;
		// ME 8, Azbel role 1 %, the component rig 2.4 % × 2.1 (nullsec); the ship rig does not apply.
		expect(modifier(row, ctx)).toBeCloseTo(0.92 * 0.99 * (1 - 0.024 * 2.1), 12);
		// Not read: the ME setting of the blueprint, else 10.
		expect(modifier({ ...row, blueprint_me: null }, ctx)).toBeCloseTo(0.96 * 0.99 * (1 - 0.024 * 2.1), 12);
		expect(
			modifier({ ...row, blueprint_me: null }, { ...ctx, tracking: TrackingSettings.parse(azbel) })
		).toBeCloseTo(0.9 * 0.99 * (1 - 0.024 * 2.1), 12);
		// A system not known counts as highsec: rig multiplier 1.
		expect(modifier(row, { ...ctx, facilities: new Map() })).toBeCloseTo(0.92 * 0.99 * (1 - 0.024), 12);
		// Nothing known about the facility: the blueprint ME only.
		expect(modifier(row, { ...ctx, tracking: TrackingSettings.parse({}) })).toBeCloseTo(0.92, 12);
		expect(toLedgerJobs([row], ctx)[0]).toMatchObject({
			jobId: 2,
			activity: 'manufacturing',
			blueprintTypeId: MFG_BLUEPRINT,
			cost: 50
		});
	});

	it('lists the days each type can be priced at, leaving out untracked contract items', () => {
		const requests = referenceRequests(
			{
				contracts: [{ contract_id: 5, date_issued: Date.UTC(2026, 9, 1, 23) } as never],
				contractItems: [
					{ contract_id: 5, record_id: 1, type_id: TITANIUM, quantity: 1, is_included: 1 },
					{ contract_id: 5, record_id: 2, type_id: 4405, quantity: 1, is_included: 1 }
				],
				jobs: [
					{ blueprint_type_id: CHROMIDE_FORMULA, start_date: Date.UTC(2026, 9, 2, 1) } as never,
					{ blueprint_type_id: 1, start_date: 0 } as never,
					{ activity_id: 1, blueprint_type_id: MFG_BLUEPRINT, start_date: Date.UTC(2026, 9, 3) } as never
				]
			},
			DATASET
		);
		expect(Object.fromEntries([...requests].map(([typeId, days]) => [typeId, [...days]]))).toEqual({
			[TITANIUM]: ['2026-10-01', '2026-10-02'],
			[CHROMIUM]: ['2026-10-02'],
			[FUEL]: ['2026-10-02'],
			[TITANIUM_CHROMIDE]: ['2026-10-03'],
			[SILICON_DIBORITE]: ['2026-10-03']
		});
	});

	it('resolves reference prices day by day, then the current price', () => {
		const lookup = referencePriceFn(
			{ name: 'Jita 4-4', basis: 'split' },
			{
				daily: new Map([
					['1:2026-10-05', { buy: 10, sell: null }],
					['1:2026-10-01', { buy: 10, sell: 20 }]
				]),
				regional: new Map([['1:2026-10-04', 14]]),
				latest: new Map([[2, { buy: 4, sell: 6 }]])
			}
		);
		expect(lookup(1, Date.UTC(2026, 9, 5, 12))).toEqual({
			unitPrice: 14,
			label: 'Jita 4-4 region average on 2026-10-04'
		});
		expect(lookup(1, Date.UTC(2026, 9, 3))).toEqual({ unitPrice: 15, label: 'Jita 4-4 split on 2026-10-01' });
		expect(lookup(1, Date.UTC(2026, 9, 12))).toBeNull();
		expect(lookup(2, 0)).toEqual({ unitPrice: 5, label: 'Jita 4-4 split (current)' });
	});

	it('turns a ledger result into rows and counts what needs review', () => {
		const source = (needsReview: boolean) => ({ kind: 'review' as const, text: 't', needsReview });
		const rows = ledgerResultRows({
			lots: [
				{
					lotId: 1,
					typeId: 5,
					acquiredAt: 7,
					quantity: 3,
					remaining: 1,
					unitCost: 2.5,
					origin: 'market',
					originRef: 'job:9',
					source: source(true)
				}
			],
			uses: [
				{ lotId: 1, useKind: 'job', useRef: 'job:9', quantity: 2, unitCost: 2.5 },
				{ lotId: 1, useKind: 'manufacturing', useRef: 'job:20', quantity: 1, unitCost: 2.5, unitValue: 4 }
			],
			jobs: [
				{
					jobId: 9,
					inputCost: 1,
					jobCost: 2,
					outputTypeId: 5,
					outputQty: 3,
					soldQty: 0,
					salesNet: 0,
					usedQty: 0,
					manufacturedQty: 1,
					manufacturedValue: 4,
					unsoldQty: 2,
					unitCost: 1,
					realizedProfit: 3,
					flags: []
				}
			],
			trades: [],
			contracts: [
				{
					ref: 'contract:4',
					contractId: 4,
					at: 8,
					direction: 'buy',
					iskIn: -10,
					impliedPct: null,
					items: [{ typeId: 5, quantity: 4, incoming: true, unitPrice: 2.5, source: source(true) }],
					needsReview: true
				}
			],
			unallocatedFees: [{ refId: 3, date: 1, amount: 2 }]
		});
		expect(rows).toEqual({
			lots: [[1, 5, 7, 3, 1, 2.5, 'market', 'job:9', 't']],
			uses: [
				[1, 'job', 'job:9', 2, 2.5, null],
				[1, 'manufacturing', 'job:20', 1, 2.5, 4]
			],
			jobs: [[9, 1, 2, 5, 3, 0, 0, 0, 1, 4, 2, 1, 3, '[]']],
			prices: [['contract:4', 5, 1, 8, 4, 2.5, 'review', 't', 1, null, null, null, null, 0]],
			unallocatedFees: [[3, 1, 2]],
			needsReview: 2
		});
	});
});
