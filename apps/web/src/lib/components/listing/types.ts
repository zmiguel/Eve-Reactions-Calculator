import type { Tier } from '@reactions/engine';

/** Which computed result of a reaction a table shows: buy inputs, full chain, using unrefined, reprocessed. */
export type Variant = 'single' | 'chain' | 'unrefined' | 'reprocessed';

/** Per-variant numbers sent to the client (instead of a full `ReactionResult`). */
export interface VariantSummary {
	profitPerSlotDay: number | null;
	/** Profit per cycle (`runs` runs of the top job, plus its chain jobs). */
	profit: number | null;
	marginPct: number | null;
	/** Input purchases including broker fees and shipping. */
	inputCost: number;
	/** Output value after fees, taxes and shipping. */
	outputValue: number;
	jobCost: number;
	runs: number;
	/** Names of the items without a price (only when the profit is `null`). */
	missing: string[];
	/** Optimal slot allocation of a full chain; null otherwise (single slot, buy inputs, reprocess). */
	slots: SlotsSummary | null;
	/** Chain views: materials built with their unrefined reaction instead (absent when none). */
	unrefined?: string[];
}

export interface SlotsSummary {
	lines: number;
	total: number;
	/** Slots per build level, final product first: `[2, 2]` is shown as `2+2`. */
	levels: number[];
	/** Per-reaction runs of each slot (tooltip). */
	reactions: { name: string; runsPerSlot: number[] }[];
}

export interface RowSummary {
	blueprintTypeId: number;
	slug: string;
	name: string;
	productTypeId: number;
	single: VariantSummary;
	chain: VariantSummary | null;
	/** Full chain with its best unrefined routes; null when no intermediate has one. */
	unrefined: VariantSummary | null;
	reprocessed: VariantSummary | null;
}

export interface SectionTab {
	variant: Variant;
	label: string;
}

export interface TierSectionData {
	tier: Tier;
	title: string;
	/** One entry → no tab bar. */
	tabs: SectionTab[];
	rows: RowSummary[];
}

export interface SettingsSummaryData {
	structure: 'athanor' | 'tatara';
	meRig: 'none' | 't1' | 't2';
	teRig: 'none' | 't1' | 't2';
	systemName: string;
	securityBand: string;
	/** Fraction (0.0412 = 4.12 %). */
	costIndex: number;
	costIndexOverridden: boolean;
	inputHub: string;
	outputHub: string;
	inputMethod: 'buy_order' | 'instant' | 'contract';
	outputMethod: 'sell_order' | 'instant' | 'contract';
}

/** One line of a ranked list (home page input prices). */
export interface RankedListItem {
	key: number;
	name: string;
	/** Detail page; the name is plain text without one. */
	href?: string;
	productTypeId: number;
	/** Formatted value shown on the right. */
	value: string;
	/** Full value for the `title` attribute. */
	valueTitle?: string;
	/** Colours the value: green above 0 (good for the visitor), red below. */
	sign?: number;
	/** Secondary line under the name. */
	detail?: string;
}
