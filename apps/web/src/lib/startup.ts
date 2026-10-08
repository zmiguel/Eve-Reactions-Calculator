import type { PlanItem, PlanPhase, PlanReaction, PlanStartup } from '@reactions/engine';
import { formatIsk, formatNumber } from '$lib/format';

const list = (items: PlanItem[]) => items.map((i) => `${formatNumber(i.quantity)} ${i.name}`).join(', ');

/** Heading of one start-up or steady phase (`PlanPhase.cycle` 0 is the one-time step 0). */
export function phaseTitle(phase: Pick<PlanPhase, 'cycle' | 'label'>): string {
	if (phase.label === 'step_0') return 'Step 0, once before cycle 1';
	if (phase.label === 'steady') return `Cycle ${phase.cycle} onward, every cycle`;
	return `Cycle ${phase.cycle}, start-up`;
}

/**
 * One line on how the plan starts when a step 0 was an option: which start-up is used, both initial
 * investments and what step 0 changes; `null` when no step 0 applies (every start-up buys in full).
 * Without a price for every start-up purchase the investments are not compared (the plan buys first).
 */
export function startupSummary(startup: PlanStartup, names: ReadonlyMap<number, string>): string | null {
	const s0 = startup.step0;
	if (!s0) return null;
	const jobs = s0.blueprintTypeIds.map((id) => names.get(id) ?? `Reaction ${id}`).join(', ');
	if (startup.buy.initialInvestment === null || s0.initialInvestment === null)
		return `Cycle 1 buys ${list(s0.saves)}. A step 0 running ${jobs} once could make it instead; some start-up purchases have no price, so the two are not compared.`;
	const buy = formatIsk(startup.buy.initialInvestment);
	const step0 = formatIsk(s0.initialInvestment);
	if (startup.mode === 'buy')
		return `Cycle 1 buys ${list(s0.saves)}: initial investment ${buy}. A step 0 running ${jobs} once to make it would need ${step0} and one more cycle.`;
	const stock = s0.stock.length > 0 ? ` Step 0 also leaves ${list(s0.stock)} in stock.` : '';
	return `Step 0 runs ${jobs} once so cycle 1 uses its reprocessed ${list(s0.saves)} instead of buying it: initial investment ${step0} instead of ${buy}, one cycle longer.${stock}`;
}

/** One reprocessed byproduct of an unrefined job, as displayed. */
export interface UnrefinedByproductView {
	name: string;
	/** Units per cycle. */
	quantity: number;
	/** Units replacing purchases of the jobs in `usedBy`. */
	used: number;
	/** Jobs buying less of it; `fromCycle` is shown once for the group when every job shares it. */
	usedBy: { name: string; fromCycle: number }[];
	sharedFromCycle: number | null;
	sold: number;
}

/** What one unrefined job of a plan does, for the planner's "Unrefined routes" note. */
export interface UnrefinedRouteView {
	name: string;
	/** Regular reactions it replaces. */
	replaces: string[];
	/** Runs once in the chosen step 0. */
	step0: boolean;
	byproducts: UnrefinedByproductView[];
}

/**
 * What one unrefined job of a plan does: the reactions it replaces and, per reprocessed byproduct, the
 * jobs that buy less of it from which cycle, and what is sold.
 */
export function unrefinedRoute(
	r: PlanReaction,
	names: ReadonlyMap<number, string>,
	startup: PlanStartup
): UnrefinedRouteView {
	return {
		name: r.name,
		replaces: r.reprocess!.replaces.map((x) => x.regularName),
		step0: startup.mode === 'step0' && startup.step0!.blueprintTypeIds.includes(r.blueprintTypeId),
		byproducts: r.reprocess!.byproducts.map((b) => {
			const usedBy = b.usedBy.map((u) => ({
				name: names.get(u.blueprintTypeId) ?? `Reaction ${u.blueprintTypeId}`,
				fromCycle: u.fromCycle
			}));
			const cycles = new Set(usedBy.map((u) => u.fromCycle));
			return {
				name: b.name,
				quantity: b.quantity,
				used: b.used,
				usedBy,
				sharedFromCycle: cycles.size === 1 ? usedBy[0].fromCycle : null,
				sold: b.sold
			};
		})
	};
}
