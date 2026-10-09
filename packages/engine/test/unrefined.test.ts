import { describe, expect, it } from 'vitest';
import { calculateAllocated } from '../src/allocation.ts';
import { calculateReaction, type CalcContext, type ChainNode, type View } from '../src/calculate.ts';
import { chainFor, listReactions } from '../src/listing.ts';
import { planReactions, type PlanInput, type PlanResult } from '../src/planner.ts';
import { DEFAULT_SETTINGS, Settings, settingsDiff } from '../src/settings.ts';
import type { Dataset, HubPrice, Reaction } from '../src/types.ts';
import { chooseUnrefined, unrefinable, unrefinedRuns, type RouteScore } from '../src/unrefined.ts';
import { makeCtx, resolved } from './fixtures/context.ts';
import { dataset as fixture } from './fixtures/dataset.ts';

// Final (100 X + 20 D → 200 F) needs X, made by its regular reaction (100 A + 100 B → 200 X) or by an
// unrefined one (100 C + 100 D → 1 U) whose product reprocesses into 100 X + 150 D at 100 % yield.
const A = 1001;
const B = 1002;
const C = 1003;
const D = 1004;
const X = 2001;
const U = 3001;
const F = 4001;

const reaction = (
	blueprintTypeId: number,
	name: string,
	tier: Reaction['tier'],
	baseTimeSeconds: number,
	product: [number, number],
	materials: [number, number][]
): Reaction => ({
	blueprintTypeId,
	slug: name.toLowerCase().replace(/ /g, '-'),
	name,
	formulaName: `${name} Reaction Formula`,
	reactor: 'composite',
	tier,
	baseTimeSeconds,
	maxRuns: 1000,
	requiredSkillLevel: 1,
	product: { typeId: product[0], quantity: product[1] },
	materials: materials.map(([typeId, quantity]) => ({ typeId, quantity }))
});

const REGULAR = reaction(
	5001,
	'Xite',
	'intermediate',
	10800,
	[X, 200],
	[
		[A, 100],
		[B, 100]
	]
);
const UNREFINED = reaction(
	5002,
	'Unrefined Xite',
	'unrefined',
	21600,
	[U, 1],
	[
		[C, 100],
		[D, 100]
	]
);
const FINAL = reaction(
	5003,
	'Final',
	'composite',
	10800,
	[F, 200],
	[
		[X, 100],
		[D, 20]
	]
);

// Two unrefined jobs that could feed each other: Unrefined Xite (100 C + 100 Q) reprocesses into
// 100 X + 150 P, Unrefined Yite (100 C + 100 P) into 100 Y + 150 Q; Final Two takes 100 X + 100 Y.
const P = 1006;
const Q = 1007;
const Y = 2002;
const UX = 3002;
const UY = 3003;
const F2 = 4002;
const REGULAR_Y = reaction(
	5004,
	'Yite',
	'intermediate',
	10800,
	[Y, 200],
	[
		[A, 100],
		[B, 100]
	]
);
const UNREFINED_X = reaction(
	5005,
	'Unrefined Xite',
	'unrefined',
	21600,
	[UX, 1],
	[
		[C, 100],
		[Q, 100]
	]
);
const UNREFINED_Y = reaction(
	5006,
	'Unrefined Yite',
	'unrefined',
	21600,
	[UY, 1],
	[
		[C, 100],
		[P, 100]
	]
);
const FINAL_TWO = reaction(
	5007,
	'Final Two',
	'composite',
	10800,
	[F2, 200],
	[
		[X, 100],
		[Y, 100]
	]
);

const names: Record<number, string> = {
	[A]: 'A',
	[B]: 'B',
	[C]: 'C',
	[D]: 'D',
	[P]: 'P',
	[Q]: 'Q',
	[X]: 'Xite',
	[Y]: 'Yite',
	[U]: 'Unrefined Xite',
	[UX]: 'Unrefined Xite',
	[UY]: 'Unrefined Yite',
	[F]: 'Final',
	[F2]: 'Final Two'
};
const types = Object.fromEntries(
	Object.entries(names).map(([id, name]) => [
		id,
		{ typeId: Number(id), name, volume: 1, portionSize: 1, groupId: 1 }
	])
);
const reprocessInto = (typeId: number, into: [number, number][]) => ({
	typeId,
	portionSize: 1,
	materials: into.map(([t, quantity]) => ({ typeId: t, quantity, quantityMin: null, quantityMax: null }))
});
const mini: Dataset = {
	...fixture,
	reactions: [REGULAR, UNREFINED, FINAL],
	types,
	reprocess: {
		[U]: reprocessInto(U, [
			[X, 100],
			[D, 150]
		])
	}
};
const mutual: Dataset = {
	...fixture,
	reactions: [REGULAR, REGULAR_Y, UNREFINED_X, UNREFINED_Y, FINAL_TWO],
	types,
	reprocess: {
		[UX]: reprocessInto(UX, [
			[X, 100],
			[P, 150]
		]),
		[UY]: reprocessInto(UY, [
			[Y, 100],
			[Q, 150]
		])
	}
};

/** Contracts at the buy price (no fees), no job cost and no rigs: every cost is a plain sum. */
function ctx(
	finalPrice: number,
	settings: Record<string, unknown> = {},
	opts: { dataset?: Dataset; prices?: Record<number, number> } = {}
): CalcContext {
	const price = (p: number): HubPrice => ({ buy: p, sell: p });
	const base = {
		[A]: 10,
		[B]: 10,
		[C]: 5,
		[D]: 2,
		[P]: 2,
		[Q]: 2,
		[X]: 12,
		[Y]: 12,
		[F]: finalPrice,
		[F2]: finalPrice
	};
	const jita = Object.fromEntries(
		Object.entries({ ...base, ...opts.prices }).map(([id, p]) => [id, price(p)])
	);
	const p = resolved({
		meRig: 'none',
		teRig: 'none',
		costIndex: 0,
		facilityTaxPct: 0,
		sccPct: 0,
		market: {
			inputMethod: 'contract',
			outputMethod: 'contract',
			inputContractBasis: 'buy',
			outputContractBasis: 'buy'
		}
	});
	const book = { asOf: '2026-10-06T00:00:00.000Z', approximate: false, hubs: { jita }, adjusted: {} };
	return {
		...makeCtx(),
		dataset: opts.dataset ?? mini,
		profiles: { biochemical: p, composite: p, hybrid: p },
		settings: Settings.parse({ reprocessing: { unrefinedYieldPct: 100 }, ...settings }),
		inputPrices: book,
		outputPrices: book
	};
}

const chain = (c: CalcContext, runs = 2, viaUnrefined?: number[], view: View = 'unrefined') =>
	calculateReaction(FINAL, c, { view, outputMode: 'product', runs, viaUnrefined });

const planInput = (c: CalcContext, overrides: Partial<PlanInput> = {}): PlanInput => ({
	ctx: c,
	totalSlots: Number.POSITIVE_INFINITY,
	targets: [{ blueprintTypeId: FINAL.blueprintTypeId, lines: 1 }],
	buyInsteadOfBuild: [],
	stock: {},
	ownedFormulas: {},
	dailyVolumes: {},
	...overrides
});

const jobs = (root: ChainNode): ChainNode[] => [root, ...root.children.flatMap(jobs)];

describe('planner with an unrefined route and its regular reaction both as targets', () => {
	it('builds the replaced type once, through the unrefined route, whatever the blueprint id order', () => {
		// The regular reaction sorts after its consumer (a higher blueprint id), so the consumer's demand is
		// known when the regular reaction is sized: it must still build only its own target lines.
		const late = { ...REGULAR, blueprintTypeId: 5009 };
		const dataset: Dataset = { ...mini, reactions: [late, UNREFINED, FINAL] };
		const c = ctx(5, {}, { dataset });
		const runs = (plan: PlanResult, name: string) =>
			plan.reactions.filter((r) => r.name === name).reduce((acc, r) => acc + r.totalRuns, 0);
		const via = { viaUnrefined: [X] };
		const both = planReactions(
			planInput(c, {
				...via,
				targets: [
					{ blueprintTypeId: FINAL.blueprintTypeId, lines: 1 },
					{ blueprintTypeId: late.blueprintTypeId, lines: 1 }
				]
			})
		);
		const finalOnly = planReactions(planInput(c, via));
		const xiteOnly = planReactions(
			planInput(c, { ...via, targets: [{ blueprintTypeId: late.blueprintTypeId, lines: 1 }] })
		);
		expect(runs(xiteOnly, 'Xite')).toBeGreaterThan(0);
		expect(runs(both, 'Xite')).toBe(runs(xiteOnly, 'Xite'));
		expect(runs(both, 'Unrefined Xite')).toBe(runs(finalOnly, 'Unrefined Xite'));
	});
});

describe('unrefined routes in full chains', () => {
	it('builds the intermediate by reprocessing; later jobs use the byproduct, the rest is sold', () => {
		// 2 runs need 200 X + 40 D. 2 unrefined runs use 200 C + 200 D and yield 200 X + 300 D. The
		// unrefined job cannot use its own output (it is reprocessed after the job): it buys its 200 D,
		// the final job then takes 40 D from reprocessing and 260 D are sold.
		const r = chain(ctx(5), 2, [X]);
		expect(r.viaUnrefined).toEqual([X]);
		const job = r.chain!.children[0];
		expect([job.name, job.runs, job.quantityProduced, job.surplus, job.step]).toEqual([
			'Unrefined Xite',
			2,
			2,
			0,
			1
		]);
		expect(job.reprocess).toEqual({
			typeId: X,
			replacesBlueprintTypeId: REGULAR.blueprintTypeId,
			replacesName: 'Xite',
			yieldPct: 100,
			surplus: 0,
			outputs: [
				{ typeId: X, name: 'Xite', quantity: 200, used: 200, sold: 0 },
				{ typeId: D, name: 'D', quantity: 300, used: 40, sold: 260 }
			]
		});
		expect(job.materials.map((m) => [m.source, m.typeId, m.quantity])).toEqual([
			['buy', C, 200],
			['buy', D, 200]
		]);
		expect(r.chain!.materials.map((m) => [m.source, m.typeId, m.quantity])).toEqual([
			['chain', X, 200],
			['byproduct', D, 40]
		]);
		expect(r.inputs.map((i) => [i.typeId, i.quantity])).toEqual([
			[C, 200],
			[D, 200]
		]);
		expect(r.outputs.map((o) => [o.typeId, o.quantity, o.total])).toEqual([
			[F, 400, 2000],
			[D, 260, 520]
		]);
		expect(r.totals.totalCost).toBe(1400);
		expect(r.totals.profit).toBe(1120);
		expect([r.chain!.step, r.chainDepth]).toEqual([2, 2]);
		const rt = r.chain!.runTimeSeconds;
		expect(r.totals.slotSeconds).toBeCloseTo(2 * rt + 2 * (2 * rt), 6);
	});

	it('runs enough unrefined jobs for the need at the reprocessing yield', () => {
		// 55 %: 55 X per run → 4 runs for 200 X → ⌊4 × 100 × 0.55⌋ = 220 X (20 surplus) and 330 D.
		const r = chain(ctx(5, { reprocessing: { unrefinedYieldPct: 55 } }), 2, [X]);
		const job = r.chain!.children[0];
		expect(job.runs).toBe(4);
		expect(job.reprocess!.yieldPct).toBe(55);
		expect(job.reprocess!.surplus).toBe(20);
		expect(job.reprocess!.outputs.map((o) => [o.typeId, o.quantity, o.used, o.sold])).toEqual([
			[X, 220, 200, 0],
			[D, 330, 40, 290]
		]);
		expect(r.inputs.map((i) => [i.typeId, i.quantity])).toEqual([
			[C, 400],
			[D, 400]
		]);
		expect(r.surplus.map((s) => [s.typeId, s.quantity])).toEqual([[X, 20]]);
	});

	it('uses the previous cycle’s byproducts in every job of a steady cycle, its own included', () => {
		// Optimal slots price one steady cycle: the unrefined jobs reuse last cycle's D (330 of their 400),
		// a short byproduct splitting their purchase; the final job buys its 40 D.
		const c = ctx(5, { reprocessing: { unrefinedYieldPct: 55 } });
		const r = calculateReaction(FINAL, c, {
			view: 'unrefined',
			outputMode: 'product',
			runs: 2,
			splitJobs: true,
			viaUnrefined: [X]
		});
		const job = r.chain!.children[0];
		expect(job.materials.map((m) => [m.source, m.typeId, m.quantity])).toEqual([
			['buy', C, 400],
			['byproduct', D, 330],
			['buy', D, 70]
		]);
		expect(r.inputs.map((i) => [i.typeId, i.quantity])).toEqual([
			[C, 400],
			[D, 110]
		]);
		expect(r.outputs.map((o) => o.typeId)).toEqual([F]);
		// No ordering within a steady cycle: the steps are the tree's levels.
		expect([job.step, r.chain!.step]).toEqual([1, 2]);
	});

	it('runs two unrefined jobs that could feed each other one after the other, the more valuable use first', () => {
		const run = (prices: Record<number, number>) => {
			const r = calculateReaction(FINAL_TWO, ctx(5, {}, { dataset: mutual, prices }), {
				view: 'unrefined',
				outputMode: 'product',
				runs: 1,
				viaUnrefined: [X, Y]
			});
			const byName = Object.fromEntries(jobs(r.chain!).map((n) => [n.name, n]));
			return { r, ux: byName['Unrefined Xite'], uy: byName['Unrefined Yite'] };
		};
		// P is worth more: Unrefined Xite runs first and its P replaces Unrefined Yite's purchase; Unrefined
		// Yite's Q comes too late for Unrefined Xite and is sold.
		const pFirst = run({ [P]: 10, [Q]: 2 });
		expect([pFirst.ux.step, pFirst.uy.step, pFirst.r.chain!.step, pFirst.r.chainDepth]).toEqual([1, 2, 3, 3]);
		expect(pFirst.uy.materials.map((m) => [m.source, m.typeId, m.quantity])).toEqual([
			['buy', C, 100],
			['byproduct', P, 100]
		]);
		expect(pFirst.ux.materials.map((m) => [m.source, m.typeId])).toEqual([
			['buy', C],
			['buy', Q]
		]);
		expect(pFirst.r.outputs.map((o) => [o.typeId, o.quantity])).toEqual([
			[F2, 200],
			[P, 50],
			[Q, 150]
		]);
		// Q is worth more: the other order.
		const qFirst = run({ [P]: 2, [Q]: 10 });
		expect([qFirst.uy.step, qFirst.ux.step]).toEqual([1, 2]);
		expect(qFirst.ux.materials.map((m) => [m.source, m.typeId, m.quantity])).toEqual([
			['buy', C, 100],
			['byproduct', Q, 100]
		]);
		// Never both directions, never a job's own output.
		for (const { r } of [pFirst, qFirst])
			for (const n of jobs(r.chain!))
				for (const m of n.materials)
					if (m.source === 'byproduct') {
						const producer = jobs(r.chain!).find((j) => j.blueprintTypeId === m.blueprintTypeId)!;
						expect(producer.step).toBeLessThan(n.step);
					}
	});

	it('finds the fewest unrefined runs whose reprocessing covers the need', () => {
		const s = Settings.parse({ reprocessing: { unrefinedYieldPct: 55 } });
		expect(unrefinedRuns(mini, s, UNREFINED, X, 55)).toBe(1);
		expect(unrefinedRuns(mini, s, UNREFINED, X, 56)).toBe(2);
		expect(unrefinedRuns(mini, s, UNREFINED, X, 110)).toBe(2);
		expect(unrefinedRuns(mini, s, UNREFINED, A, 10)).toBeNull();
		expect(
			unrefinedRuns(mini, Settings.parse({ reprocessing: { unrefinedYieldPct: 0 } }), UNREFINED, X, 1)
		).toBeNull();
	});

	it('substitutes only when it raises profit per slot-day', () => {
		// Regular: 2000 (X) + 80 (D) over 3 run lengths; unrefined: 1000 + 400 (D) − 520 sold over 6.
		// The unrefined chain wins iff 400P − 880 > 2 × (400P − 2080), i.e. below P = 8.2.
		const loss = chain(ctx(5));
		expect(loss.viaUnrefined).toEqual([X]);
		expect(loss.totals.profit).toBe(1120);

		const profitable = chain(ctx(10));
		expect(profitable.viaUnrefined).toEqual([]);
		expect(profitable.chain!.children[0].name).toBe('Xite');
		expect(profitable.totals.profit).toBe(4000 - 2080);
		// Cheaper per unit of X, but slower: more profit, less per slot-day.
		const forced = chain(ctx(10), 2, [X]);
		expect(forced.totals.profit!).toBeGreaterThan(profitable.totals.profit!);
		expect(forced.totals.profitPerSlotDay!).toBeLessThan(profitable.totals.profitPerSlotDay!);
	});

	it('keeps the chain view regular whatever the setting; `best` only drives the planner', () => {
		expect(DEFAULT_SETTINGS.unrefinedInChains).toBe('never');
		expect(settingsDiff(Settings.parse({ unrefinedInChains: 'best' }))).toEqual({
			unrefinedInChains: 'best'
		});
		for (const c of [ctx(5), ctx(5, { unrefinedInChains: 'best' })]) {
			const regular = chain(c, 2, undefined, 'chain');
			expect(regular.viaUnrefined).toEqual([]);
			expect(regular.chain!.children.map((n) => [n.name, n.reprocess])).toEqual([['Xite', undefined]]);
			expect(chain(c, 2).viaUnrefined).toEqual([X]);
		}
		expect(planReactions(planInput(ctx(5))).reactions.map((p) => p.name)).toEqual(['Final', 'Xite']);
		expect(
			planReactions(planInput(ctx(5, { unrefinedInChains: 'best' }))).reactions.map((p) => p.name)
		).toEqual(['Final', 'Unrefined Xite']);
	});

	it('can skip the Using unrefined variant without changing the regular chain or best', () => {
		const find = (rows: ReturnType<typeof listReactions>) =>
			rows.find((r) => r.reaction.blueprintTypeId === FINAL.blueprintTypeId)!;
		const full = find(listReactions(ctx(5)));
		const lean = find(listReactions(ctx(5), {}, {}, { unrefined: false }));
		expect(full.unrefined).not.toBeNull();
		expect(lean.unrefined).toBeNull();
		expect(lean.chain!.totals).toEqual(full.chain!.totals);
		expect(lean.best.totals).toEqual(full.best.totals);
	});

	it('lists the regular chain and the unrefined variant apart; the setting picks which one ranks', () => {
		const row = (c: CalcContext) =>
			listReactions(c).find((r) => r.reaction.blueprintTypeId === FINAL.blueprintTypeId)!;
		const off = row(ctx(5));
		expect(off.chain!.viaUnrefined).toEqual([]);
		expect([off.unrefined!.view, off.unrefined!.viaUnrefined]).toEqual(['unrefined', [X]]);
		expect(chainFor(off, DEFAULT_SETTINGS)).toBe(off.chain);
		expect(off.best).not.toBe(off.unrefined);
		const best = Settings.parse({ unrefinedInChains: 'best' });
		const on = row(ctx(5, { unrefinedInChains: 'best' }));
		expect(on.chain!.viaUnrefined).toEqual([]);
		expect(on.chain!.totals).toEqual(off.chain!.totals);
		expect(on.unrefined!.totals).not.toEqual(on.chain!.totals);
		expect(chainFor(on, best)).toBe(on.unrefined);
		expect(on.best).toBe(on.unrefined);
		// No route wins at this price: the variant is the regular chain.
		const noWin = row(ctx(10));
		expect(noWin.unrefined!.viaUnrefined).toEqual([]);
		expect(noWin.unrefined!.totals).toEqual(noWin.chain!.totals);
		expect(chainFor({ chain: noWin.chain, unrefined: null }, best)).toBe(noWin.chain);
		expect(unrefinable(FINAL, mini)).toBe(true);
		const tic = fixture.reactions.find((r) => r.slug === 'titanium-carbide')!;
		expect(unrefinable(tic, fixture)).toBe(false);
		expect(listReactions(makeCtx()).every((r) => r.unrefined === null)).toBe(true);
	});

	it('keeps the regular reaction without reprocess data or without yield', () => {
		const noData = { ...ctx(5), dataset: { ...mini, reprocess: {} } };
		expect(chain(noData).viaUnrefined).toEqual([]);
		expect(chain(noData, 2, [X]).chain!.children[0].name).toBe('Xite');
		const noYield = ctx(5, { reprocessing: { unrefinedYieldPct: 0 } });
		expect(chain(noYield).viaUnrefined).toEqual([]);
		expect(chain(noYield, 2, [X]).chain!.children[0].name).toBe('Xite');
	});

	it('does not count a larger loss spread over more slot-days as better', () => {
		const c = ctx(5);
		const choose = (base: RouteScore, alt: RouteScore) =>
			chooseUnrefined(FINAL, c, (via) => (via.length === 0 ? base : alt));
		const loss: RouteScore = { profit: -400, profitPerSlotDay: -10, finalUnits: 400 };
		expect(choose(loss, { profit: -500, profitPerSlotDay: -5, finalUnits: 400 })).toEqual([]);
		expect(choose(loss, { profit: -300, profitPerSlotDay: -5, finalUnits: 400 })).toEqual([X]);
		expect(choose(loss, { profit: 10, profitPerSlotDay: 0.1, finalUnits: 400 })).toEqual([X]);
		const gain: RouteScore = { profit: 400, profitPerSlotDay: 10, finalUnits: 400 };
		expect(choose(gain, { profit: 900, profitPerSlotDay: 9, finalUnits: 400 })).toEqual([]);
		expect(choose(gain, { profit: 900, profitPerSlotDay: 10, finalUnits: 400 })).toEqual([]);
		expect(choose({ ...gain, profit: null, profitPerSlotDay: null }, gain)).toEqual([]);
	});

	it('leaves chains without unrefined alternatives unchanged', () => {
		const tic = fixture.reactions.find((r) => r.slug === 'titanium-carbide')!;
		const regular = calculateReaction(tic, makeCtx(), { view: 'chain', outputMode: 'product' });
		const unrefined = calculateReaction(tic, makeCtx(), { view: 'unrefined', outputMode: 'product' });
		expect(unrefined.viaUnrefined).toEqual([]);
		expect({ ...unrefined, view: 'chain' }).toEqual(regular);
	});

	it('plans the same route with optimal slots, crediting byproducts one cycle later', () => {
		const c = ctx(5, { slotAllocation: 'optimal' });
		const r = calculateAllocated(FINAL, c, { view: 'unrefined', outputMode: 'product' });
		expect(r.viaUnrefined).toEqual([X]);
		expect(calculateAllocated(FINAL, c, { view: 'chain', outputMode: 'product' }).viaUnrefined).toEqual([]);
		const plan = planReactions(
			planInput(c, {
				targets: [{ blueprintTypeId: FINAL.blueprintTypeId, lines: r.allocation!.lines }],
				viaUnrefined: r.viaUnrefined
			})
		);
		const top = plan.reactions.find((p) => p.blueprintTypeId === FINAL.blueprintTypeId)!;
		const unrefined = plan.reactions.find((p) => p.blueprintTypeId === UNREFINED.blueprintTypeId)!;
		expect(plan.reactions.some((p) => p.blueprintTypeId === REGULAR.blueprintTypeId)).toBe(false);
		// Per top run: 100 X and 20 D; one unrefined run uses 100 D and yields 100 X + 150 D.
		const T = top.totalRuns;
		expect(unrefined.reprocess).toEqual({
			replaces: [{ typeId: X, name: 'Xite', quantity: 100 * T, regularName: 'Xite' }],
			byproducts: [
				{
					typeId: D,
					name: 'D',
					quantity: 150 * T,
					used: 120 * T,
					sold: 30 * T,
					usedBy: [
						{ blueprintTypeId: FINAL.blueprintTypeId, fromCycle: 2 },
						{ blueprintTypeId: UNREFINED.blueprintTypeId, fromCycle: 2 }
					]
				}
			]
		});
		expect(unrefined.totalRuns).toBe(T);
		// What each job consumes per cycle and who makes it: the reprocessed X comes from the unrefined job,
		// the D both jobs need is bought, 120 T of it reused from the previous cycle's reprocessing.
		expect(top.product).toEqual({ typeId: F, name: 'Final', quantity: 200 * T });
		expect(top.materials).toEqual([
			{ typeId: X, name: 'Xite', quantity: 100 * T, producer: UNREFINED.blueprintTypeId },
			{ typeId: D, name: 'D', quantity: 20 * T, producer: null }
		]);
		expect(unrefined.product).toEqual({ typeId: U, name: 'Unrefined Xite', quantity: T });
		expect(unrefined.materials).toEqual([
			{ typeId: C, name: 'C', quantity: 100 * T, producer: null },
			{ typeId: D, name: 'D', quantity: 100 * T, producer: null }
		]);
		expect(plan.startup.reused).toEqual([{ typeId: D, name: 'D', quantity: 120 * T }]);
		expect(plan.purchasesPerCycle.map((p) => [p.typeId, p.quantity])).toEqual([[C, 100 * T]]);
		expect(plan.outputsPerCycle.map((o) => [o.typeId, o.quantity])).toEqual([
			[F, 200 * T],
			[D, 30 * T]
		]);
		// Cycle 1 runs only the unrefined jobs and buys all their D; cycle 2 lives on cycle 1's 150 T.
		expect(plan.initialPurchases.find((p) => p.typeId === D)!.quantity).toBe(100 * T);
		expect(plan.phases[0].purchases.find((p) => p.typeId === D)!.quantity).toBe(100 * T);
		expect(plan.phases[1].purchases.some((p) => p.typeId === D)).toBe(false);
		expect(plan.totals.profitPerCycle).toBeCloseTo(r.totals.profit!, 6);
		// Only the job's own byproduct comes back: no step 0.
		expect(plan.startup).toMatchObject({ mode: 'buy', step0: null });
		expect(r.allocation!.startup.mode).toBe('buy');
	});
});

// Unrefined Xite (100 C + 100 Q) reprocesses into 100 X + 150 P; Pyite (100 A + 100 P → 200 Y) runs in
// the same first cycle; Final Two takes 100 X + 100 Y.
const PYITE = reaction(
	5008,
	'Pyite',
	'intermediate',
	10800,
	[Y, 200],
	[
		[A, 100],
		[P, 100]
	]
);
const feeding: Dataset = {
	...mutual,
	reactions: [REGULAR, UNREFINED_X, PYITE, FINAL_TWO],
	reprocess: { [UX]: mutual.reprocess[UX] }
};

describe('start-up of a plan whose unrefined job feeds another first-cycle job', () => {
	const plan = (pPrice: number, lines = 2) =>
		planReactions({
			...planInput(ctx(5, {}, { dataset: feeding, prices: { [P]: pPrice, [Q]: 2 } }), {
				targets: [{ blueprintTypeId: FINAL_TWO.blueprintTypeId, lines }]
			}),
			viaUnrefined: [X]
		});
	const runs = (p: PlanResult, id: number) => p.reactions.find((r) => r.blueprintTypeId === id)!.totalRuns;

	it('runs the unrefined job in a step 0 when buying the first cycle’s byproduct costs more', () => {
		// Step 0 costs the unrefined job's C and Q (100 × 7 per run); it saves Pyite's first-cycle P.
		const p = plan(20);
		const T = runs(p, UNREFINED_X.blueprintTypeId);
		const needP = 100 * runs(p, PYITE.blueprintTypeId);
		expect(p.startup.mode).toBe('step0');
		expect(p.startup.step0).toMatchObject({
			cycles: 3,
			blueprintTypeIds: [UNREFINED_X.blueprintTypeId],
			saves: [{ typeId: P, quantity: needP }],
			stock: [
				{ typeId: X, quantity: 100 * T },
				{ typeId: P, quantity: 150 * T - needP }
			]
		});
		expect(p.startup.buy.cycles).toBe(2);
		expect(p.startup.buy.initialInvestment! - p.startup.step0!.initialInvestment!).toBeCloseTo(
			needP * 20 - 700 * T,
			6
		);
		expect(p.totals.initialInvestment).toBe(p.startup.step0!.initialInvestment);
		expect(p.phases.map((ph) => [ph.cycle, ph.label, ph.blueprintTypeIds])).toEqual([
			[0, 'step_0', [UNREFINED_X.blueprintTypeId]],
			[1, 'build_up', [UNREFINED_X.blueprintTypeId, PYITE.blueprintTypeId]],
			[2, 'steady', [FINAL_TWO.blueprintTypeId, UNREFINED_X.blueprintTypeId, PYITE.blueprintTypeId]]
		]);
		const bought = (cycle: number, typeId: number) =>
			p.phases.find((ph) => ph.cycle === cycle)!.purchases.find((i) => i.typeId === typeId)?.quantity ?? 0;
		expect([bought(0, C), bought(0, Q), bought(0, P)]).toEqual([100 * T, 100 * T, 0]);
		expect(bought(1, P)).toBe(0);
		expect(
			p.reactions.find((r) => r.blueprintTypeId === UNREFINED_X.blueprintTypeId)!.reprocess!.byproducts
		).toEqual([
			expect.objectContaining({
				typeId: P,
				usedBy: [{ blueprintTypeId: PYITE.blueprintTypeId, fromCycle: 1 }]
			})
		]);
	});

	it('buys for the first cycle when that is cheaper or costs the same; the steady cycle is unchanged', () => {
		const cheap = plan(10);
		expect(cheap.startup.mode).toBe('buy');
		expect(cheap.startup.step0!.initialInvestment!).toBeGreaterThan(cheap.startup.buy.initialInvestment!);
		expect(cheap.phases.map((ph) => ph.label)).toEqual(['build_up', 'steady']);
		expect(cheap.phases[0].purchases.find((i) => i.typeId === P)!.quantity).toBe(
			100 * runs(cheap, PYITE.blueprintTypeId)
		);
		// Even runs (2 lines): Pyite needs 50 P per unrefined run, so 14 ISK is the break-even price.
		const T = runs(cheap, UNREFINED_X.blueprintTypeId);
		expect(T % 2).toBe(0);
		const tie = plan(14);
		expect(tie.startup.step0!.initialInvestment!).toBeCloseTo(tie.startup.buy.initialInvestment!, 6);
		expect(tie.startup.mode).toBe('buy');

		const step0 = plan(20);
		const steadyCost = (p: PlanResult) => p.purchasesPerCycle.map((i) => [i.typeId, i.quantity]);
		expect(steadyCost(step0)).toEqual(steadyCost(cheap));
		expect(step0.phases.at(-1)!.purchases.map((i) => [i.typeId, i.quantity])).toEqual(steadyCost(step0));
		const r = calculateAllocated(
			FINAL_TWO,
			ctx(5, { slotAllocation: 'optimal' }, { dataset: feeding, prices: { [P]: 20, [Q]: 2 } }),
			{
				view: 'unrefined',
				outputMode: 'product',
				lines: 2,
				viaUnrefined: [X]
			}
		);
		expect(r.allocation!.startup.mode).toBe('step0');
		expect(r.allocation!.phases[0].label).toBe('step_0');
		expect(r.totals.profit).toBeCloseTo(step0.totals.profitPerCycle!, 6);
	});

	it('does not compare start-ups when a purchase has no price: buys first, investments unknown', () => {
		// At P = 20 step 0 wins (test above); without a price for A (bought by Pyite in every start-up)
		// neither sum is complete, so neither can look cheaper.
		const c = ctx(5, {}, { dataset: feeding, prices: { [P]: 20, [Q]: 2 } });
		delete c.inputPrices.hubs.jita[A];
		const p = planReactions({
			...planInput(c, { targets: [{ blueprintTypeId: FINAL_TWO.blueprintTypeId, lines: 2 }] }),
			viaUnrefined: [X]
		});
		expect(p.startup.mode).toBe('buy');
		expect([p.startup.buy.initialInvestment, p.startup.step0!.initialInvestment]).toEqual([null, null]);
		expect(p.phases[0].label).not.toBe('step_0');
	});
});
