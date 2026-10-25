import { TrackingSettings, stockUnitValue } from '@reactions/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobFilters } from '$lib/jobs/types';
import type { ProfitPeriod } from '$lib/profits/types';
import { asEnv, type FakeEnv } from '../../test/fakes';
import { NOW, defaults } from '../../test/fixtures';
import { ALPHA, FUEL, GAMMA, JOB, addFuelBlocks, addManufacturing, insertTrackedJob } from '../../test/jobs';
import { DAY, insertLot, insertUse } from '../../test/ledger-item';
import { insertManualEntry, insertPrice, insertTransaction } from '../../test/ledger';
import { overviewScenario } from '../../test/profits';
import { sessionUser } from '../../test/sso';
import { loadCalc } from './context';
import { clearDataMemo } from './data';
import { jobsPage } from './jobs';
import {
	loadOverviewFacts,
	overviewCharts,
	overviewTable,
	parsePeriod,
	periodBounds,
	profitsOverview
} from './profits-overview';
import { saveTrackingSettings } from './tracking-settings';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

const u1 = { user: sessionUser('u1', [ALPHA]), settings: defaults() };
const url = (query = '') => new URL(`https://reactions.coalition.space/profits${query}`);
const overview = (env: FakeEnv, query = '') => profitsOverview(asEnv(env), u1, url(query), NOW);

async function unitValue(env: FakeEnv, typeId: number) {
	const calc = (await loadCalc(asEnv(env), { user: null, settings: defaults() }))!;
	return stockUnitValue(calc.ctx, typeId)!;
}

describe('periods', () => {
	it('reads the period from the query string, 30 days by default', () => {
		expect(parsePeriod(url('?period=7'))).toBe('7');
		expect(parsePeriod(url('?period=365'))).toBe('365');
		expect(parsePeriod(url('?period=all'))).toBe('all');
		expect(parsePeriod(url('?period=12'))).toBe('30');
		expect(parsePeriod(url())).toBe('30');
	});

	it('counts days back from now with a previous period of the same length', () => {
		expect(periodBounds('7', NOW)).toEqual({
			period: '7',
			start: NOW - 7 * DAY,
			end: NOW,
			previousStart: NOW - 14 * DAY,
			bucket: 'day'
		});
		expect(periodBounds('all', NOW)).toMatchObject({ start: null, previousStart: null, bucket: 'month' });
	});

	it('buckets by day for 7 and 30 days, by week from Monday for 90 and 365, by month for all', async () => {
		const { env } = await overviewScenario();
		const facts = await loadOverviewFacts(asEnv(env), u1, NOW);
		const labels = (period: ProfitPeriod) =>
			overviewCharts(facts, periodBounds(period, NOW)).timeline.map((p) => p.label);
		// NOW is 2026-10-06 (a Tuesday) 12:00 UTC.
		expect(labels('7')).toEqual([
			'2026-09-29',
			'2026-09-30',
			'2026-10-01',
			'2026-10-02',
			'2026-10-03',
			'2026-10-04',
			'2026-10-05',
			'2026-10-06'
		]);
		expect(labels('30')).toHaveLength(31);
		for (const period of ['90', '365'] as const) {
			const weeks = labels(period);
			expect(weeks.every((l) => new Date(`${l}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
			expect(weeks.at(-1)).toBe('2026-10-05');
		}
		expect(labels('90')).toHaveLength(14);
		// From the oldest event (JOB.old started 61 days ago) to this month.
		expect(labels('all')).toEqual(['2026-08', '2026-09', '2026-10']);
	});
});

describe('KPIs', () => {
	it('counts realized profit by sale date: a job sold over two periods splits between them', async () => {
		const { env } = await overviewScenario();
		const week = (await overview(env, '?period=7')).kpis;
		// Sale 902 (+1,680) and the later part of JOB.old (+150) in the last 7 days; the earlier part (+80) before.
		expect(week.realized).toBe(1680 + 150);
		expect(week.realizedPrevious).toBe(80);

		const month = (await overview(env)).kpis;
		// Both parts of JOB.old and the cancelled job's loss.
		expect(month.realized).toBe(1680 + 150 + 80 - 330);
		expect(month.realizedPrevious).toBe(0);
		expect((await overview(env, '?period=all')).kpis.realizedPrevious).toBeNull();
	});

	it("expected profit is the Jobs tab's for the same jobs; profit per slot per day divides it by their slot-days", async () => {
		const { env } = await overviewScenario();
		for (const period of ['7', '30', '90', 'all'] as const) {
			const filters: JobFilters = { period, status: null, formula: null, connection: null, sort: 'newest' };
			const jobs = await jobsPage(asEnv(env), u1, filters, 1, NOW);
			const { kpis } = await overview(env, `?period=${period}`);
			expect(kpis.expected).toBeCloseTo(jobs.totals.expectedProfit, 6);
			expect(kpis.unvaluedJobs).toBe(jobs.totals.unvalued);
		}
		const week = (await overview(env, '?period=7')).kpis;
		// Ended in the last 7 days: JOB.intermediate and JOB.final (one day each) and JOB.pending (no value yet).
		expect(week.endedJobs).toBe(3);
		expect(week.unvaluedJobs).toBe(1);
		expect(week.slotDays).toBe(2);
		expect(week.profitPerSlotDay).toBeCloseTo(week.expected / 2, 6);
		expect(week.expectedHasUnsold).toBe(true);
	});

	it('sums sales income, purchases and job costs of the period', async () => {
		const { env } = await overviewScenario();
		const week = (await overview(env, '?period=7')).kpis;
		expect(week.salesIncome).toBe(60 * 50 + 6 * 35 + 20 * 12);
		expect(week.sales).toBe(3);
		expect(week.purchases).toBe(100 * 8 + 50 * 9);
		// Jobs started in the last 7 days: intermediate 100, final 200, running 50, pending 70.
		expect(week.jobCosts).toBe(100 + 200 + 50 + 70);
		expect(week.spent).toBe(week.purchases + week.jobCosts);
	});

	it('values unsold output today and the gain over its cost; reselling is reported apart', async () => {
		const { env, intermediate, product } = await overviewScenario();
		const inter = intermediate.product.typeId;
		const [interValue, productValue] = [await unitValue(env, inter), await unitValue(env, product)];
		const { kpis, unsold } = await overview(env, '?period=7');
		expect(kpis.unsold.quantity).toBe(90);
		expect(kpis.unsold.value).toBeCloseTo(50 * interValue + 40 * productValue, 6);
		expect(kpis.unsold.cost).toBe(50 * 5.5 + 40 * 22);
		expect(kpis.unsold.gain).toBeCloseTo(kpis.unsold.value - kpis.unsold.cost, 6);
		expect(unsold.rows.map((r) => [r.typeId, r.quantity])).toEqual(
			[
				[inter, 50, 50 * interValue],
				[product, 40, 40 * productValue]
			]
				.sort((a, b) => b[2] - a[2])
				.map(([t, q]) => [t, q])
		);
		expect(kpis.reselling).toEqual({ profit: 20 * (12 - 9), sales: 1 });
	});
});

describe('attention', () => {
	it('lists prices to review, inputs valued at market and failing connections', async () => {
		const { env } = await overviewScenario();
		const { attention } = await overview(env, '?period=7');
		expect(attention).toEqual([
			{ kind: 'review', count: 1 },
			// JOB.intermediate: 200 of its 1,000 input cost is a market estimate.
			{ kind: 'estimates', jobs: 1, share: 0.2 },
			{ kind: 'streams', connections: 1 }
		]);
	});
});

describe('charts', () => {
	it('splits the input cost of jobs started in the period by source; the slices add up to it', async () => {
		const { env } = await overviewScenario();
		const { charts } = await overview(env, '?period=7');
		expect(charts.inputSources).toEqual([
			{ kind: 'transaction', cost: 800 },
			{ kind: 'job', cost: 150 * 5.5 },
			{ kind: 'market', cost: 200 }
		]);
		// JOB.intermediate's input cost (1,000) plus what JOB.final took from it.
		expect(charts.inputSources.reduce((s, x) => s + x.cost, 0)).toBe(1000 + 825);
	});

	it('puts realized profit, sales, purchases and job costs in their buckets', async () => {
		const { env } = await overviewScenario();
		const { charts, kpis } = await overview(env, '?period=7');
		const at = (label: string) => charts.timeline.find((p) => p.label === label)!;
		expect(at('2026-10-05')).toMatchObject({ realized: 1680, salesIncome: 3000, jobCosts: 50 });
		expect(at('2026-10-03')).toMatchObject({ realized: 150, salesIncome: 210, jobCosts: 200 });
		expect(at('2026-10-06').purchases).toBe(800);
		expect(charts.timeline.at(-1)!.cumulative).toBe(kpis.realized);
		expect(charts.timeline.reduce((s, p) => s + p.salesIncome, 0)).toBe(kpis.salesIncome);
	});

	it('ranks formulas by expected profit with its realized part, named by their product', async () => {
		const { env, intermediate, final } = await overviewScenario();
		const { charts, reactions } = await overview(env, '?period=7');
		expect(charts.reactions.map((r) => r.blueprintTypeId)).toEqual(
			reactions.rows.map((r) => r.blueprintTypeId)
		);
		expect(charts.reactions.length).toBeGreaterThan(0);
		for (const point of charts.reactions) {
			const row = reactions.rows.find((r) => r.blueprintTypeId === point.blueprintTypeId)!;
			expect(point.realized).toBe(row.realized);
			expect(point.realized + point.unrealized).toBeCloseTo(row.expected, 6);
			const reaction = [intermediate, final].find((r) => r.blueprintTypeId === point.blueprintTypeId)!;
			expect(point.name).toBe(reaction.name);
			expect(row.name).toBe(reaction.formulaName);
		}
	});
});

describe('tables', () => {
	it('reaction rows sum the ended jobs of each formula, the most expected profit first', async () => {
		const { env, intermediate, final } = await overviewScenario();
		const { reactions } = await overview(env, '?period=7');
		const expected = reactions.rows.map((r) => r.expected);
		expect(expected).toEqual([...expected].sort((a, b) => b - a));
		const byId = new Map(reactions.rows.map((r) => [r.blueprintTypeId, r]));
		expect(byId.get(final.blueprintTypeId)).toMatchObject({
			jobs: 1,
			spent: 2200,
			realized: 1680,
			unvalued: 0
		});
		expect(byId.get(intermediate.blueprintTypeId)).toMatchObject({ jobs: 2, spent: 1100 + 70, unvalued: 1 });
		const row = byId.get(final.blueprintTypeId)!;
		expect(row.marginPct).toBeCloseTo((row.expected / 2200) * 100, 6);
		expect(row.profitPerSlotDay).toBeCloseTo(row.expected, 6);
	});

	it('sale rows show the batch cost, the profit and where the units came from, newest first', async () => {
		const { env, product, material } = await overviewScenario();
		const { sales } = await overview(env, '?period=7');
		expect(sales.rows.map((r) => [r.ref, r.typeId, r.origin, r.unitCost, r.profit])).toEqual([
			['transaction:902', product, 'made', 22, 1680],
			['transaction:908', material, 'bought', 9, 60],
			['transaction:906', product, 'made', 10, 150]
		]);
	});

	it('running rows value the output the job will make', async () => {
		const { env, intermediate } = await overviewScenario();
		const inter = intermediate.product.typeId;
		const { running } = await overview(env);
		expect(running.rows.map((r) => r.jobId)).toEqual([JOB.running]);
		expect(running.rows[0].output).toMatchObject({ typeId: inter, quantity: intermediate.product.quantity });
		expect(running.rows[0].outputValue).toBeCloseTo(
			intermediate.product.quantity * (await unitValue(env, inter)),
			6
		);
	});

	it('pages 10 rows per table; a table page equals the page load', async () => {
		const { env, mine, product } = await overviewScenario();
		for (let i = 0; i < 12; i++) {
			const id = 1000 + i;
			insertTransaction(env.DB, {
				userId: 'u1',
				sourceId: mine,
				transactionId: id,
				typeId: product,
				isBuy: false,
				date: NOW - (i + 1) * 3_600_000
			});
			insertPrice(env.DB, {
				userId: 'u1',
				ref: `transaction:${id}`,
				typeId: product,
				incoming: false,
				quantity: 1,
				unitPrice: 40,
				at: NOW - (i + 1) * 3_600_000
			});
		}
		const first = await overview(env, '?period=7');
		expect(first.sales).toMatchObject({ page: 1, pageCount: 2, total: 15 });
		expect(first.sales.rows).toHaveLength(10);

		const second = await overview(env, '?period=7&sales=2');
		expect(second.sales.rows).toHaveLength(5);
		expect(second.reactions).toEqual(first.reactions);
		const table = await overviewTable(asEnv(env), u1, 'sales', url('?period=7&sales=2'), NOW);
		expect(table).toEqual(second.sales);
		expect([...first.sales.rows, ...table.rows].map((r) => r.ref)).toHaveLength(15);
	});
});

describe('isolation', () => {
	it("never counts other users' rows or tracking-off connections", async () => {
		const { env } = await overviewScenario();
		const data = await overview(env, '?period=all');
		expect(data.sales.rows.map((r) => r.ref)).not.toContain('transaction:909');
		expect(data.sales.rows.every((r) => r.netUnitPrice < 1e6)).toBe(true);
		expect(data.kpis.salesIncome).toBe(60 * 50 + 4 * 30 + 6 * 35 + 20 * 12);
		expect(data.running.rows.map((r) => r.jobId)).toEqual([JOB.running]);
		expect(data.reactions.rows.reduce((s, r) => s + r.jobs, 0)).toBe(5);

		// u2 sees only their own rows: their sale (500 units from their job at a unit cost of 1).
		const theirs = await profitsOverview(
			asEnv(env),
			{ user: sessionUser('u2', [GAMMA]), settings: defaults() },
			url('?period=all'),
			NOW
		);
		expect(theirs.sales.rows.map((r) => r.ref)).toEqual(['transaction:902']);
		expect(theirs.kpis.salesIncome).toBe(1000 * 1e6);
		expect(theirs.kpis.realized).toBe(500 * (1e6 - 1));
		expect(theirs.attention).toEqual([{ kind: 'streams', connections: 1 }]);
	});
});

describe('manufacturing use', () => {
	it('counts reaction output used by manufacturing at the manufacturing start (value − cost)', async () => {
		const s = await overviewScenario();
		const before = await overview(s.env, '?period=7');
		addManufacturing(s, s.product);
		const week = await overview(s.env, '?period=7');
		// 30 units at 9 against a unit cost of 5.5, two days ago; the tracking-off job's 5 units never count.
		expect(week.kpis.realized).toBeCloseTo(before.kpis.realized + 30 * (9 - 5.5), 6);
		expect(week.kpis.manufacturedQty).toBe(30);
		expect(before.kpis.manufacturedQty).toBe(0);
		const at = (label: string) => week.charts.timeline.find((p) => p.label === label)!;
		const was = (label: string) => before.charts.timeline.find((p) => p.label === label)!;
		expect(at('2026-10-04').realized - was('2026-10-04').realized).toBeCloseTo(105, 6);
		// Manufacturing jobs are not jobs: no job cost, no job count.
		expect(week.kpis.jobCosts).toBe(before.kpis.jobCosts);
		expect(week.kpis.endedJobs).toBe(before.kpis.endedJobs);
		expect(week.running.rows.map((r) => r.jobId)).toEqual([JOB.running]);
		// "Profit by reaction" realized includes it (job_results realized profit).
		const inter = week.reactions.rows.find((r) => r.blueprintTypeId === s.intermediate.blueprintTypeId)!;
		expect(inter.realized).toBe(105);
		// Unsold output: the manufactured units left the lot.
		expect(week.unsold.rows.find((r) => r.typeId === s.intermediate.product.typeId)?.quantity).toBe(20);

		const all = await overview(s.env, '?period=all');
		expect(all.kpis.manufacturedQty).toBe(30);
	});

	it('another user never sees it', async () => {
		const s = await overviewScenario();
		addManufacturing(s, s.product);
		const theirs = await profitsOverview(
			asEnv(s.env),
			{ user: sessionUser('u2', [GAMMA]), settings: defaults() },
			url('?period=all'),
			NOW
		);
		expect(theirs.kpis.manufacturedQty).toBe(0);
		expect(theirs.kpis.realized).toBe(500 * (1e6 - 1));
	});
});

describe('fuel blocks the user built', () => {
	it('count as money paid out and sales income only, never as reaction profit or reaction output', async () => {
		const s = await overviewScenario();
		const before = await overview(s.env, '?period=7');
		addFuelBlocks(s);
		const week = await overview(s.env, '?period=7');
		// Selling 40 blocks at 12 that cost 8 is no reaction profit.
		expect(week.kpis.realized).toBe(before.kpis.realized);
		expect(week.kpis.realizedPrevious).toBe(before.kpis.realizedPrevious);
		expect(week.kpis.salesIncome).toBe(before.kpis.salesIncome + 40 * 12);
		// The fuel block job's cost, started 4 days ago.
		expect(week.kpis.jobCosts).toBe(before.kpis.jobCosts + 200);
		expect(week.kpis.spent).toBe(before.kpis.spent + 200);
		// Not a reaction job: no job count, expected profit or profit per slot-day.
		expect(week.kpis.endedJobs).toBe(before.kpis.endedJobs);
		expect(week.kpis.expected).toBe(before.kpis.expected);
		expect(week.kpis.profitPerSlotDay).toBe(before.kpis.profitPerSlotDay);
		expect(week.reactions).toEqual(before.reactions);
		expect(week.running).toEqual(before.running);
		// The 60 blocks held are not unsold reaction output.
		expect(week.unsold).toEqual(before.unsold);
		expect(week.kpis.unsold).toEqual(before.kpis.unsold);
		expect(week.kpis.reselling).toEqual(before.kpis.reselling);
		// Its input without a purchase is not a reaction job's estimate.
		expect(week.attention).toEqual(before.attention);
		const at = (label: string) => week.charts.timeline.find((p) => p.label === label)!;
		const was = (label: string) => before.charts.timeline.find((p) => p.label === label)!;
		expect(at('2026-10-02').jobCosts - was('2026-10-02').jobCosts).toBe(200);
		expect(week.charts.timeline.map((p) => p.realized)).toEqual(
			before.charts.timeline.map((p) => p.realized)
		);
		expect(week.sales.rows.find((r) => r.ref === 'transaction:903')).toMatchObject({
			typeId: FUEL.block,
			unitCost: 8,
			profit: 40 * (12 - 8)
		});
	});
});

describe('entered purchases', () => {
	it('count as purchases, as job input cost and as bought stock when resold', async () => {
		const s = await overviewScenario();
		const db = s.env.DB;
		const before = await overview(s.env, '?period=7');
		const entryId = insertManualEntry(db, 'u1', {
			typeId: s.material,
			date: NOW - DAY,
			quantity: 10,
			unitPrice: 20
		});
		insertManualEntry(db, 'u2', { typeId: s.material, date: NOW - DAY, quantity: 99, unitPrice: 1000 });
		insertLot(db, 'u1', {
			lotId: 50,
			typeId: s.material,
			acquiredAt: NOW - DAY,
			quantity: 10,
			remaining: 0,
			unitCost: 20,
			origin: 'manual',
			originRef: `manual:${entryId}`
		});
		insertUse(db, 'u1', { lotId: 50, kind: 'job', ref: `job:${JOB.running}`, quantity: 6, unitCost: 20 });
		const saleAt = NOW - DAY / 2;
		insertTransaction(db, {
			userId: 'u1',
			sourceId: s.mine,
			transactionId: 910,
			typeId: s.material,
			quantity: 4,
			isBuy: false,
			date: saleAt
		});
		insertPrice(db, {
			userId: 'u1',
			ref: 'transaction:910',
			typeId: s.material,
			incoming: false,
			quantity: 4,
			unitPrice: 25,
			at: saleAt
		});
		insertUse(db, 'u1', { lotId: 50, kind: 'sale', ref: 'transaction:910', quantity: 4, unitCost: 20 });

		const after = await overview(s.env, '?period=7');
		expect(after.kpis.purchases).toBe(before.kpis.purchases + 10 * 20);
		expect(after.kpis.spent).toBe(before.kpis.spent + 10 * 20);
		expect(after.kpis.reselling).toEqual({ profit: before.kpis.reselling!.profit + 4 * (25 - 20), sales: 2 });
		expect(after.charts.inputSources).toContainEqual({ kind: 'manual', cost: 6 * 20 });
		expect(after.sales.rows.find((r) => r.ref === 'transaction:910')).toMatchObject({
			origin: 'bought',
			unitCost: 20,
			profit: 4 * (25 - 20)
		});
	});
});

describe('items no reaction uses', () => {
	it('leave every total, chart and table of the overview unchanged', async () => {
		const s = await overviewScenario();
		const before = await overview(s.env, '?period=7');
		const MODULE = 4405;
		for (const [id, isBuy] of [
			[911, true],
			[912, false]
		] as const) {
			insertTransaction(s.env.DB, {
				userId: 'u1',
				sourceId: s.mine,
				transactionId: id,
				typeId: MODULE,
				isBuy,
				date: NOW - DAY
			});
			insertPrice(s.env.DB, {
				userId: 'u1',
				ref: `transaction:${id}`,
				typeId: MODULE,
				incoming: isBuy,
				quantity: 3,
				unitPrice: 1e6,
				at: NOW - DAY,
				sourceKind: 'untracked',
				sourceText: 'Not tracked'
			});
		}
		const after = await overview(s.env, '?period=7');
		expect(after.kpis).toEqual(before.kpis);
		expect(after.charts).toEqual(before.charts);
		expect(after.sales).toEqual(before.sales);
		expect(after.attention).toEqual(before.attention);
	});
});

describe('materials consumed by manufacturing jobs', () => {
	it('leave every total, chart and table of the overview and the jobs tab unchanged', async () => {
		const s = await overviewScenario();
		const filters: JobFilters = {
			period: '7',
			status: null,
			formula: null,
			connection: null,
			sort: 'newest'
		};
		const before = await overview(s.env, '?period=7');
		const jobsBefore = await jobsPage(asEnv(s.env), u1, filters, 1, NOW);
		// A ship job of u1 yesterday took 20 of the bought material (lot 1) and 10 of the unsold intermediate.
		insertTrackedJob(s.env.DB, 'u1', {
			jobId: 7101,
			sourceId: s.mine,
			blueprintTypeId: 691,
			productTypeId: 587,
			activityId: 1,
			startDate: NOW - DAY,
			endDate: NOW
		});
		insertUse(s.env.DB, 'u1', { lotId: 1, kind: 'consumed', ref: 'job:7101', quantity: 20, unitCost: 8 });
		insertUse(s.env.DB, 'u1', { lotId: 3, kind: 'consumed', ref: 'job:7101', quantity: 10, unitCost: 5.5 });
		const after = await overview(s.env, '?period=7');
		expect(after).toEqual(before);
		expect(await jobsPage(asEnv(s.env), u1, filters, 1, NOW)).toEqual(jobsBefore);
	});
});

describe('cancelled jobs', () => {
	it('count when they were cancelled, not at their scheduled end', async () => {
		const { env } = await overviewScenario();
		env.DB.sqlite
			.prepare(`UPDATE tracked_jobs SET end_date = ?, completed_date = ? WHERE user_id = 'u1' AND job_id = ?`)
			.run(NOW + 3 * DAY, NOW - DAY, JOB.cancelled);
		const week = (await overview(env, '?period=7')).kpis;
		expect(week.realized).toBe(1680 + 150 - 330);
		expect(week.endedJobs).toBe(4);
	});
});

describe('default period', () => {
	it("opens on the user's default period; ?period overrides it; the endpoints agree", async () => {
		const { env } = await overviewScenario();
		expect((await overview(env)).period).toBe('30');
		await saveTrackingSettings(asEnv(env), 'u1', TrackingSettings.parse({ defaultPeriod: '7' }));
		const data = await overview(env);
		expect(data).toMatchObject({ period: '7', defaultPeriod: '7' });
		expect(data.kpis).toEqual((await overview(env, '?period=7')).kpis);
		expect((await overview(env, '?period=all')).period).toBe('all');
		expect(await overviewTable(asEnv(env), u1, 'reactions', url(), NOW)).toEqual(data.reactions);
		expect(await overviewTable(asEnv(env), u1, 'sales', url('?period=all'), NOW)).toEqual(
			(await overview(env, '?period=all')).sales
		);
		expect(parsePeriod(url(), 'all')).toBe('all');
		expect(parsePeriod(url('?period=90'), 'all')).toBe('90');
	});
});
