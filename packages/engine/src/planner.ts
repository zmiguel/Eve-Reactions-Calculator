import {
	LineItemBag,
	bestUnrefined,
	calculateReaction,
	chainable,
	producerIndex,
	reprocessOutputs,
	sellLine,
	type CalcContext,
	type LineItem,
	type PricingContext,
	type Warning
} from './calculate.ts';
import {
	SECONDS_PER_DAY,
	ZERO_JOB_COST,
	addJobCosts,
	eiv,
	jobCost,
	materialModifier,
	requiredQuantity,
	runTimeSeconds,
	runsPerCycleDetail,
	splitIntoSlots,
	type JobCostBreakdown
} from './formulas.ts';
import type { ResolvedProfile } from './settings.ts';
import { InputSourcing } from './sourcing.ts';
import type { Reaction, Tier } from './types.ts';
import { unrefinedIndex, unrefinedRuns } from './unrefined.ts';

export interface PlanTarget {
	blueprintTypeId: number;
	/** Full-cycle slots of the product (each runs `runsPerCycle`); ignored when `quantity` is set. */
	lines: number;
	/**
	 * Units of the product wanted per cycle instead of lines: the target runs exactly
	 * `⌈quantity ÷ product quantity⌉` runs, split into as few slots as fit the cycle. The units made beyond
	 * `quantity` are reported as surplus.
	 */
	quantity?: number;
}

export interface PlanInput {
	ctx: CalcContext;
	totalSlots: number;
	targets: PlanTarget[];
	/** Product type ids to buy instead of building them in the chain. */
	buyInsteadOfBuild: number[];
	stock: Record<number, number>;
	ownedFormulas: Record<number, number>;
	/** 30-day average daily volume in the output hub's region, per type id. */
	dailyVolumes: Record<number, number>;
	/**
	 * 30-day average daily volume in each input hub's region: hub id → type id → units per day. Gives the
	 * purchases' `dailyVolumeSharePct` (market purchases only).
	 */
	inputDailyVolumes?: Record<string, Record<number, number>>;
	/**
	 * Product type ids built through their unrefined reaction, whose product is reprocessed, instead of
	 * their regular reaction (`buyInsteadOfBuild` wins). Default: with `settings.unrefinedInChains: best`,
	 * every target's own full-chain choice ({@link bestUnrefined}) combined; otherwise none.
	 */
	viaUnrefined?: readonly number[];
}

/** A material and quantity (start-up savings and stock). */
export interface PlanItem {
	typeId: number;
	name: string;
	quantity: number;
}

/** Where one byproduct of an unrefined job goes in a steady cycle. */
export interface PlanByproduct extends PlanItem {
	/** Units replacing purchases of the jobs in `usedBy` (the previous cycle's reprocessing). */
	used: number;
	/** Units sold with the outputs. */
	sold: number;
	/** Jobs buying less of it, and the first cycle each gets it (1 = first start-up cycle, as `PlanPhase.cycle`). */
	usedBy: { blueprintTypeId: number; fromCycle: number }[];
}

export interface PlanReaction {
	blueprintTypeId: number;
	name: string;
	depth: number;
	totalRuns: number;
	slots: number;
	runsPerSlot: number[];
	firstCycle: number;
	/** Seconds per run with the reaction's own profile. */
	runTimeSeconds: number;
	/** Job cost (ISK) of all its jobs in one cycle. */
	jobCost: number;
	/** Unrefined job replacing regular reactions: its product is reprocessed. */
	reprocess?: {
		/** Materials it is sized for, each replacing its regular reaction (`regularName`). */
		replaces: (PlanItem & { regularName: string })[];
		byproducts: PlanByproduct[];
	};
}

export interface PlanPhase {
	/** 0 = the one-time step 0 of the `step0` start-up; 1 = first start-up cycle. */
	cycle: number;
	label: 'step_0' | 'build_up' | 'steady';
	blueprintTypeIds: number[];
	/** Slots busy in this cycle (Σ slots of its reactions). */
	slots: number;
	/**
	 * Purchases of this cycle after the previous cycle's byproducts and the stock; the steady phase lists
	 * its first cycle (every later cycle buys `purchasesPerCycle`). Together: `initialPurchases`.
	 */
	purchases: LineItem[];
	/** Job cost of this cycle. */
	jobCost: number;
}

/**
 * One way to reach the steady cycle; `initialInvestment` as in `PlanResult.totals`, `null` when a
 * start-up purchase has no price (the sum would understate it).
 */
export interface StartupOption {
	initialInvestment: number | null;
	/** Cycles up to and including the first steady one. */
	cycles: number;
}

/**
 * How the plan starts. `buy`: the start-up cycles buy what later cycles get from the previous cycle's
 * reprocessing. `step0`: a one-time step 0 runs the unrefined jobs whose byproducts other jobs of the
 * first cycle use, so the first cycle buys less; one cycle longer. The cheaper start-up is used (ties,
 * and any option with an unpriced purchase: `buy`); the steady cycle is the same for both.
 */
export interface PlanStartup {
	mode: 'buy' | 'step0';
	buy: StartupOption;
	/** Null when no unrefined job of the first cycle feeds another job of that cycle. */
	step0:
		| (StartupOption & {
				blueprintTypeIds: number[];
				/** First-cycle purchases step 0's byproducts replace. */
				saves: PlanItem[];
				/** Step 0's reprocessed materials the first cycle does not use: kept as stock. */
				stock: PlanItem[];
		  })
		| null;
}

export interface PlanResult {
	reactions: PlanReaction[];
	slotsUsed: number;
	slotsRemaining: number;
	maxDepth: number;
	/** Σ runs × run time over every job of one steady cycle. */
	slotSecondsBusy: number;
	/** `slotSecondsBusy ÷ (slotsUsed × cycle seconds)`; 0 without jobs. */
	utilisation: number;
	/** Cycles of the chosen start-up, then the steady one. */
	phases: PlanPhase[];
	startup: PlanStartup;
	/**
	 * Steady-cycle purchases; `dailyVolumeSharePct` = units per day (per cycle ÷ cycle days) as a share of
	 * the input hub region's average daily volume, `null` for contracts or without volume data.
	 */
	purchasesPerCycle: (LineItem & { dailyVolumeSharePct: number | null })[];
	/** Purchases of every phase up to and including the first steady cycle, minus stock. */
	initialPurchases: LineItem[];
	formulasToBuy: { blueprintTypeId: number; count: number; unitPrice: number | null }[];
	outputsPerCycle: (LineItem & { dailyVolumeSharePct: number | null })[];
	surplusPerCycle: LineItem[];
	totals: {
		recurringInvestment: number;
		/** Purchases (minus stock) and job costs of the chosen start-up up to the first steady cycle, plus formulas. */
		initialInvestment: number;
		/** Formulas to buy, priced (part of `initialInvestment`). */
		formulaCost: number;
		jobCostPerCycle: number;
		outputNetPerCycle: number;
		profitPerCycle: number | null;
		profitPerDay: number | null;
		/** `profitPerCycle ÷ (slotsUsed × cycleDays)`, the plan's combined profit per slot per day; null without a profit or without slots. */
		profitPerSlotDay: number | null;
		marginPct: number | null;
	};
	missingPrices: number[];
	warnings: string[];
}

interface NodeState {
	reaction: Reaction;
	profile: ResolvedProfile;
	depth: number;
	targetRuns: number;
	/** Units of the product sold as target output (lines: all produced; quantity: the requested units). */
	targetUnits: number;
	totalRuns: number;
	slots: number;
	runsPerSlot: number[];
	runTimeSeconds: number;
	surplus: number;
	purchases: Map<number, number>;
	jobCost: JobCostBreakdown;
	/** Unrefined job feeding the plan: what reprocessing its build runs yields. */
	reprocessed: { typeId: number; quantity: number; demand: number; byproduct: boolean }[];
}

const lineCost = (items: LineItem[]) => items.reduce((acc, i) => acc + i.total + i.fees + i.shipping, 0);

export function planReactions(input: PlanInput): PlanResult {
	const { ctx } = input;
	const { dataset, settings } = ctx;
	const constants = dataset.constants;
	const producers = producerIndex(dataset);
	const alternatives = unrefinedIndex(dataset);
	const byId = new Map(dataset.reactions.map((r) => [r.blueprintTypeId, r]));
	const buyInstead = new Set(input.buyInsteadOfBuild);
	const warnings = new Set<Warning>();
	const via =
		input.viaUnrefined ??
		(settings.unrefinedInChains !== 'best'
			? []
			: [...new Set(input.targets.map((t) => t.blueprintTypeId))].flatMap((id) => {
					const reaction = byId.get(id);
					return reaction && chainable(reaction, dataset) ? bestUnrefined(reaction, ctx) : [];
				}));
	/** Type id → unrefined reaction building it for the plan (reprocessing yields some of it). */
	const viaAlt = new Map<number, Reaction>();
	for (const typeId of via) {
		const alt = alternatives.get(typeId);
		if (alt && unrefinedRuns(dataset, settings, alt, typeId, 1) !== null) viaAlt.set(typeId, alt);
	}
	const builtBy = (typeId: number) =>
		buyInstead.has(typeId) ? undefined : (viaAlt.get(typeId) ?? producers.get(typeId));

	const targetRuns = new Map<number, number>();
	const targetUnits = new Map<number, number>();
	for (const t of input.targets) {
		const reaction = byId.get(t.blueprintTypeId);
		const byQuantity = t.quantity !== undefined;
		if (!reaction || (byQuantity ? !(t.quantity! > 0) : t.lines <= 0)) continue;
		const detail = runsPerCycleDetail(
			reaction,
			ctx.profiles[reaction.reactor],
			settings.cycleDays,
			constants
		);
		if (!detail.fits) warnings.add('CYCLE_SHORTER_THAN_RUN');
		if (detail.capped) warnings.add('MAX_RUNS_PER_JOB');
		const runs = byQuantity ? Math.ceil(t.quantity! / reaction.product.quantity) : detail.runs * t.lines;
		const units = byQuantity ? Math.ceil(t.quantity!) : runs * reaction.product.quantity;
		targetRuns.set(t.blueprintTypeId, (targetRuns.get(t.blueprintTypeId) ?? 0) + runs);
		targetUnits.set(t.blueprintTypeId, (targetUnits.get(t.blueprintTypeId) ?? 0) + units);
	}

	// Longest path from any target: every consumer then sits at a strictly lower depth than its producer.
	const depth = new Map<number, number>();
	const visit = (r: Reaction, d: number, ancestors: Set<number>) => {
		if ((depth.get(r.blueprintTypeId) ?? -1) >= d) return;
		depth.set(r.blueprintTypeId, d);
		for (const m of r.materials) {
			const sub = builtBy(m.typeId);
			if (sub && !ancestors.has(sub.blueprintTypeId))
				visit(sub, d + 1, new Set(ancestors).add(sub.blueprintTypeId));
		}
	};
	for (const id of targetRuns.keys()) visit(byId.get(id)!, 0, new Set([id]));

	const order = [...depth.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
	const demand = new Map<number, number>();
	const nodes: NodeState[] = [];
	for (const [id, d] of order) {
		const reaction = byId.get(id)!;
		const profile = ctx.profiles[reaction.reactor];
		const fromTarget = targetRuns.get(id) ?? 0;
		const soldUnits = targetUnits.get(id) ?? 0;
		// Demand for this product is built by whichever reaction `builtBy` picks: when an unrefined route
		// replaces it, the regular reaction (still run here as a target) must not build that demand again.
		const demanded =
			builtBy(reaction.product.typeId) === reaction ? (demand.get(reaction.product.typeId) ?? 0) : 0;
		const productRuns = Math.ceil(demanded / reaction.product.quantity);
		// An unrefined job building replaced types: runs whose reprocessed product covers each type's demand.
		const fed = [...viaAlt]
			.filter(([typeId, alt]) => alt === reaction && builtBy(typeId) === alt && (demand.get(typeId) ?? 0) > 0)
			.map(([typeId]) => typeId);
		const reprocessRuns = Math.max(
			0,
			...fed.map((typeId) => unrefinedRuns(dataset, settings, reaction, typeId, demand.get(typeId)!)!)
		);
		const buildRuns = productRuns + reprocessRuns;
		const totalRuns = fromTarget + buildRuns;
		if (totalRuns === 0) continue;
		const capacity = runsPerCycleDetail(reaction, profile, settings.cycleDays, constants).runs;
		const runsPerSlot = splitIntoSlots(totalRuns, capacity);
		const slots = runsPerSlot.length;
		const mm = materialModifier(profile, constants);
		const purchases = new Map<number, number>();
		for (const m of reaction.materials) {
			const need = runsPerSlot.reduce((acc, jobRuns) => acc + requiredQuantity(jobRuns, m.quantity, mm), 0);
			if (builtBy(m.typeId) && depth.has(builtBy(m.typeId)!.blueprintTypeId)) {
				demand.set(m.typeId, (demand.get(m.typeId) ?? 0) + need);
			} else purchases.set(m.typeId, (purchases.get(m.typeId) ?? 0) + need);
		}
		const reprocessed =
			reprocessRuns === 0
				? []
				: reprocessOutputs(
						dataset,
						settings,
						reaction.tier,
						reaction.product.typeId,
						reprocessRuns * reaction.product.quantity
					)!.map((o) => ({
						...o,
						demand: fed.includes(o.typeId) ? demand.get(o.typeId)! : 0,
						byproduct: !fed.includes(o.typeId)
					}));
		if (profile.costIndexMissing) warnings.add('COST_INDEX_MISSING');
		if (profile.reactionsSkill < reaction.requiredSkillLevel) warnings.add('SKILL_TOO_LOW');
		const estimate = eiv(reaction, totalRuns, ctx.inputPrices.adjusted);
		if (estimate.missing.length > 0) warnings.add('MISSING_ADJUSTED_PRICE');
		nodes.push({
			reaction,
			profile,
			depth: d,
			targetRuns: fromTarget,
			targetUnits: soldUnits,
			totalRuns,
			slots,
			runsPerSlot,
			runTimeSeconds: runTimeSeconds(reaction, profile, constants),
			// Rounding up intermediate runs, plus the units of a quantity target beyond the requested amount.
			surplus:
				productRuns * reaction.product.quantity -
				demanded +
				(fromTarget * reaction.product.quantity - soldUnits),
			purchases,
			jobCost: jobCost(estimate.value, profile),
			reprocessed
		});
	}

	const maxDepth = nodes.reduce((acc, n) => Math.max(acc, n.depth), 0);
	const firstCycleOf = (n: NodeState) => maxDepth - n.depth + 1;
	const steadyCycle = maxDepth + 1;
	const byproductsOf = (n: NodeState) => n.reprocessed.filter((o) => o.byproduct && o.quantity > 0);
	const buys = (n: NodeState, typeId: number) => (n.purchases.get(typeId) ?? 0) > 0;

	// Purchases are priced with the market settings of the first reaction (in plan order) that buys the type.
	const pc: PricingContext = { ctx, missing: new Set() };
	const purchaseProfile = new Map<number, ResolvedProfile>();
	for (const n of nodes)
		for (const typeId of n.purchases.keys())
			if (!purchaseProfile.has(typeId)) purchaseProfile.set(typeId, n.profile);
	const typeOrder = [...purchaseProfile.keys()];

	/**
	 * Quantities one cycle buys: the running jobs' purchases minus what the jobs running the cycle before
	 * made as byproducts (a cycle's excess is sold, not carried over).
	 */
	const cycleNeeds = (running: NodeState[], before: NodeState[]) => {
		const made = new Map<number, number>();
		for (const n of before)
			for (const o of byproductsOf(n)) made.set(o.typeId, (made.get(o.typeId) ?? 0) + o.quantity);
		const need = new Map<number, number>();
		for (const n of running)
			for (const [typeId, qty] of n.purchases) need.set(typeId, (need.get(typeId) ?? 0) + qty);
		const bought = new Map<number, number>();
		const credited = new Map<number, number>();
		for (const [typeId, qty] of need) {
			const used = Math.min(qty, made.get(typeId) ?? 0);
			credited.set(typeId, used);
			if (qty > used) bought.set(typeId, qty - used);
		}
		return { bought, credited, made };
	};

	const byproductProfile = new Map<number, ResolvedProfile>();
	for (const n of nodes)
		for (const o of byproductsOf(n))
			if (!byproductProfile.has(o.typeId)) byproductProfile.set(o.typeId, n.profile);
	const formulasToBuy = nodes
		.map((n) => {
			const count = Math.max(0, n.slots - (input.ownedFormulas[n.reaction.blueprintTypeId] ?? 0));
			const hub = ctx.outputPrices.hubs[n.profile.market.outputHub];
			return {
				blueprintTypeId: n.reaction.blueprintTypeId,
				count,
				unitPrice: hub?.[n.reaction.blueprintTypeId]?.sell ?? null
			};
		})
		.filter((f) => f.count > 0);
	const formulaCost = formulasToBuy.reduce((acc, f) => acc + f.count * (f.unitPrice ?? 0), 0);

	// Steady cycle: every job runs in it and in the cycle before.
	const steadyNeeds = cycleNeeds(nodes, nodes);
	const byproductSold = new Map<number, number>();
	for (const [typeId, made] of steadyNeeds.made) {
		const used = steadyNeeds.credited.get(typeId) ?? 0;
		if (made > used) byproductSold.set(typeId, made - used);
	}

	// Step 0 candidates: unrefined jobs of the first cycle whose byproducts another first-cycle job buys.
	const firstJobs = nodes.filter((n) => firstCycleOf(n) === 1);
	const feeders = firstJobs.filter((u) =>
		byproductsOf(u).some((o) => firstJobs.some((v) => v !== u && buys(v, o.typeId)))
	);

	interface StartupCycle {
		cycle: number;
		running: NodeState[];
		bought: Map<number, number>;
		credited: Map<number, number>;
		made: Map<number, number>;
	}
	interface PricedStartup {
		/** Jobs of step 0 (none: buy for the first cycle). */
		jobs: NodeState[];
		cycles: StartupCycle[];
		/** Priced purchases per cycle (same order as `cycles`). */
		purchases: LineItem[][];
		jobCosts: number[];
		initialPurchases: LineItem[];
		/** Purchases and job costs; formulas are the same for every start-up and added later. */
		investment: number;
		/** Every start-up purchase has a price (otherwise `investment` understates the cost). */
		priced: boolean;
		short: boolean;
		missing: Set<number>;
	}
	const startupCycles = (step0: NodeState[]): StartupCycle[] => {
		const cycles: StartupCycle[] = [];
		let before: NodeState[] = [];
		for (let cycle = step0.length > 0 ? 0 : 1; cycle <= steadyCycle; cycle++) {
			const running = cycle === 0 ? step0 : nodes.filter((n) => firstCycleOf(n) <= cycle);
			cycles.push({ cycle, running, ...cycleNeeds(running, before) });
			before = running;
		}
		// Stock covers the earliest purchases first.
		const stockLeft = new Map(Object.entries(input.stock).map(([typeId, qty]) => [Number(typeId), qty]));
		for (const c of cycles)
			for (const [typeId, qty] of c.bought) {
				const take = Math.min(qty, stockLeft.get(typeId) ?? 0);
				if (take === 0) continue;
				stockLeft.set(typeId, stockLeft.get(typeId)! - take);
				if (qty > take) c.bought.set(typeId, qty - take);
				else c.bought.delete(typeId);
			}
		return cycles;
	};

	/** Prices a start-up's purchases together (input market depth shared, like one plan's purchases). */
	const priceStartup = (jobs: NodeState[]): PricedStartup => {
		const cycles = startupCycles(jobs);
		const local: PricingContext = { ctx, missing: new Set() };
		const entries = typeOrder.flatMap((typeId) =>
			cycles.flatMap((c) =>
				c.bought.has(typeId)
					? [
							{
								cycle: c.cycle,
								profile: purchaseProfile.get(typeId)!,
								typeId,
								quantity: c.bought.get(typeId)!
							}
						]
					: []
			)
		);
		const sourcing = new InputSourcing(ctx, entries);
		const perCycle = new Map(cycles.map((c) => [c.cycle, new LineItemBag()]));
		const total = new LineItemBag();
		for (const e of entries) {
			const item = sourcing.buy(local, e.profile, e.typeId, e.quantity);
			perCycle.get(e.cycle)!.addItem(item);
			total.addItem(item);
		}
		const initialPurchases = sourcing.annotate(total.list());
		const jobCosts = cycles.map((c) => c.running.reduce((acc, n) => acc + n.jobCost.total, 0));
		return {
			jobs,
			cycles,
			purchases: cycles.map((c) => perCycle.get(c.cycle)!.list()),
			jobCosts,
			initialPurchases,
			investment: lineCost(initialPurchases) + jobCosts.reduce((a, b) => a + b, 0),
			priced: initialPurchases.every((i) => i.unitPrice !== null),
			short: sourcing.short,
			missing: local.missing
		};
	};
	const buyFirst = priceStartup([]);
	// Every non-empty subset of the feeders (few: the unrefined jobs of one plan), fewest jobs first;
	// the cheapest is the step 0 option.
	let step0: PricedStartup | null = null;
	const subsets = Array.from({ length: 2 ** feeders.length - 1 }, (_, i) =>
		feeders.filter((_, bit) => ((i + 1) >> bit) & 1)
	).sort((a, b) => a.length - b.length);
	for (const jobs of subsets) {
		const option = priceStartup(jobs);
		if (!step0 || option.investment < step0.investment) step0 = option;
	}
	// Unpriced purchases would make an option look cheaper than it is: compare only fully priced options.
	const chosen =
		step0 && step0.priced && buyFirst.priced && step0.investment < buyFirst.investment ? step0 : buyFirst;
	const investmentOf = (o: PricedStartup) => (o.priced ? o.investment + formulaCost : null);
	for (const typeId of chosen.missing) pc.missing.add(typeId);
	const prerun = new Set(chosen === step0 ? step0.jobs : []);

	const phases: PlanPhase[] = chosen.cycles.map((c, i) => ({
		cycle: c.cycle,
		label: c.cycle === 0 ? 'step_0' : c.cycle === steadyCycle ? 'steady' : 'build_up',
		blueprintTypeIds: c.running.map((n) => n.reaction.blueprintTypeId),
		slots: c.running.reduce((acc, n) => acc + n.slots, 0),
		purchases: chosen.purchases[i],
		jobCost: chosen.jobCosts[i]
	}));
	const typeName = (typeId: number) => dataset.types[typeId]?.name ?? String(typeId);
	const items = (entries: Iterable<[number, number]>): PlanItem[] =>
		[...entries]
			.filter(([, q]) => q > 0)
			.map(([typeId, quantity]) => ({ typeId, name: typeName(typeId), quantity }));
	const startup: PlanStartup = {
		mode: chosen === step0 ? 'step0' : 'buy',
		buy: { initialInvestment: investmentOf(buyFirst), cycles: buyFirst.cycles.length },
		step0: step0 && {
			initialInvestment: investmentOf(step0),
			cycles: step0.cycles.length,
			blueprintTypeIds: step0.jobs.map((n) => n.reaction.blueprintTypeId),
			saves: items(step0.cycles[1].credited),
			stock: items(
				[
					...step0.jobs.flatMap((n) =>
						n.reprocessed.filter((o) => !o.byproduct).map((o): [number, number] => [o.typeId, o.quantity])
					),
					// `made` of cycle 1 = the byproducts of the cycle before it, step 0.
					...[...step0.cycles[1].made].map(([typeId, made]): [number, number] => [
						typeId,
						made - (step0.cycles[1].credited.get(typeId) ?? 0)
					])
				].reduce((acc, [typeId, q]) => acc.set(typeId, (acc.get(typeId) ?? 0) + q), new Map<number, number>())
			)
		}
	};

	const steady = typeOrder
		.filter((typeId) => steadyNeeds.bought.has(typeId))
		.map((typeId) => ({
			profile: purchaseProfile.get(typeId)!,
			typeId,
			quantity: steadyNeeds.bought.get(typeId)!
		}));
	const steadySourcing = new InputSourcing(ctx, steady);
	const purchases = new LineItemBag();
	for (const p of steady) purchases.addItem(steadySourcing.buy(pc, p.profile, p.typeId, p.quantity));
	if (steadySourcing.short || chosen.short) warnings.add('INPUT_VOLUME_SHORT');

	/** Steady byproduct use per producer: earlier producers' units are used first. */
	const usedLeft = new Map(steadyNeeds.credited);
	const firstRun = (n: NodeState) => (prerun.has(n) ? 0 : firstCycleOf(n));
	const reprocessInfo = (n: NodeState): PlanReaction['reprocess'] => ({
		replaces: n.reprocessed
			.filter((o) => !o.byproduct)
			.map((o) => ({
				typeId: o.typeId,
				name: typeName(o.typeId),
				quantity: o.quantity,
				regularName: producers.get(o.typeId)?.name ?? typeName(o.typeId)
			})),
		byproducts: byproductsOf(n).map((o) => {
			const used = Math.min(o.quantity, usedLeft.get(o.typeId) ?? 0);
			usedLeft.set(o.typeId, (usedLeft.get(o.typeId) ?? 0) - used);
			return {
				typeId: o.typeId,
				name: typeName(o.typeId),
				quantity: o.quantity,
				used,
				sold: o.quantity - used,
				usedBy:
					used === 0
						? []
						: nodes
								.filter((v) => buys(v, o.typeId))
								.map((v) => ({
									blueprintTypeId: v.reaction.blueprintTypeId,
									fromCycle: Math.max(firstCycleOf(v), firstRun(n) + 1)
								}))
			};
		})
	});

	const outputs = new LineItemBag();
	const surplus = new LineItemBag();
	let jobCostTotal = ZERO_JOB_COST;
	for (const n of nodes) {
		jobCostTotal = addJobCosts(jobCostTotal, n.jobCost);
		const product = n.reaction.product;
		if (n.targetUnits > 0) {
			sellLine(outputs, pc, n.profile, product.typeId, n.targetUnits, {
				countMissing: true,
				withCosts: true
			});
		}
		if (n.surplus > 0)
			sellLine(surplus, pc, n.profile, product.typeId, n.surplus, { countMissing: false, withCosts: false });
		for (const o of n.reprocessed) {
			if (!o.byproduct && o.quantity > o.demand)
				sellLine(surplus, pc, n.profile, o.typeId, o.quantity - o.demand, {
					countMissing: false,
					withCosts: false
				});
		}
	}
	for (const [typeId, quantity] of byproductSold)
		sellLine(outputs, pc, byproductProfile.get(typeId)!, typeId, quantity, {
			countMissing: true,
			withCosts: true
		});
	const outputsPerCycle = outputs.list().map((o) => {
		const daily = input.dailyVolumes[o.typeId];
		return {
			...o,
			dailyVolumeSharePct: daily ? (o.quantity / settings.cycleDays / daily) * 100 : null
		};
	});
	const purchasesPerCycle = steadySourcing.annotate(purchases.list()).map((item) => {
		const m = purchaseProfile.get(item.typeId)!.market;
		const daily =
			m.inputMethod === 'contract' ? undefined : input.inputDailyVolumes?.[m.inputHub]?.[item.typeId];
		return {
			...item,
			dailyVolumeSharePct: daily ? (item.quantity / settings.cycleDays / daily) * 100 : null
		};
	});

	const slotsUsed = nodes.reduce((acc, n) => acc + n.slots, 0);
	if (slotsUsed > input.totalSlots) warnings.add('SLOTS_EXCEEDED');

	const recurringInvestment = lineCost(purchasesPerCycle) + jobCostTotal.total;
	const outputValue = outputsPerCycle.reduce((acc, o) => acc + o.total, 0);
	const outputNetPerCycle = outputsPerCycle.reduce((acc, o) => acc + o.total - o.fees - o.shipping, 0);
	const missingPrices = [...pc.missing].sort((a, b) => a - b);
	const profitPerCycle = missingPrices.length === 0 ? outputNetPerCycle - recurringInvestment : null;
	const slotSecondsBusy = nodes.reduce((acc, n) => acc + n.totalRuns * n.runTimeSeconds, 0);
	const slotSecondsAvailable = slotsUsed * settings.cycleDays * SECONDS_PER_DAY;

	return {
		reactions: nodes.map((n) => ({
			blueprintTypeId: n.reaction.blueprintTypeId,
			name: n.reaction.name,
			depth: n.depth,
			totalRuns: n.totalRuns,
			slots: n.slots,
			runsPerSlot: n.runsPerSlot,
			firstCycle: firstCycleOf(n),
			runTimeSeconds: n.runTimeSeconds,
			jobCost: n.jobCost.total,
			...(n.reprocessed.length > 0 ? { reprocess: reprocessInfo(n) } : {})
		})),
		slotsUsed,
		slotsRemaining: Math.max(0, input.totalSlots - slotsUsed),
		maxDepth,
		slotSecondsBusy,
		utilisation: slotSecondsAvailable > 0 ? slotSecondsBusy / slotSecondsAvailable : 0,
		phases,
		startup,
		purchasesPerCycle,
		initialPurchases: chosen.initialPurchases,
		formulasToBuy,
		outputsPerCycle,
		surplusPerCycle: surplus.list(),
		totals: {
			recurringInvestment,
			initialInvestment: chosen.investment + formulaCost,
			formulaCost,
			jobCostPerCycle: jobCostTotal.total,
			outputNetPerCycle,
			profitPerCycle,
			profitPerDay: profitPerCycle === null ? null : profitPerCycle / settings.cycleDays,
			profitPerSlotDay:
				profitPerCycle === null || slotsUsed === 0 ? null : profitPerCycle / (slotsUsed * settings.cycleDays),
			marginPct: profitPerCycle !== null && outputValue !== 0 ? (profitPerCycle / outputValue) * 100 : null
		},
		missingPrices,
		warnings: [...warnings]
	};
}

export const FILL_TIERS: readonly Tier[] = [
	'composite',
	'booster_strong',
	'booster_improved',
	'molecular_forged',
	'polymer',
	'intermediate'
];

export interface FillOptions {
	/** Reactions auto-fill may add; default: tiers in {@link FILL_TIERS}. */
	allowed?: (reaction: Reaction) => boolean;
	/**
	 * Cap on a product's units sold per day (output per cycle ÷ cycle days) as a percentage of its average
	 * daily volume (`dailyVolumes`). Products without volume data get at most one line (none when the
	 * product already is a target). Default: no cap.
	 */
	maxVolumeSharePct?: number;
	/**
	 * Buy the reaction-made inputs of every added reaction instead of building them: candidates are ranked
	 * by their buy-inputs (single view) profit and their intermediates join `buyInsteadOfBuild`.
	 */
	buyIntermediates?: boolean;
}

export interface FillResult {
	targets: PlanTarget[];
	/** `input.buyInsteadOfBuild` plus the intermediates bought for added reactions (`buyIntermediates`). */
	buyInsteadOfBuild: number[];
}

/**
 * Greedily adds target lines, best profit per slot-day first (full chain, or buy inputs with
 * `buyIntermediates`), while the plan still fits `totalSlots` and each product stays within
 * `maxVolumeSharePct`. Existing targets are kept. A candidate that no longer fits never fits again
 * (slots and sold volume only grow), so it is dropped from the pool.
 */
export function suggestFillPlan(input: PlanInput, opts: FillOptions = {}): FillResult {
	const { ctx } = input;
	const producers = producerIndex(ctx.dataset);
	const allowed = opts.allowed ?? ((r: Reaction) => FILL_TIERS.includes(r.tier));
	let pool = ctx.dataset.reactions
		.filter(allowed)
		.map((reaction) => {
			// The chain the planner would build: with its unrefined routes when the setting asks for them.
			const chainView = ctx.settings.unrefinedInChains === 'best' ? 'unrefined' : 'chain';
			const view = !opts.buyIntermediates && chainable(reaction, ctx.dataset) ? chainView : 'single';
			const result = calculateReaction(reaction, ctx, { view, outputMode: 'product' });
			return { reaction, score: result.totals.profitPerSlotDay };
		})
		.filter((c): c is { reaction: Reaction; score: number } => c.score !== null && c.score > 0)
		.sort((a, b) => b.score - a.score || a.reaction.blueprintTypeId - b.reaction.blueprintTypeId);

	let targets = input.targets.map((t) => ({ ...t }));
	let buy = [...input.buyInsteadOfBuild];
	const plan = (t: PlanTarget[], b: number[]) =>
		planReactions({ ...input, targets: t, buyInsteadOfBuild: b });
	if (plan(targets, buy).slotsUsed > input.totalSlots) return { targets, buyInsteadOfBuild: buy };

	while (pool.length > 0) {
		const { reaction } = pool[0];
		const id = reaction.blueprintTypeId;
		const wasTarget = targets.some((t) => t.blueprintTypeId === id);
		const existing = targets.find((t) => t.blueprintTypeId === id && t.quantity === undefined);
		const nextTargets = existing
			? targets.map((t) => (t === existing ? { ...t, lines: t.lines + 1 } : t))
			: [...targets, { blueprintTypeId: id, lines: 1 }];
		const nextBuy = opts.buyIntermediates
			? [...new Set([...buy, ...reaction.materials.map((m) => m.typeId).filter((t) => producers.has(t))])]
			: buy;
		const result = plan(nextTargets, nextBuy);
		let fits = result.slotsUsed <= input.totalSlots;
		if (fits && opts.maxVolumeSharePct !== undefined) {
			const share = result.outputsPerCycle.find(
				(o) => o.typeId === reaction.product.typeId
			)?.dailyVolumeSharePct;
			fits = share === null || share === undefined ? !wasTarget : share <= opts.maxVolumeSharePct;
		}
		if (fits) {
			targets = nextTargets;
			buy = nextBuy;
		} else pool = pool.slice(1);
	}
	return { targets, buyInsteadOfBuild: buy };
}

/** {@link suggestFillPlan}'s targets (the planner's "Auto-fill best"). */
export function suggestFill(input: PlanInput, opts: FillOptions = {}): PlanTarget[] {
	return suggestFillPlan(input, opts).targets;
}
