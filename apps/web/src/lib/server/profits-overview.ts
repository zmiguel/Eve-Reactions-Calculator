/**
 * The `/profits` overview: KPIs, charts and tables of the signed-in user's tracked reactions, trades
 * and contracts (connections with Profit tracking on only), for a period of days back from now. Every
 * block is a pure function of {@link OverviewFacts} (loaded once per request) and the period bounds;
 * the page load and the `/profits/data/*` table endpoints share them.
 */
import type { Dataset } from '@reactions/engine';
import { paginate, pageParam, type Paged } from '$lib/paging';
import type {
	AttentionItem,
	InputSourceKind,
	InputSourceSlice,
	OverviewCharts,
	OverviewKpis,
	ProfitBucket,
	ProfitPeriod,
	ProfitTimePoint,
	ProfitsOverviewData,
	ReactionTableRow,
	RunningTableRow,
	SaleTableRow,
	UnsoldTableRow
} from '$lib/profits/types';
import type { JobRow } from '$lib/jobs/types';
import { listJobRows, type JobListRow, type JobsLocals } from './jobs.ts';
import { ledgerReviewCount } from './ledger.ts';
import { getTrackingSettings } from './tracking-settings.ts';

export const PROFIT_PERIODS: readonly ProfitPeriod[] = ['7', '30', '90', '365', 'all'];
export const DEFAULT_PROFIT_PERIOD: ProfitPeriod = '30';
const DAY = 86_400_000;
/** Formulas in the "Profit by reaction" chart. */
const TOP_REACTIONS = 8;

/** The `period` query parameter (else `defaultPeriod`, the user's `TrackingSettings.defaultPeriod`). */
export function parsePeriod(url: URL, defaultPeriod: ProfitPeriod = DEFAULT_PROFIT_PERIOD): ProfitPeriod {
	const value = url.searchParams.get('period');
	return PROFIT_PERIODS.includes(value as ProfitPeriod) ? (value as ProfitPeriod) : defaultPeriod;
}

export interface PeriodBounds {
	period: ProfitPeriod;
	/** Inclusive start; null for `all`. */
	start: number | null;
	/** Inclusive end (now). */
	end: number;
	/** The period of the same length just before (`[previousStart, start)`); null for `all`. */
	previousStart: number | null;
	bucket: ProfitBucket;
}

/** `period` days back from `now` (as the Jobs tab counts them), its previous period and chart bucket. */
export function periodBounds(period: ProfitPeriod, now: number): PeriodBounds {
	if (period === 'all') return { period, start: null, end: now, previousStart: null, bucket: 'month' };
	const length = Number(period) * DAY;
	const start = now - length;
	return {
		period,
		start,
		end: now,
		previousStart: start - length,
		bucket: period === '7' || period === '30' ? 'day' : 'week'
	};
}

const inPeriod = (b: PeriodBounds, at: number) => (b.start === null || at >= b.start) && at <= b.end;

/** Start of `at`'s bucket (UTC). */
function bucketStart(bucket: ProfitBucket, at: number): number {
	const day = Math.floor(at / DAY) * DAY;
	if (bucket === 'day') return day;
	if (bucket === 'week') return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
	const d = new Date(day);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextBucket(bucket: ProfitBucket, start: number): number {
	if (bucket === 'day') return start + DAY;
	if (bucket === 'week') return start + 7 * DAY;
	const d = new Date(start);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

// ---- Facts ----

interface PriceSqlRow {
	ref: string;
	type_id: number;
	incoming: number;
	at: number;
	quantity: number;
	unit_price: number;
}

interface UseSqlRow {
	use_kind: 'job' | 'sale';
	use_ref: string;
	quantity: number;
	unit_cost: number;
	type_id: number;
	origin: InputSourceKind;
}

interface HeldSqlRow {
	type_id: number;
	remaining: number;
	unit_cost: number;
}

interface ManufacturingSqlRow {
	at: number;
	quantity: number;
	unit_cost: number;
	unit_value: number;
	type_id: number;
}

/**
 * Refs (`transaction:<id>`, `contract:<id>`, `job:<id>`) of rows of the user's tracking-on connections,
 * plus `manual:<id>` of the purchases the user entered (no connection). Jobs of every activity on
 * purpose: manufacturing uses of reaction output have `job:<id>` refs.
 */
const TRACKED = `WITH tracked(ref) AS (
	SELECT 'transaction:' || t.transaction_id FROM tracked_transactions t
	JOIN inventory_sources s ON s.source_id = t.source_id AND s.user_id = t.user_id
	WHERE t.user_id = ?1 AND s.tracking_enabled = 1
	UNION ALL
	SELECT 'contract:' || c.contract_id FROM tracked_contracts c
	JOIN inventory_sources s ON s.source_id = c.source_id AND s.user_id = c.user_id
	WHERE c.user_id = ?1 AND s.tracking_enabled = 1
	UNION ALL
	SELECT 'job:' || j.job_id FROM tracked_jobs j
	JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = j.user_id
	WHERE j.user_id = ?1 AND s.tracking_enabled = 1
	UNION ALL
	SELECT 'manual:' || m.entry_id FROM manual_entries m WHERE m.user_id = ?1
)`;

const SQL = {
	/**
	 * Purchases (`incoming` 1) and sales at their net unit price; transfers between own parties left out.
	 * Entered purchases have no `ledger_prices` row: their price is the one the user entered.
	 */
	prices: `${TRACKED} SELECT ref, type_id, incoming, at, quantity, unit_price FROM ledger_prices
		WHERE user_id = ?1 AND transfer = 0 AND ref IN (SELECT ref FROM tracked)
		UNION ALL
		SELECT 'manual:' || entry_id, type_id, 1, date, quantity, unit_price FROM manual_entries
		WHERE user_id = ?1 AND quantity > 0`,
	/** What reaction jobs and sales took from which kind of batch. */
	uses: `${TRACKED} SELECT u.use_kind, u.use_ref, u.quantity, u.unit_cost, l.type_id, l.origin
		FROM ledger_uses u JOIN ledger_lots l ON l.user_id = u.user_id AND l.lot_id = u.lot_id
		WHERE u.user_id = ?1 AND u.use_kind IN ('job', 'sale')
			AND u.use_ref IN (SELECT ref FROM tracked) AND l.origin_ref IN (SELECT ref FROM tracked)`,
	/**
	 * Reaction output taken by manufacturing jobs of tracking-on connections, dated at the manufacturing
	 * job's start, with what one unit counted for (null = its unit cost).
	 */
	manufacturing: `${TRACKED} SELECT m.start_date AS at, u.quantity, u.unit_cost,
			COALESCE(u.unit_value, u.unit_cost) AS unit_value, l.type_id
		FROM ledger_uses u JOIN ledger_lots l ON l.user_id = u.user_id AND l.lot_id = u.lot_id
		JOIN tracked_jobs m ON m.user_id = u.user_id AND u.use_ref = 'job:' || m.job_id
		JOIN inventory_sources s ON s.source_id = m.source_id AND s.user_id = m.user_id
		WHERE u.user_id = ?1 AND u.use_kind = 'manufacturing' AND m.activity_id = 1 AND s.tracking_enabled = 1
			AND l.origin = 'job' AND l.origin_ref IN (SELECT ref FROM tracked)`,
	/** Output of the user's jobs still held. */
	held: `${TRACKED} SELECT type_id, remaining, unit_cost FROM ledger_lots
		WHERE user_id = ?1 AND origin = 'job' AND remaining > 0 AND origin_ref IN (SELECT ref FROM tracked)`,
	state: 'SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?1',
	/** Tracking-on connections whose sync or one of its streams failed or was denied. */
	failing: `SELECT COUNT(*) AS n FROM inventory_sources s
		WHERE s.user_id = ?1 AND s.tracking_enabled = 1
			AND (s.tracking_status IN ('error', 'denied') OR EXISTS (SELECT 1 FROM tracking_streams ts
				WHERE ts.source_id = s.source_id AND ts.status IN ('error', 'denied')))`
} as const;

export interface OverviewTrade {
	ref: string;
	typeId: number;
	at: number;
	quantity: number;
	netUnitPrice: number;
}

export interface OverviewUse {
	ref: string;
	quantity: number;
	unitCost: number;
	typeId: number;
	origin: InputSourceKind;
}

/** Reaction output taken by a manufacturing job (dated at that job's start). */
export interface OverviewManufacturingUse {
	at: number;
	typeId: number;
	quantity: number;
	unitCost: number;
	/** What one unit counted for (buy value at the job's start, or its unit cost). */
	unitValue: number;
}

/** Everything the overview is computed from: all of the user's tracked history (no period applied). */
export interface OverviewFacts {
	now: number;
	dataset: Dataset | null;
	/** Today's net value of one unit (the visitor's output settings); null without a price. */
	value: (typeId: number) => number | null;
	/** Every job, as the Jobs tab shows it (`endedAt`: when it ended or was cancelled). */
	jobs: JobListRow[];
	purchases: OverviewTrade[];
	sales: OverviewTrade[];
	/** Units sales took from batches, per sale `ref` and type. */
	saleUses: OverviewUse[];
	/** Units jobs took from batches (`ref` = `job:<id>`). */
	jobUses: OverviewUse[];
	/** Reaction output used by manufacturing jobs (realized at once). */
	manufacturingUses: OverviewManufacturingUse[];
	held: { typeId: number; quantity: number; unitCost: number }[];
	rebuiltAt: number | null;
	dirty: boolean;
	reviewCount: number;
	failingConnections: number;
}

/** Loads {@link OverviewFacts} of the signed-in user (tracking-on connections only). */
export async function loadOverviewFacts(env: Env, locals: JobsLocals, now: number): Promise<OverviewFacts> {
	const userId = locals.user.userId;
	const db = env.DB;
	const [[pricesRes, usesRes, manufacturingRes, heldRes, stateRes, failingRes], jobs, reviewCount] =
		await Promise.all([
			db.batch([
				db.prepare(SQL.prices).bind(userId),
				db.prepare(SQL.uses).bind(userId),
				db.prepare(SQL.manufacturing).bind(userId),
				db.prepare(SQL.held).bind(userId),
				db.prepare(SQL.state).bind(userId),
				db.prepare(SQL.failing).bind(userId)
			]),
			listJobRows(
				env,
				locals,
				{ period: 'all', status: null, formula: null, connection: null, sort: 'newest' },
				now
			),
			ledgerReviewCount(env, userId)
		]);
	const trade = (p: PriceSqlRow): OverviewTrade => ({
		ref: p.ref,
		typeId: p.type_id,
		at: p.at,
		quantity: p.quantity,
		netUnitPrice: p.unit_price
	});
	const prices = pricesRes.results as unknown as PriceSqlRow[];
	const uses = (usesRes.results as unknown as UseSqlRow[]).map((u) => ({
		kind: u.use_kind,
		use: {
			ref: u.use_ref,
			quantity: u.quantity,
			unitCost: u.unit_cost,
			typeId: u.type_id,
			origin: u.origin
		} satisfies OverviewUse
	}));
	const state = stateRes.results[0] as { rebuilt_at: number | null; dirty: number } | undefined;
	return {
		now,
		dataset: jobs.dataset,
		value: jobs.value,
		jobs: jobs.rows,
		purchases: prices.filter((p) => p.incoming === 1).map(trade),
		sales: prices.filter((p) => p.incoming === 0).map(trade),
		saleUses: uses.filter((u) => u.kind === 'sale').map((u) => u.use),
		jobUses: uses.filter((u) => u.kind === 'job').map((u) => u.use),
		manufacturingUses: (manufacturingRes.results as unknown as ManufacturingSqlRow[]).map((m) => ({
			at: m.at,
			typeId: m.type_id,
			quantity: m.quantity,
			unitCost: m.unit_cost,
			unitValue: m.unit_value
		})),
		held: (heldRes.results as unknown as HeldSqlRow[]).map((h) => ({
			typeId: h.type_id,
			quantity: h.remaining,
			unitCost: h.unit_cost
		})),
		rebuiltAt: state?.rebuilt_at ?? null,
		dirty: Boolean(state?.dirty),
		reviewCount,
		failingConnections: (failingRes.results[0] as { n: number } | undefined)?.n ?? 0
	};
}

// ---- Shared derivations ----

const typeName = (dataset: Dataset | null, typeId: number) =>
	dataset?.types[typeId]?.name ?? `Type ${typeId}`;
/** Formula name for the tables, as the Jobs tab words a formula missing from the dataset. */
const formulaName = (job: JobRow) => job.formula.name ?? 'Unknown formula';

/** A dated profit or loss counted as realized. */
interface RealizedEvent {
	at: number;
	amount: number;
}

/** Sale `ref|typeId` → the sale. */
function salesByKey(facts: OverviewFacts): Map<string, OverviewTrade> {
	return new Map(facts.sales.map((s) => [`${s.ref}|${s.typeId}`, s]));
}

/**
 * Realized profit events: every sale of job-made units (quantity × (net sale price − batch unit cost),
 * dated at the sale), every use of job output by a manufacturing job (quantity × (unit value − unit
 * cost), dated at that job's start) and every cancelled job's loss (dated when it was cancelled).
 */
function realizedEvents(facts: OverviewFacts): RealizedEvent[] {
	const sales = salesByKey(facts);
	const events: RealizedEvent[] = [];
	for (const use of facts.saleUses) {
		if (use.origin !== 'job') continue;
		const sale = sales.get(`${use.ref}|${use.typeId}`);
		if (sale) events.push({ at: sale.at, amount: use.quantity * (sale.netUnitPrice - use.unitCost) });
	}
	for (const use of facts.manufacturingUses)
		events.push({ at: use.at, amount: use.quantity * (use.unitValue - use.unitCost) });
	for (const job of facts.jobs) {
		if (job.status === 'cancelled' && job.realizedProfit !== null)
			events.push({ at: job.endedAt, amount: job.realizedProfit });
	}
	return events;
}

/** Jobs that ended (finished or cancelled) in the period. */
const endedJobs = (facts: OverviewFacts, b: PeriodBounds) =>
	facts.jobs.filter((j) => j.status !== 'running' && inPeriod(b, j.endedAt));

/** Slot-days of a job: it holds one slot from start to end. */
const slotDays = (job: JobRow) => Math.max(0, job.endDate - job.startDate) / DAY;

/** Job ref → start date, for jobs started in the period. */
function startedJobRefs(facts: OverviewFacts, b: PeriodBounds): Set<string> {
	return new Set(facts.jobs.filter((j) => inPeriod(b, j.startDate)).map((j) => `job:${j.jobId}`));
}

const sum = <T>(items: readonly T[], pick: (item: T) => number) =>
	items.reduce((total, item) => total + pick(item), 0);

// ---- Blocks ----

export function overviewKpis(facts: OverviewFacts, b: PeriodBounds): OverviewKpis {
	const events = realizedEvents(facts);
	const realized = sum(
		events.filter((e) => inPeriod(b, e.at)),
		(e) => e.amount
	);
	const realizedPrevious =
		b.start === null || b.previousStart === null
			? null
			: sum(
					events.filter((e) => e.at >= b.previousStart! && e.at < b.start!),
					(e) => e.amount
				);

	const ended = endedJobs(facts, b);
	const valued = ended.filter((j) => j.expectedProfit !== null);
	const expected = sum(valued, (j) => j.expectedProfit!);
	const days = sum(valued, slotDays);

	const sales = facts.sales.filter((s) => inPeriod(b, s.at));
	const purchases = sum(
		facts.purchases.filter((p) => inPeriod(b, p.at)),
		(p) => p.quantity * p.netUnitPrice
	);
	const jobCosts = sum(
		facts.jobs.filter((j) => inPeriod(b, j.startDate)),
		(j) => j.jobCost ?? 0
	);

	const unsold = { quantity: 0, value: 0, cost: 0, gain: 0, unvaluedTypes: 0 };
	for (const row of unsoldRows(facts)) {
		unsold.quantity += row.quantity;
		if (row.value === null) unsold.unvaluedTypes += 1;
		else {
			unsold.value += row.value;
			unsold.cost += row.quantity * row.unitCost;
		}
	}
	unsold.gain = unsold.value - unsold.cost;

	const saleAt = salesByKey(facts);
	let resellProfit = 0;
	const resold = new Set<string>();
	for (const use of facts.saleUses) {
		if (use.origin === 'job' || use.origin === 'market' || use.origin === 'correction') continue;
		const sale = saleAt.get(`${use.ref}|${use.typeId}`);
		if (!sale || !inPeriod(b, sale.at)) continue;
		resellProfit += use.quantity * (sale.netUnitPrice - use.unitCost);
		resold.add(`${use.ref}|${use.typeId}`);
	}

	return {
		realized,
		realizedPrevious,
		manufacturedQty: sum(
			facts.manufacturingUses.filter((u) => inPeriod(b, u.at)),
			(u) => u.quantity
		),
		expected,
		endedJobs: ended.length,
		unvaluedJobs: ended.length - valued.length,
		expectedHasUnsold: valued.some((j) => (j.output?.unsoldQty ?? 0) > 0),
		salesIncome: sum(sales, (s) => s.quantity * s.netUnitPrice),
		sales: sales.length,
		spent: purchases + jobCosts,
		purchases,
		jobCosts,
		profitPerSlotDay: days > 0 ? expected / days : null,
		slotDays: days,
		unsold,
		reselling: resold.size > 0 ? { profit: resellProfit, sales: resold.size } : null
	};
}

/** Every bucket of the period (for `all`: from the first tracked event), oldest first. */
function buckets(facts: OverviewFacts, b: PeriodBounds): number[] {
	let start = b.start;
	if (start === null) {
		const dates = [
			...facts.sales.map((s) => s.at),
			...facts.purchases.map((p) => p.at),
			...facts.jobs.map((j) => j.startDate)
		].filter((at) => at <= b.end);
		if (dates.length === 0) return [];
		start = Math.min(...dates);
	}
	const list: number[] = [];
	for (let at = bucketStart(b.bucket, start); at <= b.end; at = nextBucket(b.bucket, at)) list.push(at);
	return list;
}

export function overviewCharts(facts: OverviewFacts, b: PeriodBounds): OverviewCharts {
	const starts = buckets(facts, b);
	const points = new Map<number, ProfitTimePoint>(
		starts.map((s) => [
			s,
			{
				label: new Date(s).toISOString().slice(0, b.bucket === 'month' ? 7 : 10),
				realized: 0,
				cumulative: 0,
				salesIncome: 0,
				purchases: 0,
				jobCosts: 0
			}
		])
	);
	const at = (time: number) => (inPeriod(b, time) ? points.get(bucketStart(b.bucket, time)) : undefined);
	for (const e of realizedEvents(facts)) {
		const p = at(e.at);
		if (p) p.realized += e.amount;
	}
	for (const s of facts.sales) {
		const p = at(s.at);
		if (p) p.salesIncome += s.quantity * s.netUnitPrice;
	}
	for (const s of facts.purchases) {
		const p = at(s.at);
		if (p) p.purchases += s.quantity * s.netUnitPrice;
	}
	for (const j of facts.jobs) {
		const p = at(j.startDate);
		if (p) p.jobCosts += j.jobCost ?? 0;
	}
	const timeline = [...points.values()];
	let running = 0;
	for (const p of timeline) p.cumulative = running += p.realized;

	// The chart names the product ("Titanium Carbide"): the formula's "Reaction Formula" suffix only
	// crowds the axis. A formula missing from the dataset keeps its table name.
	const products = new Map(facts.dataset?.reactions.map((r) => [r.blueprintTypeId, r.name]));
	const reactions = reactionRows(facts, b)
		.filter((r) => r.expected !== 0 || r.realized !== 0)
		.slice(0, TOP_REACTIONS)
		.map((r) => ({
			blueprintTypeId: r.blueprintTypeId,
			name: products.get(r.blueprintTypeId) ?? r.name,
			realized: r.realized,
			unrealized: r.expected - r.realized
		}));

	const started = startedJobRefs(facts, b);
	const order: InputSourceKind[] = ['transaction', 'contract', 'manual', 'job', 'market', 'correction'];
	const costs = new Map<InputSourceKind, number>();
	for (const use of facts.jobUses) {
		if (!started.has(use.ref)) continue;
		costs.set(use.origin, (costs.get(use.origin) ?? 0) + use.quantity * use.unitCost);
	}
	const inputSources: InputSourceSlice[] = order
		.map((kind) => ({ kind, cost: costs.get(kind) ?? 0 }))
		.filter((s) => s.cost > 0);

	return { bucket: b.bucket, timeline, reactions, inputSources };
}

/** What needs the user's attention, each with somewhere to fix it. */
export function attentionItems(facts: OverviewFacts, b: PeriodBounds): AttentionItem[] {
	const items: AttentionItem[] = [];
	if (facts.reviewCount > 0) items.push({ kind: 'review', count: facts.reviewCount });

	const started = startedJobRefs(facts, b);
	const perJob = new Map<string, { total: number; estimated: number }>();
	for (const use of facts.jobUses) {
		if (!started.has(use.ref)) continue;
		let job = perJob.get(use.ref);
		if (!job) perJob.set(use.ref, (job = { total: 0, estimated: 0 }));
		const cost = use.quantity * use.unitCost;
		job.total += cost;
		if (use.origin === 'market') job.estimated += cost;
	}
	const estimatedJobs = [...perJob.values()].filter((j) => j.estimated > 0);
	if (estimatedJobs.length > 0) {
		const total = sum(estimatedJobs, (j) => j.total);
		items.push({
			kind: 'estimates',
			jobs: estimatedJobs.length,
			share: total > 0 ? sum(estimatedJobs, (j) => j.estimated) / total : 0
		});
	}

	if (facts.failingConnections > 0) items.push({ kind: 'streams', connections: facts.failingConnections });
	return items;
}

/** Jobs that ended in the period per formula, by expected profit (highest first). */
export function reactionRows(facts: OverviewFacts, b: PeriodBounds): ReactionTableRow[] {
	const byFormula = new Map<number, ReactionTableRow & { days: number }>();
	for (const job of endedJobs(facts, b)) {
		const id = job.formula.blueprintTypeId;
		let row = byFormula.get(id);
		if (!row)
			byFormula.set(
				id,
				(row = {
					blueprintTypeId: id,
					name: formulaName(job),
					jobs: 0,
					runs: 0,
					spent: 0,
					realized: 0,
					expected: 0,
					unvalued: 0,
					marginPct: null,
					profitPerSlotDay: null,
					days: 0
				})
			);
		row.jobs += 1;
		row.runs += job.runs;
		row.spent += (job.inputCost ?? 0) + (job.jobCost ?? 0);
		row.realized += job.realizedProfit ?? 0;
		if (job.expectedProfit === null) row.unvalued += 1;
		else {
			row.expected += job.expectedProfit;
			row.days += slotDays(job);
		}
	}
	return [...byFormula.values()]
		.map(({ days, ...row }) => ({
			...row,
			marginPct: row.spent > 0 ? (row.expected / row.spent) * 100 : null,
			profitPerSlotDay: days > 0 ? row.expected / days : null
		}))
		.sort((a, c) => c.expected - a.expected || c.realized - a.realized || a.name.localeCompare(c.name));
}

/** Sales in the period, newest first, with the cost of the batches they came from. */
export function saleRows(facts: OverviewFacts, b: PeriodBounds): SaleTableRow[] {
	const uses = new Map<string, OverviewUse[]>();
	for (const use of facts.saleUses) {
		const key = `${use.ref}|${use.typeId}`;
		uses.set(key, [...(uses.get(key) ?? []), use]);
	}
	return facts.sales
		.filter((s) => inPeriod(b, s.at))
		.map((s): SaleTableRow => {
			const from = uses.get(`${s.ref}|${s.typeId}`) ?? [];
			const costedQty = sum(from, (u) => u.quantity);
			const cost = sum(from, (u) => u.quantity * u.unitCost);
			const made = from.some((u) => u.origin === 'job');
			const bought = from.some((u) => u.origin !== 'job');
			return {
				ref: s.ref,
				kind: s.ref.startsWith('contract:') ? 'contract' : 'market',
				at: s.at,
				typeId: s.typeId,
				name: typeName(facts.dataset, s.typeId),
				quantity: s.quantity,
				netUnitPrice: s.netUnitPrice,
				unitCost: costedQty > 0 ? cost / costedQty : null,
				profit: costedQty > 0 ? costedQty * s.netUnitPrice - cost : null,
				untrackedQty: Math.max(0, s.quantity - costedQty),
				origin: made && bought ? 'mixed' : made ? 'made' : bought ? 'bought' : null
			};
		})
		.sort((a, c) => c.at - a.at || (a.ref < c.ref ? 1 : a.ref > c.ref ? -1 : 0) || a.typeId - c.typeId);
}

/** Output of the user's jobs still held, per type, most valuable first (unpriced last). */
export function unsoldRows(facts: OverviewFacts): UnsoldTableRow[] {
	const byType = new Map<number, { quantity: number; cost: number }>();
	for (const lot of facts.held) {
		const t = byType.get(lot.typeId) ?? { quantity: 0, cost: 0 };
		t.quantity += lot.quantity;
		t.cost += lot.quantity * lot.unitCost;
		byType.set(lot.typeId, t);
	}
	return [...byType]
		.map(([typeId, t]): UnsoldTableRow => {
			const unitValue = facts.value(typeId);
			const value = unitValue === null ? null : unitValue * t.quantity;
			return {
				typeId,
				name: typeName(facts.dataset, typeId),
				quantity: t.quantity,
				unitCost: t.cost / t.quantity,
				unitValue,
				value,
				gain: value === null ? null : value - t.cost
			};
		})
		.sort(
			(a, c) =>
				(c.value ?? -Infinity) - (a.value ?? -Infinity) ||
				c.quantity * c.unitCost - a.quantity * a.unitCost ||
				a.name.localeCompare(c.name)
		);
}

/** Jobs still running, the soonest to end first. */
export function runningRows(facts: OverviewFacts): RunningTableRow[] {
	return facts.jobs
		.filter((j) => j.status === 'running')
		.map((j): RunningTableRow => {
			const reaction = facts.dataset?.reactions.find((r) => r.blueprintTypeId === j.formula.blueprintTypeId);
			const output = reaction
				? {
						typeId: reaction.product.typeId,
						name: typeName(facts.dataset, reaction.product.typeId),
						quantity: j.runs * reaction.product.quantity
					}
				: null;
			const unitValue = output ? facts.value(output.typeId) : null;
			return {
				jobId: j.jobId,
				blueprintTypeId: j.formula.blueprintTypeId,
				name: formulaName(j),
				runs: j.runs,
				owner: j.owner,
				startDate: j.startDate,
				endDate: j.endDate,
				output,
				outputValue: output && unitValue !== null ? output.quantity * unitValue : null
			};
		})
		.sort((a, c) => a.endDate - c.endDate || a.jobId - c.jobId);
}

// ---- Page and endpoints ----

interface TableRows {
	reactions: ReactionTableRow;
	sales: SaleTableRow;
	unsold: UnsoldTableRow;
	running: RunningTableRow;
}

/** The overview's tables; each name is also the query parameter of its page number. */
export type OverviewTable = keyof TableRows;

const TABLES: { [K in OverviewTable]: (facts: OverviewFacts, b: PeriodBounds) => TableRows[K][] } = {
	reactions: reactionRows,
	sales: saleRows,
	unsold: (facts) => unsoldRows(facts),
	running: (facts) => runningRows(facts)
};

const tablePage = <K extends OverviewTable>(
	table: K,
	facts: OverviewFacts,
	b: PeriodBounds,
	url: URL
): Paged<TableRows[K]> => paginate(TABLES[table](facts, b), pageParam(url, table));

/**
 * The whole `/profits` page for `url`'s period (else the user's `TrackingSettings.defaultPeriod`) and
 * table pages.
 */
export async function profitsOverview(
	env: Env,
	locals: JobsLocals,
	url: URL,
	now = Date.now()
): Promise<ProfitsOverviewData> {
	const [{ defaultPeriod }, facts] = await Promise.all([
		getTrackingSettings(env, locals.user.userId),
		loadOverviewFacts(env, locals, now)
	]);
	const b = periodBounds(parsePeriod(url, defaultPeriod), now);
	return {
		period: b.period,
		defaultPeriod,
		now,
		rebuiltAt: facts.rebuiltAt,
		dirty: facts.dirty,
		attention: attentionItems(facts, b),
		kpis: overviewKpis(facts, b),
		charts: overviewCharts(facts, b),
		reactions: tablePage('reactions', facts, b, url),
		sales: tablePage('sales', facts, b, url),
		unsold: tablePage('unsold', facts, b, url),
		running: tablePage('running', facts, b, url)
	};
}

/** One table of the overview for `url` (the `/profits/data/<table>` endpoints): the page load's rows. */
export async function overviewTable<K extends OverviewTable>(
	env: Env,
	locals: JobsLocals,
	table: K,
	url: URL,
	now = Date.now()
): Promise<Paged<TableRows[K]>> {
	const [{ defaultPeriod }, facts] = await Promise.all([
		getTrackingSettings(env, locals.user.userId),
		loadOverviewFacts(env, locals, now)
	]);
	return tablePage(table, facts, periodBounds(parsePeriod(url, defaultPeriod), now), url);
}
