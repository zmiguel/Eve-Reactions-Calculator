import { TrackingSettings, stockUnitValue, type Settings } from '@reactions/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobFilters, JobRow, JobsPageData, JobTotalsView } from '$lib/jobs/types';
import { asEnv, type FakeEnv } from '../../test/fakes';
import { L_REACTOR_RIG, TATARA, industryFixture, insertTrackedFacility } from '../../test/facilities';
import { NOW, defaults, insertUser, loadSde, marketFor, putKv } from '../../test/fixtures';
import {
	ALPHA,
	FACILITY,
	FUEL,
	GAMMA,
	JOB,
	MANUFACTURING,
	OTHER_FACILITY,
	addFuelBlocks,
	addManufacturing,
	insertJobResult,
	insertTrackedJob,
	jobsScenario,
	setLedgerState
} from '../../test/jobs';
import { DAY } from '../../test/ledger-item';
import { insertPrice } from '../../test/ledger';
import { sessionUser } from '../../test/sso';
import { loadCalc } from './context';
import { clearDataMemo } from './data';
import { PAGE_SIZE } from '$lib/paging';
import {
	isTrackedJob,
	jobDetailPage,
	jobStatus,
	jobsPage,
	jobsTable,
	listJobRows,
	parseJobsQuery,
	userJobsQuery
} from './jobs';
import { saveTrackingSettings } from './tracking-settings';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

const ALL: JobFilters = { period: 'all', status: null, formula: null, connection: null, sort: 'newest' };
const u1 = (settings: Settings = defaults()) => ({ user: sessionUser('u1', [ALPHA]), settings });

const page = (env: FakeEnv, filters: Partial<JobFilters> = {}, settings?: Settings, pageNumber = 1) =>
	jobsPage(asEnv(env), u1(settings), { ...ALL, ...filters }, pageNumber, NOW);

const ids = (data: JobsPageData) => data.jobs.rows.map((r) => r.jobId);
const row = (data: JobsPageData, jobId: number) => data.jobs.rows.find((r) => r.jobId === jobId)!;

/** Sums the rows the way the totals are defined. */
function sum(rows: JobRow[]): JobTotalsView {
	const nonNull = (pick: (r: JobRow) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
	return {
		jobs: rows.length,
		runs: nonNull((r) => r.runs),
		spent: nonNull((r) => (r.inputCost ?? 0) + (r.jobCost ?? 0)),
		realizedProfit: nonNull((r) => r.realizedProfit),
		expectedProfit: nonNull((r) => r.expectedProfit),
		unvalued: rows.filter((r) => r.expectedProfit === null && r.status !== 'running').length,
		soldQty: nonNull((r) => r.output?.soldQty ?? 0),
		usedQty: nonNull((r) => r.output?.usedQty ?? 0),
		manufacturedQty: nonNull((r) => r.output?.manufacturedQty ?? 0),
		unsoldQty: nonNull((r) => r.output?.unsoldQty ?? 0)
	};
}

/** Net value of one unit with `settings` (the engine's output side). */
async function unitValue(env: FakeEnv, typeId: number, settings = defaults()) {
	const calc = (await loadCalc(asEnv(env), { user: null, settings }))!;
	return stockUnitValue(calc.ctx, typeId);
}

describe('jobStatus', () => {
	it('running before the end date, finished after it or once delivered/ready, cancelled when reverted', () => {
		expect(jobStatus('active', NOW + 1, NOW)).toBe('running');
		expect(jobStatus('paused', NOW + 1, NOW)).toBe('running');
		expect(jobStatus('active', NOW, NOW)).toBe('finished');
		expect(jobStatus('ready', NOW + DAY, NOW)).toBe('finished');
		expect(jobStatus('delivered', NOW - DAY, NOW)).toBe('finished');
		expect(jobStatus('cancelled', NOW - DAY, NOW)).toBe('cancelled');
		expect(jobStatus('reverted', NOW + DAY, NOW)).toBe('cancelled');
	});
});

describe('parseJobsQuery', () => {
	it('reads the filters, the sort and the page; defaults to 30 days, every status, newest first', () => {
		const q = (s: string) => parseJobsQuery(new URLSearchParams(s));
		expect(q('')).toEqual({
			filters: { period: '30', status: null, formula: null, connection: null, sort: 'newest' },
			page: 1
		});
		expect(q('period=365&status=cancelled&reaction=46182&connection=3&sort=profit_asc&page=2')).toEqual({
			filters: { period: '365', status: 'cancelled', formula: 46182, connection: 3, sort: 'profit_asc' },
			page: 2
		});
		expect(q('period=12&status=all&reaction=x&connection=-1&sort=random&page=0')).toEqual({
			filters: { period: '30', status: null, formula: null, connection: null, sort: 'newest' },
			page: 1
		});
	});

	it("falls back to the user's default period; ?period overrides it", async () => {
		expect(parseJobsQuery(new URLSearchParams(''), '90').filters.period).toBe('90');
		expect(parseJobsQuery(new URLSearchParams('period=7'), 'all').filters.period).toBe('7');
		const { env } = await jobsScenario();
		const query = (s: string) => userJobsQuery(asEnv(env), 'u1', new URLSearchParams(s));
		expect(await query('')).toMatchObject({ filters: { period: '30' }, defaultPeriod: '30' });
		await saveTrackingSettings(asEnv(env), 'u1', TrackingSettings.parse({ defaultPeriod: '365' }));
		expect(await query('')).toMatchObject({ filters: { period: '365' }, defaultPeriod: '365' });
		expect(await query('period=7')).toMatchObject({ filters: { period: '7' }, defaultPeriod: '365' });
		// Another user keeps the default.
		expect((await userJobsQuery(asEnv(env), 'u2', new URLSearchParams(''))).filters.period).toBe('30');
	});
});

describe('jobsPage', () => {
	it("lists only the caller's jobs of tracking-on connections, newest end date first", async () => {
		const { env } = await jobsScenario();
		const data = await page(env);
		expect(ids(data)).toEqual([
			JOB.running,
			JOB.final,
			JOB.pending,
			JOB.intermediate,
			JOB.cancelled,
			JOB.old
		]);
		expect(data.hasJobs).toBe(true);
		expect(data.connections.map((c) => c.name)).toEqual(['Alpha', 'Alpha Corp']);

		const theirs = await jobsPage(
			asEnv(env),
			{ user: sessionUser('u2', [GAMMA]), settings: defaults() },
			ALL,
			1,
			NOW
		);
		expect(ids(theirs).sort()).toEqual([JOB.intermediate, 8001]);
		expect(theirs.totals.spent).toBe(5e8 + 100);
	});

	it('totals equal the sums of every matching row (listJobRows, all pages)', async () => {
		const { env } = await jobsScenario();
		const data = await page(env);
		const { rows } = await listJobRows(asEnv(env), u1(), ALL, NOW);
		expect(rows.map((r) => r.jobId)).toEqual(ids(data));
		expect(data.totals).toEqual(sum(rows));
		expect(data.totals.spent).toBe(1100 + 2200 + 550 + 330 + 70 + 100);
		expect(data.totals.realizedProfit).toBe(0 + 1680 - 330 + 100);
		expect(data.totals.unvalued).toBe(1);
	});

	it('counts jobs per status under the other filters, whatever the status filter', async () => {
		const { env, final } = await jobsScenario();
		const counts = { all: 6, running: 1, finished: 4, cancelled: 1 };
		expect((await page(env)).counts).toEqual(counts);
		expect((await page(env, { status: 'running' })).counts).toEqual(counts);
		expect((await page(env, { period: '7' })).counts).toEqual({
			all: 4,
			running: 1,
			finished: 3,
			cancelled: 0
		});
		expect((await page(env, { formula: final.blueprintTypeId })).counts).toEqual({
			all: 2,
			running: 0,
			finished: 2,
			cancelled: 0
		});
	});

	it('sorts by profit (nulls last), by spent and by running jobs ending soonest', async () => {
		const { env, mine } = await jobsScenario();
		// A second running job ending before the scenario's.
		insertTrackedJob(env.DB, 'u1', {
			jobId: 7020,
			sourceId: mine,
			blueprintTypeId: 46182,
			status: 'active',
			cost: 5,
			startDate: NOW - DAY,
			endDate: NOW + 3_600_000
		});
		const sorted = async (sort: JobFilters['sort']) => ids(await page(env, { sort }));
		const data = await page(env);
		const profit = (jobId: number) => row(data, jobId).expectedProfit ?? row(data, jobId).realizedProfit;
		// Jobs without a profit yet (running, not calculated) come last, newest end date first.
		const unknown = [JOB.running, 7020, JOB.pending];
		for (const jobId of unknown) expect(profit(jobId)).toBeNull();
		const desc = await sorted('profit_desc');
		const asc = await sorted('profit_asc');
		expect(desc.slice(4)).toEqual(unknown);
		expect(asc.slice(4)).toEqual(unknown);
		const valued = desc.slice(0, 4).map((id) => profit(id)!);
		expect(valued).toEqual([...valued].sort((a, b) => b - a));
		expect(new Set(valued).size).toBe(4);
		expect(desc.slice(0, 4).sort()).toEqual([JOB.intermediate, JOB.final, JOB.cancelled, JOB.old].sort());
		expect(asc.slice(0, 4)).toEqual(desc.slice(0, 4).reverse());
		expect(desc[3]).toBe(JOB.cancelled);
		// Spent: final 2,200, intermediate 1,100, running 550, cancelled 330, old 100, pending 70, 7020 5.
		expect(await sorted('spent')).toEqual([
			JOB.final,
			JOB.intermediate,
			JOB.running,
			JOB.cancelled,
			JOB.old,
			JOB.pending,
			7020
		]);
		expect(await sorted('ending')).toEqual([
			7020,
			JOB.running,
			JOB.final,
			JOB.pending,
			JOB.intermediate,
			JOB.cancelled,
			JOB.old
		]);
	});

	it('expected profit values unsold output with stockUnitValue and the visitor settings', async () => {
		const { env, intermediate, final } = await jobsScenario();
		const inter = intermediate.product.typeId;
		const value = (await unitValue(env, inter))!;
		// Fixture market: Jita sell = 100 × typeId mod 997 + 1; default sell order, broker 1.5 %, tax 3.6 %.
		expect(value).toBeCloseTo((((inter * 100) % 997) + 1) * (1 - 0.015 - 0.036), 6);

		const data = await page(env);
		expect(row(data, JOB.intermediate).expectedProfit).toBeCloseTo(0 + 50 * (value - 5.5), 6);
		const productValue = (await unitValue(env, final.product.typeId))!;
		expect(row(data, JOB.final).expectedProfit).toBeCloseTo(1680 + 40 * (productValue - 22), 6);
		// All output sold: expected = realized.
		expect(row(data, JOB.old).expectedProfit).toBe(100);

		const cheap = defaults();
		cheap.shared.market.outputPricePct = 50;
		const halved = (await unitValue(env, inter, cheap))!;
		expect(halved).toBeCloseTo(value / 2, 6);
		const withCheap = await page(env, {}, cheap);
		expect(row(withCheap, JOB.intermediate).expectedProfit).toBeCloseTo(50 * (halved - 5.5), 6);
	});

	it('expected profit is null (with a note) when the output has no price today', async () => {
		const { env, final } = await jobsScenario();
		const sde = await loadSde();
		const market = marketFor(sde);
		delete market.prices.jita[final.product.typeId];
		await putKv(env, sde, market);
		clearDataMemo();

		const data = await page(env);
		const finalRow = row(data, JOB.final);
		expect(finalRow.realizedProfit).toBe(1680);
		expect(finalRow.expectedProfit).toBeNull();
		expect(finalRow.expectedNote).toBeTruthy();
		// The job whose output is all sold keeps its expected profit.
		expect(row(data, JOB.old).expectedProfit).toBe(100);
		expect(data.totals.unvalued).toBe(2);
		expect(data.totals).toEqual(sum(data.jobs.rows));
	});

	it('running jobs have no profit; a cancelled job shows its loss', async () => {
		const { env } = await jobsScenario();
		const data = await page(env);
		const running = row(data, JOB.running);
		expect(running).toMatchObject({
			status: 'running',
			inputCost: 500,
			jobCost: 50,
			output: null,
			realizedProfit: null,
			expectedProfit: null
		});
		expect(running.expectedNote).toBeTruthy();
		expect(row(data, JOB.cancelled)).toMatchObject({
			status: 'cancelled',
			marks: ['no_cost'],
			output: null,
			realizedProfit: -330,
			expectedProfit: -330
		});
	});

	it('a job without results (or with out-of-date ones) shows its job cost only', async () => {
		const { env, mine } = await jobsScenario();
		// Ended after the last recalculation, which still saw it running.
		insertTrackedJob(env.DB, 'u1', {
			jobId: 7010,
			sourceId: mine,
			blueprintTypeId: 46182,
			status: 'active',
			cost: 40,
			endDate: NOW - 60_000
		});
		insertJobResult(env.DB, 'u1', { jobId: 7010, inputCost: 400, jobCost: 40, flags: ['running'] });
		const data = await page(env);
		for (const jobId of [JOB.pending, 7010]) {
			expect(row(data, jobId)).toMatchObject({
				status: 'finished',
				inputCost: null,
				output: null,
				realizedProfit: null,
				expectedProfit: null
			});
		}
		expect(row(data, JOB.pending).jobCost).toBe(70);
		expect(row(data, 7010).jobCost).toBe(40);
	});

	it('names owners and facilities, flags and output', async () => {
		const { env, intermediate } = await jobsScenario();
		const data = await page(env);
		expect(row(data, JOB.intermediate)).toMatchObject({
			formula: { blueprintTypeId: intermediate.blueprintTypeId, name: intermediate.formulaName },
			runs: 2,
			owner: 'Alpha',
			facility: 'Reactor One',
			marks: ['market_fallback'],
			inputCost: 1000,
			jobCost: 100,
			realizedProfit: 0,
			output: {
				typeId: intermediate.product.typeId,
				quantity: 200,
				soldQty: 0,
				usedQty: 150,
				unsoldQty: 50
			}
		});
		expect(row(data, JOB.final)).toMatchObject({
			owner: 'Alpha Corp',
			facility: 'Unknown structure'
		});
		expect(FACILITY).not.toBe(OTHER_FACILITY);
	});

	it('filters by period (end date), status, reaction and connection', async () => {
		const { env, final, other } = await jobsScenario();
		expect(ids(await page(env, { period: '30' }))).toEqual([
			JOB.running,
			JOB.final,
			JOB.pending,
			JOB.intermediate,
			JOB.cancelled
		]);
		expect(ids(await page(env, { period: '7' }))).toEqual([
			JOB.running,
			JOB.final,
			JOB.pending,
			JOB.intermediate
		]);
		expect(ids(await page(env, { period: '90' }))).toContain(JOB.old);
		expect(ids(await page(env, { status: 'running', period: '7' }))).toEqual([JOB.running]);
		expect(ids(await page(env, { status: 'finished' }))).toEqual([
			JOB.final,
			JOB.pending,
			JOB.intermediate,
			JOB.old
		]);
		expect(ids(await page(env, { status: 'cancelled' }))).toEqual([JOB.cancelled]);
		expect(ids(await page(env, { formula: final.blueprintTypeId }))).toEqual([JOB.final, JOB.old]);
		expect(ids(await page(env, { connection: other }))).toEqual([JOB.final]);

		const filtered = await page(env, { period: '7', status: 'finished' });
		expect(filtered.totals).toEqual(sum(filtered.jobs.rows));
		expect(filtered.formulas.map((f) => f.blueprintTypeId).sort()).toEqual(
			[46182, final.blueprintTypeId].sort()
		);
	});

	it('pages by 10 with totals over every page; jobsTable serves the same pages', async () => {
		const { env, mine } = await jobsScenario();
		for (let i = 0; i < 20; i++) {
			insertTrackedJob(env.DB, 'u1', {
				jobId: 10_000 + i,
				sourceId: mine,
				blueprintTypeId: 46182,
				cost: 1 + i,
				endDate: NOW - 10 * DAY - i * 60_000
			});
		}
		const first = await page(env);
		expect(first.jobs).toMatchObject({ page: 1, pageCount: 3, total: 26 });
		expect(first.jobs.rows).toHaveLength(PAGE_SIZE);
		expect(first.totals.jobs).toBe(26);
		const ends = first.jobs.rows.map((r) => r.endDate);
		expect(ends).toEqual([...ends].sort((a, b) => b - a));
		const last = await page(env, {}, undefined, 3);
		expect(last.jobs.page).toBe(3);
		expect(last.jobs.rows).toHaveLength(6);
		expect((await page(env, {}, undefined, 99)).jobs.page).toBe(3);
		expect(last.totals).toEqual(first.totals);

		for (const [filters, n] of [
			[ALL, 2],
			[{ ...ALL, sort: 'spent', status: 'finished' }, 2],
			[{ ...ALL, period: '7' }, 1]
		] as const) {
			const table = await jobsTable(asEnv(env), u1(), filters, n, NOW);
			const loaded = await jobsPage(asEnv(env), u1(), filters, n, NOW);
			expect(table).toEqual(loaded.jobs);
		}
		// The table rows carry no detail-only fields.
		expect(Object.keys(first.jobs.rows[0])).not.toContain('unitCost');
	});

	it('header facts: recalculation state, review count; no connections', async () => {
		const { env } = await jobsScenario();
		insertPrice(env.DB, {
			userId: 'u1',
			ref: 'transaction:901',
			typeId: 1,
			needsReview: true
		});
		const data = await page(env);
		expect(data.rebuiltAt).toBe(NOW - 600_000);
		expect(data.dirty).toBe(false);
		expect(data.reviewCount).toBe(1);
		setLedgerState(env.DB, 'u1', null, true);
		expect((await page(env)).dirty).toBe(true);

		insertUser(env.DB, { userId: 'u3' }, [{ characterId: 90000004, name: 'Delta' }]);
		const none = await jobsPage(
			asEnv(env),
			{ user: sessionUser('u3', [{ characterId: 90000004, name: 'Delta' }]), settings: defaults() },
			ALL,
			1,
			NOW
		);
		expect(none).toMatchObject({
			hasJobs: false,
			jobs: { rows: [], total: 0 },
			counts: { all: 0 },
			reviewCount: 0
		});
	});

	it('manufacturing jobs are never rows, counts, formulas or facilities; their use is a fourth output part', async () => {
		const s = await jobsScenario();
		const before = await page(s.env);
		addManufacturing(s, s.final.product.typeId);
		const data = await page(s.env);
		expect(ids(data)).toEqual(ids(before));
		expect(data.counts).toEqual(before.counts);
		expect(data.formulas).toEqual(before.formulas);
		expect(data.totals.jobs).toBe(before.totals.jobs);
		const inter = row(data, JOB.intermediate);
		expect(inter.output).toMatchObject({ usedQty: 150, manufacturedQty: 30, unsoldQty: 20 });
		// Realized from job_results (it includes the manufacturing value).
		expect(inter.realizedProfit).toBe(105);
		expect(data.totals.manufacturedQty).toBe(30);
		expect(data.totals).toEqual(sum(data.jobs.rows));
		expect(await isTrackedJob(asEnv(s.env), 'u1', MANUFACTURING.mine)).toBe(false);
		expect(await isTrackedJob(asEnv(s.env), 'u1', JOB.intermediate)).toBe(true);

		// A user with only manufacturing jobs has no jobs to show.
		const theirs = await jobsPage(
			asEnv(s.env),
			{ user: sessionUser('u2', [GAMMA]), settings: defaults() },
			ALL,
			1,
			NOW
		);
		expect(ids(theirs)).not.toContain(MANUFACTURING.theirs);
	});

	it("returns the user's default period for links", async () => {
		const { env } = await jobsScenario();
		expect((await page(env)).defaultPeriod).toBe('30');
		const data = await jobsPage(asEnv(env), u1(), { ...ALL, period: '90' }, 1, NOW, '90');
		expect(data).toMatchObject({ defaultPeriod: '90', filters: { period: '90' } });
	});
});

describe('jobDetailPage', () => {
	const detail = (env: FakeEnv, jobId: number, settings?: Settings) =>
		jobDetailPage(asEnv(env), u1(settings), jobId, NOW);

	it('null for unknown jobs, other users’ jobs and tracking-off connections', async () => {
		const { env } = await jobsScenario();
		for (const jobId of [0, 999_999, 8001, JOB.trackingOff]) expect(await detail(env, jobId)).toBeNull();
	});

	it('lists inputs with their lots and sources; market value lots are correctable', async () => {
		const { env, intermediate, final } = await jobsScenario();
		const data = (await detail(env, JOB.intermediate))!;
		const [mat1, mat2] = intermediate.materials;
		expect(data.job).toMatchObject({
			jobId: JOB.intermediate,
			product: { typeId: intermediate.product.typeId },
			unitCost: 5.5,
			salesNet: 0,
			status: 'finished'
		});
		expect(data.inputs.map((i) => [i.typeId, i.quantity, i.cost])).toEqual([
			[mat1.typeId, 100, 800],
			[mat2.typeId, 10, 200]
		]);
		expect(data.inputs[0].lots).toEqual([
			expect.objectContaining({
				lotId: 1,
				origin: 'transaction',
				priceSource: 'Source of lot 1',
				quantity: 100,
				unitCost: 8,
				cost: 800,
				madeBy: null,
				correctionRef: null,
				corrected: false
			})
		]);
		expect(data.inputs[1].lots[0]).toMatchObject({
			lotId: 2,
			origin: 'market',
			priceSource: 'Source of lot 2',
			correctionRef: `job:${JOB.intermediate}:${mat2.typeId}`,
			corrected: false
		});
		// Output: 150 used by the final job, 50 unsold valued today.
		const value = (await unitValue(env, intermediate.product.typeId))!;
		expect(data.output).toMatchObject({
			quantity: 200,
			usedQty: 150,
			unsoldQty: 50,
			sales: [],
			usedBy: [{ jobId: JOB.final, formula: { name: final.formulaName }, quantity: 150 }]
		});
		expect(data.output!.unsoldValueNow).toBeCloseTo(50 * value, 6);
		expect(data.chain).toEqual({ from: [], to: data.output!.usedBy });
	});

	it('shows sales of the output and the job that made an input (chain up)', async () => {
		const { env, intermediate } = await jobsScenario();
		const data = (await detail(env, JOB.final))!;
		expect(data.inputs).toHaveLength(1);
		expect(data.inputs[0]).toMatchObject({ typeId: intermediate.product.typeId, quantity: 150, cost: 825 });
		expect(data.inputs[0].lots[0]).toMatchObject({
			lotId: 3,
			origin: 'job',
			madeBy: { jobId: JOB.intermediate, formula: { name: intermediate.formulaName } },
			correctionRef: null
		});
		expect(data.output!.sales).toEqual([
			{ ref: 'transaction:902', kind: 'market', at: NOW - DAY, quantity: 60, netUnitValue: 50 }
		]);
		expect(data.output!.usedBy).toEqual([]);
		expect(data.chain.from.map((j) => [j.jobId, j.quantity])).toEqual([[JOB.intermediate, 150]]);
		expect(data.chain.to).toEqual([]);
	});

	it('a corrected input offers undo; running and cancelled jobs have no output', async () => {
		const { env } = await jobsScenario();
		env.DB.sqlite.exec(`UPDATE ledger_lots SET origin = 'correction' WHERE user_id = 'u1' AND lot_id = 2`);
		const data = (await detail(env, JOB.intermediate))!;
		expect(data.inputs[1].lots[0]).toMatchObject({ corrected: true, correctionNote: null });
		const ref = data.inputs[1].lots[0].correctionRef!;
		expect(ref).not.toBeNull();
		env.DB.sqlite
			.prepare(
				`INSERT INTO price_corrections (user_id, target_kind, target_ref, unit_price, note, created_at)
					VALUES ('u1', 'job_input', ?, 9, 'From the corp hangar', ?)`
			)
			.run(ref, NOW);
		expect((await detail(env, JOB.intermediate))!.inputs[1].lots[0].correctionNote).toBe(
			'From the corp hangar'
		);

		const running = (await detail(env, JOB.running))!;
		expect(running).toMatchObject({ output: null, job: { status: 'running', realizedProfit: null } });
		// Its cost per unit and expected profit are worked out for the output it will make, at the same net
		// value today as the finished intermediate's unsold output (same product).
		const outputQty = running.job.runningOutputQty!;
		expect(outputQty).toBeGreaterThan(0);
		expect(running.job.unitCost).toBeCloseTo(550 / outputQty, 10);
		const valueNow = (await detail(env, JOB.intermediate))!.output!.unitValueNow!;
		expect(running.job.expectedProfit).toBeCloseTo(outputQty * valueNow - 550, 6);
		expect(running.job.expectedNote).toBeNull();
		// The realized profit keeps a reason of its own: the job is still running.
		expect(running.job.realizedNote).toBeTruthy();
		expect(running.job.realizedNote).not.toBe(running.job.expectedNote);
		// Finished jobs carry no running estimate.
		expect((await detail(env, JOB.intermediate))!.job.runningOutputQty).toBeNull();
		expect((await detail(env, JOB.cancelled))!).toMatchObject({
			output: null,
			job: { status: 'cancelled', realizedProfit: -330 }
		});
	});

	it('a running job whose output has no value today: cost per unit, no expected profit, with a note', async () => {
		const { env, intermediate } = await jobsScenario();
		const sde = await loadSde();
		const market = marketFor(sde);
		delete market.prices.jita[intermediate.product.typeId];
		await putKv(env, sde, market);
		clearDataMemo();

		const running = (await detail(env, JOB.running))!;
		const outputQty = running.job.runningOutputQty!;
		expect(outputQty).toBeGreaterThan(0);
		expect(running.job.unitCost).toBeCloseTo(550 / outputQty, 10);
		expect(running.job.expectedProfit).toBeNull();
		expect(running.job.expectedNote).toBeTruthy();
		expect(running.job.realizedNote).toBeTruthy();
		expect(running.job.realizedNote).not.toBe(running.job.expectedNote);
	});

	it('a running job of a formula not in the dataset gets no estimate', async () => {
		const { env, mine } = await jobsScenario();
		const jobId = 7030;
		insertTrackedJob(env.DB, 'u1', {
			jobId,
			sourceId: mine,
			blueprintTypeId: 1,
			status: 'active',
			cost: 50,
			startDate: NOW - DAY,
			endDate: NOW + DAY
		});
		insertJobResult(env.DB, 'u1', { jobId, inputCost: 500, jobCost: 50, flags: ['running'] });

		const running = (await detail(env, jobId))!;
		expect(running.job).toMatchObject({
			status: 'running',
			formula: { name: null },
			runningOutputQty: null,
			unitCost: null,
			expectedProfit: null,
			realizedProfit: null
		});
		expect(running.job.expectedNote).toBeTruthy();
		expect(running.job.realizedNote).toBeTruthy();
		expect(running.materialBonus).toBeNull();
	});

	it('lists the manufacturing jobs that used the output (tracking-on, this user only)', async () => {
		const s = await jobsScenario();
		addManufacturing(s, s.final.product.typeId);
		const data = (await detail(s.env, JOB.intermediate))!;
		expect(data.output).toMatchObject({ manufacturedQty: 30, unsoldQty: 20 });
		expect(data.output!.manufacturing).toEqual([
			{
				jobId: MANUFACTURING.mine,
				product: { typeId: s.final.product.typeId, name: expect.any(String) },
				at: NOW - 2 * DAY,
				quantity: 30,
				unitValue: 9,
				basis: 'buy_value'
			}
		]);
		expect(data.output!.manufacturing[0].product!.name).not.toMatch(/^Type /);
		// Manufacturing jobs are not chain links, nor job pages.
		expect(data.chain.to.map((j) => j.jobId)).toEqual([JOB.final]);
		expect(await detail(s.env, MANUFACTURING.mine)).toBeNull();

		await saveTrackingSettings(asEnv(s.env), 'u1', TrackingSettings.parse({ manufacturingUse: 'zero' }));
		expect((await detail(s.env, JOB.intermediate))!.output!.manufacturing[0].basis).toBe('cost');
		// No output used in manufacturing: an empty list.
		expect((await detail(s.env, JOB.final))!.output!.manufacturing).toEqual([]);
	});

	it('material bonus: the structure and the installed rig matching the product, in its band', async () => {
		const s = await jobsScenario();
		const sde = await loadSde();
		const industry = industryFixture({ composite: [s.intermediate.product.typeId] });
		await s.env.CACHE.put('dataset:v1', JSON.stringify({ ...sde.dataset, industry }));
		clearDataMemo();
		insertTrackedFacility(s.env.DB, 'u1', {
			facilityId: FACILITY,
			typeId: TATARA,
			systemId: 30004604,
			rigs: [L_REACTOR_RIG]
		});
		expect((await detail(s.env, JOB.intermediate))!.materialBonus).toEqual({
			facility: 'Reactor One',
			band: 'nullsec',
			source: 'facility',
			reactorSettingsSystem: false,
			parts: [
				{ kind: 'rig', name: 'Standup L-Set Reactor Efficiency II', reduction: expect.closeTo(0.0264, 10) }
			],
			profileRig: null,
			reduction: expect.closeTo(0.0264, 10)
		});
	});

	it('material bonus: the reactor settings when the structure or its rigs are not known', async () => {
		const { env } = await jobsScenario();
		// Nothing known of the facility: the default profile's T2 ME rig in Ignoitton (lowsec).
		const profileRig = { meRig: 't2', reduction: expect.closeTo(0.024, 10), band: 'lowsec' };
		expect((await detail(env, JOB.final))!.materialBonus).toEqual({
			facility: 'Unknown structure',
			band: null,
			source: 'profile',
			reactorSettingsSystem: false,
			parts: [],
			profileRig,
			reduction: expect.closeTo(0.024, 10)
		});
		// With industry data and the structure set but not its rigs: the structure plus the profile's rig.
		const sde = await loadSde();
		await env.CACHE.put('dataset:v1', JSON.stringify({ ...sde.dataset, industry: industryFixture() }));
		clearDataMemo();
		await saveTrackingSettings(
			asEnv(env),
			'u1',
			TrackingSettings.parse({ facilities: { [OTHER_FACILITY]: { structureTypeId: TATARA } } })
		);
		expect((await detail(env, JOB.final))!.materialBonus).toMatchObject({
			source: 'structure_profile_rig',
			parts: [],
			profileRig
		});
		const noRig = { ...defaults(), shared: { ...defaults().shared, meRig: 'none' as const } };
		expect((await detail(env, JOB.final, noRig))!.materialBonus).toMatchObject({ reduction: 0 });
		// A facility in the reactor settings' system (Ignoitton): the settings are its defaults, on purpose.
		insertTrackedFacility(env.DB, 'u1', { facilityId: OTHER_FACILITY, systemId: 30002647 });
		expect((await detail(env, JOB.final))!.materialBonus).toMatchObject({ reactorSettingsSystem: true });
	});
});

describe('fuel block jobs', () => {
	it('stay out of the job list, its counts, totals and formula choices', async () => {
		const s = await jobsScenario();
		const before = await page(s.env);
		addFuelBlocks(s);
		const after = await page(s.env);
		expect(ids(after)).toEqual(ids(before));
		expect(after.counts).toEqual(before.counts);
		expect(after.totals).toEqual(before.totals);
		expect(after.formulas).toEqual(before.formulas);
		const rows = (await listJobRows(asEnv(s.env), u1(), ALL, NOW)).rows;
		expect(rows.map((r) => r.jobId)).not.toContain(FUEL.job);
	});

	it('have a job page: inputs, output used by reactions, cost per block, no material bonus', async () => {
		const s = await jobsScenario();
		addFuelBlocks(s);
		const data = (await jobDetailPage(asEnv(s.env), u1(), FUEL.job, NOW))!;
		expect(data.kind).toBe('fuel_block');
		expect(data.job.formula).toEqual({
			blueprintTypeId: FUEL.blueprint,
			name: 'Nitrogen Fuel Block Blueprint'
		});
		expect(data.job.product?.typeId).toBe(FUEL.block);
		// (3,000 inputs + 200 job cost) / 400 blocks.
		expect(data.job.unitCost).toBe(8);
		expect(data.materialBonus).toBeNull();
		expect(data.inputs.map((i) => [i.typeId, i.quantity, i.cost])).toEqual([[FUEL.ingredient, 1700, 1700]]);
		expect(data.inputs[0].lots[0]).toMatchObject({
			origin: 'market',
			correctionRef: `job:${FUEL.job}:${FUEL.ingredient}`
		});
		expect(data.output).toMatchObject({ quantity: 400, usedQty: 300, soldQty: 40, unsoldQty: 60 });
		expect(data.chain.to).toEqual([expect.objectContaining({ jobId: JOB.final, quantity: 300 })]);
		expect(data.chain.from).toEqual([]);
		expect(await isTrackedJob(asEnv(s.env), 'u1', FUEL.job)).toBe(true);

		// The reaction job using the blocks links back to it by blueprint name.
		const final = (await jobDetailPage(asEnv(s.env), u1(), JOB.final, NOW))!;
		expect(final.kind).toBe('reaction');
		expect(final.chain.from).toContainEqual(
			expect.objectContaining({
				jobId: FUEL.job,
				formula: { blueprintTypeId: FUEL.blueprint, name: 'Nitrogen Fuel Block Blueprint' },
				quantity: 300
			})
		);
	});

	it('a manufacturing job making no fuel block has no job page', async () => {
		const s = await jobsScenario();
		addFuelBlocks(s);
		expect(await jobDetailPage(asEnv(s.env), u1(), FUEL.notFuel, NOW)).toBeNull();
		expect(await isTrackedJob(asEnv(s.env), 'u1', FUEL.notFuel)).toBe(false);
	});
});
