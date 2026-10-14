import {
	getCoreDb,
	ledgerLots,
	ledgerPrices,
	ledgerUses,
	priceCorrections,
	trackedJobs
} from '@reactions/db';
import {
	DEFAULT_CONSTANTS,
	expectedProfit,
	jobMaterialBonus,
	manufacturingNames,
	resolveFacility,
	stockUnitValue,
	type CalcContext,
	type Dataset,
	type JobFlag,
	type JobResult,
	type Settings,
	type TrackingSettings
} from '@reactions/engine';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import type {
	JobConnectionOption,
	JobDetail,
	JobDetailData,
	JobFilters,
	JobFormula,
	JobInputLot,
	JobInputView,
	JobLink,
	JobMark,
	JobManufacturingUse,
	JobMaterialBonusView,
	JobOutputDetail,
	JobPeriod,
	JobRow,
	JobSaleView,
	JobSort,
	JobStatus,
	JobStatusCounts,
	JobTotalsView,
	JobsPageData
} from '$lib/jobs/types';
import { paginate, type Paged } from '$lib/paging';
import { loadCalc } from './context.ts';
import { getDataset } from './data.ts';
import { facilityEve, facilityPlaces, type FacilityPlace } from './facilities.ts';
import { ledgerReviewCount } from './ledger.ts';
import { refId, trackedRef } from './ledger-item.ts';
import { correctionRef } from './price-corrections.ts';
import { resolveProfiles } from './profiles.ts';
import type { SessionUser } from './session.ts';
import { getTrackingSettings } from './tracking-settings.ts';

export const JOB_PERIODS: readonly JobPeriod[] = ['7', '30', '90', '365', 'all'];
export const JOB_SORTS: readonly JobSort[] = ['newest', 'profit_desc', 'profit_asc', 'spent', 'ending'];
const JOB_STATUSES: readonly JobStatus[] = ['running', 'finished', 'cancelled'];
const DAY_MS = 86_400_000;

/** The signed-in visitor: their account and their calculator settings (output side of expected profit). */
export interface JobsLocals {
	user: SessionUser;
	settings: Settings;
}

/** ESI `activity_id`s of reaction jobs; manufacturing jobs (1) are tracked only for what they use. */
export const REACTION_ACTIVITIES = '(9, 11)';

const SQL = {
	/**
	 * Reaction jobs of tracking-on connections with their result; `?2` end date from (null = all), `?3`
	 * formula, `?4` connection, `?5` one job (null = all).
	 */
	jobs: `SELECT j.job_id, j.source_id, j.blueprint_type_id, j.product_type_id, j.runs, j.status, j.cost,
			j.facility_id, j.start_date, j.end_date, j.completed_date, s.owner_name, r.job_id AS result_id,
			r.input_cost, r.job_cost,
			r.output_type_id, r.output_qty, r.sold_qty, r.sales_net, r.used_qty, r.manufactured_qty,
			r.manufactured_value, r.unsold_qty, r.unit_cost, r.realized_profit, r.flags_json
		FROM tracked_jobs j
		JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = j.user_id
		LEFT JOIN job_results r ON r.user_id = j.user_id AND r.job_id = j.job_id
		WHERE j.user_id = ?1 AND s.tracking_enabled = 1 AND j.activity_id IN ${REACTION_ACTIVITIES}
			AND (?2 IS NULL OR j.end_date >= ?2)
			AND (?3 IS NULL OR j.blueprint_type_id = ?3)
			AND (?4 IS NULL OR j.source_id = ?4)
			AND (?5 IS NULL OR j.job_id = ?5)
		ORDER BY j.end_date DESC, j.job_id DESC`,
	formulas: `SELECT DISTINCT j.blueprint_type_id FROM tracked_jobs j
		JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = j.user_id
		WHERE j.user_id = ?1 AND s.tracking_enabled = 1 AND j.activity_id IN ${REACTION_ACTIVITIES}`,
	sources: `SELECT source_id, kind, owner_name FROM inventory_sources
		WHERE user_id = ?1 AND tracking_enabled = 1 ORDER BY owner_name, source_id`,
	state: 'SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?1',
	/**
	 * What the manufacturing jobs of tracking-on connections took of the output of job `?2` (`job:<id>`),
	 * per manufacturing job and type; `value` = Σ quantity × unit value (null unit value = unit cost).
	 */
	manufacturing: `SELECT m.job_id, m.blueprint_type_id, m.product_type_id, m.start_date, l.type_id,
			SUM(u.quantity) AS quantity, SUM(u.quantity * COALESCE(u.unit_value, u.unit_cost)) AS value
		FROM ledger_uses u
		JOIN ledger_lots l ON l.user_id = u.user_id AND l.lot_id = u.lot_id
		JOIN tracked_jobs m ON m.user_id = u.user_id AND u.use_ref = 'job:' || m.job_id
		JOIN inventory_sources s ON s.source_id = m.source_id AND s.user_id = m.user_id
		WHERE u.user_id = ?1 AND u.use_kind = 'manufacturing' AND l.origin = 'job' AND l.origin_ref = ?2
			AND m.activity_id = 1 AND s.tracking_enabled = 1
		GROUP BY m.job_id, l.type_id
		ORDER BY m.start_date, m.job_id, l.type_id`
} as const;

interface JobSqlRow {
	job_id: number;
	source_id: number;
	blueprint_type_id: number;
	product_type_id: number | null;
	runs: number;
	status: string;
	cost: number | null;
	facility_id: number;
	start_date: number;
	end_date: number;
	completed_date: number | null;
	owner_name: string;
	result_id: number | null;
	input_cost: number | null;
	job_cost: number | null;
	output_type_id: number | null;
	output_qty: number | null;
	sold_qty: number | null;
	sales_net: number | null;
	used_qty: number | null;
	manufactured_qty: number | null;
	manufactured_value: number | null;
	unsold_qty: number | null;
	unit_cost: number | null;
	realized_profit: number | null;
	flags_json: string | null;
}

interface ManufacturingSqlRow {
	job_id: number;
	blueprint_type_id: number;
	product_type_id: number | null;
	start_date: number;
	type_id: number;
	quantity: number;
	value: number;
}

/**
 * Reads the query string of the jobs page and of `/profits/data/jobs`; unknown or malformed values fall
 * back to the defaults (`defaultPeriod`, every status, newest first, page 1).
 */
export function parseJobsQuery(
	params: URLSearchParams,
	defaultPeriod: JobPeriod = '30'
): { filters: JobFilters; page: number } {
	const id = (name: string) => {
		const n = Number(params.get(name));
		return params.get(name) && Number.isSafeInteger(n) && n > 0 ? n : null;
	};
	const pick = <T extends string>(values: readonly T[], name: string): T | null => {
		const value = params.get(name);
		return values.includes(value as T) ? (value as T) : null;
	};
	return {
		filters: {
			period: pick(JOB_PERIODS, 'period') ?? defaultPeriod,
			status: pick(JOB_STATUSES, 'status'),
			formula: id('reaction'),
			connection: id('connection'),
			sort: pick(JOB_SORTS, 'sort') ?? 'newest'
		},
		page: id('page') ?? 1
	};
}

/**
 * {@link parseJobsQuery} with the user's default period (`TrackingSettings.defaultPeriod`), which is
 * also returned so links can leave it out.
 */
export async function userJobsQuery(
	env: Pick<Env, 'DB'>,
	userId: string,
	params: URLSearchParams
): Promise<{ filters: JobFilters; page: number; defaultPeriod: JobPeriod }> {
	const { defaultPeriod } = await getTrackingSettings(env, userId);
	return { ...parseJobsQuery(params, defaultPeriod), defaultPeriod };
}

/** Status at `now` from the ESI status and the end date (see {@link JobStatus}). */
export function jobStatus(status: string, endDate: number, now: number): JobStatus {
	if (status === 'cancelled' || status === 'reverted') return 'cancelled';
	if (status === 'active' || status === 'paused') return endDate > now ? 'running' : 'finished';
	return 'finished';
}

const MARKS: readonly JobMark[] = ['market_fallback', 'unpriced_input', 'no_cost', 'unknown_formula'];
const FLAGS: Record<JobFlag, true> = {
	running: true,
	cancelled: true,
	market_fallback: true,
	unpriced_input: true,
	no_cost: true,
	unknown_formula: true
};

function parseFlags(json: string | null): JobFlag[] {
	if (!json) return [];
	try {
		const parsed: unknown = JSON.parse(json);
		return Array.isArray(parsed)
			? (parsed.filter((f) => typeof f === 'string' && Object.hasOwn(FLAGS, f)) as JobFlag[])
			: [];
	} catch {
		return [];
	}
}

const NOTE = {
	running: 'Still running: profit is known once the job has ended.',
	runningRealized: 'Still running: the realized profit is known once its output is sold.',
	pending: 'Waiting for the results to be recalculated.',
	noMarket: 'Market prices are not available right now.',
	unvalued: 'Some output could not be valued: it has no market value today with your settings.'
} as const;

/** Formula of a job, named from the dataset. */
const formulaOf = (dataset: Dataset | null, blueprintTypeId: number): JobFormula => ({
	blueprintTypeId,
	name: dataset?.reactions.find((r) => r.blueprintTypeId === blueprintTypeId)?.formulaName ?? null
});

const typeName = (dataset: Dataset | null, typeId: number) =>
	dataset?.types[typeId]?.name ?? `Type ${typeId}`;

/** Values unsold output once per type (`stockUnitValue` with the visitor's settings; null without prices). */
function valuer(ctx: CalcContext | null) {
	const memo = new Map<number, number | null>();
	return (typeId: number): number | null => {
		if (!ctx) return null;
		if (!memo.has(typeId)) memo.set(typeId, stockUnitValue(ctx, typeId));
		return memo.get(typeId)!;
	};
}

interface RowContext {
	dataset: Dataset | null;
	ctx: CalcContext | null;
	value: (typeId: number) => number | null;
	facilities: Map<number, FacilityPlace>;
	now: number;
}

/**
 * A job row plus what the detail page needs of its result (`unitCost`, `salesNet`: null without one) and
 * `endedAt`: when a cancelled job was cancelled (its completed date, else its end date), else its end date.
 */
export type JobListRow = JobRow & { unitCost: number | null; salesNet: number | null; endedAt: number };

function toRow(j: JobSqlRow, c: RowContext): JobListRow {
	const status = jobStatus(j.status, j.end_date, c.now);
	const flags = parseFlags(j.flags_json);
	const resultStatus: JobStatus = flags.includes('cancelled')
		? 'cancelled'
		: flags.includes('running')
			? 'running'
			: 'finished';
	// A result written before the job ended (or was cancelled) is out of date until the next rebuild.
	const current = j.result_id !== null && resultStatus === status;
	const base = {
		jobId: j.job_id,
		formula: formulaOf(c.dataset, j.blueprint_type_id),
		runs: j.runs,
		owner: j.owner_name,
		facility: c.facilities.get(j.facility_id)?.name ?? 'Unknown structure',
		startDate: j.start_date,
		endDate: j.end_date,
		status,
		marks: MARKS.filter((m) => flags.includes(m)),
		endedAt: status === 'cancelled' ? (j.completed_date ?? j.end_date) : j.end_date
	};
	if (!current) {
		return {
			...base,
			inputCost: null,
			jobCost: j.cost,
			output: null,
			realizedProfit: null,
			expectedProfit: null,
			expectedNote: status === 'running' ? NOTE.running : NOTE.pending,
			unitCost: null,
			salesNet: null
		};
	}
	const result: JobResult = {
		jobId: j.job_id,
		inputCost: j.input_cost ?? 0,
		jobCost: j.job_cost ?? 0,
		outputTypeId: j.output_type_id,
		outputQty: j.output_qty ?? 0,
		soldQty: j.sold_qty ?? 0,
		salesNet: j.sales_net ?? 0,
		usedQty: j.used_qty ?? 0,
		manufacturedQty: j.manufactured_qty ?? 0,
		manufacturedValue: j.manufactured_value ?? 0,
		unsoldQty: j.unsold_qty ?? 0,
		unitCost: j.unit_cost,
		realizedProfit: j.realized_profit ?? 0,
		flags
	};
	const costs = {
		...base,
		inputCost: result.inputCost,
		jobCost: result.jobCost,
		unitCost: result.unitCost,
		salesNet: status === 'running' ? null : result.salesNet
	};
	if (status === 'running') {
		return {
			...costs,
			output: null,
			realizedProfit: null,
			expectedProfit: null,
			expectedNote: NOTE.running
		};
	}
	const output =
		status === 'finished' && result.outputTypeId !== null && result.outputQty > 0
			? {
					typeId: result.outputTypeId,
					name: typeName(c.dataset, result.outputTypeId),
					quantity: result.outputQty,
					soldQty: result.soldQty,
					usedQty: result.usedQty,
					manufacturedQty: result.manufacturedQty,
					unsoldQty: result.unsoldQty
				}
			: null;
	const expected = expectedProfit(result, result.outputTypeId === null ? null : c.value(result.outputTypeId));
	return {
		...costs,
		output,
		realizedProfit: result.realizedProfit,
		expectedProfit: expected,
		expectedNote: expected !== null ? null : c.ctx ? NOTE.unvalued : NOTE.noMarket
	};
}

const emptyTotals = (): JobTotalsView => ({
	jobs: 0,
	runs: 0,
	spent: 0,
	realizedProfit: 0,
	expectedProfit: 0,
	unvalued: 0,
	soldQty: 0,
	usedQty: 0,
	manufacturedQty: 0,
	unsoldQty: 0
});

/** The jobs page of a visitor who may not see it (the layout shows the login / switch-on message). */
export const emptyJobsPage = (filters: JobFilters, now = Date.now()): JobsPageData => ({
	now,
	defaultPeriod: '30',
	hasJobs: false,
	filters,
	counts: { all: 0, running: 0, finished: 0, cancelled: 0 },
	totals: emptyTotals(),
	jobs: paginate([], 1),
	reviewCount: 0,
	rebuiltAt: null,
	dirty: false,
	formulas: [],
	connections: []
});

function addRow(t: JobTotalsView, row: JobRow): void {
	t.jobs += 1;
	t.runs += row.runs;
	t.spent += (row.inputCost ?? 0) + (row.jobCost ?? 0);
	if (row.realizedProfit !== null) t.realizedProfit += row.realizedProfit;
	if (row.expectedProfit !== null) t.expectedProfit += row.expectedProfit;
	else if (row.status !== 'running') t.unvalued += 1;
	if (row.output) {
		t.soldQty += row.output.soldQty;
		t.usedQty += row.output.usedQty;
		t.manufacturedQty += row.output.manufacturedQty;
		t.unsoldQty += row.output.unsoldQty;
	}
}

async function rowContext(env: Env, locals: JobsLocals, now: number): Promise<RowContext> {
	const [calc, facilities] = await Promise.all([
		loadCalc(env, locals),
		facilityPlaces(env, locals.user.userId)
	]);
	const dataset = calc?.dataset ?? (await getDataset(env));
	const ctx = calc?.ctx ?? null;
	return { dataset, ctx, value: valuer(ctx), facilities, now };
}

/** Every job of the user's tracking-on connections matching `filters` except the status, unsorted. */
async function matchingRows(
	env: Env,
	locals: JobsLocals,
	filters: JobFilters,
	now: number
): Promise<{ rows: JobListRow[]; c: RowContext }> {
	const since = filters.period === 'all' ? null : now - Number(filters.period) * DAY_MS;
	const [jobsRes, c] = await Promise.all([
		env.DB.prepare(SQL.jobs).bind(locals.user.userId, since, filters.formula, filters.connection, null).all(),
		rowContext(env, locals, now)
	]);
	return { rows: (jobsRes.results as unknown as JobSqlRow[]).map((j) => toRow(j, c)), c };
}

/** What "most / least profitable" orders by: expected profit, else realized. */
const profitOf = (r: JobRow) => r.expectedProfit ?? r.realizedProfit;

/** Compares by `pick` in `dir` order (1 ascending, -1 descending), nulls last. */
const nullsLast =
	(pick: (r: JobRow) => number | null, dir: 1 | -1) =>
	(a: JobRow, b: JobRow): number => {
		const x = pick(a);
		const y = pick(b);
		if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
		return dir * (x - y);
	};

const COMPARE: Record<JobSort, (a: JobRow, b: JobRow) => number> = {
	newest: () => 0,
	profit_desc: nullsLast(profitOf, -1),
	profit_asc: nullsLast(profitOf, 1),
	spent: (a, b) => (b.inputCost ?? 0) + (b.jobCost ?? 0) - (a.inputCost ?? 0) - (a.jobCost ?? 0),
	ending: (a, b) => {
		const ra = a.status === 'running' ? 0 : 1;
		const rb = b.status === 'running' ? 0 : 1;
		return ra - rb || (ra === 0 ? a.endDate - b.endDate : 0);
	}
};

/** The rows of `filters.status` in `filters.sort` order (ties: newest end date first). */
function selectRows<T extends JobRow>(rows: readonly T[], filters: JobFilters): T[] {
	return rows
		.filter((r) => filters.status === null || r.status === filters.status)
		.sort((a, b) => COMPARE[filters.sort](a, b) || b.endDate - a.endDate || b.jobId - a.jobId);
}

/** Page `page` of the selected rows as the job table shows them. */
function tablePage(rows: readonly JobListRow[], page: number): Paged<JobRow> {
	const paged = paginate(rows, page);
	return {
		...paged,
		rows: paged.rows.map(
			({ unitCost: _unitCost, salesNet: _salesNet, endedAt: _endedAt, ...row }): JobRow => row
		)
	};
}

/**
 * Every job of the user's tracking-on connections matching `filters` (period by end date; running jobs
 * end in the future, so every period includes them), in `filters.sort` order, before paging: the jobs
 * page totals are computed over exactly these. `value` is the memoized net unit value of output today
 * with the visitor's settings (`stockUnitValue`), the one expected profit uses.
 */
export async function listJobRows(
	env: Env,
	locals: JobsLocals,
	filters: JobFilters,
	now = Date.now()
): Promise<{ rows: JobListRow[]; value: (typeId: number) => number | null; dataset: Dataset | null }> {
	const { rows, c } = await matchingRows(env, locals, filters, now);
	return { rows: selectRows(rows, filters), value: c.value, dataset: c.dataset };
}

/** One page of the job table (`/profits/data/jobs`; the jobs page load renders the same page). */
export async function jobsTable(
	env: Env,
	locals: JobsLocals,
	filters: JobFilters,
	page: number,
	now = Date.now()
): Promise<Paged<JobRow>> {
	return tablePage((await listJobRows(env, locals, filters, now)).rows, page);
}

/**
 * The jobs page: counts per status, totals over every job matching `filters`, the table page `page`
 * (as {@link jobsTable}), recalculation state, prices needing review and the filter choices.
 * `defaultPeriod` is the period links leave out (the user's `TrackingSettings.defaultPeriod`).
 */
export async function jobsPage(
	env: Env,
	locals: JobsLocals,
	filters: JobFilters,
	page: number,
	now = Date.now(),
	defaultPeriod: JobPeriod = '30'
): Promise<JobsPageData> {
	const userId = locals.user.userId;
	const db = env.DB;
	const [{ rows: all, c }, [formulasRes, sourcesRes, stateRes], reviewCount] = await Promise.all([
		matchingRows(env, locals, filters, now),
		db.batch([
			db.prepare(SQL.formulas).bind(userId),
			db.prepare(SQL.sources).bind(userId),
			db.prepare(SQL.state).bind(userId)
		]),
		ledgerReviewCount(env, userId)
	]);
	const state = stateRes.results[0] as { rebuilt_at: number | null; dirty: number } | undefined;
	const sources = sourcesRes.results as {
		source_id: number;
		kind: 'character' | 'corporation';
		owner_name: string;
	}[];

	const counts: JobStatusCounts = { all: all.length, running: 0, finished: 0, cancelled: 0 };
	for (const row of all) counts[row.status] += 1;
	const rows = selectRows(all, filters);
	const totals = emptyTotals();
	for (const row of rows) addRow(totals, row);

	const byName = (a: JobFormula, b: JobFormula) =>
		(a.name ?? '').localeCompare(b.name ?? '') || a.blueprintTypeId - b.blueprintTypeId;
	const formulas = (formulasRes.results as { blueprint_type_id: number }[])
		.map((f) => formulaOf(c.dataset, f.blueprint_type_id))
		.sort(byName);
	return {
		now,
		defaultPeriod,
		hasJobs: formulas.length > 0,
		filters,
		counts,
		totals,
		jobs: tablePage(rows, page),
		reviewCount,
		rebuiltAt: state?.rebuilt_at ?? null,
		dirty: Boolean(state?.dirty),
		formulas,
		connections: sources.map((s): JobConnectionOption => ({
			sourceId: s.source_id,
			name: s.owner_name,
			kind: s.kind
		}))
	};
}

/** Whether `id` is a positive integer job id (route param). */
export const isJobId = (id: number) => Number.isSafeInteger(id) && id > 0;

/** Whether `jobId` is a reaction job of one of the user's connections with Profit tracking on. */
export async function isTrackedJob(env: Pick<Env, 'DB'>, userId: string, jobId: number): Promise<boolean> {
	const row = await env.DB.prepare(
		`SELECT 1 AS found FROM tracked_jobs j
		JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = j.user_id
		WHERE j.user_id = ?1 AND j.job_id = ?2 AND s.tracking_enabled = 1
			AND j.activity_id IN ${REACTION_ACTIVITIES}`
	)
		.bind(userId, jobId)
		.first<{ found: number }>();
	return row !== null;
}

/**
 * The reaction material bonus of job `j` as the ledger computes it: the facility as EVE tells it with
 * the user's facility settings filling in, else the account reactor profile's ME rig (the profile of
 * the formula's reactor). Null without the dataset or a known product.
 */
async function materialBonusView(
	env: Env,
	locals: JobsLocals,
	c: RowContext,
	j: JobSqlRow,
	settings: TrackingSettings['facilities']
): Promise<JobMaterialBonusView | null> {
	const reaction = c.dataset?.reactions.find((r) => r.blueprintTypeId === j.blueprint_type_id);
	const productTypeId = reaction?.product.typeId ?? j.product_type_id;
	if (!c.dataset || productTypeId === null) return null;
	const place = c.facilities.get(j.facility_id);
	const facility = resolveFacility(facilityEve(place), settings[String(j.facility_id)]);
	const profiles = c.ctx?.profiles ?? (await resolveProfiles(env, locals.settings, new Set())).profiles;
	const profile = profiles[reaction?.reactor ?? 'composite'];
	const bonus = jobMaterialBonus(
		c.dataset.industry,
		productTypeId,
		facility,
		{
			structure: profile.structure,
			meRig: profile.meRig,
			teRig: profile.teRig,
			reactionsSkill: profile.reactionsSkill,
			securityBand: profile.securityBand
		},
		DEFAULT_CONSTANTS
	);
	return {
		facility: place?.name ?? 'Unknown structure',
		band: facility.band,
		source: bonus.source,
		reactorSettingsSystem: place?.systemId != null && place.systemId === profile.systemId,
		parts: bonus.parts.map(({ kind, name, reduction }) => ({ kind, name, reduction })),
		profileRig: bonus.profileRig && {
			...bonus.profileRig,
			// The engine's rule: the facility's band, unless unknown or highsec (no reaction band there).
			band: facility.band === null || facility.band === 'highsec' ? profile.securityBand : facility.band
		},
		reduction: 1 - bonus.multiplier
	};
}

/**
 * The job page: the job (a tracking-on connection's job of the signed-in user, else null),
 * its inputs with the lots they came from, where its output went, and the jobs before and after it.
 */
export async function jobDetailPage(
	env: Env,
	locals: JobsLocals,
	jobId: number,
	now = Date.now()
): Promise<JobDetailData | null> {
	if (!isJobId(jobId)) return null;
	const userId = locals.user.userId;
	const db = env.DB;
	const jobRef = `job:${jobId}`;
	const [[jobRes, stateRes, manufacturingRes], c, tracking] = await Promise.all([
		db.batch([
			db.prepare(SQL.jobs).bind(userId, null, null, null, jobId),
			db.prepare(SQL.state).bind(userId),
			db.prepare(SQL.manufacturing).bind(userId, jobRef)
		]),
		rowContext(env, locals, now),
		getTrackingSettings(env, userId)
	]);
	const raw = (jobRes.results as unknown as JobSqlRow[])[0];
	if (!raw) return null;
	const state = stateRes.results[0] as { rebuilt_at: number | null; dirty: number } | undefined;
	const row = toRow(raw, c);
	const orm = getCoreDb(env.DB);

	const [inputRows, outputRows, corrections] = await Promise.all([
		orm
			.select({
				lotId: ledgerLots.lotId,
				typeId: ledgerLots.typeId,
				acquiredAt: ledgerLots.acquiredAt,
				origin: ledgerLots.origin,
				originRef: ledgerLots.originRef,
				priceSource: ledgerLots.priceSource,
				quantity: ledgerUses.quantity,
				unitCost: ledgerUses.unitCost
			})
			.from(ledgerUses)
			.innerJoin(
				ledgerLots,
				and(eq(ledgerLots.userId, ledgerUses.userId), eq(ledgerLots.lotId, ledgerUses.lotId))
			)
			.where(
				and(
					eq(ledgerUses.userId, userId),
					eq(ledgerUses.useKind, 'job'),
					eq(ledgerUses.useRef, jobRef),
					trackedRef(userId, ledgerLots.originRef)
				)
			)
			.orderBy(asc(ledgerLots.acquiredAt), asc(ledgerLots.lotId)),
		orm
			.select({
				kind: ledgerUses.useKind,
				ref: ledgerUses.useRef,
				quantity: ledgerUses.quantity,
				saleAt: ledgerPrices.at,
				saleUnitPrice: ledgerPrices.unitPrice
			})
			.from(ledgerUses)
			.innerJoin(
				ledgerLots,
				and(eq(ledgerLots.userId, ledgerUses.userId), eq(ledgerLots.lotId, ledgerUses.lotId))
			)
			.leftJoin(
				ledgerPrices,
				and(
					eq(ledgerUses.useKind, 'sale'),
					eq(ledgerPrices.userId, ledgerUses.userId),
					eq(ledgerPrices.ref, ledgerUses.useRef),
					eq(ledgerPrices.typeId, ledgerLots.typeId),
					eq(ledgerPrices.incoming, false)
				)
			)
			.where(
				and(
					eq(ledgerUses.userId, userId),
					eq(ledgerLots.origin, 'job'),
					eq(ledgerLots.originRef, jobRef),
					inArray(ledgerUses.useKind, ['job', 'sale']),
					trackedRef(userId, ledgerUses.useRef)
				)
			)
			.orderBy(asc(ledgerUses.useRef)),
		orm
			.select({ ref: priceCorrections.targetRef, note: priceCorrections.note })
			.from(priceCorrections)
			.where(
				and(
					eq(priceCorrections.userId, userId),
					eq(priceCorrections.targetKind, 'job_input'),
					like(priceCorrections.targetRef, `job:${jobId}:%`)
				)
			)
	]);
	const correctionNotes = new Map(corrections.map((c) => [c.ref, c.note]));

	// Formulas of the jobs before (made an input lot) and after (used the output).
	const linkedIds = new Set<number>();
	for (const l of inputRows) {
		const maker = l.origin === 'job' ? refId(l.originRef, 'job:') : null;
		if (maker !== null) linkedIds.add(maker);
	}
	for (const u of outputRows) {
		const user = u.kind === 'job' ? refId(u.ref, 'job:') : null;
		if (user !== null) linkedIds.add(user);
	}
	const linkedJobs = linkedIds.size
		? await orm
				.select({
					jobId: trackedJobs.jobId,
					blueprintTypeId: trackedJobs.blueprintTypeId,
					startDate: trackedJobs.startDate
				})
				.from(trackedJobs)
				.where(
					and(
						eq(trackedJobs.userId, userId),
						inArray(trackedJobs.activityId, [9, 11]),
						sql`${trackedJobs.jobId} IN (SELECT value FROM json_each(${JSON.stringify([...linkedIds])}))`
					)
				)
		: [];
	const linked = new Map(linkedJobs.map((j) => [j.jobId, j]));
	const link = (id: number, quantity: number): JobLink | null => {
		const job = linked.get(id);
		return job === undefined
			? null
			: { jobId: id, formula: formulaOf(c.dataset, job.blueprintTypeId), startDate: job.startDate, quantity };
	};

	// Inputs in formula order, then anything else the job took.
	const reaction = c.dataset?.reactions.find((r) => r.blueprintTypeId === raw.blueprint_type_id);
	const order = new Map(reaction?.materials.map((m, i) => [m.typeId, i]) ?? []);
	const inputs = new Map<number, JobInputView>();
	const from = new Map<number, JobLink>();
	for (const l of inputRows) {
		const maker = l.origin === 'job' ? refId(l.originRef, 'job:') : null;
		const madeBy = maker === null ? null : link(maker, l.quantity);
		if (madeBy) {
			const known = from.get(madeBy.jobId);
			if (known) known.quantity += l.quantity;
			else from.set(madeBy.jobId, { ...madeBy });
		}
		const fallback =
			(l.origin === 'market' || l.origin === 'correction') && refId(l.originRef, 'job:') === jobId;
		const ref = fallback ? correctionRef({ kind: 'job_input', jobId, typeId: l.typeId }) : null;
		const corrected = fallback && l.origin === 'correction';
		const lot: JobInputLot = {
			lotId: l.lotId,
			acquiredAt: l.acquiredAt,
			origin: l.origin,
			priceSource: l.priceSource,
			quantity: l.quantity,
			unitCost: l.unitCost,
			cost: l.quantity * l.unitCost,
			madeBy,
			correctionRef: ref,
			corrected,
			correctionNote: corrected && ref !== null ? (correctionNotes.get(ref) ?? null) : null
		};
		const input = inputs.get(l.typeId);
		if (input) {
			input.quantity += lot.quantity;
			input.cost += lot.cost;
			input.lots.push(lot);
		} else {
			inputs.set(l.typeId, {
				typeId: l.typeId,
				name: typeName(c.dataset, l.typeId),
				quantity: lot.quantity,
				cost: lot.cost,
				lots: [lot]
			});
		}
	}
	const sales = new Map<string, JobSaleView>();
	const to = new Map<number, JobLink>();
	for (const u of outputRows) {
		if (u.kind === 'job') {
			const used = refId(u.ref, 'job:');
			const next = used === null ? null : link(used, u.quantity);
			if (!next) continue;
			const known = to.get(next.jobId);
			if (known) known.quantity += u.quantity;
			else to.set(next.jobId, next);
		} else {
			const sale = sales.get(u.ref);
			if (sale) sale.quantity += u.quantity;
			else
				sales.set(u.ref, {
					ref: u.ref,
					kind: u.ref.startsWith('contract:') ? 'contract' : 'market',
					at: u.saleAt,
					quantity: u.quantity,
					netUnitValue: u.saleUnitPrice
				});
		}
	}
	const usedBy = [...to.values()].sort((a, b) => a.jobId - b.jobId);
	const basis = tracking.manufacturingUse === 'zero' ? 'cost' : 'buy_value';
	const manufacturing = (manufacturingRes.results as unknown as ManufacturingSqlRow[]).map(
		(m): JobManufacturingUse => {
			const names = manufacturingNames(c.dataset, m.blueprint_type_id);
			const productTypeId = names.productTypeId ?? m.product_type_id;
			return {
				jobId: m.job_id,
				product:
					productTypeId === null
						? null
						: { typeId: productTypeId, name: names.product ?? typeName(c.dataset, productTypeId) },
				at: m.start_date,
				quantity: m.quantity,
				unitValue: m.quantity > 0 ? m.value / m.quantity : 0,
				basis
			};
		}
	);

	let output: JobOutputDetail | null = null;
	if (row.output) {
		const unitValueNow = c.value(row.output.typeId);
		output = {
			...row.output,
			sales: [...sales.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.ref.localeCompare(b.ref)),
			usedBy,
			manufacturing,
			unitValueNow,
			unsoldValueNow: unitValueNow === null ? null : unitValueNow * row.output.unsoldQty
		};
	}
	const productTypeId = raw.product_type_id ?? reaction?.product.typeId ?? null;
	// A running job with current results: its unit cost and expected profit for the output it will make.
	let running: Partial<Pick<JobDetail, 'unitCost' | 'expectedProfit' | 'expectedNote'>> &
		Pick<JobDetail, 'runningOutputQty'> = { runningOutputQty: null };
	if (row.status === 'running' && row.inputCost !== null && reaction) {
		const outputQty = raw.runs * reaction.product.quantity;
		const totalCost = row.inputCost + (row.jobCost ?? 0);
		const unitValueNow = c.value(reaction.product.typeId);
		running = {
			runningOutputQty: outputQty,
			unitCost: outputQty > 0 ? totalCost / outputQty : null,
			expectedProfit: unitValueNow === null ? null : outputQty * unitValueNow - totalCost,
			expectedNote: unitValueNow !== null ? null : c.ctx ? NOTE.unvalued : NOTE.noMarket
		};
	}
	return {
		now,
		materialBonus: await materialBonusView(env, locals, c, raw, tracking.facilities),
		job: {
			...row,
			...running,
			realizedNote: row.status === 'running' ? NOTE.runningRealized : row.expectedNote,
			product:
				productTypeId === null ? null : { typeId: productTypeId, name: typeName(c.dataset, productTypeId) }
		},
		inputs: [...inputs.values()].sort(
			(a, b) =>
				(order.get(a.typeId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.typeId) ?? Number.MAX_SAFE_INTEGER) ||
				a.typeId - b.typeId
		),
		output,
		chain: { from: [...from.values()].sort((a, b) => a.jobId - b.jobId), to: usedBy },
		rebuiltAt: state?.rebuilt_at ?? null,
		dirty: Boolean(state?.dirty)
	};
}
