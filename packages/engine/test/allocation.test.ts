import { describe, expect, it } from 'vitest';
import { calculateAllocated, optimizeChainLines } from '../src/allocation.ts';
import { calculateReaction } from '../src/calculate.ts';
import { listReactions } from '../src/listing.ts';
import { byId, makeCtx } from './fixtures/context.ts';
import { jitaPrices, priceBook } from './fixtures/dataset.ts';

const RUN_TIME = 4769.28; // spreadsheet profile: Tatara, T2 rigs, nullsec, Reactions V
const CYCLE_SECONDS = 7 * 86400;
const chainOpts = { view: 'chain', outputMode: 'product' } as const;

describe('optimizeChainLines', () => {
	it('Titanium Carbide runs 2 lines in 2 + 2 slots with intermediates filling the cycle', () => {
		const best = optimizeChainLines(byId(46204), makeCtx());
		expect(best.lines).toBe(2);
		expect(best.slotsUsed).toBe(4);
		expect(best.plan.reactions.map((r) => [r.blueprintTypeId, r.slots, r.runsPerSlot])).toEqual([
			[46204, 2, [126, 126]],
			[46179, 1, [123]],
			[46182, 1, [123]]
		]);
		expect(best.utilisation).toBeCloseTo(((252 + 123 + 123) * RUN_TIME) / (4 * CYCLE_SECONDS), 12);
		expect(best.utilisation).toBeGreaterThan(0.95);
		expect(best.plan.slotsRemaining).toBe(0);
		expect(best.profitPerSlotDay).toBeCloseTo(best.profitPerCycle! / (4 * 7), 6);
	});

	it('prefers the fewest lines among candidates within 0.5 % of the best', () => {
		const best = optimizeChainLines(byId(46204), makeCtx(), { maxLines: 10 });
		expect(best.candidates.map((c) => [c.lines, c.slotsUsed])).toEqual([
			[1, 3],
			[2, 4],
			[3, 7],
			[4, 8],
			[5, 11],
			[6, 12],
			[7, 15],
			[8, 16],
			[9, 19],
			[10, 20]
		]);
		const score = (lines: number) => best.candidates[lines - 1].score;
		// 2, 4 and 6 lines tie exactly (same slot shape); 8 lines differ by less than the tolerance.
		expect(score(4)).toBeCloseTo(score(2), 6);
		expect(score(6)).toBeCloseTo(score(2), 6);
		expect(Math.abs(score(8) - score(2))).toBeLessThan(Math.abs(score(2)) * 0.005);
		expect(best.lines).toBe(2);
	});

	it('values surplus intermediates when ranking, so thin margins do not inflate the line count', () => {
		// Selling at 11 % of the market price leaves a thin profit margin.
		const ctx = makeCtx({ profile: { market: { outputPricePct: 11 } } });
		const best = optimizeChainLines(byId(46204), ctx, { maxLines: 10 });
		const byProfit = [...best.candidates].sort((a, b) => b.profitPerSlotDay! - a.profitPerSlotDay!)[0];
		const two = best.candidates[1];
		// Profit alone would pick 8 lines: they round the intermediate runs more tightly (less surplus)…
		expect(byProfit.lines).toBe(8);
		expect(byProfit.profitPerSlotDay! - two.profitPerSlotDay!).toBeGreaterThan(
			Math.abs(byProfit.profitPerSlotDay!) * 0.005
		);
		// …but the surplus carries over into the next cycle, so 2 lines (4 slots) remain the choice.
		expect(best.lines).toBe(2);
		expect(best.slotsUsed).toBe(4);
		const surplus = best.plan.surplusPerCycle.reduce((acc, s) => acc + s.total, 0);
		expect(two.score).toBeCloseTo((best.profitPerCycle! + surplus) / (4 * 7), 6);
	});

	it('falls back to slot utilisation when a price is missing', () => {
		const prices = { ...jitaPrices, 16671: { buy: null, sell: null } };
		const best = optimizeChainLines(byId(46204), makeCtx({ inputPrices: priceBook({ jita: prices }) }));
		expect(best.profitPerCycle).toBeNull();
		expect(best.candidates.every((c) => c.profitPerSlotDay === null)).toBe(true);
		const top = Math.max(...best.candidates.map((c) => c.utilisation));
		expect(best.utilisation).toBeCloseTo(top, 12);
		expect(best.lines).toBe(2);
	});

	it('respects maxLines and a fixed line count', () => {
		const ctx = makeCtx();
		expect(optimizeChainLines(byId(46204), ctx, { maxLines: 1 })).toMatchObject({ lines: 1, slotsUsed: 3 });
		expect(optimizeChainLines(byId(46204), ctx, { maxLines: 3 }).candidates).toHaveLength(3);
		expect(optimizeChainLines(byId(46204), ctx).candidates.map((c) => c.lines)).toEqual([1, 2, 3, 4]);
		expect(optimizeChainLines(byId(46204), ctx, { maxLines: 10 }).candidates).toHaveLength(10);
		const fixed = optimizeChainLines(byId(46204), ctx, { lines: 3 });
		expect(fixed).toMatchObject({ lines: 3, slotsUsed: 7 });
		expect(fixed.candidates).toHaveLength(1);
	});

	it('tries 1 to the maxParallelLines setting unless maxLines overrides it', () => {
		const ten = makeCtx({ settings: { maxParallelLines: 10 } });
		expect(optimizeChainLines(byId(46204), ten).candidates.map((c) => c.lines)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10
		]);
		expect(optimizeChainLines(byId(46204), ten, { maxLines: 2 }).candidates).toHaveLength(2);
		const two = makeCtx({ settings: { maxParallelLines: 2 } });
		expect(optimizeChainLines(byId(46204), two, { unrefined: true }).candidates).toHaveLength(2);
		expect(
			calculateAllocated(byId(46204), two, {
				view: 'chain',
				outputMode: 'product',
				slotAllocation: 'optimal'
			}).allocation!.lines
		).toBeLessThanOrEqual(2);
	});

	it('gives a reaction that is not chainable one line in one slot', () => {
		const best = optimizeChainLines(byId(46166), makeCtx());
		expect(best).toMatchObject({ lines: 1, slotsUsed: 1 });
		expect(best.candidates).toHaveLength(1);
		expect(best.plan.reactions).toMatchObject([{ blueprintTypeId: 46166, slots: 1, runsPerSlot: [126] }]);
	});
});

describe('calculateAllocated', () => {
	it('single allocation is calculateReaction unchanged', () => {
		const ctx = makeCtx();
		const single = calculateAllocated(byId(46204), ctx, { ...chainOpts, slotAllocation: 'single' });
		expect(single).toEqual(calculateReaction(byId(46204), ctx, chainOpts));
		expect(single.allocation).toBeUndefined();
		expect(single.totals.slotSeconds).toBeCloseTo((126 + 124) * RUN_TIME, 6);
		expect(calculateAllocated(byId(46204), ctx, chainOpts)).toEqual(single);
	});

	it('optimal allocation prices one steady cycle of the chosen lines', () => {
		const ctx = makeCtx({ settings: { slotAllocation: 'optimal' } });
		const result = calculateAllocated(byId(46204), ctx, chainOpts);
		const best = optimizeChainLines(byId(46204), ctx);
		expect(result.runs).toBe(252);
		expect(result.chain!.runsPerSlot).toEqual([126, 126]);
		expect(result.chain!.children.map((c) => [c.runs, c.runsPerSlot, c.quantityUsed, c.surplus])).toEqual([
			[123, [123], 2 * 12268, 123 * 200 - 2 * 12268],
			[123, [123], 2 * 12268, 123 * 200 - 2 * 12268]
		]);
		expect(result.outputs[0].quantity).toBe(252 * byId(46204).product.quantity);
		expect(result.totals.profit).toBeCloseTo(best.profitPerCycle!, 4);
		expect(result.totals.jobCost).toBeCloseTo(best.plan.totals.jobCostPerCycle, 6);
		expect(result.totals.profitPerSlotDay).toBeCloseTo(result.totals.profit! / (4 * 7), 6);
		expect(result.totals.slotSeconds).toBeCloseTo((252 + 123 + 123) * RUN_TIME, 6);
		expect(result.allocation).toMatchObject({
			mode: 'optimal',
			lines: 2,
			slotsUsed: 4,
			cycleDays: 7,
			reactions: [
				{ blueprintTypeId: 46204, depth: 0, slots: 2, runsPerSlot: [126, 126], firstCycle: 2 },
				{ blueprintTypeId: 46179, depth: 1, slots: 1, runsPerSlot: [123], firstCycle: 1 },
				{ blueprintTypeId: 46182, depth: 1, slots: 1, runsPerSlot: [123], firstCycle: 1 }
			],
			phases: [
				{ cycle: 1, label: 'build_up', slots: 2 },
				{ cycle: 2, label: 'steady', slots: 4 }
			]
		});
		expect(result.allocation!.reactions[1].slotDurations[0]).toBeCloseTo(123 * RUN_TIME, 6);
		expect(result.allocation!.initialInvestment).toBeCloseTo(
			best.plan.totals.initialInvestment - best.plan.totals.formulaCost,
			4
		);
	});

	it('an explicit slotAllocation overrides the setting and a fixed line count is kept', () => {
		const ctx = makeCtx({ settings: { slotAllocation: 'optimal' } });
		expect(calculateAllocated(byId(46204), ctx, { ...chainOpts, slotAllocation: 'single' }).allocation).toBe(
			undefined
		);
		const three = calculateAllocated(byId(46204), makeCtx(), {
			...chainOpts,
			slotAllocation: 'optimal',
			lines: 3
		});
		expect(three.runs).toBe(378);
		expect(three.allocation).toMatchObject({ lines: 3, slotsUsed: 7 });
	});

	it('Strong booster chain: one line in 5 slots over three phases', () => {
		const result = calculateAllocated(byId(46235), makeCtx(), { ...chainOpts, slotAllocation: 'optimal' });
		const a = result.allocation!;
		expect(a.lines).toBe(1);
		expect(a.slotsUsed).toBe(5);
		expect(a.utilisation).toBeCloseTo(((126 + 123 + 123 + 120 + 120) * RUN_TIME) / (5 * CYCLE_SECONDS), 12);
		expect(
			a.reactions.map((r) => [r.blueprintTypeId, r.depth, r.slots, r.runsPerSlot, r.firstCycle])
		).toEqual([
			[46235, 0, 1, [126], 3],
			[46225, 1, 1, [123], 2],
			[46251, 1, 1, [123], 2],
			[46230, 2, 1, [120], 1],
			[46231, 2, 1, [120], 1]
		]);
		expect(a.phases.map((p) => [p.cycle, p.label, p.slots])).toEqual([
			[1, 'build_up', 2],
			[2, 'build_up', 4],
			[3, 'steady', 5]
		]);
		expect(result.totals.profitPerSlotDay).toBeCloseTo(result.totals.profit! / (5 * 7), 6);
	});

	it('leaves buy-inputs and reprocessed variants alone', () => {
		const ctx = makeCtx({ settings: { slotAllocation: 'optimal' } });
		const opts = { view: 'single', outputMode: 'product' } as const;
		expect(calculateAllocated(byId(46204), ctx, opts)).toEqual(calculateReaction(byId(46204), ctx, opts));
	});
});

describe('listReactions slot allocation', () => {
	it('computes the full chain in the active mode', () => {
		const single = listReactions(makeCtx(), { tier: 'composite' });
		const optimal = listReactions(makeCtx({ settings: { slotAllocation: 'optimal' } }), {
			tier: 'composite'
		});
		const tic = (rows: typeof single) => rows.find((r) => r.reaction.blueprintTypeId === 46204)!;
		expect(tic(single).chain!.allocation).toBeUndefined();
		expect(tic(optimal).chain!.allocation).toMatchObject({ lines: 2, slotsUsed: 4 });
		expect(tic(optimal).single).toEqual(tic(single).single);
		// Profit per allocated slot-day (idle slot time included) instead of per busy slot-day.
		const chain = tic(optimal).chain!;
		expect(chain.totals.profitPerSlotDay).toBeCloseTo(chain.totals.profit! / (4 * 7), 6);
		expect(chain.totals.profitPerSlotDay).toBeLessThan(tic(single).chain!.totals.profitPerSlotDay!);
	});

	it('accepts an allocation override with a fixed line count', () => {
		const rows = listReactions(makeCtx(), { tier: 'composite' }, { slotAllocation: 'optimal', lines: 3 });
		const tic = rows.find((r) => r.reaction.blueprintTypeId === 46204)!;
		expect(tic.chain!.allocation).toMatchObject({ lines: 3 });
		expect(tic.chain!.allocation!.slotsUsed).toBeGreaterThan(4);
	});
});
