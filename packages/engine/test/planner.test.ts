import { describe, expect, it } from 'vitest';
import { distributeRuns, splitIntoSlots } from '../src/formulas.ts';
import {
	FILL_TIERS,
	planReactions,
	suggestFill,
	suggestFillPlan,
	type PlanInput,
	type PlanResult
} from '../src/planner.ts';
import { makeCtx } from './fixtures/context.ts';
import { jitaPrices, priceBook } from './fixtures/dataset.ts';

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

describe('slot allocation (spreadsheet parity)', () => {
	it('1 line of Crystalline Carbonide uses 3 slots', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 1 }] }));
		expect(plan.slotsUsed).toBe(3);
		expect(plan.slotsRemaining).toBe(147);
		expect(reaction(plan, 46205)).toMatchObject({ depth: 0, totalRuns: 126, slots: 1, firstCycle: 2 });
		expect(reaction(plan, 46169)).toMatchObject({ depth: 1, totalRuns: 62, slots: 1, firstCycle: 1 });
	});

	it('2 lines of Crystalline Carbonide use 4 slots', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 2 }] }));
		expect(plan.slotsUsed).toBe(4);
		expect(reaction(plan, 46205)).toMatchObject({ totalRuns: 252, slots: 2, runsPerSlot: [126, 126] });
		expect(reaction(plan, 46167)).toMatchObject({ totalRuns: 123, slots: 1 });
	});

	it('distributes runs evenly with the remainder on the first jobs', () => {
		expect(distributeRuns(10, 3)).toEqual([4, 3, 3]);
		expect(distributeRuns(9, 3)).toEqual([3, 3, 3]);
		expect(splitIntoSlots(252, 126)).toEqual([126, 126]);
		expect(splitIntoSlots(127, 126)).toEqual([64, 63]);
	});

	it('reports run time, job cost and slot utilisation', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 2 }] }));
		expect(reaction(plan, 46167).runTimeSeconds).toBeCloseTo(4769.28, 9);
		expect(reaction(plan, 46205).jobCost).toBeGreaterThan(0);
		expect(plan.slotSecondsBusy).toBeCloseTo((252 + 123 + 123) * 4769.28, 6);
		expect(plan.utilisation).toBeCloseTo(((252 + 123 + 123) * 4769.28) / (4 * 7 * 86400), 12);
		expect(plan.totals.jobCostPerCycle).toBeCloseTo(
			plan.reactions.reduce((acc, r) => acc + r.jobCost, 0),
			6
		);
	});
});

describe('shared intermediates', () => {
	it('aggregates Carbon Polymers demand across Crystalline Carbonide and Fullerides', () => {
		const plan = planReactions(
			input({
				targets: [
					{ blueprintTypeId: 46205, lines: 1 },
					{ blueprintTypeId: 46209, lines: 1 }
				]
			})
		);
		expect(plan.reactions.filter((r) => r.blueprintTypeId === 46167)).toHaveLength(1);
		expect(reaction(plan, 46167)).toMatchObject({ totalRuns: Math.ceil((2 * 12268) / 200), slots: 1 });
		expect(plan.surplusPerCycle.find((s) => s.typeId === 16659)?.quantity).toBe(123 * 200 - 2 * 12268);
	});

	it('buys products listed in buyInsteadOfBuild', () => {
		const plan = planReactions(
			input({ targets: [{ blueprintTypeId: 46205, lines: 1 }], buyInsteadOfBuild: [16659] })
		);
		expect(plan.reactions.map((r) => r.blueprintTypeId).sort()).toEqual([46169, 46205]);
		expect(plan.purchasesPerCycle.find((p) => p.typeId === 16659)?.quantity).toBe(12268);
	});
});

describe('phases', () => {
	it('depth 1 chain: build-up then steady, each with its purchases and job cost', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 1 }] }));
		expect(plan.maxDepth).toBe(1);
		expect(plan.phases).toMatchObject([
			{ cycle: 1, label: 'build_up', blueprintTypeIds: [46167, 46169], slots: 2 },
			{ cycle: 2, label: 'steady', blueprintTypeIds: [46205, 46167, 46169], slots: 3 }
		]);
		const [buildUp, steady] = plan.phases;
		expect(buildUp.purchases.map((p) => p.typeId).sort((a, b) => a - b)).toEqual([
			4247, 16633, 16636, 16640, 16643
		]);
		expect(steady.purchases.map((p) => [p.typeId, p.quantity])).toEqual(
			plan.purchasesPerCycle.map((p) => [p.typeId, p.quantity])
		);
		expect(buildUp.jobCost).toBeCloseTo(reaction(plan, 46167).jobCost + reaction(plan, 46169).jobCost, 6);
		const cost = (items: { total: number; fees: number; shipping: number }[]) =>
			items.reduce((a, i) => a + i.total + i.fees + i.shipping, 0);
		expect(cost(plan.initialPurchases)).toBeCloseTo(cost(buildUp.purchases) + cost(steady.purchases), 4);
		expect(plan.totals.initialInvestment).toBeCloseTo(
			cost(plan.initialPurchases) + buildUp.jobCost + steady.jobCost + plan.totals.formulaCost,
			4
		);
		expect(plan.startup).toMatchObject({ mode: 'buy', step0: null, buy: { cycles: 2 } });
		expect(plan.startup.buy.initialInvestment).toBe(plan.totals.initialInvestment);
	});

	it('phase slots count every slot of the reactions running in that cycle', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 2 }] }));
		expect(plan.phases.map((p) => [p.label, p.slots])).toEqual([
			['build_up', 2],
			['steady', 4]
		]);
	});

	it('Strong booster chain has three phases', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46235, lines: 1 }] }));
		expect(plan.maxDepth).toBe(2);
		expect(plan.phases.map((p) => [p.cycle, p.label, [...p.blueprintTypeIds].sort()])).toEqual([
			[1, 'build_up', [46230, 46231]],
			[2, 'build_up', [46225, 46230, 46231, 46251]],
			[3, 'steady', [46225, 46230, 46231, 46235, 46251]]
		]);
		expect(reaction(plan, 46230).firstCycle).toBe(1);
		expect(reaction(plan, 46235).firstCycle).toBe(3);
	});
});

describe('purchases and investment', () => {
	it('initial purchases cover every cycle up to the first steady one, minus stock', () => {
		const base = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 1 }] }));
		const cobalt = base.purchasesPerCycle.find((p) => p.typeId === 16640)!;
		expect(base.initialPurchases.find((p) => p.typeId === 16640)?.quantity).toBe(cobalt.quantity * 2);
		const topFuel = 614;
		const fuel = base.purchasesPerCycle.find((p) => p.typeId === 4247)!;
		expect(base.initialPurchases.find((p) => p.typeId === 4247)?.quantity).toBe(fuel.quantity * 2 - topFuel);

		const stocked = planReactions(
			input({ targets: [{ blueprintTypeId: 46205, lines: 1 }], stock: { 16640: 1000, 16643: 1e9 } })
		);
		expect(stocked.initialPurchases.find((p) => p.typeId === 16640)?.quantity).toBe(
			cobalt.quantity * 2 - 1000
		);
		expect(stocked.initialPurchases.find((p) => p.typeId === 16643)).toBeUndefined();
		expect(stocked.purchasesPerCycle).toEqual(base.purchasesPerCycle);
		expect(stocked.totals.recurringInvestment).toBe(base.totals.recurringInvestment);
		expect(stocked.totals.initialInvestment).toBeLessThan(base.totals.initialInvestment);
	});

	it('profit per cycle = output net − recurring investment', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 1 }] }));
		const out = plan.outputsPerCycle[0];
		expect(out).toMatchObject({ typeId: 16670, quantity: 126 * 10000 });
		expect(plan.totals.outputNetPerCycle).toBeCloseTo(out.total - out.fees - out.shipping, 6);
		expect(plan.totals.profitPerCycle).toBeCloseTo(
			plan.totals.outputNetPerCycle - plan.totals.recurringInvestment,
			6
		);
		expect(plan.totals.profitPerDay).toBeCloseTo(plan.totals.profitPerCycle! / 7, 6);
		expect(plan.slotsUsed).toBeGreaterThan(1);
		expect(plan.totals.profitPerSlotDay).toBeCloseTo(plan.totals.profitPerCycle! / (plan.slotsUsed * 7), 6);
		expect(plan.totals.marginPct).toBeCloseTo((plan.totals.profitPerCycle! / out.total) * 100, 6);
	});

	it('null profit when a sold output has no price', () => {
		const prices = { ...jitaPrices, 16670: { buy: null, sell: null } };
		const plan = planReactions(
			input({
				ctx: makeCtx({ inputPrices: priceBook({ jita: prices }) }),
				targets: [{ blueprintTypeId: 46205, lines: 1 }]
			})
		);
		expect(plan.missingPrices).toEqual([16670]);
		expect(plan.totals.profitPerCycle).toBeNull();
		expect(plan.totals.profitPerDay).toBeNull();
		expect(plan.totals.profitPerSlotDay).toBeNull();
	});

	it('daily volume share', () => {
		const plan = planReactions(
			input({ targets: [{ blueprintTypeId: 46205, lines: 1 }], dailyVolumes: { 16670: 900_000 } })
		);
		expect(plan.outputsPerCycle[0].dailyVolumeSharePct).toBeCloseTo((1_260_000 / 7 / 900_000) * 100, 8);
	});
});

describe('formulas to buy', () => {
	it('owned formulas reduce the count; fully owned reactions disappear', () => {
		const plan = planReactions(
			input({ targets: [{ blueprintTypeId: 46205, lines: 2 }], ownedFormulas: { 46205: 1, 46167: 3 } })
		);
		expect(plan.formulasToBuy).toEqual([
			{ blueprintTypeId: 46205, count: 1, unitPrice: 22_000_000 },
			{ blueprintTypeId: 46169, count: 1, unitPrice: 22_000_000 }
		]);
	});
});

describe('slot limits', () => {
	it('warns when the plan needs more slots than available', () => {
		const plan = planReactions(input({ totalSlots: 3, targets: [{ blueprintTypeId: 46205, lines: 2 }] }));
		expect(plan.warnings).toContain('SLOTS_EXCEEDED');
		expect(plan.slotsRemaining).toBe(0);
		expect(
			planReactions(input({ totalSlots: 4, targets: [{ blueprintTypeId: 46205, lines: 2 }] })).warnings
		).not.toContain('SLOTS_EXCEEDED');
	});

	it('suggestFill adds profitable lines without exceeding the slots', () => {
		for (const totalSlots of [1, 5, 20]) {
			const base = input({ totalSlots });
			const targets = suggestFill(base);
			const plan = planReactions({ ...base, targets });
			expect(plan.slotsUsed).toBeLessThanOrEqual(totalSlots);
			expect(targets.length).toBeGreaterThan(0);
			expect(plan.totals.profitPerCycle).toBeGreaterThan(0);
		}
	});

	it('suggestFill keeps existing targets and returns them unchanged when already full', () => {
		const base = input({ totalSlots: 3, targets: [{ blueprintTypeId: 46205, lines: 1 }] });
		expect(suggestFill(base)).toEqual([{ blueprintTypeId: 46205, lines: 1 }]);
	});
});

describe('quantity targets', () => {
	it('35,280,000 Crystalline Carbonide: 3528 runs in 28 final slots, 56 slots with intermediates', () => {
		const plan = planReactions(
			input({ totalSlots: 1000, targets: [{ blueprintTypeId: 46205, lines: 0, quantity: 35_280_000 }] })
		);
		expect(reaction(plan, 46205)).toMatchObject({ totalRuns: 3528, slots: 28 });
		expect(reaction(plan, 46205).runsPerSlot.every((r) => r === 126)).toBe(true);
		// Each 126-run job needs 12,268 of each intermediate = 61.34 runs: one 122/123-run slot feeds two.
		expect(reaction(plan, 46167)).toMatchObject({ totalRuns: 1718, slots: 14 });
		expect(reaction(plan, 46169)).toMatchObject({ totalRuns: 1718, slots: 14 });
		expect(plan.slotsUsed).toBe(56);
		expect(plan.phases.map((p) => p.slots)).toEqual([28, 56]);
		expect(plan.outputsPerCycle.map((o) => [o.typeId, o.quantity])).toEqual([[16670, 35_280_000]]);
		expect(plan.surplusPerCycle.find((s) => s.typeId === 16670)).toBeUndefined();
	});

	it('never under-produces and reports the excess as surplus', () => {
		for (const quantity of [1, 9_999, 10_001, 1_260_000, 35_280_001]) {
			const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 0, quantity }] }));
			const runs = reaction(plan, 46205).totalRuns;
			expect(runs).toBe(Math.ceil(quantity / 10_000));
			expect(runs * 10_000).toBeGreaterThanOrEqual(quantity);
			expect(plan.outputsPerCycle[0].quantity).toBe(quantity);
			const surplus = plan.surplusPerCycle.find((s) => s.typeId === 16670)?.quantity ?? 0;
			expect(surplus).toBe(runs * 10_000 - quantity);
		}
	});

	it('splits runs into as few slots as the cycle allows, without full-line rounding', () => {
		const plan = planReactions(
			input({ targets: [{ blueprintTypeId: 46205, lines: 0, quantity: 1_270_000 }] })
		);
		expect(reaction(plan, 46205)).toMatchObject({ totalRuns: 127, slots: 2, runsPerSlot: [64, 63] });
	});

	it('accepts intermediates as targets and ignores lines when a quantity is set', () => {
		const plan = planReactions(
			input({ targets: [{ blueprintTypeId: 46167, lines: 99, quantity: 1_000_000 }] })
		);
		expect(plan.reactions).toHaveLength(1);
		expect(reaction(plan, 46167)).toMatchObject({ depth: 0, totalRuns: 5000, slots: 40 });
		expect(plan.outputsPerCycle[0]).toMatchObject({ typeId: 16659, quantity: 1_000_000 });
	});

	it('skips non-positive quantities', () => {
		const plan = planReactions(input({ targets: [{ blueprintTypeId: 46205, lines: 2, quantity: 0 }] }));
		expect(plan.reactions).toEqual([]);
	});
});

describe('suggestFill options', () => {
	const products = (volume: number) =>
		Object.fromEntries(makeCtx().dataset.reactions.map((r) => [r.product.typeId, volume]));

	it('without options behaves as before (best full chain repeated while it fits)', () => {
		const base = input({ totalSlots: 150 });
		expect(suggestFill(base)).toEqual(suggestFill(base, {}));
		expect(suggestFill(base)).toEqual([{ blueprintTypeId: 46157, lines: 150 }]);
		expect(suggestFillPlan(base)).toEqual({
			targets: [{ blueprintTypeId: 46157, lines: 150 }],
			buyInsteadOfBuild: []
		});
	});

	it('caps each product at a share of its daily volume and spreads lines across products', () => {
		const base = input({ totalSlots: 150, dailyVolumes: products(1_000_000) });
		const targets = suggestFill(base, { maxVolumeSharePct: 10 });
		const plan = planReactions({ ...base, targets });
		expect(targets.length).toBeGreaterThan(3);
		expect(plan.slotsUsed).toBeLessThanOrEqual(150);
		for (const o of plan.outputsPerCycle) expect(o.dailyVolumeSharePct!).toBeLessThanOrEqual(10);
		// One more line of the top pick would break the cap.
		const top = targets[0];
		const more = planReactions({ ...base, targets: [{ ...top, lines: top.lines + 1 }] });
		expect(more.outputsPerCycle[0].dailyVolumeSharePct!).toBeGreaterThan(10);
	});

	it('gives products without volume data at most one line', () => {
		const targets = suggestFill(input({ totalSlots: 150 }), { maxVolumeSharePct: 10 });
		expect(targets.length).toBeGreaterThan(1);
		expect(targets.every((t) => t.lines === 1)).toBe(true);
		const existing = suggestFill(
			input({ totalSlots: 150, targets: [{ blueprintTypeId: 46157, lines: 1 }] }),
			{
				maxVolumeSharePct: 10
			}
		);
		expect(existing.find((t) => t.blueprintTypeId === 46157)).toEqual({ blueprintTypeId: 46157, lines: 1 });
	});

	it('only adds allowed reactions', () => {
		const targets = suggestFill(input({ totalSlots: 20 }), { allowed: (r) => r.tier === 'composite' });
		const tiers = targets.map(
			(t) => makeCtx().dataset.reactions.find((r) => r.blueprintTypeId === t.blueprintTypeId)!.tier
		);
		expect(tiers.length).toBeGreaterThan(0);
		expect(new Set(tiers)).toEqual(new Set(['composite']));
		expect(FILL_TIERS).toContain('composite');
	});

	it('buyIntermediates ranks by buy-inputs profit and buys the added reactions’ intermediates', () => {
		const base = input({ totalSlots: 20 });
		const fill = suggestFillPlan(base, { allowed: (r) => r.tier === 'composite', buyIntermediates: true });
		expect(fill.targets).toEqual([{ blueprintTypeId: 46204, lines: 20 }]);
		expect(fill.buyInsteadOfBuild.sort()).toEqual([16654, 16658]);
		const plan = planReactions({ ...base, ...fill });
		expect(plan.reactions.map((r) => r.blueprintTypeId)).toEqual([46204]);
		expect(plan.slotsUsed).toBe(20);
	});

	it('adds lines to a line target, never to a quantity target', () => {
		const targets = suggestFill(
			input({ totalSlots: 45, targets: [{ blueprintTypeId: 46157, lines: 0, quantity: 160 }] })
		);
		expect(targets[0]).toEqual({ blueprintTypeId: 46157, lines: 0, quantity: 160 });
		expect(targets[1]).toEqual({ blueprintTypeId: 46157, lines: 44 });
	});
});
