import type { Reactor } from '@reactions/engine';

/** The two ways a reactor board can rank: buy every input, or run the full chain. */
export type BuildView = 'single' | 'chain';

/** One final product on a reactor board, with its profit over the recent days. */
export interface BuildItem {
	blueprintTypeId: number;
	slug: string;
	name: string;
	productTypeId: number;
	/** Variant the numbers belong to: `single` on the chain board for reactions without a chain. */
	variant: BuildView;
	/** The chain numbers use unrefined routes (setting on): the link opens the Using unrefined tab. */
	unrefined: boolean;
	/**
	 * The reaction page has a Using unrefined tab. Known only with `unrefinedInChains: best` (the boards
	 * skip that variant otherwise), the only case in which links open on that tab.
	 */
	unrefinable: boolean;
	/** The reaction has a full chain (its page has the chain tabs). */
	chainable: boolean;
	/** Mean profit/slot/day over `days` (= profit at the average prices of those days). */
	average: number;
	/** Days with a complete price and how many of them were profitable. */
	days: number;
	profitableDays: number;
	/** Profit/slot/day at the current prices; `null` when a price is missing. */
	now: number | null;
	/** Slots the region's trade absorbs; `null` without market statistics. */
	slots: number | null;
	/** Units one slot makes per day. */
	perSlotDay: number;
	/** Units traded per day in the output hub's region (lower of the 30-day and 7-day averages); `null` without statistics. */
	volume: number | null;
}

export interface BoardList {
	items: BuildItem[];
	/** Products profitable on most days that one slot would flood (left out). */
	thin: number;
}

/** Best final products of one reactor; `chain` only when one of them has a full chain. */
export interface ReactorBoard {
	reactor: Reactor;
	single: BoardList;
	chain: BoardList | null;
}

/** A raw input whose regional average price moved: last 5 days against 30 days. */
export interface InputMove {
	typeId: number;
	name: string;
	price5d: number;
	price30d: number;
	pct: number;
	/** Reactors whose final products use it (directly or through their chain). */
	reactors: Reactor[];
}

/** The recent days the boards average over. */
export interface HomeWindow {
	from: string;
	to: string;
	days: number;
	/** Some prices are the region's ESI average instead of the hub's daily average. */
	approximate: boolean;
}
