import {
	calculateReaction,
	chainable,
	type CalcContext,
	type CalcOptions,
	type ReactionResult
} from './calculate.ts';
import { planReactions, type PlanPhase, type PlanResult, type PlanStartup } from './planner.ts';
import type { SlotAllocation } from './settings.ts';
import type { Reaction } from './types.ts';
import { chooseUnrefined, memoChoice } from './unrefined.ts';

/** Candidates scoring within this fraction of the best count as equal; the fewest lines win. */
export const LINE_TIE_TOLERANCE = 0.005;

export interface LineCandidate {
	lines: number;
	slotsUsed: number;
	/** `profitPerCycle ÷ (slotsUsed × cycleDays)`; null when a price is missing. */
	profitPerSlotDay: number | null;
	utilisation: number;
	/**
	 * Ranking value: `(profitPerCycle + surplus value) ÷ (slotsUsed × cycleDays)`, or `utilisation` when a
	 * price is missing.
	 */
	score: number;
}

export interface ChainLines {
	/** Chosen number of final-product lines (slots of the top reaction running `runsPerCycle` runs). */
	lines: number;
	/** Steady-state plan of `lines` lines; its slot budget is exactly its own slot count. */
	plan: PlanResult;
	profitPerCycle: number | null;
	profitPerSlotDay: number | null;
	utilisation: number;
	slotsUsed: number;
	/** Every evaluated line count, ascending. */
	candidates: LineCandidate[];
	/** Product type ids the lines build through their unrefined reaction (the given or chosen set). */
	viaUnrefined: readonly number[];
}

export interface LineOptions {
	/** Highest line count tried (default `ctx.settings.maxParallelLines`). */
	maxLines?: number;
	/** Fixed line count instead of optimising (e.g. to price the same allocation with other prices). */
	lines?: number;
	/**
	 * Types built through their unrefined reaction. Default: with `unrefined`, the combination
	 * {@link chooseUnrefined} picks with this allocation's profit per slot-day; otherwise none.
	 */
	viaUnrefined?: readonly number[];
	/** Use the best unrefined routes (`calculateAllocated`: the `unrefined` view). */
	unrefined?: boolean;
}

/**
 * Optimal slot allocation of a reaction's full chain: evaluates 1…`maxLines` parallel lines with the
 * planner (shared intermediates aggregated, `⌈runs ÷ runsPerCycle⌉` slots per reaction) and picks the
 * highest profit per allocated slot-day, or the highest slot utilisation when a price is missing.
 * Candidates within {@link LINE_TIE_TOLERANCE} of the best prefer fewer lines.
 *
 * The ranking adds the surplus intermediates (at the output price) to the profit: surplus carries over
 * into the next cycle, so a line count is not better merely because it rounds intermediate runs more
 * tightly (without this, thin-margin chains would pick 6–8 lines to save a fraction of one run).
 * A reaction that is not chainable always gets one line.
 */
export function optimizeChainLines(reaction: Reaction, ctx: CalcContext, opts: LineOptions = {}): ChainLines {
	const maxLines = opts.maxLines ?? ctx.settings.maxParallelLines;
	const key = `optimal:${reaction.blueprintTypeId}:${opts.lines ?? ''}:${maxLines}`;
	const lineOpts = { ...opts, maxLines };
	const viaUnrefined =
		opts.viaUnrefined ??
		(opts.unrefined
			? memoChoice(ctx, key, () =>
					chooseUnrefined(reaction, ctx, (via) => {
						const c = bestLines(reaction, ctx, lineOpts, via);
						const top = c.plan.reactions.find((r) => r.blueprintTypeId === reaction.blueprintTypeId);
						return {
							profit: c.profitPerCycle,
							profitPerSlotDay: c.profitPerSlotDay,
							finalUnits: (top?.totalRuns ?? 0) * reaction.product.quantity
						};
					})
				)
			: []);
	return { ...bestLines(reaction, ctx, lineOpts, viaUnrefined), viaUnrefined };
}

function bestLines(
	reaction: Reaction,
	ctx: CalcContext,
	opts: LineOptions & { maxLines: number },
	viaUnrefined: readonly number[]
): Omit<ChainLines, 'viaUnrefined'> {
	const cycleDays = ctx.settings.cycleDays;
	const counts =
		opts.lines !== undefined
			? [Math.max(1, Math.floor(opts.lines))]
			: chainable(reaction, ctx.dataset)
				? Array.from({ length: Math.max(1, Math.floor(opts.maxLines)) }, (_, i) => i + 1)
				: [1];
	const evaluated = counts.map((lines) => {
		const plan = planReactions({
			ctx,
			totalSlots: Number.POSITIVE_INFINITY,
			targets: [{ blueprintTypeId: reaction.blueprintTypeId, lines }],
			buyInsteadOfBuild: [],
			stock: {},
			ownedFormulas: {},
			dailyVolumes: {},
			viaUnrefined
		});
		const profitPerCycle = plan.totals.profitPerCycle;
		const slotDays = plan.slotsUsed * cycleDays;
		const surplusValue = plan.surplusPerCycle.reduce((acc, s) => acc + s.total, 0);
		return {
			lines,
			plan: { ...plan, slotsRemaining: 0 },
			profitPerCycle,
			profitPerSlotDay: profitPerCycle === null ? null : profitPerCycle / slotDays,
			utilisation: plan.utilisation,
			slotsUsed: plan.slotsUsed,
			score: profitPerCycle === null ? plan.utilisation : (profitPerCycle + surplusValue) / slotDays
		};
	});
	// Missing prices are the same types for every line count: all candidates are scored alike.
	const best = Math.max(...evaluated.map((c) => c.score));
	const chosen = evaluated.find((c) => c.score >= best - Math.abs(best) * LINE_TIE_TOLERANCE)!;
	return {
		...chosen,
		candidates: evaluated.map((c) => ({
			lines: c.lines,
			slotsUsed: c.slotsUsed,
			profitPerSlotDay: c.profitPerSlotDay,
			utilisation: c.utilisation,
			score: c.score
		}))
	};
}

export interface AllocationReaction {
	blueprintTypeId: number;
	name: string;
	/** 0 = final product. */
	depth: number;
	slots: number;
	runsPerSlot: number[];
	runTimeSeconds: number;
	/** Duration of each slot's job (runs × run time). */
	slotDurations: number[];
	/** First cycle the reaction runs in (1 = build-up start). */
	firstCycle: number;
}

/** Slot plan behind an optimal-allocation chain result. */
export interface ChainAllocation {
	mode: 'optimal';
	lines: number;
	slotsUsed: number;
	cycleDays: number;
	/** Busy share of the allocated slot time in a steady cycle. */
	utilisation: number;
	slotSecondsBusy: number;
	reactions: AllocationReaction[];
	/** Start-up cycles (step 0 when chosen, build-up), then the steady one; `slots` = slots busy in that cycle. */
	phases: PlanPhase[];
	/** Build-up purchases and job costs up to and including the first steady cycle (formulas excluded); null when a purchase has no price. */
	initialInvestment: number | null;
	/** The plan's start-up choice; option investments exclude formulas, like `initialInvestment`. */
	startup: PlanStartup;
}

export interface AllocationOptions extends LineOptions {
	/** Default: `ctx.settings.slotAllocation`. */
	slotAllocation?: SlotAllocation;
}

/**
 * `calculateReaction` honouring the chain slot allocation. `single` (and every non-chain view) is
 * `calculateReaction` unchanged: one line whose jobs run one after another, profit per slot-day over
 * their summed duration. `optimal` runs {@link optimizeChainLines} and prices one steady cycle of the
 * chosen lines with every job split into its slots (`opts.runs` is ignored); profit per slot-day is
 * profit per cycle ÷ (slots used × cycle days) and `allocation` describes the slots.
 */
export function calculateAllocated(
	reaction: Reaction,
	ctx: CalcContext,
	opts: CalcOptions & AllocationOptions
): ReactionResult {
	const mode = opts.slotAllocation ?? ctx.settings.slotAllocation;
	if (opts.view === 'single' || mode === 'single') return calculateReaction(reaction, ctx, opts);

	const { lines, plan, viaUnrefined } = optimizeChainLines(reaction, ctx, {
		...opts,
		unrefined: opts.view === 'unrefined'
	});
	const top = plan.reactions.find((r) => r.blueprintTypeId === reaction.blueprintTypeId)!;
	const result = calculateReaction(reaction, ctx, {
		view: opts.view,
		outputMode: opts.outputMode,
		runs: top.totalRuns,
		splitJobs: true,
		viaUnrefined
	});
	const cycleDays = ctx.settings.cycleDays;
	const profit = result.totals.profit;
	return {
		...result,
		warnings: [...new Set([...result.warnings, ...plan.warnings])],
		totals: {
			...result.totals,
			profitPerSlotDay: profit === null ? null : profit / (plan.slotsUsed * cycleDays)
		},
		allocation: {
			mode: 'optimal',
			lines,
			slotsUsed: plan.slotsUsed,
			cycleDays,
			utilisation: plan.utilisation,
			slotSecondsBusy: plan.slotSecondsBusy,
			reactions: plan.reactions.map((r) => ({
				blueprintTypeId: r.blueprintTypeId,
				name: r.name,
				depth: r.depth,
				slots: r.slots,
				runsPerSlot: r.runsPerSlot,
				runTimeSeconds: r.runTimeSeconds,
				slotDurations: r.runsPerSlot.map((runs) => runs * r.runTimeSeconds),
				firstCycle: r.firstCycle
			})),
			phases: plan.phases,
			initialInvestment: plan.initialPurchases.some((i) => i.unitPrice === null)
				? null
				: plan.totals.initialInvestment - plan.totals.formulaCost,
			startup: {
				...plan.startup,
				buy: {
					...plan.startup.buy,
					initialInvestment: withoutFormulas(plan.startup.buy.initialInvestment, plan.totals.formulaCost)
				},
				step0: plan.startup.step0 && {
					...plan.startup.step0,
					initialInvestment: withoutFormulas(plan.startup.step0.initialInvestment, plan.totals.formulaCost)
				}
			}
		}
	};
}

/** A start-up investment without formulas (chain allocations price only the jobs); `null` stays unknown. */
function withoutFormulas(investment: number | null, formulaCost: number): number | null {
	return investment === null ? null : investment - formulaCost;
}
