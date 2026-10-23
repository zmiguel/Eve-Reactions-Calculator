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
		// Stock of bought types changes no schedule; Cadmium beyond the 2 × ⌈62 × 100 × 0.9736⌉ = 12,074 the
		// two start-up cycles of Crystallite Alloy buy is unused, all the Cobalt is used.
		const schedule = (plan: PlanResult) => plan.phases.map((p) => [p.cycle, p.label, p.blueprintTypeIds]);
		expect(schedule(stocked)).toEqual(schedule(base));
		expect(stocked.unusedStock).toEqual([{ typeId: 16643, name: 'Cadmium', quantity: 1e9 - 12_074 }]);
		expect(base.unusedStock).toEqual([]);
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

describe('stock of built types feeds the earliest cycles', () => {
	// Titanium Carbide, 2 lines. Every reaction here fits ⌊7 × 86,400 ÷ 4,769.28⌋ = 126 runs per slot and
	// cycle, so the final reaction runs 2 jobs of 126. Each job needs ⌈126 × 100 × 0.9736⌉ = 12,268 Titanium
	// Chromide and Silicon Diborite (T2 rig in nullsec: 1 − 0.024 × 1.1 = 0.9736), 24,536 of each per cycle,
	// made by ⌈24,536 ÷ 200⌉ = 123 runs of each intermediate reaction (one slot each).
	const TIC = 46204;
	const SIDI = 46179;
	const TICR = 46182;
	const perCycle = 24_536;
	const carbide = (stock: Record<number, number>) =>
		planReactions(input({ targets: [{ blueprintTypeId: TIC, lines: 2 }], stock }));
	const base = carbide({});
	const schedule = (plan: PlanResult) =>
		plan.phases.map((p) => [p.cycle, p.label, p.blueprintTypeIds, p.slots]);
	const bought = (plan: PlanResult, cycle: number) =>
		plan.phases.find((p) => p.cycle === cycle)!.purchases.map((p) => [p.typeId, p.quantity]);
	const cost = (items: { total: number; fees: number; shipping: number }[]) =>
		items.reduce((a, i) => a + i.total + i.fees + i.shipping, 0);
	/** Stock is valued at market value: the steady cycle never changes. */
	const expectSameSteady = (plan: PlanResult) => {
		expect(plan.purchasesPerCycle).toEqual(base.purchasesPerCycle);
		expect(plan.outputsPerCycle).toEqual(base.outputsPerCycle);
		expect(plan.totals.profitPerCycle).toBe(base.totals.profitPerCycle);
	};

	it('without stock: the intermediates run in cycle 1, the final jobs from cycle 2', () => {
		expect(reaction(base, TIC).materials.find((m) => m.typeId === 16654)!.quantity).toBe(perCycle);
		expect(reaction(base, TICR)).toMatchObject({ totalRuns: 123, slots: 1, firstCycle: 1 });
		expect(schedule(base)).toEqual([
			[1, 'build_up', [SIDI, TICR], 2],
			[2, 'steady', [TIC, SIDI, TICR], 4]
		]);
	});

	it('one steady cycle of both intermediates: steady from cycle 1, buying one cycle', () => {
		// Cycle 1: the final jobs use the stock while the intermediates run their 123 runs for cycle 2.
		const plan = carbide({ 16654: perCycle, 16658: perCycle });
		expect(plan.reactions.map((r) => [r.blueprintTypeId, r.firstCycle])).toEqual([
			[TIC, 1],
			[SIDI, 1],
			[TICR, 1]
		]);
		expect(schedule(plan)).toEqual([[1, 'steady', [TIC, SIDI, TICR], 4]]);
		const quantities = (items: { typeId: number; quantity: number }[]) =>
			items.map((i) => [i.typeId, i.quantity]);
		expect(quantities(plan.initialPurchases)).toEqual(quantities(plan.purchasesPerCycle));
		expect(plan.totals.initialInvestment).toBeCloseTo(
			cost(plan.purchasesPerCycle) + plan.totals.jobCostPerCycle + plan.totals.formulaCost,
			4
		);
		expect(plan.startup.buy.cycles).toBe(1);
		expect(plan.unusedStock).toEqual([]);
		expect(plan.totals.initialInvestment).toBeLessThan(base.totals.initialInvestment);
		expectSameSteady(plan);
	});

	it('two cycles of stock: the intermediates start in cycle 2, cycle 1 buys nothing for them', () => {
		// The stock covers the final jobs' cycles 1 and 2: the intermediates first run in cycle 2, for cycle 3.
		const plan = carbide({ 16654: 2 * perCycle, 16658: 2 * perCycle });
		expect(schedule(plan)).toEqual([
			[1, 'build_up', [TIC], 2],
			[2, 'steady', [TIC, SIDI, TICR], 4]
		]);
		expect([reaction(plan, SIDI).firstCycle, reaction(plan, TICR).firstCycle]).toEqual([2, 2]);
		// Only the final jobs' Oxygen Fuel Blocks: 2 × ⌈126 × 5 × 0.9736⌉ = 1,228.
		expect(bought(plan, 1)).toEqual([[4312, 1228]]);
		expect(plan.unusedStock).toEqual([]);
		expectSameSteady(plan);
	});

	it('half a cycle of stock: the final jobs start in cycle 2, the intermediates’ first runs halve', () => {
		// 12,268 of each cannot feed cycle 1 (24,536), so the final jobs start in cycle 2. The stock covers
		// half of cycle 2: cycle 1 makes the other 12,268 in ⌈12,268 ÷ 200⌉ = 62 runs instead of 123.
		const plan = carbide({ 16654: perCycle / 2, 16658: perCycle / 2 });
		expect(reaction(plan, TIC).firstCycle).toBe(2);
		expect(schedule(plan)).toEqual([
			[1, 'build_up', [SIDI, TICR], 2],
			[2, 'steady', [TIC, SIDI, TICR], 4]
		]);
		// 123 runs buy ⌈123 × 100 × 0.9736⌉ = 11,976 of each moon material and ⌈123 × 5 × 0.9736⌉ = 599
		// fuel blocks per reaction; 62 runs buy ⌈62 × 100 × 0.9736⌉ = 6,037 and ⌈62 × 5 × 0.9736⌉ = 302.
		expect(bought(base, 1)).toEqual([
			[4312, 2 * 599],
			[16635, 11_976],
			[16636, 11_976],
			[16638, 11_976],
			[16641, 11_976]
		]);
		expect(bought(plan, 1)).toEqual([
			[4312, 2 * 302],
			[16635, 6037],
			[16636, 6037],
			[16638, 6037],
			[16641, 6037]
		]);
		// Job cost grows linearly with runs.
		expect(plan.phases[0].jobCost).toBeCloseTo((base.phases[0].jobCost * 62) / 123, 6);
		expect(plan.unusedStock).toEqual([]);
		expectSameSteady(plan);
	});

	it('never takes longer than without stock: stock beyond the start-up is unused', () => {
		// Three cycles of stock: the final jobs use two (cycles 1 and 2), then the plan is steady like
		// without stock; the third cycle is left over.
		const plan = carbide({ 16654: 3 * perCycle, 16658: 3 * perCycle });
		expect(schedule(plan)).toEqual(schedule(carbide({ 16654: 2 * perCycle, 16658: 2 * perCycle })));
		expect(plan.unusedStock).toEqual([
			{ typeId: 16658, name: 'Silicon Diborite', quantity: perCycle },
			{ typeId: 16654, name: 'Titanium Chromide', quantity: perCycle }
		]);
	});

	it('stock of a target product is unused; stock the plan never touches is not listed', () => {
		const plan = carbide({ 16671: 50_000, 16670: 7 });
		expect(plan.phases).toEqual(base.phases);
		expect(plan.totals.initialInvestment).toBe(base.totals.initialInvestment);
		expect(plan.unusedStock).toEqual([{ typeId: 16671, name: 'Titanium Carbide', quantity: 50_000 }]);
	});

	it('Strong booster: stock of the middle level shortens the build-up by one cycle', () => {
		// 126 runs of Pure Strong Blue Pill Booster need ⌈126 × 12 × 0.9736⌉ = 1,473 Pure Improved Blue Pill
		// Booster per cycle. With one cycle of it the strong jobs start in cycle 2; the Improved jobs first
		// run in cycle 2 (for cycle 3) and the Standard jobs in cycle 1 (Mindflood for the strong jobs,
		// Blue Pill and Crash for the Improved ones).
		const booster = (stock: Record<number, number>) =>
			planReactions(input({ targets: [{ blueprintTypeId: 46235, lines: 1 }], stock }));
		const before = booster({});
		const plan = booster({ 25241: 1473 });
		expect(reaction(before, 46235).materials.find((m) => m.typeId === 25241)!.quantity).toBe(1473);
		expect(before.phases.map((p) => p.label)).toEqual(['build_up', 'build_up', 'steady']);
		expect(plan.phases.map((p) => [p.cycle, p.label, [...p.blueprintTypeIds].sort()])).toEqual([
			[1, 'build_up', [46225, 46230, 46231]],
			[2, 'steady', [46225, 46230, 46231, 46235, 46251]]
		]);
		expect([reaction(plan, 46235).firstCycle, reaction(plan, 46251).firstCycle]).toEqual([2, 2]);
		expect(plan.unusedStock).toEqual([]);
		expect(plan.totals.profitPerCycle).toBe(before.totals.profitPerCycle);
		expect(plan.totals.initialInvestment).toBeLessThan(before.totals.initialInvestment);
	});
});

describe('horizon: purchases over N cycles', () => {
	// Titanium Carbide, 2 lines, as above: per cycle the two final jobs buy 2 × 614 = 1,228 Oxygen Fuel
	// Blocks and the two intermediate jobs (123 runs each) 2 × 599 = 1,198 plus 11,976 of each of their
	// four moon materials. Without stock: cycle 1 runs the intermediates, cycle 2 is steady.
	const TIC = 46204;
	const SIDI = 46179;
	const TICR = 46182;
	const perCycle = 24_536;
	const MOON = [16635, 16636, 16638, 16641];
	const carbide = (stock: Record<number, number>, horizonCycles?: number) =>
		planReactions(input({ targets: [{ blueprintTypeId: TIC, lines: 2 }], stock, horizonCycles }));
	const quantities = (items: { typeId: number; quantity: number }[]) =>
		Object.fromEntries(items.map((i) => [i.typeId, i.quantity]));
	const moon = (quantity: number) => Object.fromEntries(MOON.map((typeId) => [typeId, quantity]));
	const cost = (items: { total: number; fees: number; shipping: number }[]) =>
		items.reduce((a, i) => a + i.total + i.fees + i.shipping, 0);
	const phaseJobCost = (plan: PlanResult) => plan.phases.reduce((a, p) => a + p.jobCost, 0);
	const base = carbide({});

	it('defaults to the first steady cycle: the start-up purchases and job costs', () => {
		expect(base.horizon.cycles).toBe(2);
		expect(base.horizon.purchases).toEqual(base.initialPurchases);
		expect(base.horizon.jobCost).toBeCloseTo(phaseJobCost(base), 6);
		expect(base.horizon.unusedStock).toEqual([]);
		const booster = planReactions(input({ targets: [{ blueprintTypeId: 46235, lines: 1 }] }));
		expect(booster.horizon.cycles).toBe(3);
		expect(booster.horizon.purchases).toEqual(booster.initialPurchases);
	});

	it('without stock, every cycle past the first steady one adds a steady cycle of purchases', () => {
		const plan = carbide({}, 5);
		// Fuel: 1,198 + 2 × (1,228 + 1,198) start-up, then 3 × 2,426; moon materials: 5 × 11,976.
		expect(quantities(plan.horizon.purchases)).toEqual({ 4312: 10_902, ...moon(59_880) });
		expect(cost(plan.horizon.purchases)).toBeCloseTo(
			cost(base.initialPurchases) + 3 * cost(base.purchasesPerCycle),
			4
		);
		expect(plan.horizon.jobCost).toBeCloseTo(phaseJobCost(base) + 3 * base.totals.jobCostPerCycle, 6);
		// Every other field is the plan's own.
		expect({ ...plan, horizon: base.horizon }).toEqual(base);
	});

	it('fewer cycles than the start-up: only those cycles', () => {
		const booster = (horizonCycles: number) =>
			planReactions(input({ targets: [{ blueprintTypeId: 46235, lines: 1 }], horizonCycles }));
		const summed = (lists: { typeId: number; quantity: number }[][]) =>
			lists.flat().reduce<Record<number, number>>((acc, i) => {
				acc[i.typeId] = (acc[i.typeId] ?? 0) + i.quantity;
				return acc;
			}, {});
		const phases = booster(3).phases;
		expect(quantities(booster(1).horizon.purchases)).toEqual(summed([phases[0].purchases]));
		expect(quantities(booster(2).horizon.purchases)).toEqual(
			summed([phases[0].purchases, phases[1].purchases])
		);
		expect(booster(1).horizon.jobCost).toBeCloseTo(phases[0].jobCost, 6);
		expect(quantities(carbide({}, 1).horizon.purchases)).toEqual({ 4312: 1198, ...moon(11_976) });
	});

	it('takes whole cycles from 1 to 52', () => {
		expect([0, 2.7, 99].map((n) => carbide({}, n).horizon.cycles)).toEqual([1, 2, 52]);
	});

	it('stock of a bought type covers the earliest purchases of all N cycles', () => {
		// 4 cycles need 4 × 11,976 = 47,904 Evaporite Deposits; 30,000 in stock leave 17,904 to buy.
		const plan = carbide({ 16635: 30_000 }, 4);
		expect(quantities(plan.horizon.purchases)[16635]).toBe(17_904);
		expect(plan.horizon.unusedStock).toEqual([]);
		// The start-up alone uses 2 × 11,976 = 23,952.
		expect(plan.unusedStock).toEqual([{ typeId: 16635, name: 'Evaporite Deposits', quantity: 6048 }]);
		expect(carbide({ 16635: 30_000 }, 2).horizon.unusedStock).toEqual(plan.unusedStock);
	});

	it('stock of a built intermediate cuts its reactions’ runs and their inputs in later cycles too', () => {
		// Three cycles of both intermediates feed the final jobs in cycles 1 to 3: the intermediates first
		// run in cycle 3, for cycle 4. Cycle 2 is the first steady cycle of the start-up, which keeps them
		// running there and leaves a cycle of stock over.
		const stock = { 16654: 3 * perCycle, 16658: 3 * perCycle };
		const two = carbide(stock);
		expect(two.horizon.cycles).toBe(2);
		expect(quantities(two.horizon.purchases)).toEqual({ 4312: 2 * 1228 });
		expect(two.horizon.jobCost).toBeCloseTo(2 * reaction(two, TIC).jobCost, 6);
		expect(two.horizon.unusedStock).toEqual([]);
		expect(two.unusedStock).toHaveLength(2);

		const three = carbide(stock, 3);
		expect(quantities(three.horizon.purchases)).toEqual({ 4312: 3 * 1228 + 2 * 599, ...moon(11_976) });
		expect(three.horizon.jobCost).toBeCloseTo(
			3 * reaction(three, TIC).jobCost + reaction(three, SIDI).jobCost + reaction(three, TICR).jobCost,
			6
		);

		// Two and a half cycles: cycle 2 makes the other half of cycle 3 in 62 runs per intermediate,
		// buying ⌈62 × 100 × 0.9736⌉ = 6,037 of each moon material and 2 × 302 fuel blocks; cycle 3 runs
		// the full 123 for cycle 4.
		const half = carbide({ 16654: 2.5 * perCycle, 16658: 2.5 * perCycle }, 3);
		expect(quantities(half.horizon.purchases)).toEqual({
			4312: 3 * 1228 + 2 * 302 + 2 * 599,
			...moon(6037 + 11_976)
		});
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
