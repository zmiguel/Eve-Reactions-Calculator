/** View types of the `/profits` overview page and its table endpoints. */
import type { Paged } from '$lib/paging';

/** Days back from today (`all`: everything tracked). */
export type ProfitPeriod = '7' | '30' | '90' | '365' | 'all';

/** Chart bucket of a period: day for 7 and 30 days, week (from Monday) for 90 and 365, month for all. */
export type ProfitBucket = 'day' | 'week' | 'month';

/** Something that needs the user's attention, with where to fix it. */
export type AttentionItem =
	| { kind: 'review'; count: number }
	/** `jobs` started in the period still have inputs valued at market; `share` (0–1) of their input cost. */
	| { kind: 'estimates'; jobs: number; share: number }
	| { kind: 'streams'; connections: number };

export interface OverviewKpis {
	/**
	 * Profit of job output sold in the period (by sale date) and used by manufacturing jobs started in it,
	 * plus losses of jobs cancelled in it.
	 */
	realized: number;
	/** The same over the previous period of the same length; null for `all`. */
	realizedPrevious: number | null;
	/** Units of job output used by manufacturing jobs started in the period (counted in `realized`). */
	manufacturedQty: number;
	/** Expected profit of the jobs that ended in the period (finished or cancelled). */
	expected: number;
	/** Jobs that ended in the period. */
	endedJobs: number;
	/** Of those, jobs whose expected profit could not be valued (left out). */
	unvaluedJobs: number;
	/** Some of `expected` is unsold output valued at today's price. */
	expectedHasUnsold: boolean;
	/** Net income of every sale in the period (after tax and broker fees). */
	salesIncome: number;
	sales: number;
	/** `purchases` + `jobCosts`. */
	spent: number;
	/** Market, contract and entered purchases in the period, fees included. */
	purchases: number;
	/** Job costs (installation and tax) of reaction and fuel block jobs started in the period. */
	jobCosts: number;
	/** `expected` ÷ the slot-days of the jobs counted in it; null without any. */
	profitPerSlotDay: number | null;
	/** Slot-days of those jobs (one slot each, end − start). */
	slotDays: number;
	/** Output of your jobs still held (not period-bound). */
	unsold: {
		quantity: number;
		/** Value today of the types that have a price. */
		value: number;
		/** What those units cost you. */
		cost: number;
		/** `value` − `cost`. */
		gain: number;
		/** Types without a price today (left out of value, cost and gain). */
		unvaluedTypes: number;
	};
	/** Sales in the period of items you bought rather than made; null when there were none. */
	reselling: { profit: number; sales: number } | null;
}

export interface ProfitTimePoint {
	/** `YYYY-MM-DD` (first day of the bucket) or `YYYY-MM` for months. */
	label: string;
	realized: number;
	cumulative: number;
	salesIncome: number;
	purchases: number;
	jobCosts: number;
}

export interface ReactionProfitPoint {
	blueprintTypeId: number;
	/** The product's name (the formula's when it is missing from the dataset). */
	name: string;
	realized: number;
	/** Expected − realized: unsold output at today's value. */
	unrealized: number;
}

export type InputSourceKind = 'transaction' | 'contract' | 'manual' | 'job' | 'market' | 'correction';

export interface InputSourceSlice {
	kind: InputSourceKind;
	cost: number;
}

export interface OverviewCharts {
	bucket: ProfitBucket;
	timeline: ProfitTimePoint[];
	/** Top 8 formulas by expected profit. */
	reactions: ReactionProfitPoint[];
	/** Input cost of jobs started in the period by where it came from (zero slices left out). */
	inputSources: InputSourceSlice[];
}

export interface ReactionTableRow {
	blueprintTypeId: number;
	name: string;
	jobs: number;
	runs: number;
	/** Input cost + job cost. */
	spent: number;
	realized: number;
	expected: number;
	/** Jobs whose expected profit could not be valued (left out of `expected`). */
	unvalued: number;
	/** `expected` ÷ `spent` × 100; null when nothing was spent. */
	marginPct: number | null;
	profitPerSlotDay: number | null;
}

export interface SaleTableRow {
	/** `transaction:<id>` or `contract:<id>`. */
	ref: string;
	kind: 'market' | 'contract';
	at: number;
	typeId: number;
	name: string;
	quantity: number;
	/** After tax and broker fees. */
	netUnitPrice: number;
	/** Average cost of the batches it came from; null when none were tracked. */
	unitCost: number | null;
	/** Over the units that came from tracked batches; null when none did. */
	profit: number | null;
	/** Units without a tracked batch (stock from before tracking). */
	untrackedQty: number;
	/** Where the sold units came from. */
	origin: 'made' | 'bought' | 'mixed' | null;
}

export interface UnsoldTableRow {
	typeId: number;
	name: string;
	quantity: number;
	/** Average cost of the units held. */
	unitCost: number;
	/** Net value of one unit today; null without a price. */
	unitValue: number | null;
	value: number | null;
	gain: number | null;
}

export interface RunningTableRow {
	jobId: number;
	blueprintTypeId: number;
	name: string;
	runs: number;
	owner: string;
	startDate: number;
	endDate: number;
	/** Output of the job when it ends; null when the formula is unknown. */
	output: { typeId: number; name: string; quantity: number } | null;
	/** Output quantity × today's net unit value; null without a price. */
	outputValue: number | null;
}

export interface ProfitsOverviewData {
	period: ProfitPeriod;
	/** Period the tab opens on (`TrackingSettings.defaultPeriod`): links leave it out of the URL. */
	defaultPeriod: ProfitPeriod;
	now: number;
	rebuiltAt: number | null;
	dirty: boolean;
	attention: AttentionItem[];
	kpis: OverviewKpis;
	charts: OverviewCharts;
	reactions: Paged<ReactionTableRow>;
	sales: Paged<SaleTableRow>;
	unsold: Paged<UnsoldTableRow>;
	running: Paged<RunningTableRow>;
}
