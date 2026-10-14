/** View types of the `/profits/jobs` and `/profits/jobs/[jobId]` pages. */

import type { IndustryBand, ReactionBonusSource, RigLevel, SecurityBand } from '@reactions/engine';
import type { LedgerActionResult } from '$lib/ledger/types';
import type { Paged } from '$lib/paging';

/**
 * Status at page load: `running` = ESI `active`/`paused` before its end date; `finished` = `delivered`/
 * `ready`, or `active`/`paused` past its end date; `cancelled` = `cancelled`/`reverted`.
 */
export type JobStatus = 'running' | 'finished' | 'cancelled';

/** Days back from now, by the job's end date (`all`: no limit). Running jobs are always included. */
export type JobPeriod = '7' | '30' | '90' | '365' | 'all';

/**
 * Order of the job table: `newest` end date first; `profit_desc`/`profit_asc` by expected profit (else
 * realized; jobs without either last); `spent` most input + job cost first; `ending` running jobs ending
 * soonest first, then the rest newest first.
 */
export type JobSort = 'newest' | 'profit_desc' | 'profit_asc' | 'spent' | 'ending';

/** Result flags shown as marks next to the status (`running`/`cancelled` are the status itself). */
export type JobMark = 'market_fallback' | 'unpriced_input' | 'no_cost' | 'unknown_formula';

export interface JobFilters {
	period: JobPeriod;
	/** null = every status. */
	status: JobStatus | null;
	/** Formula (`blueprint_type_id`). */
	formula: number | null;
	/** Connection (`inventory_sources.source_id`). */
	connection: number | null;
	sort: JobSort;
}

export interface JobFormula {
	blueprintTypeId: number;
	/** Formula name from the dataset; null when the formula is not in it. */
	name: string | null;
}

export interface JobOutputView {
	typeId: number;
	name: string;
	quantity: number;
	soldQty: number;
	/** Taken by later own reaction jobs (its value is realized by those jobs). */
	usedQty: number;
	/** Taken by the user's manufacturing jobs (realized at once, see the manufacturing setting). */
	manufacturedQty: number;
	unsoldQty: number;
}

export interface JobRow {
	jobId: number;
	formula: JobFormula;
	runs: number;
	/** Owner name of the job's connection. */
	owner: string;
	/** Facility name from EVE's lookup or the user's places, else "Unknown structure". */
	facility: string;
	startDate: number;
	endDate: number;
	status: JobStatus;
	marks: JobMark[];
	/** null until the ledger has been calculated with this job. */
	inputCost: number | null;
	jobCost: number | null;
	/** null for running, cancelled and not yet calculated jobs. */
	output: JobOutputView | null;
	/** null while running or not yet calculated; a cancelled job shows its loss. */
	realizedProfit: number | null;
	/** Realized + unsold output at today's value (the account's output settings); null when not valued. */
	expectedProfit: number | null;
	/** Why `expectedProfit` is null (shown as a hint); null when it has a value. */
	expectedNote: string | null;
}

/** Sums over jobs; profits sum the jobs that have one. */
export interface JobTotalsView {
	jobs: number;
	runs: number;
	/** Input cost + job cost. */
	spent: number;
	realizedProfit: number;
	expectedProfit: number;
	/** Finished jobs whose expected profit could not be valued (left out of `expectedProfit`). */
	unvalued: number;
	soldQty: number;
	usedQty: number;
	manufacturedQty: number;
	unsoldQty: number;
}

export interface JobConnectionOption {
	sourceId: number;
	name: string;
	kind: 'character' | 'corporation';
}

/** Jobs per status (and in total) matching every filter but the status. */
export type JobStatusCounts = Record<'all' | JobStatus, number>;

export interface JobsPageData {
	/** Time of the load (relative dates: "ends in", "ended 2 d ago"). */
	now: number;
	/** Period the tab opens on (`TrackingSettings.defaultPeriod`): links leave it out of the URL. */
	defaultPeriod: JobPeriod;
	/** The user has tracked jobs at all, whatever the filters. */
	hasJobs: boolean;
	filters: JobFilters;
	counts: JobStatusCounts;
	/** Every job matching the filters (all pages). */
	totals: JobTotalsView;
	/** The table page (`PAGE_SIZE` rows in `filters.sort` order; `/profits/data/jobs` serves the others). */
	jobs: Paged<JobRow>;
	reviewCount: number;
	rebuiltAt: number | null;
	/** A recalculation is pending. */
	dirty: boolean;
	/** Filter choices: formulas of the user's jobs, tracked connections. */
	formulas: JobFormula[];
	connections: JobConnectionOption[];
}

/**
 * Where a batch came from: bought on the market (`transaction`) or by contract, made by a job, valued at
 * the buy price when the job started because no purchase was found (`market`), priced by the user, or
 * a purchase the user entered (`manual`).
 */
export type JobLotOrigin = 'transaction' | 'contract' | 'job' | 'market' | 'correction' | 'manual';

/** A batch (ledger lot) an input of the job came from. */
export interface JobInputLot {
	lotId: number;
	acquiredAt: number;
	origin: JobLotOrigin;
	/** Shown verbatim. */
	priceSource: string;
	/** Quantity this job took from the lot. */
	quantity: number;
	unitCost: number;
	cost: number;
	/** The job that made the lot (origin `job`), else null. */
	madeBy: JobLink | null;
	/** `job_input` correction ref of a lot without a purchase (market value or corrected); else null. */
	correctionRef: string | null;
	/** Priced by the user's correction ("Undo correction"). */
	corrected: boolean;
	/** The note of that correction; null without one. */
	correctionNote: string | null;
}

export interface JobInputView {
	typeId: number;
	name: string;
	/** Quantity consumed (computed from the formula and the facility). */
	quantity: number;
	cost: number;
	lots: JobInputLot[];
}

export interface JobLink {
	jobId: number;
	formula: JobFormula;
	/** Start of the linked job (tells apart links of the same formula). */
	startDate: number;
	/** Units of the linked item moved between the two jobs. */
	quantity: number;
}

export interface JobSaleView {
	ref: string;
	kind: 'market' | 'contract';
	at: number | null;
	quantity: number;
	/** Net unit value of the sale (after tax and fees). */
	netUnitValue: number | null;
}

/** Output of this job taken by one of the user's manufacturing jobs. */
export interface JobManufacturingUse {
	/** The manufacturing job (ESI job id). */
	jobId: number;
	/** What the manufacturing job makes; null when its blueprint is not in the dataset. */
	product: { typeId: number; name: string } | null;
	/** Start of the manufacturing job (when the units were used). */
	at: number;
	quantity: number;
	/** What one unit counted for. */
	unitValue: number;
	/** `buy_value`: the buy price on the day the job started; `cost`: what the unit cost (no profit). */
	basis: 'buy_value' | 'cost';
}

export interface JobOutputDetail extends JobOutputView {
	sales: JobSaleView[];
	usedBy: JobLink[];
	/** Manufacturing jobs that took some of the output, oldest first. */
	manufacturing: JobManufacturingUse[];
	/** Net value of one unit today with the account's output settings; null when unpriced. */
	unitValueNow: number | null;
	/** `unsoldQty × unitValueNow`. */
	unsoldValueNow: number | null;
}

export interface JobDetail extends JobRow {
	product: { typeId: number; name: string } | null;
	/**
	 * (input cost + job cost) ÷ output quantity; null without output. For a running job, computed with the
	 * output it will make (`runningOutputQty`).
	 */
	unitCost: number | null;
	/** Net value of the sold output (after tax and fees); null without results. */
	salesNet: number | null;
	/**
	 * A running job: the output it will make (runs × the formula's product quantity). Its `expectedProfit`
	 * is then an estimate: that output at today's net value minus its costs. Null otherwise.
	 */
	runningOutputQty: number | null;
	/** Why `realizedProfit` is null (shown as a hint); null when it has a value. */
	realizedNote: string | null;
}

/**
 * How the job's input quantities were reduced (the ledger's reaction material bonus): `facility` = the
 * structure and its rigs; `profile` = the structure is not known, the ME rig of the account reactor
 * settings applies; `structure_profile_rig` = the structure is known but not its rigs.
 */
export interface JobMaterialBonusView {
	facility: string;
	/** Band of the facility's system; null when unknown (rig values of highsec). */
	band: IndustryBand | null;
	source: ReactionBonusSource;
	/**
	 * The facility is in the system of the account reactor settings used: what is not known of it comes
	 * from those settings on purpose (`/account/tracking` shows them as its defaults).
	 */
	reactorSettingsSystem: boolean;
	/** Structure role bonus and each applied rig, reduction after security. */
	parts: { kind: 'structure' | 'rig'; name: string; reduction: number }[];
	/** The reactor settings' ME rig and the band it was computed for (sources other than `facility`). */
	profileRig: { meRig: RigLevel; reduction: number; band: SecurityBand } | null;
	/** Total material reduction (1 − multiplier). */
	reduction: number;
}

export interface JobDetailData {
	/** Time of the load (relative dates). */
	now: number;
	job: JobDetail;
	/** Null without the dataset or the job's product. */
	materialBonus: JobMaterialBonusView | null;
	inputs: JobInputView[];
	/** null without output (running, cancelled, not yet calculated). */
	output: JobOutputDetail | null;
	/** Jobs that made this job's inputs, and jobs that used its output. */
	chain: { from: JobLink[]; to: JobLink[] };
	rebuiltAt: number | null;
	dirty: boolean;
}

/** Result of the `correct` and `undo` actions on the job page (`ref` = the input the form was for). */
export type JobActionResult = LedgerActionResult;
