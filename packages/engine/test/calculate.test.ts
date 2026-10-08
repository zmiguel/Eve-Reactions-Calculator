import { describe, expect, it } from 'vitest';
import { calculateReaction, chainable, reprocessable } from '../src/calculate.ts';
import { byId, makeCtx, resolved } from './fixtures/context.ts';
import { dataset, jitaPrices, priceBook } from './fixtures/dataset.ts';

const RUN_TIME = 4769.28;

describe('single reaction (Caesarium Cadmide, spreadsheet profile)', () => {
	const result = calculateReaction(byId(46166), makeCtx(), { view: 'single', outputMode: 'product' });

	it('buys every material with ME applied', () => {
		expect(result.runs).toBe(126);
		expect(result.runTimeSeconds).toBeCloseTo(RUN_TIME, 6);
		expect(result.chainDepth).toBe(1);
		expect(result.chain).toBeNull();
		expect(result.inputs.map((i) => [i.typeId, i.quantity])).toEqual([
			[4312, 614],
			[16643, 12268],
			[16647, 12268]
		]);
	});

	it('computes totals exactly', () => {
		const inputCost = 614 * 18000 + 2 * 12268 * 900;
		const outputValue = 126 * 200 * 66000;
		const job = 126 * (5 * 18500 + 100 * 950 + 100 * 950) * 0.1;
		const t = result.totals;
		expect(t.inputCost).toBeCloseTo(inputCost, 4);
		expect(t.inputFees).toBeCloseTo(inputCost * 0.015, 4);
		expect(t.outputValue).toBeCloseTo(outputValue, 4);
		expect(t.outputFees).toBeCloseTo(outputValue * 0.051, 4);
		expect(t.jobCost).toBeCloseTo(job, 4);
		expect(t.totalCost).toBeCloseTo(inputCost * 1.015 + job, 4);
		const profit = outputValue * 0.949 - inputCost * 1.015 - job;
		expect(t.profit).toBeCloseTo(profit, 4);
		expect(t.marginPct).toBeCloseTo((profit / outputValue) * 100, 8);
		expect(t.roiPct).toBeCloseTo((profit / (inputCost * 1.015 + job)) * 100, 8);
		expect(t.slotSeconds).toBeCloseTo(126 * RUN_TIME, 4);
		expect(t.profitPerSlotDay).toBeCloseTo(profit / ((126 * RUN_TIME) / 86400), 4);
		expect(t.profitPerRun).toBeCloseTo(profit / 126, 4);
		expect(result.missingPrices).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('honours an explicit run count', () => {
		const r = calculateReaction(byId(46166), makeCtx(), { view: 'single', outputMode: 'product', runs: 1 });
		expect(r.runs).toBe(1);
		expect(r.outputs[0].quantity).toBe(200);
		expect(r.inputs.find((i) => i.typeId === 16643)?.quantity).toBe(98);
	});
});

describe('chain (Titanium Carbide)', () => {
	const result = calculateReaction(byId(46204), makeCtx(), { view: 'chain', outputMode: 'product' });

	it('builds both intermediates with 62 runs and 132 surplus each', () => {
		expect(result.chain?.children.map((c) => [c.blueprintTypeId, c.runs, c.quantityUsed, c.surplus])).toEqual(
			[
				[46182, 62, 12268, 132],
				[46179, 62, 12268, 132]
			]
		);
		expect(result.chainDepth).toBe(2);
		expect(result.totals.slotSeconds).toBeCloseTo((126 + 124) * RUN_TIME, 4);
	});

	it('aggregates bought materials across the chain', () => {
		const qty = Object.fromEntries(result.inputs.map((i) => [i.typeId, i.quantity]));
		expect(qty).toEqual({ 4312: 614 + 302 + 302, 16638: 6037, 16641: 6037, 16635: 6037, 16636: 6037 });
	});

	it('reports surplus at output price without adding it to revenue', () => {
		expect(result.surplus.map((s) => [s.typeId, s.quantity, s.total])).toEqual([
			[16654, 132, 132 * 66000],
			[16658, 132, 132 * 66000]
		]);
		expect(result.totals.outputValue).toBeCloseTo(126 * 10000 * 1650, 4);
	});

	it('sums job costs of every node', () => {
		const top = 126 * (5 * 18500 + 100 * 63000 + 100 * 63000) * 0.1;
		const sub = 62 * (5 * 18500 + 100 * 950 + 100 * 950) * 0.1;
		expect(result.totals.jobCost).toBeCloseTo(top + 2 * sub, 4);
	});

	it('differs from buying the intermediates', () => {
		const single = calculateReaction(byId(46204), makeCtx(), { view: 'single', outputMode: 'product' });
		expect(single.inputs.map((i) => i.typeId)).toEqual([4312, 16654, 16658]);
		expect(single.totals.profit).not.toBeCloseTo(result.totals.profit!, 0);
	});

	it('uses each node reactor profile for job costs', () => {
		const ctx = makeCtx({ profiles: { composite: resolved({ costIndex: 0 }) } });
		const r = calculateReaction(byId(46204), ctx, { view: 'chain', outputMode: 'product' });
		expect(r.jobCost.systemCost).toBe(0);
	});
});

describe('chain steps (Titanium Carbide)', () => {
	const ctx = makeCtx({
		profile: { shipping: { input: { enabled: true, iskPerM3: 500, collateralPct: 1 } } }
	});
	const result = calculateReaction(byId(46204), ctx, { view: 'chain', outputMode: 'product' });
	const root = result.chain!;
	const nodes = [root, ...root.children];
	const bought = nodes.flatMap((n) => n.materials.filter((m) => m.source === 'buy'));

	it('describes the top job: 2 materials from the chain and 1 bought', () => {
		expect(root.productTypeId).toBe(16671);
		expect(root.materials.map((m) => [m.typeId, m.source])).toEqual([
			[4312, 'buy'],
			[16654, 'chain'],
			[16658, 'chain']
		]);
		expect(root.materials.filter((m) => m.source === 'chain')).toEqual([
			expect.objectContaining({ quantity: 12268, blueprintTypeId: 46182 }),
			expect.objectContaining({ quantity: 12268, blueprintTypeId: 46179 })
		]);
		expect(root.children.map((c) => c.productTypeId)).toEqual([16654, 16658]);
	});

	it('per-step bought materials sum to the aggregated inputs', () => {
		for (const input of result.inputs) {
			const lines = bought.filter((m) => m.typeId === input.typeId);
			const sum = (k: 'quantity' | 'total' | 'fees' | 'shipping') => lines.reduce((a, m) => a + m[k], 0);
			expect(sum('quantity')).toBe(input.quantity);
			expect(sum('total')).toBeCloseTo(input.total, 6);
			expect(sum('fees')).toBeCloseTo(input.fees, 6);
			expect(sum('shipping')).toBeCloseTo(input.shipping, 6);
		}
		expect(new Set(bought.map((m) => m.typeId))).toEqual(new Set(result.inputs.map((i) => i.typeId)));
		expect(result.totals.inputShipping).toBeGreaterThan(0);
	});

	it('step subtotals add up to the totals', () => {
		const sum = (k: 'purchaseCost' | 'purchaseFees' | 'purchaseShipping' | 'jobCost' | 'total') =>
			nodes.reduce((a, n) => a + n.subtotal[k], 0);
		expect(sum('jobCost')).toBeCloseTo(result.totals.jobCost, 6);
		expect(nodes.reduce((a, n) => a + n.jobCost.total, 0)).toBeCloseTo(result.totals.jobCost, 6);
		expect(sum('purchaseCost')).toBeCloseTo(result.totals.inputCost, 6);
		expect(sum('purchaseFees')).toBeCloseTo(result.totals.inputFees, 6);
		expect(sum('purchaseShipping')).toBeCloseTo(result.totals.inputShipping, 6);
		expect(sum('total')).toBeCloseTo(result.totals.totalCost, 6);
	});

	it('per-step slot time and job rates', () => {
		expect(root.slotSeconds).toBeCloseTo(126 * RUN_TIME, 6);
		expect(nodes.reduce((a, n) => a + n.slotSeconds, 0)).toBeCloseTo(result.totals.slotSeconds, 6);
		expect(root.jobRates).toEqual({ costIndex: 0.05, facilityTaxPct: 1, sccPct: 4 });
		expect(nodes.map((n) => n.depth)).toEqual([0, 1, 1]);
	});

	it('leaves every existing number unchanged by the step data', () => {
		const single = calculateReaction(byId(46204), ctx, { view: 'single', outputMode: 'product' });
		expect(single.chain).toBeNull();
		expect(result.chainDepth).toBe(2);
		expect(result.inputs.map((i) => i.typeId)).toEqual([4312, 16638, 16641, 16635, 16636]);
	});

	it('step subtotals reflect an input shipping discount', () => {
		const discounted = calculateReaction(
			byId(46204),
			makeCtx({
				profile: { shipping: { input: { enabled: true, iskPerM3: 500, collateralPct: 1, discountPct: 25 } } }
			}),
			{ view: 'chain', outputMode: 'product' }
		);
		const discountedNodes = [discounted.chain!, ...discounted.chain!.children];
		discountedNodes.forEach((n, i) => {
			expect(n.subtotal.purchaseShipping).toBeCloseTo(nodes[i].subtotal.purchaseShipping * 0.75, 6);
			expect(n.subtotal.total).toBeCloseTo(
				nodes[i].subtotal.total - nodes[i].subtotal.purchaseShipping * 0.25,
				6
			);
		});
		expect(discounted.totals.inputShipping).toBeCloseTo(result.totals.inputShipping * 0.75, 6);
		expect(discounted.totals.totalCost).toBeCloseTo(
			result.totals.totalCost - result.totals.inputShipping * 0.25,
			6
		);
	});
});

describe('booster chain depth', () => {
	it('Pure Strong Blue Pill builds Improved, which builds two Standards', () => {
		const r = calculateReaction(byId(46235), makeCtx(), { view: 'chain', outputMode: 'product' });
		expect(r.chainDepth).toBe(3);
		const improved = r.chain!.children.find((c) => c.blueprintTypeId === 46251)!;
		expect(improved.children.map((c) => c.blueprintTypeId).sort()).toEqual([46230, 46231]);
	});

	it('gives each node its depth from the top job', () => {
		const r = calculateReaction(byId(46235), makeCtx(), { view: 'chain', outputMode: 'product' });
		const depths: [number, number][] = [];
		const walk = (n: NonNullable<typeof r.chain>) => {
			depths.push([n.blueprintTypeId, n.depth]);
			n.children.forEach(walk);
		};
		walk(r.chain!);
		expect(Object.fromEntries(depths)).toMatchObject({ 46235: 0, 46251: 1, 46230: 2, 46231: 2 });
		expect(Math.max(...depths.map(([, d]) => d))).toBe(r.chainDepth - 1);
	});
});

describe('missing prices', () => {
	it('nulls the profit metrics and lists the type', () => {
		const prices = { ...jitaPrices, 16647: { buy: null, sell: 1 } };
		const r = calculateReaction(byId(46166), makeCtx({ inputPrices: priceBook({ jita: prices }) }), {
			view: 'single',
			outputMode: 'product'
		});
		expect(r.missingPrices).toEqual([16647]);
		expect(r.inputs.find((i) => i.typeId === 16647)).toMatchObject({ unitPrice: null, total: 0 });
		expect(r.totals.profit).toBeNull();
		expect(r.totals.marginPct).toBeNull();
		expect(r.totals.roiPct).toBeNull();
		expect(r.totals.profitPerSlotDay).toBeNull();
		expect(r.totals.profitPerRun).toBeNull();
	});

	it('treats a hub without the type as missing (output side)', () => {
		const prices = { ...jitaPrices };
		delete prices[16663];
		const r = calculateReaction(byId(46166), makeCtx({ outputPrices: priceBook({ jita: prices }) }), {
			view: 'single',
			outputMode: 'product'
		});
		expect(r.missingPrices).toEqual([16663]);
		expect(r.totals.profit).toBeNull();
	});

	it('marks a sub-step material without a price and lists it', () => {
		const prices = { ...jitaPrices, 16638: { buy: null, sell: 1 } };
		const r = calculateReaction(byId(46204), makeCtx({ inputPrices: priceBook({ jita: prices }) }), {
			view: 'chain',
			outputMode: 'product'
		});
		const step = r.chain!.children.find((c) => c.materials.some((m) => m.typeId === 16638))!;
		expect(step.depth).toBe(1);
		expect(step.materials.find((m) => m.typeId === 16638)).toMatchObject({
			source: 'buy',
			unitPrice: null,
			total: 0,
			fees: 0,
			shipping: 0
		});
		expect(r.missingPrices).toEqual([16638]);
		expect(r.totals.profit).toBeNull();
	});
});

describe('reprocessed outputs', () => {
	it('Unrefined Hexite → floor(runs × 36 × 55 %) Hexite', () => {
		const r = calculateReaction(byId(46191), makeCtx(), { view: 'single', outputMode: 'reprocessed' });
		expect(r.runs).toBe(63);
		expect(r.outputMode).toBe('reprocessed');
		expect(r.outputs).toHaveLength(1);
		expect(r.outputs[0]).toMatchObject({ typeId: 16665, quantity: Math.floor(63 * 36 * 0.55) });
	});

	it('Prismaticite roll 50 % → 432,400 per portion × 90.63 %', () => {
		const r = calculateReaction(byId(90274), makeCtx(), { view: 'single', outputMode: 'reprocessed' });
		expect(r.runs).toBe(1000);
		expect(r.outputs[0]).toMatchObject({ typeId: 34, quantity: Math.floor(1000 * 432_400 * 0.9063) });
	});

	it('roll and yield follow settings', () => {
		const ctx = makeCtx({
			settings: { reprocessing: { prismaticiteRollPct: 0, prismaticiteYieldPct: 100 } }
		});
		const r = calculateReaction(byId(90274), ctx, { view: 'single', outputMode: 'reprocessed', runs: 2 });
		expect(r.outputs[0].quantity).toBe(2 * 368_000);
	});

	it('falls back to the product with NO_REPROCESS_DATA', () => {
		const r = calculateReaction(byId(46166), makeCtx(), { view: 'single', outputMode: 'reprocessed' });
		expect(r.outputMode).toBe('product');
		expect(r.outputs[0].typeId).toBe(16663);
		expect(r.warnings).toContain('NO_REPROCESS_DATA');
	});
});

describe('shipping', () => {
	it('adds input shipping to cost and subtracts output shipping from revenue', () => {
		const base = calculateReaction(byId(46166), makeCtx(), {
			view: 'single',
			outputMode: 'product',
			runs: 1
		});
		const shipped = calculateReaction(
			byId(46166),
			makeCtx({
				profile: {
					shipping: {
						input: { enabled: true, iskPerM3: 1000, collateralPct: 1 },
						output: { enabled: true, iskPerM3: 500, collateralPct: 2 }
					}
				}
			}),
			{ view: 'single', outputMode: 'product', runs: 1 }
		);
		const inputShipping = 5 * 5 * 1000 + 5 * 18000 * 0.01 + 2 * (98 * 0.05 * 1000 + 98 * 900 * 0.01);
		const outputShipping = 200 * 0.2 * 500 + 200 * 66000 * 0.02;
		expect(shipped.totals.inputShipping).toBeCloseTo(inputShipping, 6);
		expect(shipped.totals.outputShipping).toBeCloseTo(outputShipping, 6);
		expect(shipped.totals.profit!).toBeCloseTo(base.totals.profit! - inputShipping - outputShipping, 4);
	});

	const shippingCtx = (inputDiscountPct: number, outputDiscountPct: number) =>
		makeCtx({
			profile: {
				shipping: {
					input: { enabled: true, iskPerM3: 1000, collateralPct: 1, discountPct: inputDiscountPct },
					output: { enabled: true, iskPerM3: 500, collateralPct: 2, discountPct: outputDiscountPct }
				}
			}
		});
	const single = { view: 'single', outputMode: 'product', runs: 1 } as const;

	it('applies the input and output discounts independently', () => {
		const full = calculateReaction(byId(46166), shippingCtx(0, 0), single);
		const inputOnly = calculateReaction(byId(46166), shippingCtx(10, 0), single);
		expect(inputOnly.totals.inputShipping).toBeCloseTo(full.totals.inputShipping * 0.9, 6);
		expect(inputOnly.totals.outputShipping).toBeCloseTo(full.totals.outputShipping, 6);
		expect(inputOnly.totals.totalCost).toBeCloseTo(
			full.totals.totalCost - full.totals.inputShipping * 0.1,
			6
		);
		expect(inputOnly.totals.profit!).toBeCloseTo(full.totals.profit! + full.totals.inputShipping * 0.1, 4);

		const outputOnly = calculateReaction(byId(46166), shippingCtx(0, 40), single);
		expect(outputOnly.totals.inputShipping).toBeCloseTo(full.totals.inputShipping, 6);
		expect(outputOnly.totals.outputShipping).toBeCloseTo(full.totals.outputShipping * 0.6, 6);
		expect(outputOnly.outputs[0].shipping).toBeCloseTo(full.outputs[0].shipping * 0.6, 6);
		expect(outputOnly.totals.profit!).toBeCloseTo(full.totals.profit! + full.totals.outputShipping * 0.4, 4);
	});

	it('100 % discounts make shipping free', () => {
		const base = calculateReaction(byId(46166), makeCtx(), single);
		const free = calculateReaction(byId(46166), shippingCtx(100, 100), single);
		expect(free.totals.inputShipping).toBe(0);
		expect(free.totals.outputShipping).toBe(0);
		expect(free.inputs.every((i) => i.shipping === 0)).toBe(true);
		expect(free.totals.profit!).toBeCloseTo(base.totals.profit!, 6);
	});
});

describe('warnings', () => {
	it('SKILL_TOO_LOW, COST_INDEX_MISSING, MISSING_ADJUSTED_PRICE', () => {
		const r = calculateReaction(
			byId(46204),
			makeCtx({
				profile: { reactionsSkill: 1, costIndexMissing: true },
				inputPrices: priceBook(undefined, {})
			}),
			{ view: 'single', outputMode: 'product' }
		);
		expect(r.warnings.sort()).toEqual(['COST_INDEX_MISSING', 'MISSING_ADJUSTED_PRICE', 'SKILL_TOO_LOW']);
		expect(r.totals.jobCost).toBe(0);
	});

	it('MAX_RUNS_PER_JOB when the formula caps runs below the cycle capacity', () => {
		const ctx = makeCtx();
		ctx.dataset = { ...dataset, reactions: dataset.reactions.map((r) => ({ ...r, maxRuns: 100 })) };
		const capped = calculateReaction(ctx.dataset.reactions[0], ctx, {
			view: 'single',
			outputMode: 'product'
		});
		expect(capped.runs).toBe(100);
		expect(capped.warnings).toContain('MAX_RUNS_PER_JOB');
		const uncapped = calculateReaction(byId(46166), makeCtx(), { view: 'single', outputMode: 'product' });
		expect(uncapped.warnings).not.toContain('MAX_RUNS_PER_JOB');
	});

	it('CYCLE_SHORTER_THAN_RUN when no run fits the cycle', () => {
		const ctx = makeCtx({ settings: { cycleDays: 0.25 } });
		ctx.dataset = {
			...dataset,
			reactions: dataset.reactions.map((r) => ({ ...r, baseTimeSeconds: 100_000 }))
		};
		const r = calculateReaction(ctx.dataset.reactions[0], ctx, { view: 'single', outputMode: 'product' });
		expect(r.runs).toBe(1);
		expect(r.warnings).toContain('CYCLE_SHORTER_THAN_RUN');
	});
});

describe('chainable / reprocessable', () => {
	it('detects reactions whose materials are reaction products', () => {
		expect(chainable(byId(46204), dataset)).toBe(true);
		expect(chainable(byId(46166), dataset)).toBe(false);
		expect(reprocessable(byId(46191), dataset)).toBe(true);
		expect(reprocessable(byId(46204), dataset)).toBe(false);
	});
});
