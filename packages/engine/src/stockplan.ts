import {
	LineItemBag,
	type CalcContext,
	type LineItem,
	type PricingContext,
	type Warning
} from './calculate.ts';
import { isFuelBlock, sortMaterials } from './constants.ts';
import {
	eiv,
	inputUnitPrice,
	jobCost,
	materialModifier,
	requiredQuantity,
	runsPerCycleDetail,
	shippingCost,
	splitIntoSlots
} from './formulas.ts';
import { inventoryRole, stockUnitValue } from './inventory.ts';
import { DEFAULT_NODE_CAP, solveLp, solveMip, type LinearConstraint } from './lp.ts';
import type { PlanItem } from './planner.ts';
import type { ResolvedProfile } from './settings.ts';
import { InputSourcing, type Purchase } from './sourcing.ts';
import type { Reaction } from './types.ts';

/**
 * Most cycles a stock plan spans. On the owner's inventory (66 held types, 589 formulas, 150 slots)
 * 12 cycles still give a first plan in under 0.1 s; inventories holding every raw material can take
 * seconds from 8 cycles on.
 */
export const STOCK_PLAN_MAX_CYCLES = 12;
/** Default `maxCycles`. Cycles after the last one with jobs are hidden in the planner, so a longer default costs nothing. */
export const STOCK_PLAN_DEFAULT_MAX_CYCLES = 4;

export interface StockPlanInput {
	ctx: CalcContext;
	totalSlots: number;
	/** Units held per type id: raw materials, intermediates, products and fuel blocks. */
	stock: Record<number, number>;
	/** Formulas held per blueprint type id. */
	ownedFormulas: Record<number, number>;
	/**
	 * Cycles to plan, 1 to {@link STOCK_PLAN_MAX_CYCLES}. Default {@link STOCK_PLAN_DEFAULT_MAX_CYCLES}.
	 */
	maxCycles?: number;
	/**
	 * Lets the plan buy formulas at their market price (the planner's formula price; unpriced formulas
	 * are never bought), including more copies of owned ones. Default false: only owned formulas run.
	 */
	allowUnownedFormulas?: boolean;
	/** Branch-and-bound node cap; default {@link DEFAULT_NODE_CAP}. */
	nodeCap?: number;
	/**
	 * Milliseconds the search may take (default: no limit). When reached, the best plan found so far is
	 * returned with `optimal: false`; without one yet, the root relaxation rounded to whole slots.
	 */
	timeLimitMs?: number;
	/**
	 * Called with the plan of every better solution the search finds (the first rounding included), so
	 * the best plan so far can be shown while it runs. Their `optimal` is false; their `valueAdded` only
	 * grows, and the last one is the returned plan (apart from `optimal`).
	 */
	onIncumbent?: (plan: StockPlan) => void;
}

export interface StockPlanJob {
	blueprintTypeId: number;
	name: string;
	slots: number;
	runsPerSlot: number[];
	runs: number;
	/** Job cost (ISK) of all its jobs in the cycle. */
	jobCost: number;
}

export interface StockPlanCycle {
	/** 1 = the first cycle. */
	cycle: number;
	jobs: StockPlanJob[];
	/** Fuel blocks bought for this cycle: what the held fuel blocks no longer cover. */
	fuel: LineItem[];
	/** Everything the cycle's jobs consume (held stock, earlier products and bought fuel), fuel blocks first. */
	consumed: PlanItem[];
	/** Products of the cycle's jobs, held from the next cycle. */
	produced: PlanItem[];
	slotsUsed: number;
	jobCost: number;
}

export interface StockPlan {
	maxCycles: number;
	cycles: StockPlanCycle[];
	/** Fuel blocks bought over all cycles (input pricing with market depth), in list order. */
	fuelToBuy: LineItem[];
	formulasToBuy: { blueprintTypeId: number; name: string; count: number; unitPrice: number | null }[];
	/** Stock and products held after the last cycle, fuel blocks first, then by name. */
	leftover: PlanItem[];
	/** Held reaction types without a price: valued at 0. Non-empty exactly when `UNPRICED_STOCK` is warned. */
	unpricedStock: PlanItem[];
	/**
	 * Values are net realisable values ({@link stockUnitValue}), except produced units of a type a
	 * candidate reaction consumes (an intermediate) still held after the last cycle: those count at their
	 * production cost (inputs' value plus job cost per unit, at most the market value), so making an
	 * intermediate only adds value when a later job uses it. Jobs draw held stock first: the units left
	 * are `min(produced, held + produced − consumed)` per type. Untouched stock keeps its value.
	 * `valueProduced` counts that way; `valueConsumed` covers what the jobs consume of held stock and
	 * earlier products (bought fuel counts in `fuelCost` instead);
	 * `valueAdded = valueProduced − valueConsumed − fuelCost − jobCost − formulaCost`.
	 */
	totals: {
		valueConsumed: number;
		valueProduced: number;
		fuelCost: number;
		jobCost: number;
		formulaCost: number;
		valueAdded: number;
		/** Σ over cycles of slots used × cycle days. */
		slotDays: number;
		/** `valueAdded ÷ slotDays`; null without slots used. */
		profitPerSlotDay: number | null;
	};
	/**
	 * False when branch and bound stopped early (node cap, time limit): the plan is the best one found.
	 * True: no plan is worth more than {@link STOCK_PLAN_GAP} more (before the exact pass).
	 */
	optimal: boolean;
	warnings: string[];
}

type StockPlanWarning = Warning | 'UNPRICED_STOCK';

interface Candidate {
	reaction: Reaction;
	profile: ResolvedProfile;
	owned: number;
	/** Price of one more formula; null when it cannot be bought. */
	formulaPrice: number | null;
	/** Earliest cycle its non-fuel inputs can be there (1: all held). */
	earliest: number;
}

/** Column indices of one candidate's runs and slots in one cycle. */
interface Columns {
	x: number;
	y: number;
}

/** Relative preference for earlier cycles: breaks ties between equally valuable cycles. */
const LATER_CYCLE_DISCOUNT = 1e-6;
/** Distance below an integer the solver's runs still count as that integer. */
const RUNS_TOLERANCE = 1e-6;
/**
 * Share of the plan's value within which branch and bound stops: finer than the exact pass, which can
 * lose up to one run per job to rounding.
 */
export const STOCK_PLAN_GAP = 1e-3;

/**
 * Plans reactions that turn held stock into more value within `maxCycles` cycles, buying nothing but
 * fuel blocks (and, with `allowUnownedFormulas`, formulas). Candidates: the closure of reactions whose
 * non-fuel inputs are held or made by other candidates, with an owned (or buyable) formula and a priced
 * product. A mixed-integer program (runs `x[r,c]`, integer slots `y[r,c]`, fuel bought, integer formulas
 * bought) maximises the value held at the end (produced intermediates left over at production cost)
 * minus ISK spent: per type and cycle, consumption up to the cycle (with one unit per job and material
 * for rounding) stays within the stock, earlier output and bought fuel. An exact pass rebuilds each
 * better solution's cycles with {@link splitIntoSlots} and {@link requiredQuantity}, lowering runs until
 * they fit what is held; held fuel is used before buying. The best exact plan is returned.
 */
export function planFromStock(input: StockPlanInput): StockPlan {
	const start = performance.now();
	const { ctx } = input;
	const { dataset, settings } = ctx;
	const constants = dataset.constants;
	const adjusted = ctx.inputPrices.adjusted;
	const totalSlots = Math.max(0, Math.floor(input.totalSlots));
	const typeName = (typeId: number) => dataset.types[typeId]?.name ?? String(typeId);
	const held = new Map<number, number>();
	for (const [key, quantity] of Object.entries(input.stock))
		if (quantity > 0) held.set(Number(key), quantity);

	const values = new Map<number, number | null>();
	const valueOf = (typeId: number) => {
		if (!values.has(typeId)) values.set(typeId, stockUnitValue(ctx, typeId));
		return values.get(typeId)!;
	};

	const eligible = [...dataset.reactions]
		.sort((a, b) => a.blueprintTypeId - b.blueprintTypeId)
		.flatMap((reaction) => {
			const profile = ctx.profiles[reaction.reactor];
			const owned = Math.max(0, Math.floor(input.ownedFormulas[reaction.blueprintTypeId] ?? 0));
			const formulaPrice = input.allowUnownedFormulas
				? (ctx.outputPrices.hubs[profile.market.outputHub]?.[reaction.blueprintTypeId]?.sell ?? null)
				: null;
			if (valueOf(reaction.product.typeId) === null || (owned === 0 && formulaPrice === null)) return [];
			return [{ reaction, profile, owned, formulaPrice, earliest: 0 }];
		});

	// Closure: a type is ready after cycle `ready` (0 = held); a reaction joins in the first cycle all its
	// non-fuel inputs are ready before, its product is then ready after that cycle.
	const ready = new Map<number, number>([...held.keys()].map((typeId) => [typeId, 0]));
	for (let cycle = 1; ; cycle++) {
		const joining = eligible.filter(
			(e) =>
				e.earliest === 0 &&
				e.reaction.materials.every(
					(m) => isFuelBlock(dataset, m.typeId) || (ready.get(m.typeId) ?? Infinity) < cycle
				)
		);
		if (joining.length === 0) break;
		for (const e of joining) {
			e.earliest = cycle;
			if (!ready.has(e.reaction.product.typeId)) ready.set(e.reaction.product.typeId, cycle);
		}
	}
	const closure: Candidate[] = eligible.filter((e) => e.earliest > 0);

	const maxCycles =
		input.maxCycles !== undefined && Number.isFinite(input.maxCycles)
			? Math.min(STOCK_PLAN_MAX_CYCLES, Math.max(1, Math.floor(input.maxCycles)))
			: STOCK_PLAN_DEFAULT_MAX_CYCLES;
	interface Prepared extends Candidate {
		capacity: number;
		materialModifier: number;
		/** Units consumed per run by the model (≥ 1 per run, as `requiredQuantity`), per material type. */
		perRun: Map<number, number>;
		/** Value one run adds: its product minus its materials (as `perRun`) minus its job cost. */
		runValue: number;
	}
	let candidates: Prepared[] = closure
		.filter((c) => c.earliest <= maxCycles)
		.map((c) => {
			const mm = materialModifier(c.profile, constants);
			const perRun = new Map<number, number>();
			for (const m of c.reaction.materials)
				perRun.set(m.typeId, (perRun.get(m.typeId) ?? 0) + Math.max(1, m.quantity * mm));
			const product = c.reaction.product;
			return {
				...c,
				capacity: runsPerCycleDetail(c.reaction, c.profile, settings.cycleDays, constants).runs,
				materialModifier: mm,
				perRun,
				runValue:
					product.quantity * (valueOf(product.typeId) ?? 0) -
					[...perRun].reduce((acc, [typeId, q]) => acc + q * (valueOf(typeId) ?? 0), 0) -
					jobCost(eiv(c.reaction, 1, adjusted).value, c.profile).total
			};
		});
	// Dominated candidates: a reaction whose product no other candidate uses only adds its own runs' value.
	// It is dropped when that is not positive, or when it needs a bought formula and at most adds the
	// formula's price (runs bounded by all slots in every cycle and by its held inputs no candidate makes;
	// fuel ignored). Repeated until none is dropped, as a drop can leave a producer unused.
	for (let size = 0; size !== candidates.length;) {
		size = candidates.length;
		const used = new Set(candidates.flatMap((c) => c.reaction.materials.map((m) => m.typeId)));
		const made = new Set(candidates.map((c) => c.reaction.product.typeId));
		candidates = candidates.filter((c) => {
			if (used.has(c.reaction.product.typeId)) return true;
			if (c.runValue <= 0) return false;
			if (c.owned > 0) return true;
			let runs = c.capacity * totalSlots * (maxCycles - c.earliest + 1);
			for (const [typeId, q] of c.perRun)
				if (!isFuelBlock(dataset, typeId) && !made.has(typeId))
					runs = Math.min(runs, (held.get(typeId) ?? 0) / q);
			return runs * c.runValue > c.formulaPrice!;
		});
	}

	// Model columns.
	const objective: number[] = [];
	const upper: number[] = [];
	/** Integer columns: formulas bought, then slots (the branching priority). */
	const formulaColumns: number[] = [];
	const slotColumns: number[] = [];
	const rows: { terms: [number, number][]; relation: LinearConstraint['relation']; rhs: number }[] = [];
	const column = (value: number, bound: number) => {
		objective.push(value);
		upper.push(bound);
		return objective.length - 1;
	};

	/** Fuel type id → profile buying it (the first candidate consuming it) and unit cost; null = unpriced. */
	const fuelBuyers = new Map<number, { profile: ResolvedProfile; unitCost: number | null }>();
	for (const c of candidates)
		for (const m of c.reaction.materials) {
			if (!isFuelBlock(dataset, m.typeId) || fuelBuyers.has(m.typeId)) continue;
			const market = c.profile.market;
			const unit = inputUnitPrice(ctx.inputPrices.hubs[market.inputHub]?.[m.typeId], market);
			const volume = dataset.types[m.typeId]?.volume ?? 0;
			fuelBuyers.set(m.typeId, {
				profile: c.profile,
				unitCost:
					unit && unit.price + unit.fee + shippingCost(1, volume, unit.price, c.profile.shipping.input)
			});
		}

	interface Modelled extends Prepared {
		/** Columns per cycle (index = cycle; earlier than `earliest`: none). */
		columns: (Columns | undefined)[];
		/** Column of the formulas bought; undefined when none can be. */
		formulaColumn: number | undefined;
	}
	const modelled: Modelled[] = candidates.map((c) => {
		const { runValue, capacity } = c;
		// One unit of every material per job covers rounding up.
		const allowanceValue = [...c.perRun.keys()].reduce((acc, typeId) => acc + (valueOf(typeId) ?? 0), 0);
		// The slot row bounds slots by the total; formulas bound them only below it.
		const slotBound = c.formulaPrice === null && c.owned < totalSlots ? c.owned : Infinity;
		const columns: (Columns | undefined)[] = [];
		for (let cycle = c.earliest; cycle <= maxCycles; cycle++) {
			const x = column(runValue - LATER_CYCLE_DISCOUNT * Math.abs(runValue) * (cycle - 1), Infinity);
			const y = column(-allowanceValue, slotBound);
			slotColumns.push(y);
			rows.push({
				terms: [
					[x, 1],
					[y, -capacity]
				],
				relation: '<=',
				rhs: 0
			});
			columns[cycle] = { x, y };
		}
		let formulaColumn: number | undefined;
		if (c.formulaPrice !== null && totalSlots > c.owned) {
			// Formulas cost: the solver buys no more than the slots need.
			const b = column(-c.formulaPrice, Infinity);
			formulaColumn = b;
			formulaColumns.push(b);
			for (const col of columns)
				if (col)
					rows.push({
						terms: [
							[col.y, 1],
							[b, -1]
						],
						relation: '<=',
						rhs: c.owned
					});
		}
		return { ...c, columns, formulaColumn };
	});

	for (let cycle = 1; cycle <= maxCycles; cycle++) {
		const terms = modelled.flatMap((c): [number, number][] => {
			const col = c.columns[cycle];
			return col ? [[col.y, 1]] : [];
		});
		if (terms.length > 0) rows.push({ terms, relation: '<=', rhs: totalSlots });
	}

	// Balance per consumed type: cumulative consumption up to a cycle ≤ held + earlier output (+ fuel bought).
	const consumedTypes = [...new Set(modelled.flatMap((c) => [...c.perRun.keys()]))];
	for (const typeId of consumedTypes) {
		const buyer = fuelBuyers.get(typeId);
		const f = buyer?.unitCost != null ? column((valueOf(typeId) ?? 0) - buyer.unitCost, Infinity) : undefined;
		const producers = modelled.filter((c) => c.reaction.product.typeId === typeId);
		const consumers = modelled.filter((c) => c.perRun.has(typeId));
		const consumption = (c: Modelled, col: Columns): [number, number][] => [
			[col.x, c.perRun.get(typeId)!],
			[col.y, 1]
		];
		// Without producers, cumulative consumption only grows: the last cycle's row implies the others.
		const firstCycle = producers.length === 0 ? maxCycles : Math.min(...consumers.map((c) => c.earliest));
		for (let cycle = firstCycle; cycle <= maxCycles; cycle++) {
			const terms: [number, number][] = [];
			for (let k = 1; k <= cycle; k++) {
				for (const c of consumers) {
					const col = c.columns[k];
					if (col) terms.push(...consumption(c, col));
				}
				for (const p of producers) {
					const col = p.columns[k - 1];
					if (col) terms.push([col.x, -p.reaction.product.quantity]);
				}
			}
			if (f !== undefined) terms.push([f, -1]);
			rows.push({ terms, relation: '<=', rhs: held.get(typeId) ?? 0 });
		}
		// Fuel is bought for the jobs only, never to hold.
		if (f !== undefined)
			rows.push({
				terms: [
					[f, 1],
					...consumers.flatMap((c) =>
						c.columns.flatMap((col): [number, number][] =>
							col ? consumption(c, col).map(([j, q]): [number, number] => [j, -q]) : []
						)
					)
				],
				relation: '<=',
				rhs: 0
			});
	}

	// Produced intermediates (types a candidate of the closure consumes, whatever `maxCycles`) still held
	// at the end count at their production cost, not their market value: each is worth its producer's
	// margin less (the best margin when several make the type). Jobs draw held stock first, so the
	// produced units left are `min(produced, held + produced − consumed)`. The minimum is not linear:
	// per type the model uses one side (`produced`, when held stock covers the consumption, or
	// `held + produced − consumed`), both at least the true count, so the model never overvalues a plan.
	// Starting from "held stock covers it" where there is any, the sides are switched to what the
	// relaxation does until they agree (at most a few times).
	/** Intermediate type id → value per produced unit left at the end below market. */
	const leftoverMargin = new Map<number, number>();
	const intermediates = new Set(
		closure.flatMap((c) =>
			c.reaction.materials.flatMap((m) => (isFuelBlock(dataset, m.typeId) ? [] : [m.typeId]))
		)
	);
	/** Per intermediate: its left-over column and the terms of `produced − consumed` (all cycles). */
	const leftovers: {
		typeId: number;
		s: number;
		produced: [number, number][];
		consumed: [number, number][];
	}[] = [];
	for (const typeId of new Set(modelled.map((c) => c.reaction.product.typeId))) {
		if (!intermediates.has(typeId)) continue;
		const producers = modelled.filter((c) => c.reaction.product.typeId === typeId);
		const margin = Math.max(0, ...producers.map((p) => p.runValue / p.reaction.product.quantity));
		if (margin <= 0) continue;
		leftoverMargin.set(typeId, margin);
		const produced: [number, number][] = [];
		for (const p of producers)
			for (const col of p.columns) if (col) produced.push([col.x, p.reaction.product.quantity]);
		const consumed: [number, number][] = [];
		for (const c of modelled) {
			const q = c.perRun.get(typeId);
			if (q !== undefined) for (const col of c.columns) if (col) consumed.push([col.x, q], [col.y, 1]);
		}
		leftovers.push({ typeId, s: column(-margin, Infinity), produced, consumed });
	}

	const n = objective.length;
	const toConstraint = (row: (typeof rows)[number]): LinearConstraint => {
		const coefficients = new Array<number>(n).fill(0);
		for (const [j, a] of row.terms) coefficients[j] += a;
		return { coefficients, relation: row.relation, rhs: row.rhs };
	};
	const base = rows.map(toConstraint);
	/** `heldCovers`: the type's held stock covers its consumption (`s ≥ produced`), else `s ≥ held + produced − consumed`. */
	const leftoverRows = (heldCovers: ReadonlySet<number>) =>
		leftovers.map((l) => {
			const covered = heldCovers.has(l.typeId);
			return toConstraint({
				terms: [
					[l.s, -1],
					...l.produced,
					...(covered ? [] : l.consumed.map(([j, q]): [number, number] => [j, -q]))
				],
				relation: '<=',
				rhs: covered ? 0 : (held.get(l.typeId) ?? 0)
			});
		});
	let heldCovers = new Set(leftovers.filter((l) => held.has(l.typeId)).map((l) => l.typeId));
	for (let round = 0; round < 4 && heldCovers.size > 0; round++) {
		if (performance.now() > start + (input.timeLimitMs ?? Infinity) / 2) break;
		const relaxed = solveLp({ objective, constraints: [...base, ...leftoverRows(heldCovers)], upper });
		if (relaxed.status !== 'optimal') break;
		const total = (terms: [number, number][]) =>
			terms.reduce((acc, [j, q]) => acc + q * relaxed.solution[j], 0);
		const next = new Set(
			leftovers
				.filter((l) => held.has(l.typeId) && total(l.consumed) <= held.get(l.typeId)! + RUNS_TOLERANCE)
				.map((l) => l.typeId)
		);
		if (next.size === heldCovers.size && [...next].every((t) => heldCovers.has(t))) break;
		heldCovers = next;
	}
	const constraints = [...base, ...leftoverRows(heldCovers)];
	/**
	 * Whole slots for a relaxation's runs: each reaction gets the slots its runs need; where a cycle then
	 * has too many, the last slot with the least `worth` (given the runs left in it) is dropped, until it
	 * fits. Formulas follow the slots.
	 */
	const roundSlots = (relaxation: readonly number[], worth: (c: Modelled, lastRuns: number) => number) => {
		const rounded = [...relaxation];
		for (let cycle = 1; cycle <= maxCycles; cycle++) {
			const running = modelled.flatMap((c) => {
				const col = c.columns[cycle];
				return col ? [{ c, col }] : [];
			});
			let used = 0;
			for (const { c, col } of running) {
				const runs = relaxation[col.x];
				const slots = runs > RUNS_TOLERANCE ? Math.ceil(runs / c.capacity - RUNS_TOLERANCE) : 0;
				rounded[col.y] = Math.min(slots, upper[col.y]);
				used += rounded[col.y];
			}
			while (used > totalSlots) {
				let drop = running[0];
				let least = Infinity;
				for (const r of running) {
					if (rounded[r.col.y] === 0) continue;
					const w = worth(r.c, relaxation[r.col.x] - r.c.capacity * (rounded[r.col.y] - 1));
					if (w < least) {
						least = w;
						drop = r;
					}
				}
				rounded[drop.col.y]--;
				used--;
			}
		}
		for (const c of modelled) {
			if (c.formulaColumn === undefined) continue;
			// `columns` has holes before the first cycle: iterate, never map.
			let most = 0;
			for (const col of c.columns) if (col) most = Math.max(most, rounded[col.y]);
			rounded[c.formulaColumn] = Math.max(0, most - c.owned);
		}
		return rounded;
	};
	// Dropping the emptiest last slots suits chains (an intermediate's own value understates it);
	// dropping the least valuable runs suits independent reactions. Both are tried.
	const byFill = (c: Modelled, lastRuns: number) => lastRuns / c.capacity;
	const byValue = (c: Modelled, lastRuns: number) => Math.min(c.capacity, lastRuns) * c.runValue;
	const deadline = input.timeLimitMs === undefined ? Infinity : start + input.timeLimitMs;
	const items = (entries: Iterable<[number, number]>): PlanItem[] =>
		[...entries]
			.filter(([, quantity]) => quantity > 0)
			.map(([typeId, quantity]) => ({ typeId, name: typeName(typeId), quantity }));
	/** Every item list in the material order (`sortMaterials`). */
	const inMaterialOrder = <T extends { typeId: number }>(list: T[]) => sortMaterials(list, dataset);
	const unpricedStock = inMaterialOrder(
		items(
			[...held].filter(([typeId]) => {
				const role = inventoryRole(dataset, typeId);
				return role !== null && role !== 'formula' && valueOf(typeId) === null;
			})
		)
	);
	/** Best exact plan of the incumbents so far (exact passes need not rank like the solver's values). */
	let best: StockPlan | null = null;
	const offer = (solution: readonly number[]) => {
		const plan = build(solution, false);
		if (best && plan.totals.valueAdded <= best.totals.valueAdded) return;
		best = plan;
		input.onIncumbent?.(plan);
	};
	// Formulas are decided first and rather not bought (lower child first); slots rather used (upper first).
	const mip = solveMip({ objective, constraints, upper }, [...formulaColumns, ...slotColumns], {
		nodeCap: input.nodeCap ?? DEFAULT_NODE_CAP,
		deadline,
		relativeGap: STOCK_PLAN_GAP,
		downFirst: formulaColumns,
		round: (relaxation) => [roundSlots(relaxation, byFill), roundSlots(relaxation, byValue)],
		onIncumbent: offer
	});
	const optimal = mip.status === 'optimal';
	if (best) return { ...(best as StockPlan), optimal };
	// Without an integer solution (stopped early), the root relaxation in whole slots; without that,
	// nothing runs (always feasible). The exact pass makes any of them fit what is held.
	return build(mip.relaxation ? roundSlots(mip.relaxation, byFill) : new Array<number>(n).fill(0), optimal);

	/** The exact plan of a model solution, cycle by cycle: held stock first, then fuel bought for the rest. */
	function build(solution: readonly number[], optimal: boolean): StockPlan {
		const warnings = new Set<StockPlanWarning>();
		const pool = new Map(held);
		const purchases: (Purchase & { cycle: number })[] = [];
		const consumedTotal = new Map<number, number>();
		const madeTotal = new Map<number, number>();
		const boughtTotal = new Map<number, number>();
		const slotsPeak = new Map<Modelled, number>();
		const rawCycles: {
			cycle: number;
			jobs: StockPlanJob[];
			consumed: Map<number, number>;
			made: Map<number, number>;
		}[] = [];
		for (let cycle = 1; cycle <= maxCycles; cycle++) {
			const made = new Map<number, number>();
			const consumed = new Map<number, number>();
			const bought = new Map<number, number>();
			const jobs: StockPlanJob[] = [];
			for (const c of modelled) {
				const col = c.columns[cycle];
				if (!col) continue;
				const inputs = sortMaterials(c.reaction.materials, dataset);
				const needs = (runs: number) => {
					const runsPerSlot = splitIntoSlots(runs, c.capacity);
					return inputs.map((m) => ({
						typeId: m.typeId,
						quantity: runsPerSlot.reduce(
							(acc, jobRuns) => acc + requiredQuantity(jobRuns, m.quantity, c.materialModifier),
							0
						)
					}));
				};
				const fits = (runs: number) =>
					needs(runs).every(
						(need) =>
							need.quantity <= (pool.get(need.typeId) ?? 0) || fuelBuyers.get(need.typeId)?.unitCost != null
					);
				let runs = Math.min(
					Math.floor(solution[col.x] + RUNS_TOLERANCE),
					Math.round(solution[col.y]) * c.capacity
				);
				while (runs > 0 && !fits(runs)) runs--;
				if (runs <= 0) continue;

				for (const need of needs(runs)) {
					const take = Math.min(need.quantity, pool.get(need.typeId) ?? 0);
					pool.set(need.typeId, (pool.get(need.typeId) ?? 0) - take);
					consumed.set(need.typeId, (consumed.get(need.typeId) ?? 0) + need.quantity);
					if (need.quantity > take)
						bought.set(need.typeId, (bought.get(need.typeId) ?? 0) + need.quantity - take);
				}
				const product = c.reaction.product;
				made.set(product.typeId, (made.get(product.typeId) ?? 0) + runs * product.quantity);
				const runsPerSlot = splitIntoSlots(runs, c.capacity);
				slotsPeak.set(c, Math.max(slotsPeak.get(c) ?? 0, runsPerSlot.length));
				const estimate = eiv(c.reaction, runs, adjusted);
				jobs.push({
					blueprintTypeId: c.reaction.blueprintTypeId,
					name: c.reaction.name,
					slots: runsPerSlot.length,
					runsPerSlot,
					runs,
					jobCost: jobCost(estimate.value, c.profile).total
				});
				const detail = runsPerCycleDetail(c.reaction, c.profile, settings.cycleDays, constants);
				if (!detail.fits) warnings.add('CYCLE_SHORTER_THAN_RUN');
				if (detail.capped) warnings.add('MAX_RUNS_PER_JOB');
				if (c.profile.costIndexMissing) warnings.add('COST_INDEX_MISSING');
				if (c.profile.reactionsSkill < c.reaction.requiredSkillLevel) warnings.add('SKILL_TOO_LOW');
				if (estimate.missing.length > 0) warnings.add('MISSING_ADJUSTED_PRICE');
			}
			for (const [typeId, quantity] of made) {
				pool.set(typeId, (pool.get(typeId) ?? 0) + quantity);
				madeTotal.set(typeId, (madeTotal.get(typeId) ?? 0) + quantity);
			}
			for (const [typeId, quantity] of consumed)
				consumedTotal.set(typeId, (consumedTotal.get(typeId) ?? 0) + quantity);
			for (const [typeId, quantity] of bought) {
				boughtTotal.set(typeId, (boughtTotal.get(typeId) ?? 0) + quantity);
				purchases.push({ cycle, profile: fuelBuyers.get(typeId)!.profile, typeId, quantity });
			}
			rawCycles.push({ cycle, jobs, consumed, made });
		}

		// Fuel is priced together over all cycles (input market depth shared).
		const fuelOrder = [...fuelBuyers.keys()];
		purchases.sort((a, b) => fuelOrder.indexOf(a.typeId) - fuelOrder.indexOf(b.typeId) || a.cycle - b.cycle);
		const sourcing = new InputSourcing(ctx, purchases);
		const pc: PricingContext = { ctx, missing: new Set() };
		const perCycle = new Map(rawCycles.map((c) => [c.cycle, new LineItemBag()]));
		const fuelBag = new LineItemBag();
		for (const p of purchases) {
			const item = sourcing.buy(pc, p.profile, p.typeId, p.quantity);
			perCycle.get(p.cycle)!.addItem(item);
			fuelBag.addItem(item);
		}
		if (sourcing.short) warnings.add('INPUT_VOLUME_SHORT');
		const fuelToBuy = inMaterialOrder(sourcing.annotate(fuelBag.list()));

		const cycles: StockPlanCycle[] = rawCycles.map((c) => ({
			cycle: c.cycle,
			jobs: c.jobs,
			fuel: inMaterialOrder(perCycle.get(c.cycle)!.list()),
			consumed: inMaterialOrder(items(c.consumed)),
			produced: inMaterialOrder(items(c.made)),
			slotsUsed: c.jobs.reduce((acc, j) => acc + j.slots, 0),
			jobCost: c.jobs.reduce((acc, j) => acc + j.jobCost, 0)
		}));

		const formulasToBuy = modelled
			.filter((c) => c.formulaPrice !== null && (slotsPeak.get(c) ?? 0) > c.owned)
			.map((c) => ({
				blueprintTypeId: c.reaction.blueprintTypeId,
				name: c.reaction.formulaName,
				count: slotsPeak.get(c)! - c.owned,
				unitPrice: c.formulaPrice
			}));
		if (unpricedStock.length > 0) warnings.add('UNPRICED_STOCK');

		// Produced units still held at the end (jobs draw held stock first) of an intermediate count at
		// their production cost: their producer's margin less than market.
		let valueProduced = 0;
		for (const [typeId, quantity] of madeTotal) {
			const end = (held.get(typeId) ?? 0) + quantity - (consumedTotal.get(typeId) ?? 0);
			const left = Math.max(0, Math.min(quantity, end));
			valueProduced += quantity * (valueOf(typeId) ?? 0) - left * (leftoverMargin.get(typeId) ?? 0);
		}
		const valueConsumed = [...consumedTotal].reduce(
			(acc, [typeId, quantity]) => acc + (quantity - (boughtTotal.get(typeId) ?? 0)) * (valueOf(typeId) ?? 0),
			0
		);
		const fuelCost = fuelToBuy.reduce((acc, i) => acc + i.total + i.fees + i.shipping, 0);
		const jobCostTotal = cycles.reduce((acc, c) => acc + c.jobCost, 0);
		const formulaCost = formulasToBuy.reduce((acc, f) => acc + f.count * (f.unitPrice ?? 0), 0);
		const valueAdded = valueProduced - valueConsumed - fuelCost - jobCostTotal - formulaCost;
		const slotDays = cycles.reduce((acc, c) => acc + c.slotsUsed, 0) * settings.cycleDays;

		return {
			maxCycles,
			cycles,
			fuelToBuy,
			formulasToBuy,
			leftover: inMaterialOrder(items(pool)),
			unpricedStock,
			totals: {
				valueConsumed,
				valueProduced,
				fuelCost,
				jobCost: jobCostTotal,
				formulaCost,
				valueAdded,
				slotDays,
				profitPerSlotDay: slotDays > 0 ? valueAdded / slotDays : null
			},
			optimal,
			warnings: [...warnings]
		};
	}
}
