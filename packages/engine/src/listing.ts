import { calculateAllocated, type AllocationOptions } from './allocation.ts';
import {
	calculateReaction,
	chainable,
	reprocessable,
	type CalcContext,
	type ReactionResult,
	type ReactionTotals
} from './calculate.ts';
import type { Settings } from './settings.ts';
import type { Reaction, Reactor, Tier } from './types.ts';
import { unrefinable } from './unrefined.ts';

export interface ReactionRow {
	reaction: Reaction;
	single: ReactionResult;
	/** Full chain with the regular reactions. */
	chain: ReactionResult | null;
	/** The full chain with its best unrefined routes; null when no intermediate has one ({@link unrefinable}). */
	unrefined: ReactionResult | null;
	reprocessed: ReactionResult | null;
	/** Best of `single`, {@link chainFor} and `reprocessed`. */
	best: ReactionResult;
}

export type RankKey = 'profitPerSlotDay' | 'profit' | 'marginPct' | 'roiPct' | 'profitPerRun';

/**
 * The full chain of a row where no view is chosen (home boards, `best`): with its unrefined routes when
 * `settings.unrefinedInChains` is `best`, the regular chain otherwise; null without a chain.
 */
export function chainFor(
	row: Pick<ReactionRow, 'chain' | 'unrefined'>,
	settings: Settings
): ReactionResult | null {
	return settings.unrefinedInChains === 'best' ? (row.unrefined ?? row.chain) : row.chain;
}

/**
 * Every variant of each matching reaction and its best one. `allocation` overrides the chain slot
 * allocation (default `ctx.settings.slotAllocation`) and may fix the number of lines. `variants.unrefined`
 * (default true) computes the Using unrefined variant; callers that show no Using unrefined tab and only
 * rank through {@link chainFor} pass `ctx.settings.unrefinedInChains === 'best'` to skip it when unused.
 */
export function listReactions(
	ctx: CalcContext,
	filter: { reactor?: Reactor; tier?: Tier } = {},
	allocation: AllocationOptions = {},
	variants: { unrefined?: boolean } = {}
): ReactionRow[] {
	const withUnrefined = variants.unrefined ?? true;
	return ctx.dataset.reactions
		.filter(
			(r) => (!filter.reactor || r.reactor === filter.reactor) && (!filter.tier || r.tier === filter.tier)
		)
		.map((reaction) => {
			const single = calculateReaction(reaction, ctx, { view: 'single', outputMode: 'product' });
			// Full chain in the visitor's slot allocation (`settings.slotAllocation`) unless overridden.
			const chain = chainable(reaction, ctx.dataset)
				? calculateAllocated(reaction, ctx, { ...allocation, view: 'chain', outputMode: 'product' })
				: null;
			const unrefined =
				!withUnrefined || chain === null || !unrefinable(reaction, ctx.dataset)
					? null
					: calculateAllocated(reaction, ctx, { ...allocation, view: 'unrefined', outputMode: 'product' });
			const reprocessed = reprocessable(reaction, ctx.dataset)
				? calculateReaction(reaction, ctx, { view: 'single', outputMode: 'reprocessed' })
				: null;
			let best = single;
			for (const candidate of [chainFor({ chain, unrefined }, ctx.settings), reprocessed]) {
				const value = candidate?.totals.profitPerSlotDay;
				if (value == null) continue;
				const current = best.totals.profitPerSlotDay;
				if (current === null || value > current) best = candidate!;
			}
			return { reaction, single, chain, unrefined, reprocessed, best };
		});
}

/** Sorts by `best.totals[key]` descending; rows without a value go last. Returns a new array. */
export function rankRows(rows: ReactionRow[], key: RankKey = 'profitPerSlotDay'): ReactionRow[] {
	return [...rows].sort((a, b) => {
		const av = a.best.totals[key as keyof ReactionTotals] as number | null;
		const bv = b.best.totals[key as keyof ReactionTotals] as number | null;
		if (av === null && bv === null) return 0;
		if (av === null) return 1;
		if (bv === null) return -1;
		return bv - av;
	});
}
