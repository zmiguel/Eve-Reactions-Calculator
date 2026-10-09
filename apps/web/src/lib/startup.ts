import type { PlanItem, PlanPhase, PlanStartup } from '@reactions/engine';
import { formatIsk, formatNumber } from '$lib/format';

const list = (items: PlanItem[]) => items.map((i) => `${formatNumber(i.quantity)} ${i.name}`).join(', ');

/** Heading of one start-up or steady phase (`PlanPhase.cycle` 0 is the one-time step 0). */
export function phaseTitle(phase: Pick<PlanPhase, 'cycle' | 'label'>): string {
	if (phase.label === 'step_0') return 'Step 0, once before cycle 1';
	if (phase.label === 'steady') return `Cycle ${phase.cycle} onward, every cycle`;
	return `Cycle ${phase.cycle}, start-up`;
}

/** How a plan starts, as a short heading and one sentence per point. */
export interface StartupNote {
	/** The decision ("No step 0", "Step 0, once before cycle 1"); null when there was none to make. */
	title: string | null;
	points: string[];
}

/**
 * How the plan starts, in short points: the decision first (step 0 or not), what step 0 does or why it was
 * not used, and which reprocessing byproducts later cycles reuse instead of buying. `null` when nothing is
 * reprocessed for reuse and no step 0 was possible.
 */
export function startupSummary(startup: PlanStartup, names: ReadonlyMap<number, string>): StartupNote | null {
	const s0 = startup.step0;
	if (!s0 && startup.reused.length === 0) return null;
	const reuse =
		startup.reused.length === 0
			? []
			: [
					`From the cycle after their first run, their reprocessing byproducts replace purchases: ${list(startup.reused)} per cycle. Until then, the start-up buys these.`
				];
	if (!s0)
		return {
			title: null,
			points: ['Every unrefined reaction runs each cycle, like the other reactions.', ...reuse]
		};
	const jobNames = s0.blueprintTypeIds.map((id) => names.get(id) ?? `Reaction ${id}`);
	const jobs = jobNames.join(' and ');
	const buy = formatIsk(startup.buy.initialInvestment);
	const step0 = formatIsk(s0.initialInvestment);
	if (startup.mode === 'step0')
		return {
			title: 'Step 0, once before cycle 1',
			points: [
				`${jobs} ${jobNames.length === 1 ? 'runs' : 'run'} one extra time before cycle 1, so cycle 1 already has ${list(s0.saves)} from reprocessing instead of buying it.`,
				`Initial investment ${step0} instead of ${buy}, but one more cycle.`,
				...(s0.stock.length > 0 ? [`Step 0 also leaves ${list(s0.stock)} in stock.`] : []),
				'From cycle 1, every unrefined reaction runs each cycle, like the other reactions.',
				...reuse
			]
		};
	const why =
		startup.buy.initialInvestment === null || s0.initialInvestment === null
			? 'Not compared: some start-up purchases have no price.'
			: `Not used: it would raise the initial investment from ${buy} to ${step0} and add a cycle.`;
	return {
		title: 'No step 0',
		points: [
			'Every unrefined reaction runs each cycle, like the other reactions.',
			...reuse,
			`A step 0 would run ${jobs} once before cycle 1, so cycle 1 already has ${list(s0.saves)}. ${why}`
		]
	};
}
