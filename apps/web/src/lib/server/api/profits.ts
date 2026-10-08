import {
	calculateReaction,
	listReactions,
	type AllocationOptions,
	type CalcContext,
	type ReactionResult,
	type Reactor,
	type Tier
} from '@reactions/engine';
import type { z } from 'zod';
import { variantOf } from '../listing.ts';
import type { ProfitRow } from './schemas.ts';

export type ProfitView = 'single' | 'chain' | 'unrefined' | 'best';
type Row = z.output<typeof ProfitRow>;

/**
 * The variant of each matching reaction that `view` asks for: `chain` falls back to single without a
 * chain, `unrefined` to the chain without an unrefined route; `best` picks among single, the full chain
 * (with its unrefined routes when `unrefinedInChains` is `best`, see `chainFor`) and reprocessed.
 */
export function profitResults(
	ctx: CalcContext,
	filter: { reactor?: Reactor; tier?: Tier },
	view: ProfitView,
	allocation: AllocationOptions
): ReactionResult[] {
	if (view === 'single') {
		return ctx.dataset.reactions
			.filter(
				(r) => (!filter.reactor || r.reactor === filter.reactor) && (!filter.tier || r.tier === filter.tier)
			)
			.map((r) => calculateReaction(r, ctx, { view: 'single', outputMode: 'product' }));
	}
	return listReactions(ctx, filter, allocation).map((row) =>
		view === 'chain'
			? (row.chain ?? row.single)
			: view === 'unrefined'
				? (row.unrefined ?? row.chain ?? row.single)
				: row.best
	);
}

/** One `/profits` row; `withAllocation` adds `slotsUsed`/`lines` (null without an optimal allocation). */
export function profitRow(result: ReactionResult, withAllocation: boolean): Row {
	const t = result.totals;
	const row: Row = {
		slug: result.slug,
		name: result.name,
		reactor: result.reactor,
		tier: result.tier,
		view: variantOf(result),
		runs: result.runs,
		inputCost: t.inputCost,
		outputValue: t.outputValue,
		jobCost: t.jobCost,
		fees: t.inputFees + t.outputFees,
		shipping: t.inputShipping + t.outputShipping,
		profit: t.profit,
		marginPct: t.marginPct,
		profitPerSlotDay: t.profitPerSlotDay
	};
	if (withAllocation) {
		row.slotsUsed = result.allocation?.slotsUsed ?? null;
		row.lines = result.allocation?.lines ?? null;
	}
	return row;
}

/** Highest profit per slot-day first; rows without one keep their order at the end. */
export function sortRows(rows: Row[]): Row[] {
	return [...rows].sort((a, b) => {
		if (a.profitPerSlotDay === null) return b.profitPerSlotDay === null ? 0 : 1;
		if (b.profitPerSlotDay === null) return -1;
		return b.profitPerSlotDay - a.profitPerSlotDay;
	});
}
