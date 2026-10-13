import { describe, expect, it } from 'vitest';
import { isFuelBlock } from '../src/constants.ts';
import { materialModifier, requiredQuantity, runsPerCycle } from '../src/formulas.ts';
import { stockUnitValue } from '../src/inventory.ts';
import { planFromStock, type StockPlan, type StockPlanInput } from '../src/stockplan.ts';
import { byId, makeCtx } from './fixtures/context.ts';
import { dataset, jitaPrices, priceBook } from './fixtures/dataset.ts';

const OXYGEN_FUEL_BLOCK = 4312;
const EVAPORITE_DEPOSITS = 16635;
const SILICATES = 16636;
const TITANIUM = 16638;
const COBALT = 16640;
const CHROMIUM = 16641;
const CADMIUM = 16643;
const TITANIUM_CHROMIDE = 16654;
const SILICON_DIBORITE = 16658;
const CRYSTALLITE_ALLOY_FORMULA = 46169;
const SILICON_DIBORITE_FORMULA = 46179;
const TITANIUM_CHROMIDE_FORMULA = 46182;
const TITANIUM_CARBIDE_FORMULA = 46204;

/** Like the seed pilot: intermediates for about two Titanium Carbide lines, raw moon materials, fuel. */
const SEED_STOCK = {
	[TITANIUM_CHROMIDE]: 24_000,
	[SILICON_DIBORITE]: 24_000,
	[OXYGEN_FUEL_BLOCK]: 2000,
	[TITANIUM]: 40_000,
	[CHROMIUM]: 30_000,
	[SILICATES]: 25_000,
	[COBALT]: 20_000,
	[CADMIUM]: 15_000
};

const input = (overrides: Partial<StockPlanInput> = {}): StockPlanInput => ({
	ctx: makeCtx(),
	totalSlots: 11,
	stock: SEED_STOCK,
	ownedFormulas: { [TITANIUM_CARBIDE_FORMULA]: 2 },
	...overrides
});

const jobIds = (plan: StockPlan, cycle: number) =>
	plan.cycles.find((c) => c.cycle === cycle)?.jobs.map((j) => j.blueprintTypeId) ?? [];

const closeTo = (actual: number, expected: number) =>
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(expected)));

/**
 * Replays the plan from the stock: every job's exact consumption (`requiredQuantity` per job) must be
 * held (stock, earlier output, fuel bought for the cycle) when its cycle starts; checks slots,
 * formulas, purchases, leftover and totals.
 */
function expectValid(plan: StockPlan, given: StockPlanInput) {
	const { ctx } = given;
	const value = (typeId: number) => stockUnitValue(ctx, typeId) ?? 0;
	const pool = new Map(Object.entries(given.stock).map(([key, q]): [number, number] => [Number(key), q]));
	const add = (typeId: number, quantity: number) => pool.set(typeId, (pool.get(typeId) ?? 0) + quantity);
	const bought = new Map(plan.formulasToBuy.map((f) => [f.blueprintTypeId, f.count]));
	if (!given.allowUnownedFormulas) expect(plan.formulasToBuy).toEqual([]);
	const fuel = new Map<number, number>();
	const madeQty = new Map<number, number>();
	const usedQty = new Map<number, number>();
	const tally = (into: Map<number, number>, typeId: number, quantity: number) =>
		into.set(typeId, (into.get(typeId) ?? 0) + quantity);
	let produced = 0;
	let jobCost = 0;
	for (const cycle of plan.cycles) {
		expect(cycle.slotsUsed).toBe(cycle.jobs.reduce((acc, j) => acc + j.slots, 0));
		expect(cycle.slotsUsed).toBeLessThanOrEqual(given.totalSlots);
		for (const item of cycle.fuel) {
			expect(isFuelBlock(dataset, item.typeId)).toBe(true);
			add(item.typeId, item.quantity);
			fuel.set(item.typeId, (fuel.get(item.typeId) ?? 0) + item.quantity);
		}
		const made: [number, number][] = [];
		for (const job of cycle.jobs) {
			const reaction = byId(job.blueprintTypeId);
			const profile = ctx.profiles[reaction.reactor];
			const owned = given.ownedFormulas[job.blueprintTypeId] ?? 0;
			expect(job.slots).toBeLessThanOrEqual(owned + (bought.get(job.blueprintTypeId) ?? 0));
			expect(job.runsPerSlot).toHaveLength(job.slots);
			expect(job.runsPerSlot.reduce((a, b) => a + b, 0)).toBe(job.runs);
			const capacity = runsPerCycle(reaction, profile, ctx.settings.cycleDays, dataset.constants);
			for (const runs of job.runsPerSlot) expect(runs).toBeLessThanOrEqual(capacity);
			const mm = materialModifier(profile, dataset.constants);
			for (const m of reaction.materials) {
				const need = job.runsPerSlot.reduce((acc, r) => acc + requiredQuantity(r, m.quantity, mm), 0);
				add(m.typeId, -need);
				tally(usedQty, m.typeId, need);
			}
			made.push([reaction.product.typeId, job.runs * reaction.product.quantity]);
			jobCost += job.jobCost;
		}
		for (const [typeId, quantity] of pool)
			expect(quantity, `type ${typeId} in cycle ${cycle.cycle}`).toBeGreaterThanOrEqual(0);
		for (const [typeId, quantity] of made) {
			add(typeId, quantity);
			tally(madeQty, typeId, quantity);
			produced += quantity * value(typeId);
		}
	}
	const held = (entries: Iterable<[number, number]>) =>
		[...entries].filter(([, q]) => q > 0).sort((a, b) => a[0] - b[0]);
	expect(held(plan.leftover.map((i) => [i.typeId, i.quantity]))).toEqual(held(pool));
	expect(held(plan.fuelToBuy.map((i) => [i.typeId, i.quantity]))).toEqual(held(fuel));
	for (const item of plan.fuelToBuy) expect(isFuelBlock(dataset, item.typeId)).toBe(true);

	const t = plan.totals;
	// Produced units left at the end (beyond what jobs consumed) of a type a reaction consumes count at
	// their production cost, between 0 and market value; everything else at market value.
	const consumedByAny = new Set(dataset.reactions.flatMap((r) => r.materials.map((m) => m.typeId)));
	const leftoverIntermediates = [...madeQty]
		.map(([typeId, q]): [number, number] => [typeId, Math.max(0, q - (usedQty.get(typeId) ?? 0))])
		.filter(([typeId, left]) => left > 0 && consumedByAny.has(typeId));
	if (leftoverIntermediates.length === 0) closeTo(t.valueProduced, produced);
	else {
		expect(t.valueProduced).toBeLessThanOrEqual(produced + 1e-6 * produced);
		const atMost = leftoverIntermediates.reduce((acc, [typeId, left]) => acc + left * value(typeId), 0);
		expect(t.valueProduced).toBeGreaterThanOrEqual(produced - atMost - 1e-6 * produced);
	}
	const slotDays = plan.cycles.reduce((acc, c) => acc + c.slotsUsed, 0) * ctx.settings.cycleDays;
	closeTo(t.slotDays, slotDays);
	if (slotDays === 0) expect(t.profitPerSlotDay).toBeNull();
	else closeTo(t.profitPerSlotDay!, t.valueAdded / slotDays);
	closeTo(t.jobCost, jobCost);
	closeTo(
		t.fuelCost,
		plan.fuelToBuy.reduce((acc, i) => acc + i.total + i.fees + i.shipping, 0)
	);
	closeTo(
		t.formulaCost,
		plan.formulasToBuy.reduce((acc, f) => acc + f.count * f.unitPrice!, 0)
	);
	closeTo(t.valueAdded, t.valueProduced - t.valueConsumed - t.fuelCost - t.jobCost - t.formulaCost);
	// What is held gains, at market value, exactly the market value produced minus the value consumed.
	const worth = (entries: Iterable<[number, number]>) =>
		[...entries].reduce((acc, [typeId, q]) => acc + q * value(typeId), 0);
	closeTo(
		worth(plan.leftover.map((i) => [i.typeId, i.quantity])) -
			worth(Object.entries(given.stock).map(([k, q]) => [Number(k), q])),
		produced - t.valueConsumed
	);
	// Every item list: fuel blocks first, then by name.
	const lists = [
		plan.leftover,
		plan.unpricedStock,
		plan.fuelToBuy,
		...plan.cycles.flatMap((c) => [c.consumed, c.produced, c.fuel])
	];
	for (const list of lists) {
		const key = (i: { typeId: number; name: string }) => `${isFuelBlock(dataset, i.typeId) ? 0 : 1}${i.name}`;
		expect(list.map(key)).toEqual(list.map(key).sort((a, b) => a.localeCompare(b)));
	}
}

describe('planFromStock', () => {
	it('turns held intermediates into Titanium Carbide with the owned formula only', () => {
		const given = input();
		const plan = planFromStock(given);
		// The default horizon is 4 cycles; the held intermediates are used up in the first.
		expect(plan.maxCycles).toBe(4);
		expect(plan.optimal).toBe(true);
		expect(plan.cycles.slice(1).flatMap((c) => c.jobs)).toEqual([]);
		expect(plan.cycles[0].jobs).toMatchObject([{ blueprintTypeId: TITANIUM_CARBIDE_FORMULA, slots: 2 }]);
		expect(plan.cycles[0].jobs[0].runs).toBeGreaterThan(240);
		// Held fuel covers the jobs: nothing is bought.
		expect(plan.fuelToBuy).toEqual([]);
		expect(plan.totals.valueAdded).toBeGreaterThan(0);
		expectValid(plan, given);
	});

	it('never uses a reaction without an owned formula when the option is off', () => {
		const given = input({ ownedFormulas: {} });
		const plan = planFromStock(given);
		expect(plan.cycles.flatMap((c) => c.jobs)).toEqual([]);
		expect(plan.totals.valueAdded).toBe(0);
		expect(plan.leftover).toHaveLength(Object.keys(SEED_STOCK).length);
		expectValid(plan, given);
		// The same stock has reactions worth running once formulas may be bought.
		expect(planFromStock({ ...given, allowUnownedFormulas: true }).cycles.flatMap((c) => c.jobs)).not.toEqual(
			[]
		);
	});

	it('uses and buys an unowned formula when the option is on and it pays', () => {
		// Cobalt and Cadmium make Crystallite Alloy, a final product here (no Carbon Polymers for Crystalline
		// Carbonide); held Titanium Chromide already covers the Titanium Carbide jobs, so making more of it
		// would only be left over.
		const given = input({ allowUnownedFormulas: true, maxCycles: 2 });
		const plan = planFromStock(given);
		expect(plan.maxCycles).toBe(2);
		const used = plan.cycles.flatMap((c) => c.jobs.map((j) => j.blueprintTypeId));
		expect(used).toContain(CRYSTALLITE_ALLOY_FORMULA);
		expect(used).not.toContain(TITANIUM_CHROMIDE_FORMULA);
		const formula = plan.formulasToBuy.find((f) => f.blueprintTypeId === CRYSTALLITE_ALLOY_FORMULA);
		expect(formula).toMatchObject({ name: 'Crystallite Alloy Reaction Formula', unitPrice: 22_000_000 });
		expect(formula!.count).toBeGreaterThan(0);
		expect(plan.totals.formulaCost).toBeGreaterThanOrEqual(formula!.count * 22_000_000);
		expect(plan.totals.valueAdded).toBeGreaterThan(planFromStock(input()).totals.valueAdded);
		expectValid(plan, given);
	});

	it('turns raw materials into intermediates and, the cycle after, their product', () => {
		const given = input({
			stock: {
				[TITANIUM]: 20_000,
				[CHROMIUM]: 20_000,
				[EVAPORITE_DEPOSITS]: 20_000,
				[SILICATES]: 20_000,
				[OXYGEN_FUEL_BLOCK]: 1000
			},
			ownedFormulas: {
				[TITANIUM_CHROMIDE_FORMULA]: 1,
				[SILICON_DIBORITE_FORMULA]: 1,
				[TITANIUM_CARBIDE_FORMULA]: 1
			},
			maxCycles: 2
		});
		const plan = planFromStock(given);
		expect(plan.maxCycles).toBe(2);
		expect(jobIds(plan, 1)).toEqual(
			expect.arrayContaining([TITANIUM_CHROMIDE_FORMULA, SILICON_DIBORITE_FORMULA])
		);
		expect(jobIds(plan, 1)).not.toContain(TITANIUM_CARBIDE_FORMULA);
		expect(jobIds(plan, 2)).toContain(TITANIUM_CARBIDE_FORMULA);
		// Held fuel does not cover two cycles: the rest is bought.
		expect(plan.fuelToBuy.map((f) => f.typeId)).toEqual([OXYGEN_FUEL_BLOCK]);
		expectValid(plan, given);
	});

	it('runs an intermediate worth less than its inputs when its product next cycle pays for both', () => {
		// Titanium Chromide sells below its inputs and job cost; Titanium Carbide made from it pays well.
		const ctx = makeCtx({
			inputPrices: priceBook({ jita: { ...jitaPrices, [TITANIUM_CHROMIDE]: { buy: 800, sell: 900 } } })
		});
		const given = input({
			ctx,
			stock: {
				[TITANIUM]: 20_000,
				[CHROMIUM]: 20_000,
				[SILICON_DIBORITE]: 20_000,
				[OXYGEN_FUEL_BLOCK]: 5000
			},
			ownedFormulas: { [TITANIUM_CHROMIDE_FORMULA]: 1, [TITANIUM_CARBIDE_FORMULA]: 1 },
			maxCycles: 2
		});
		const alone = planFromStock({ ...given, maxCycles: 1 });
		expect(alone.cycles[0].jobs).toEqual([]);
		const plan = planFromStock(given);
		expect(plan.maxCycles).toBe(2);
		expect(jobIds(plan, 1)).toEqual([TITANIUM_CHROMIDE_FORMULA]);
		expect(jobIds(plan, 2)).toContain(TITANIUM_CARBIDE_FORMULA);
		expect(plan.totals.valueAdded).toBeGreaterThan(0);
		expectValid(plan, given);
	});

	it('uses held fuel blocks before buying', () => {
		const held = planFromStock(input());
		const consumed = held.cycles[0].consumed.find((i) => i.typeId === OXYGEN_FUEL_BLOCK)!.quantity;
		expect(held.leftover.find((i) => i.typeId === OXYGEN_FUEL_BLOCK)?.quantity).toBe(2000 - consumed);

		const given = input({ stock: { ...SEED_STOCK, [OXYGEN_FUEL_BLOCK]: 500 } });
		const plan = planFromStock(given);
		expect(plan.cycles[0].consumed.find((i) => i.typeId === OXYGEN_FUEL_BLOCK)!.quantity).toBe(consumed);
		expect(plan.fuelToBuy).toMatchObject([{ typeId: OXYGEN_FUEL_BLOCK, quantity: consumed - 500 }]);
		expect(plan.cycles[0].fuel).toMatchObject([{ typeId: OXYGEN_FUEL_BLOCK, quantity: consumed - 500 }]);
		expect(plan.leftover.some((i) => i.typeId === OXYGEN_FUEL_BLOCK)).toBe(false);
		expect(plan.totals.fuelCost).toBeGreaterThan(0);
		expectValid(plan, given);
	});

	describe('intermediates left at the end count at production cost', () => {
		// Titanium Chromide sells well on its own; held Silicon Diborite feeds about 10 Titanium Carbide runs.
		const chain = (maxCycles: number) =>
			input({
				stock: {
					[TITANIUM]: 20_000,
					[CHROMIUM]: 20_000,
					[SILICON_DIBORITE]: 1000,
					[OXYGEN_FUEL_BLOCK]: 5000
				},
				ownedFormulas: { [TITANIUM_CHROMIDE_FORMULA]: 1, [TITANIUM_CARBIDE_FORMULA]: 1 },
				maxCycles
			});
		const made = (plan: StockPlan, typeId: number) =>
			plan.cycles
				.flatMap((c) => c.produced)
				.reduce((acc, i) => acc + (i.typeId === typeId ? i.quantity : 0), 0);
		const used = (plan: StockPlan, typeId: number) =>
			plan.cycles
				.flatMap((c) => c.consumed)
				.reduce((acc, i) => acc + (i.typeId === typeId ? i.quantity : 0), 0);

		it('makes no intermediate that nothing within the horizon uses', () => {
			const given = chain(1);
			const plan = planFromStock(given);
			expect(plan.cycles[0].jobs).toEqual([]);
			expect(plan.totals.valueAdded).toBe(0);
			expectValid(plan, given);
		});

		it('makes an intermediate for the composite of the next cycle, and no more', () => {
			const given = chain(2);
			const plan = planFromStock(given);
			expect(jobIds(plan, 1)).toEqual([TITANIUM_CHROMIDE_FORMULA]);
			expect(jobIds(plan, 2)).toEqual([TITANIUM_CARBIDE_FORMULA]);
			expect(plan.totals.valueAdded).toBeGreaterThan(0);
			// Less than one run (200 units) of Titanium Chromide is left over.
			expect(made(plan, TITANIUM_CHROMIDE)).toBeGreaterThan(0);
			expect(made(plan, TITANIUM_CHROMIDE) - used(plan, TITANIUM_CHROMIDE)).toBeLessThan(200);
			expectValid(plan, given);
		});

		it('values untouched stock of an intermediate unchanged', () => {
			const given = { ...chain(2), stock: { ...chain(2).stock, [TITANIUM_CHROMIDE]: 50_000 } };
			const plan = planFromStock(given);
			expect(plan.leftover.find((i) => i.typeId === TITANIUM_CHROMIDE)!.quantity).toBeGreaterThan(40_000);
			// Held Titanium Chromide covers the composite: making more would only be left over.
			expect(made(plan, TITANIUM_CHROMIDE)).toBe(0);
			expectValid(plan, given);
		});
	});

	it('reports every better plan while searching, the last one being the result', () => {
		const seen: StockPlan[] = [];
		const given = input({ allowUnownedFormulas: true, maxCycles: 4, onIncumbent: (plan) => seen.push(plan) });
		const plan = planFromStock(given);
		expect(seen.length).toBeGreaterThan(0);
		for (const p of seen) expect(p.optimal).toBe(false);
		for (let i = 1; i < seen.length; i++)
			expect(seen[i].totals.valueAdded).toBeGreaterThan(seen[i - 1].totals.valueAdded);
		expect(plan).toEqual({ ...seen.at(-1)!, optimal: plan.optimal });
		expectValid(plan, given);
	});

	it('reports slot-days and value added per slot-day', () => {
		const plan = planFromStock(input());
		expect(plan.totals.slotDays).toBe(2 * 7);
		expect(plan.totals.profitPerSlotDay).toBeCloseTo(plan.totals.valueAdded / 14, 6);
		const idle = planFromStock(input({ ownedFormulas: {} }));
		expect(idle.totals).toMatchObject({ slotDays: 0, profitPerSlotDay: null });
	});

	it('returns a valid plan, not marked optimal, when the node cap is reached', () => {
		const given = input({ allowUnownedFormulas: true, nodeCap: 1 });
		const plan = planFromStock(given);
		expect(plan.optimal).toBe(false);
		expect(plan.cycles.flatMap((c) => c.jobs).length).toBeGreaterThan(0);
		expectValid(plan, given);
	});

	it('returns a valid plan, not marked optimal, at the time limit', () => {
		const given = input({ allowUnownedFormulas: true, maxCycles: 4, timeLimitMs: 0 });
		const plan = planFromStock(given);
		expect(plan.optimal).toBe(false);
		expectValid(plan, given);
		expect(planFromStock({ ...given, timeLimitMs: undefined }).optimal).toBe(true);
	});

	it('values unpriced held types at 0, lists them and skips reactions with an unpriced product', () => {
		const prices = Object.fromEntries(
			Object.entries(jitaPrices).filter(([typeId]) => ![TITANIUM, TITANIUM_CHROMIDE].includes(Number(typeId)))
		);
		const given = input({
			ctx: makeCtx({ inputPrices: priceBook({ jita: prices }) }),
			stock: { ...SEED_STOCK, [TITANIUM]: 1000 },
			ownedFormulas: { [TITANIUM_CHROMIDE_FORMULA]: 1, [TITANIUM_CARBIDE_FORMULA]: 2 }
		});
		const plan = planFromStock(given);
		expect(plan.unpricedStock.map((i) => i.typeId)).toEqual([TITANIUM, TITANIUM_CHROMIDE]);
		expect(plan.warnings).toContain('UNPRICED_STOCK');
		expect(plan.cycles.flatMap((c) => c.jobs.map((j) => j.blueprintTypeId))).not.toContain(
			TITANIUM_CHROMIDE_FORMULA
		);
		expectValid(plan, given);
	});
});
