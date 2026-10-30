import { describe, expect, it } from 'vitest';
import { planReactions, suggestFillPlan, type PlanInput, type PlanResult } from '../src/planner.ts';
import { makeCtx } from './fixtures/context.ts';

const input = (overrides: Partial<PlanInput> = {}): PlanInput => ({
	ctx: makeCtx(),
	totalSlots: 150,
	targets: [],
	buyInsteadOfBuild: [],
	stock: {},
	ownedFormulas: {},
	dailyVolumes: {},
	...overrides
});

const reaction = (plan: PlanResult, id: number) => plan.reactions.find((r) => r.blueprintTypeId === id)!;

// Every composite reaction of the fixture takes 4,769.28 s per run: ⌊604,800 ÷ 4,769.28⌋ = 126 runs fit
// a 7-day slot.
const RUN = 4769.28;
const CYCLE = 7 * 86400;
const CAESARIUM = 46166;
const PLATINUM = 46177;
const CARBON_POLYMERS = 46167;
const NITROGEN_FUEL = 4051;
// 130 Caesarium Cadmide runs (126 + 4) and 140 Platinum Technite runs (126 + 14), 200 units a run.
const pair = [
	{ blueprintTypeId: CAESARIUM, lines: 0, quantity: 130 * 200 },
	{ blueprintTypeId: PLATINUM, lines: 0, quantity: 140 * 200 }
];

describe('shared slots', () => {
	const own = planReactions(input({ targets: pair }));
	const shared = planReactions(input({ targets: pair, shareSlots: true }));

	it('without sharing each reaction splits its runs evenly over its own slots', () => {
		expect(own.slotsUsed).toBe(4);
		expect(reaction(own, CAESARIUM)).toMatchObject({ slots: 2, runsPerSlot: [65, 65] });
		expect(reaction(own, PLATINUM)).toMatchObject({ slots: 2, runsPerSlot: [70, 70] });
		expect(own.sharedSlots).toEqual([]);
		expect(own.reactions.every((r) => r.sharedRuns === undefined && r.jobSlots === undefined)).toBe(true);
	});

	it('packs the two remainders into one slot, longest job first', () => {
		expect(shared.slotsUsed).toBe(3);
		expect(shared.slotsRemaining).toBe(147);
		// The two full jobs tie on duration: the lower blueprint id takes slot 0.
		expect(reaction(shared, CAESARIUM)).toMatchObject({
			slots: 2,
			runsPerSlot: [126, 4],
			jobSlots: [0, 2],
			sharedRuns: 4
		});
		expect(reaction(shared, PLATINUM)).toMatchObject({
			slots: 2,
			runsPerSlot: [126, 14],
			jobSlots: [1, 2],
			sharedRuns: 14
		});
		expect(shared.sharedSlots).toHaveLength(1);
		const [slot] = shared.sharedSlots;
		expect(slot.slot).toBe(2);
		expect(slot.jobs.map((j) => [j.blueprintTypeId, j.name, j.runs])).toEqual([
			[PLATINUM, 'Platinum Technite', 14],
			[CAESARIUM, 'Caesarium Cadmide', 4]
		]);
		// Platinum Technite runs 14 × 4,769.28 = 66,769.92 s, then Caesarium Cadmide 4 × 4,769.28 = 19,077.12 s.
		expect(slot.jobs[0].startSeconds).toBe(0);
		expect(slot.jobs[0].seconds).toBeCloseTo(14 * RUN, 6);
		expect(slot.jobs[1].startSeconds).toBeCloseTo(14 * RUN, 6);
		expect(slot.jobs[1].seconds).toBeCloseTo(4 * RUN, 6);
		// 604,800 − 18 × 4,769.28 = 518,952.96 s idle.
		expect(slot.idleSeconds).toBeCloseTo(CYCLE - 18 * RUN, 6);
	});

	it('changes slots only: same runs, outputs and job costs; utilisation over fewer slots', () => {
		expect(shared.reactions.map((r) => [r.blueprintTypeId, r.totalRuns, r.jobCost])).toEqual(
			own.reactions.map((r) => [r.blueprintTypeId, r.totalRuns, r.jobCost])
		);
		expect(shared.outputsPerCycle).toEqual(own.outputsPerCycle);
		expect(shared.slotSecondsBusy).toBeCloseTo(own.slotSecondsBusy, 6);
		expect(own.utilisation).toBeCloseTo((270 * RUN) / (4 * CYCLE), 12);
		expect(shared.utilisation).toBeCloseTo((270 * RUN) / (3 * CYCLE), 12);
	});

	it('rounds materials per job: the 126 + 14 split needs one Nitrogen Fuel Block more than 70 + 70', () => {
		// 5 blocks a run × 0.9736: ⌈70 × 4.868⌉ = 341 twice = 682, against ⌈126 × 4.868⌉ = 614 plus
		// ⌈14 × 4.868⌉ = 69 = 683. Every other material rounds to the same total either way.
		const quantities = (plan: PlanResult) =>
			Object.fromEntries(plan.purchasesPerCycle.map((p) => [p.typeId, p.quantity]));
		expect(quantities(own)[NITROGEN_FUEL]).toBe(682);
		expect(quantities(shared)).toEqual({ ...quantities(own), [NITROGEN_FUEL]: 683 });
		const cost = (plan: PlanResult) => {
			const line = plan.purchasesPerCycle.find((p) => p.typeId === NITROGEN_FUEL)!;
			return line.total + line.fees + line.shipping;
		};
		expect(own.totals.profitPerCycle! - shared.totals.profitPerCycle!).toBeCloseTo(
			cost(shared) - cost(own),
			4
		);
	});

	it('gives a remainder no other slot has room for its own slot', () => {
		// 123 Carbon Polymers runs leave 3 runs of idle time: not enough for the 4- or 14-run remainders,
		// which share another slot. 126 + 126 + 123 + (14 + 4): 4 slots.
		const plan = planReactions(
			input({
				targets: [...pair, { blueprintTypeId: CARBON_POLYMERS, lines: 0, quantity: 123 * 200 }],
				shareSlots: true
			})
		);
		expect(plan.slotsUsed).toBe(4);
		expect(reaction(plan, CARBON_POLYMERS)).toMatchObject({ slots: 1, runsPerSlot: [123] });
		expect(reaction(plan, CARBON_POLYMERS).sharedRuns).toBeUndefined();
		expect(plan.sharedSlots.map((s) => s.jobs.map((j) => j.blueprintTypeId))).toEqual([
			[PLATINUM, CAESARIUM]
		]);
	});

	it('puts a capped reaction’s remainder in the slot of its own full job without sharing it', () => {
		// Unrefined Tritanium: 360 s × 0.4416 = 158.976 s a run; 3,804 runs would fit a cycle, but a job
		// takes at most 1,000. 1,100 runs = a 1,000-run job (158,976 s) and a 100-run job (15,897.6 s).
		// Caesarium Cadmide's 126-run job (600,929.28 s) takes slot 0 and has no room for either, so both
		// Tritanium jobs go to slot 1.
		const plan = planReactions(
			input({
				targets: [
					{ blueprintTypeId: 90274, lines: 0, quantity: 1100 * 100 },
					{ blueprintTypeId: CAESARIUM, lines: 0, quantity: 126 * 200 }
				],
				shareSlots: true
			})
		);
		expect(plan.slotsUsed).toBe(2);
		expect(reaction(plan, CAESARIUM)).toMatchObject({ runsPerSlot: [126], jobSlots: [0] });
		expect(reaction(plan, 90274)).toMatchObject({ slots: 2, runsPerSlot: [1000, 100], jobSlots: [1, 1] });
		expect(reaction(plan, 90274).sharedRuns).toBeUndefined();
		expect(plan.sharedSlots).toEqual([]);
		// Both Tritanium jobs run one after another in slot 1: one formula serves them.
		const formulas = (p: PlanResult) =>
			Object.fromEntries(p.formulasToBuy.map((f) => [f.blueprintTypeId, f.count]));
		expect(formulas(plan)).toEqual({ 90274: 1, [CAESARIUM]: 1 });
		const owned = planReactions(
			input({
				targets: [
					{ blueprintTypeId: 90274, lines: 0, quantity: 1100 * 100 },
					{ blueprintTypeId: CAESARIUM, lines: 0, quantity: 126 * 200 }
				],
				shareSlots: true,
				ownedFormulas: { 90274: 1 }
			})
		);
		expect(formulas(owned)).toEqual({ [CAESARIUM]: 1 });
	});

	it('packs the jobs of each start-up cycle', () => {
		// 1 line of Crystalline Carbonide: cycle 1 runs 62 Carbon Polymers and 62 Crystallite Alloy runs
		// (124 ≤ 126: one shared slot); the steady cycle adds the 126-run final job.
		const phases = (shareSlots: boolean) =>
			planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 1 }], shareSlots })).phases.map(
				(p) => [p.label, p.slots]
			);
		expect(phases(false)).toEqual([
			['build_up', 2],
			['steady', 3]
		]);
		expect(phases(true)).toEqual([
			['build_up', 1],
			['steady', 2]
		]);
	});
});

describe('auto-fill with shared slots', () => {
	// The pair fills 4 slots without sharing; sharing frees one.
	const base = (shareSlots: boolean) => input({ totalSlots: 4, targets: pair, shareSlots });
	const linesAdded = (targets: PlanInput['targets']) =>
		targets.filter((t) => t.auto && t.quantity === undefined);

	it('fills the freed slot and the idle time of the shared slot', () => {
		expect(planReactions(base(false)).slotsUsed).toBe(4);
		const without = suggestFillPlan(base(false));
		expect(linesAdded(without.targets)).toEqual([]);

		const fill = suggestFillPlan(base(true));
		expect(fill.targets.slice(0, 2)).toEqual(pair);
		// The shared slot's 518,952.96 s idle fit ⌊518,952.96 ÷ 4,769.28⌋ = 108 runs of either remainder
		// (within 126 − 4 and 126 − 14); Caesarium Cadmide (lower id) goes first: 108 × 200 units. Its
		// 112-run job then leaves 604,800 − 126 × 4,769.28 = 3,870.72 s, less than a run of Platinum Technite.
		expect(fill.targets).toContainEqual({
			blueprintTypeId: CAESARIUM,
			lines: 1,
			quantity: 21_600,
			auto: true
		});
		expect(linesAdded(fill.targets)).toHaveLength(1);
		const plan = planReactions({ ...base(true), targets: fill.targets });
		expect(plan.slotsUsed).toBe(4);
		expect(plan.sharedSlots.map((s) => s.jobs.map((j) => [j.blueprintTypeId, j.runs]))).toEqual([
			[
				[CAESARIUM, 112],
				[PLATINUM, 14]
			]
		]);
		const profit = (b: PlanInput, targets: PlanInput['targets']) =>
			planReactions({ ...b, targets }).totals.profitPerCycle!;
		expect(profit(base(true), fill.targets)).toBeGreaterThan(profit(base(true), pair));
		expect(profit(base(true), fill.targets)).toBeGreaterThan(profit(base(false), without.targets));
	});

	it('never exceeds the slots and is idempotent', () => {
		for (const totalSlots of [3, 4, 10]) {
			const b = input({ totalSlots, targets: pair, shareSlots: true });
			const fill = suggestFillPlan(b);
			expect(planReactions({ ...b, targets: fill.targets }).slotsUsed).toBeLessThanOrEqual(totalSlots);
			expect(suggestFillPlan({ ...b, targets: fill.targets })).toEqual(fill);
		}
	});
});
