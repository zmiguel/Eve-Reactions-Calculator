/** Tracked jobs, their ledger results and a shared scenario for the `/jobs` pages, written straight to D1. */
import type { Reaction } from '@reactions/engine';
import { seededEnv } from './api.ts';
import type { FakeD1, FakeEnv } from './fakes.ts';
import { NOW, insertUser } from './fixtures.ts';
import { insertLocation, insertSource } from './inventory.ts';
import { DAY, insertLot, insertUse } from './ledger-item.ts';
import { insertPrice, insertTransaction } from './ledger.ts';

export interface TrackedJobFixture {
	jobId: number;
	sourceId: number;
	blueprintTypeId: number;
	productTypeId?: number | null;
	runs?: number;
	status?: string;
	cost?: number | null;
	facilityId?: number;
	startDate?: number;
	endDate?: number;
	/** ESI activity: 9 (default) reaction, 1 manufacturing. */
	activityId?: number;
	/** Manufacturing: the blueprint's ME read from EVE (null = not read). */
	blueprintMe?: number | null;
}

export function insertTrackedJob(db: FakeD1, userId: string, j: TrackedJobFixture) {
	const endDate = j.endDate ?? NOW - DAY;
	db.sqlite
		.prepare(
			`INSERT INTO tracked_jobs (user_id, job_id, source_id, installer_id, blueprint_type_id, product_type_id,
				runs, status, cost, facility_id, output_location_id, start_date, end_date, activity_id, blueprint_me)
			VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
		)
		.run(
			userId,
			j.jobId,
			j.sourceId,
			j.blueprintTypeId,
			j.productTypeId ?? null,
			j.runs ?? 1,
			j.status ?? 'delivered',
			j.cost === undefined ? 100 : j.cost,
			j.facilityId ?? 1,
			j.startDate ?? endDate - DAY,
			endDate,
			j.activityId ?? 9,
			j.blueprintMe ?? null
		);
}

/** A manufacturing use of lot `lotId` by job `ref` (`job:<id>`), valued at `unitValue` per unit. */
export function insertManufacturingUse(
	db: FakeD1,
	userId: string,
	use: { lotId: number; ref: string; quantity: number; unitCost: number; unitValue: number | null }
) {
	db.sqlite
		.prepare(
			`INSERT INTO ledger_uses (user_id, lot_id, use_kind, use_ref, quantity, unit_cost, unit_value)
			VALUES (?, ?, 'manufacturing', ?, ?, ?, ?)`
		)
		.run(userId, use.lotId, use.ref, use.quantity, use.unitCost, use.unitValue);
}

export interface JobResultFixture {
	jobId: number;
	inputCost?: number;
	jobCost?: number;
	outputTypeId?: number | null;
	outputQty?: number;
	soldQty?: number;
	salesNet?: number;
	usedQty?: number;
	manufacturedQty?: number;
	manufacturedValue?: number;
	unsoldQty?: number;
	unitCost?: number | null;
	realizedProfit?: number;
	flags?: string[];
}

export function insertJobResult(db: FakeD1, userId: string, r: JobResultFixture) {
	db.sqlite
		.prepare(
			`INSERT INTO job_results (user_id, job_id, input_cost, job_cost, output_type_id, output_qty, sold_qty,
				sales_net, used_qty, manufactured_qty, manufactured_value, unsold_qty, unit_cost, realized_profit,
				flags_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			r.jobId,
			r.inputCost ?? 0,
			r.jobCost ?? 0,
			r.outputTypeId ?? null,
			r.outputQty ?? 0,
			r.soldQty ?? 0,
			r.salesNet ?? 0,
			r.usedQty ?? 0,
			r.manufacturedQty ?? 0,
			r.manufacturedValue ?? 0,
			r.unsoldQty ?? 0,
			r.unitCost ?? null,
			r.realizedProfit ?? 0,
			JSON.stringify(r.flags ?? [])
		);
}

export function setLedgerState(db: FakeD1, userId: string, rebuiltAt: number | null, dirty = false) {
	db.sqlite
		.prepare('INSERT OR REPLACE INTO ledger_state (user_id, rebuilt_at, dirty) VALUES (?, ?, ?)')
		.run(userId, rebuiltAt, dirty ? 1 : 0);
}

export const ALPHA = { characterId: 90000001, name: 'Alpha' };
export const BETA = { characterId: 90000002, name: 'Beta' };
export const GAMMA = { characterId: 90000003, name: 'Gamma' };
/** Named in Alpha's places ("Reactor One"); `OTHER_FACILITY` is not. */
export const FACILITY = 1040000000001;
export const OTHER_FACILITY = 1040000000002;
/** Titanium Chromide (intermediate) and the formula consuming its product. */
export const INTERMEDIATE = 46182;

/** u1's jobs of the scenario. */
export const JOB = {
	/** Intermediate, ended 5 days ago: 200 made, 150 used by `FINAL`, 50 unsold; one input bought, one at market value. */
	intermediate: 7001,
	/** Uses the intermediate's output, ended 2 days ago: 100 made, 60 sold (sale 902), 40 unsold. */
	final: 7002,
	/** Intermediate, still running. */
	running: 7003,
	/** Intermediate, cancelled 20 days ago. */
	cancelled: 7004,
	/** Final, ended 60 days ago, all 10 sold. */
	old: 7005,
	/** Ended 3 days ago, not in the ledger results yet. */
	pending: 7007,
	/** Of u1's tracking-off connection, ended a day ago. */
	trackingOff: 7006
} as const;

export interface JobsScenario {
	env: FakeEnv;
	/** Titanium Chromide reaction and the reaction using its product. */
	intermediate: Reaction;
	final: Reaction;
	mine: number;
	other: number;
	off: number;
}

/**
 * u1 tracks two connections (Alpha, "Alpha" with a named facility, and the corporation "Alpha Corp") and
 * has one with tracking off (Beta); u2 has a job and a result with u1's ids. The chain: `JOB.intermediate`
 * makes 200 of the intermediate (input cost 1,000, job cost 100, unit cost 5.5); `JOB.final` takes 150
 * of them and makes 100 of its product (input cost 2,000, job cost 200, unit cost 22), sells 60 for 3,000
 * net (realized 3,000 − 60 × 22 = 1,680).
 */
export async function jobsScenario(overrides: Partial<FakeEnv> = {}): Promise<JobsScenario> {
	const { env, sde } = await seededEnv(overrides);
	const db = env.DB;
	const intermediate = sde.dataset.reactions.find((r) => r.blueprintTypeId === INTERMEDIATE)!;
	const final = sde.dataset.reactions.find((r) =>
		r.materials.some((m) => m.typeId === intermediate.product.typeId)
	)!;
	insertUser(db, { userId: 'u1' }, [ALPHA, BETA]);
	insertUser(db, { userId: 'u2' }, [GAMMA]);
	const mine = insertSource(db, {
		userId: 'u1',
		characterId: ALPHA.characterId,
		ownerName: 'Alpha',
		trackingEnabled: true
	});
	const other = insertSource(db, {
		userId: 'u1',
		characterId: ALPHA.characterId,
		kind: 'corporation',
		ownerId: 98000001,
		ownerName: 'Alpha Corp',
		trackingEnabled: true
	});
	const off = insertSource(db, {
		userId: 'u1',
		characterId: BETA.characterId,
		ownerName: 'Beta',
		trackingEnabled: false
	});
	const theirs = insertSource(db, {
		userId: 'u2',
		characterId: GAMMA.characterId,
		ownerName: 'Gamma',
		trackingEnabled: true
	});
	insertLocation(db, mine, FACILITY, { kind: 'structure', name: 'Reactor One' });
	setLedgerState(db, 'u1', NOW - 600_000);

	const [mat1, mat2] = intermediate.materials;
	const inter = intermediate.product.typeId;
	const product = final.product.typeId;
	const job = (jobId: number, f: Partial<TrackedJobFixture>) =>
		insertTrackedJob(db, 'u1', {
			jobId,
			sourceId: mine,
			blueprintTypeId: INTERMEDIATE,
			facilityId: FACILITY,
			...f
		});

	job(JOB.intermediate, { runs: 2, cost: 100, endDate: NOW - 5 * DAY });
	insertJobResult(db, 'u1', {
		jobId: JOB.intermediate,
		inputCost: 1000,
		jobCost: 100,
		outputTypeId: inter,
		outputQty: 200,
		usedQty: 150,
		unsoldQty: 50,
		unitCost: 5.5,
		realizedProfit: 0,
		flags: ['market_fallback']
	});
	job(JOB.final, {
		blueprintTypeId: final.blueprintTypeId,
		sourceId: other,
		facilityId: OTHER_FACILITY,
		cost: 200,
		endDate: NOW - 2 * DAY
	});
	insertJobResult(db, 'u1', {
		jobId: JOB.final,
		inputCost: 2000,
		jobCost: 200,
		outputTypeId: product,
		outputQty: 100,
		soldQty: 60,
		salesNet: 3000,
		unsoldQty: 40,
		unitCost: 22,
		realizedProfit: 1680
	});
	job(JOB.running, { status: 'active', cost: 50, startDate: NOW - DAY, endDate: NOW + DAY });
	insertJobResult(db, 'u1', { jobId: JOB.running, inputCost: 500, jobCost: 50, flags: ['running'] });
	job(JOB.cancelled, { status: 'cancelled', cost: 30, endDate: NOW - 20 * DAY });
	insertJobResult(db, 'u1', {
		jobId: JOB.cancelled,
		inputCost: 300,
		jobCost: 30,
		realizedProfit: -330,
		flags: ['cancelled', 'no_cost']
	});
	job(JOB.old, { blueprintTypeId: final.blueprintTypeId, cost: 10, endDate: NOW - 60 * DAY });
	insertJobResult(db, 'u1', {
		jobId: JOB.old,
		inputCost: 90,
		jobCost: 10,
		outputTypeId: product,
		outputQty: 10,
		soldQty: 10,
		salesNet: 200,
		unitCost: 10,
		realizedProfit: 100
	});
	job(JOB.pending, { cost: 70, facilityId: OTHER_FACILITY, endDate: NOW - 3 * DAY });
	job(JOB.trackingOff, { sourceId: off, endDate: NOW - DAY });
	insertJobResult(db, 'u1', { jobId: JOB.trackingOff, inputCost: 1e9, realizedProfit: 1e9 });

	// Lots: the intermediate's inputs (one bought, one at market value), its output, the final's other input.
	const own = { userId: 'u1', sourceId: mine };
	insertTransaction(db, {
		...own,
		transactionId: 901,
		typeId: mat1.typeId,
		quantity: 100,
		date: NOW - 9 * DAY
	});
	insertPrice(db, { userId: 'u1', ref: 'transaction:901', typeId: mat1.typeId, quantity: 100, unitPrice: 8 });
	const lots = [
		{
			lotId: 1,
			typeId: mat1.typeId,
			quantity: 100,
			remaining: 0,
			unitCost: 8,
			origin: 'transaction',
			originRef: 'transaction:901'
		},
		{
			lotId: 2,
			typeId: mat2.typeId,
			quantity: 10,
			remaining: 0,
			unitCost: 20,
			origin: 'market',
			originRef: `job:${JOB.intermediate}`
		},
		{
			lotId: 3,
			typeId: inter,
			quantity: 200,
			remaining: 50,
			unitCost: 5.5,
			origin: 'job',
			originRef: `job:${JOB.intermediate}`
		},
		{
			lotId: 4,
			typeId: product,
			quantity: 100,
			remaining: 40,
			unitCost: 22,
			origin: 'job',
			originRef: `job:${JOB.final}`
		}
	] as const;
	lots.forEach((l, i) => insertLot(db, 'u1', { ...l, acquiredAt: NOW - (9 - i) * DAY }));
	insertUse(db, 'u1', { lotId: 1, kind: 'job', ref: `job:${JOB.intermediate}`, quantity: 100, unitCost: 8 });
	insertUse(db, 'u1', { lotId: 2, kind: 'job', ref: `job:${JOB.intermediate}`, quantity: 10, unitCost: 20 });
	insertUse(db, 'u1', { lotId: 3, kind: 'job', ref: `job:${JOB.final}`, quantity: 150, unitCost: 5.5 });
	insertTransaction(db, {
		...own,
		transactionId: 902,
		typeId: product,
		quantity: 60,
		isBuy: false,
		date: NOW - DAY
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:902',
		typeId: product,
		incoming: false,
		quantity: 60,
		unitPrice: 50,
		at: NOW - DAY
	});
	insertUse(db, 'u1', { lotId: 4, kind: 'sale', ref: 'transaction:902', quantity: 60, unitCost: 22 });

	insertTrackedJob(db, 'u2', { jobId: JOB.intermediate, sourceId: theirs, blueprintTypeId: INTERMEDIATE });
	insertJobResult(db, 'u2', { jobId: JOB.intermediate, inputCost: 5e8, realizedProfit: 5e8 });
	insertTrackedJob(db, 'u2', { jobId: 8001, sourceId: theirs, blueprintTypeId: INTERMEDIATE });

	return { env, intermediate, final, mine, other, off };
}

/** Manufacturing jobs added by {@link addManufacturing}. */
export const MANUFACTURING = {
	/** u1 (Alpha): took 30 of `JOB.intermediate`'s output 2 days ago, valued 9 per unit (cost 5.5). */
	mine: 7101,
	/** u1's tracking-off connection (Beta): took 5 more, which never count. */
	trackingOff: 7102,
	/** u2's manufacturing job with u1's lot id. */
	theirs: 7103,
	/** Blueprint of the manufacturing jobs (not in the fixture dataset; named from its product). */
	blueprint: 99_001,
	/** Its facility, where u1 has no reaction job. */
	facility: 1040000000009
} as const;

/**
 * Adds manufacturing use of `JOB.intermediate`'s output to {@link jobsScenario}: the job result becomes
 * 150 used by `JOB.final`, 30 used in manufacturing at 9 per unit (+105 realized), 20 unsold.
 * `productTypeId`: what the manufacturing jobs make.
 */
export function addManufacturing(s: JobsScenario, productTypeId: number) {
	const db = s.env.DB;
	const start = NOW - 2 * DAY;
	const mfg = (userId: string, jobId: number, sourceId: number) =>
		insertTrackedJob(db, userId, {
			jobId,
			sourceId,
			activityId: 1,
			blueprintTypeId: MANUFACTURING.blueprint,
			productTypeId,
			runs: 10,
			cost: 1000,
			facilityId: MANUFACTURING.facility,
			startDate: start,
			endDate: NOW - DAY
		});
	mfg('u1', MANUFACTURING.mine, s.mine);
	mfg('u1', MANUFACTURING.trackingOff, s.off);
	const [theirs] = db.rows<{ source_id: number }>(
		"SELECT source_id FROM inventory_sources WHERE user_id = 'u2'"
	);
	mfg('u2', MANUFACTURING.theirs, theirs.source_id);
	insertManufacturingUse(db, 'u1', {
		lotId: 3,
		ref: `job:${MANUFACTURING.mine}`,
		quantity: 30,
		unitCost: 5.5,
		unitValue: 9
	});
	insertManufacturingUse(db, 'u1', {
		lotId: 3,
		ref: `job:${MANUFACTURING.trackingOff}`,
		quantity: 5,
		unitCost: 5.5,
		unitValue: 9
	});
	db.sqlite
		.prepare(
			`UPDATE job_results SET manufactured_qty = 30, manufactured_value = 270, unsold_qty = 20,
				realized_profit = 105 WHERE user_id = 'u1' AND job_id = ?`
		)
		.run(JOB.intermediate);
	db.sqlite.prepare("UPDATE ledger_lots SET remaining = 20 WHERE user_id = 'u1' AND lot_id = 3").run();
}

/** The fuel block job added by {@link addFuelBlocks}, and the fixture dataset's Nitrogen Fuel Block. */
export const FUEL = {
	/** u1 (Alpha): 10 runs of Nitrogen Fuel Block Blueprint, ended 3 days ago. */
	job: 7201,
	/** A manufacturing job of a blueprint making no fuel block. */
	notFuel: 7202,
	blueprint: 4314,
	block: 4051,
	/** An ingredient (Heavy Water) the job had no purchase for. */
	ingredient: 16272,
	/** The ingredient batch valued at market (`job:<job>`) and the fuel block batch the job made. */
	inputLot: 21,
	blockLot: 22
} as const;

/**
 * Adds a fuel block job to {@link jobsScenario}: 1,700 Heavy Water without a purchase (market estimate,
 * 1 each), job cost 200, inputs 3,000 in all; it made 400 blocks at 8 each, of which `JOB.final` took
 * 300, 40 were sold for 12 each net (sale 903, a day ago) and 60 are held.
 */
export function addFuelBlocks(s: JobsScenario) {
	const db = s.env.DB;
	insertTrackedJob(db, 'u1', {
		jobId: FUEL.job,
		sourceId: s.mine,
		activityId: 1,
		blueprintTypeId: FUEL.blueprint,
		productTypeId: FUEL.block,
		runs: 10,
		cost: 200,
		facilityId: FACILITY,
		startDate: NOW - 4 * DAY,
		endDate: NOW - 3 * DAY
	});
	insertJobResult(db, 'u1', {
		jobId: FUEL.job,
		inputCost: 3000,
		jobCost: 200,
		outputTypeId: FUEL.block,
		outputQty: 400,
		usedQty: 300,
		soldQty: 40,
		salesNet: 480,
		unsoldQty: 60,
		unitCost: 8,
		realizedProfit: 160,
		flags: ['market_fallback']
	});
	insertTrackedJob(db, 'u1', {
		jobId: FUEL.notFuel,
		sourceId: s.mine,
		activityId: 1,
		blueprintTypeId: MANUFACTURING.blueprint,
		productTypeId: 11186,
		endDate: NOW - DAY
	});
	insertLot(db, 'u1', {
		lotId: FUEL.inputLot,
		typeId: FUEL.ingredient,
		acquiredAt: NOW - 4 * DAY,
		quantity: 1700,
		remaining: 0,
		unitCost: 1,
		origin: 'market',
		originRef: `job:${FUEL.job}`
	});
	insertUse(db, 'u1', {
		lotId: FUEL.inputLot,
		kind: 'job',
		ref: `job:${FUEL.job}`,
		quantity: 1700,
		unitCost: 1
	});
	insertLot(db, 'u1', {
		lotId: FUEL.blockLot,
		typeId: FUEL.block,
		acquiredAt: NOW - 3 * DAY,
		quantity: 400,
		remaining: 60,
		unitCost: 8,
		origin: 'job',
		originRef: `job:${FUEL.job}`
	});
	insertUse(db, 'u1', {
		lotId: FUEL.blockLot,
		kind: 'job',
		ref: `job:${JOB.final}`,
		quantity: 300,
		unitCost: 8
	});
	insertTransaction(db, {
		userId: 'u1',
		sourceId: s.mine,
		transactionId: 903,
		typeId: FUEL.block,
		quantity: 40,
		isBuy: false,
		date: NOW - DAY
	});
	insertPrice(db, {
		userId: 'u1',
		ref: 'transaction:903',
		typeId: FUEL.block,
		incoming: false,
		quantity: 40,
		unitPrice: 12,
		at: NOW - DAY
	});
	insertUse(db, 'u1', {
		lotId: FUEL.blockLot,
		kind: 'sale',
		ref: 'transaction:903',
		quantity: 40,
		unitCost: 8
	});
}
