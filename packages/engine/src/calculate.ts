import type { ChainAllocation } from './allocation.ts';
import {
	SECONDS_PER_DAY,
	ZERO_JOB_COST,
	addJobCosts,
	eiv,
	jobCost,
	inputUnitPrice,
	materialModifier,
	outputUnitPrice,
	requiredQuantity,
	runTimeSeconds,
	runsPerCycleDetail,
	shippingCost,
	splitIntoSlots,
	type JobCostBreakdown
} from './formulas.ts';
import type { ResolvedProfile, Settings } from './settings.ts';
import { InputSourcing, type InputSource, type Purchase } from './sourcing.ts';
import type { Dataset, PriceBook, Reaction, Reactor, ReprocessMaterial, Tier } from './types.ts';
import { chooseUnrefined, memoChoice, unrefinedIndex, unrefinedRuns } from './unrefined.ts';

export interface CalcContext {
	dataset: Dataset;
	profiles: Record<Reactor, ResolvedProfile>;
	settings: Settings;
	inputPrices: PriceBook;
	outputPrices: PriceBook;
}

/**
 * `single` buys every input; `chain` builds the intermediates with their regular reactions; `unrefined`
 * is the full chain with the best unrefined routes. Views never read `settings.unrefinedInChains`: that
 * setting only picks which chain ranks where no view is chosen (`chainFor`, the planner).
 */
export type View = 'single' | 'chain' | 'unrefined';
export type OutputMode = 'product' | 'reprocessed';

export interface CalcOptions {
	view: View;
	outputMode: OutputMode;
	runs?: number;
	/**
	 * Splits every job into parallel slot jobs of at most `runsPerCycle` runs (same rule as the planner);
	 * material needs are summed per job. Used by the optimal slot allocation.
	 */
	splitJobs?: boolean;
	/**
	 * Chain views: product type ids built through their unrefined reaction, whose product is reprocessed,
	 * instead of their regular reaction. Default: {@link bestUnrefined} for `unrefined`, none for `chain`.
	 */
	viaUnrefined?: readonly number[];
}

export interface LineItem {
	typeId: number;
	name: string;
	quantity: number;
	unitPrice: number | null;
	total: number;
	fees: number;
	shipping: number;
	volume: number;
	/**
	 * Bought inputs (aggregated per type) split by market depth: the quantity bought at the input hub and
	 * the rest at the fallback hub.
	 */
	sources?: InputSource[];
	/** Bought inputs (market purchases): units listed for sale at the input hub; `null` when unknown. */
	availableAtInputHub?: number | null;
}

/**
 * A material one job consumes: bought (priced like the aggregated `inputs`), built by a child job, or
 * taken from the byproduct of an unrefined job's reprocessing elsewhere in the chain.
 */
export type StepMaterial =
	| (LineItem & { source: 'buy' })
	| {
			source: 'chain' | 'byproduct';
			typeId: number;
			name: string;
			quantity: number;
			volume: number;
			/** Blueprint of the job producing it (`byproduct`: the unrefined job whose reprocessing yields it). */
			blueprintTypeId: number;
	  };

/** One material an unrefined job's reprocessing yields. */
export interface ReprocessedOutput {
	typeId: number;
	name: string;
	/** Units reprocessing yields (after the reprocessing yield). */
	quantity: number;
	/**
	 * Units the chain uses: the replaced material by the consuming job; a byproduct in place of the
	 * chain's purchases of its type.
	 */
	used: number;
	/** Byproduct units sold with the outputs (0 for the replaced material, whose leftover is surplus). */
	sold: number;
}

/** An unrefined job standing in for a regular reaction: its whole product is reprocessed. */
export interface ChainReprocess {
	/** The material the consuming job needs (the regular reaction's product). */
	typeId: number;
	/** Regular reaction the job replaces. */
	replacesBlueprintTypeId: number;
	replacesName: string;
	/** Reprocessing yield applied (`settings.reprocessing`). */
	yieldPct: number;
	/** Every reprocessed material in reprocessing order: the replaced one and the byproducts. */
	outputs: ReprocessedOutput[];
	/** Units of the replaced material beyond the consuming job's need (chain surplus). */
	surplus: number;
}

/** One job's own costs (children excluded); `total` = purchases + fees + shipping + job cost. */
export interface StepSubtotal {
	purchaseCost: number;
	purchaseFees: number;
	purchaseShipping: number;
	jobCost: number;
	total: number;
}

export interface ChainNode {
	blueprintTypeId: number;
	name: string;
	reactor: Reactor;
	runs: number;
	runTimeSeconds: number;
	quantityProduced: number;
	quantityUsed: number;
	/** Units of the product left over; 0 for an unrefined job (see `reprocess.surplus`). */
	surplus: number;
	jobCost: JobCostBreakdown;
	children: ChainNode[];
	productTypeId: number;
	/** Distance from the top job (0 = final product). */
	depth: number;
	/**
	 * Build step, 1-based: one after its sub-jobs and, in a single-line chain, after the unrefined jobs
	 * whose reprocessing byproducts it uses; the top job's step is the result's `chainDepth`.
	 */
	step: number;
	/** Materials in blueprint order, quantities after ME. */
	materials: StepMaterial[];
	/** `runs × runTimeSeconds` of this job only. */
	slotSeconds: number;
	/** Rates behind `jobCost` (the job's reactor profile). */
	jobRates: { costIndex: number; facilityTaxPct: number; sccPct: number };
	subtotal: StepSubtotal;
	/** Runs of each parallel slot job; only with `splitJobs` (otherwise one job of `runs`). */
	runsPerSlot?: number[];
	/** Present when the job is an unrefined reaction replacing a regular one (`viaUnrefined`). */
	reprocess?: ChainReprocess;
}

export interface ReactionTotals {
	inputCost: number;
	inputFees: number;
	inputShipping: number;
	outputValue: number;
	outputFees: number;
	outputShipping: number;
	jobCost: number;
	totalCost: number;
	profit: number | null;
	marginPct: number | null;
	roiPct: number | null;
	slotSeconds: number;
	profitPerSlotDay: number | null;
	profitPerRun: number | null;
}

export interface ReactionResult {
	blueprintTypeId: number;
	slug: string;
	name: string;
	reactor: Reactor;
	tier: Tier;
	view: View;
	outputMode: OutputMode;
	runs: number;
	runTimeSeconds: number;
	/** Reaction levels between buying inputs and selling outputs (1 for a single reaction). */
	chainDepth: number;
	inputs: LineItem[];
	chain: ChainNode | null;
	/**
	 * Chain view: product type ids the chain builds through their unrefined reaction and reprocessing,
	 * ascending; empty otherwise.
	 */
	viaUnrefined: number[];
	outputs: LineItem[];
	surplus: LineItem[];
	jobCost: JobCostBreakdown;
	totals: ReactionTotals;
	missingPrices: number[];
	warnings: string[];
	/** Slot plan of an optimal-allocation chain (see `calculateAllocated`); absent otherwise. */
	allocation?: ChainAllocation;
}

export type Warning =
	| 'CYCLE_SHORTER_THAN_RUN'
	| 'MAX_RUNS_PER_JOB'
	| 'MISSING_ADJUSTED_PRICE'
	| 'COST_INDEX_MISSING'
	| 'SKILL_TOO_LOW'
	| 'NO_REPROCESS_DATA'
	| 'SLOTS_EXCEEDED'
	/** An input's need exceeds the units listed at the input hub; the rest is priced at the fallback hub. */
	| 'INPUT_VOLUME_SHORT';

const producerCache = new WeakMap<Dataset, Map<number, Reaction>>();

/** Product type id → published reaction producing it (lowest blueprint id wins). */
export function producerIndex(dataset: Dataset): Map<number, Reaction> {
	let index = producerCache.get(dataset);
	if (!index) {
		index = new Map();
		const sorted = [...dataset.reactions].sort((a, b) => a.blueprintTypeId - b.blueprintTypeId);
		for (const r of sorted) if (!index.has(r.product.typeId)) index.set(r.product.typeId, r);
		producerCache.set(dataset, index);
	}
	return index;
}

export function chainable(reaction: Reaction, dataset: Dataset): boolean {
	const producers = producerIndex(dataset);
	return reaction.materials.some((m) => producers.has(m.typeId));
}

export function reprocessable(reaction: Reaction, dataset: Dataset): boolean {
	return dataset.reprocess[reaction.product.typeId] !== undefined;
}

/** Accumulates line items per type id; unit price is the quantity-weighted average. */
export class LineItemBag {
	private items = new Map<number, LineItem & { priced: boolean }>();

	add(
		typeId: number,
		name: string,
		quantity: number,
		unitPrice: number | null,
		fees: number,
		shipping: number,
		volume: number
	) {
		const existing = this.items.get(typeId);
		const total = unitPrice === null ? 0 : quantity * unitPrice;
		if (existing) {
			existing.quantity += quantity;
			existing.total += total;
			existing.fees += fees;
			existing.shipping += shipping;
			existing.volume += volume;
			existing.priced = existing.priced && unitPrice !== null;
		} else {
			this.items.set(typeId, {
				typeId,
				name,
				quantity,
				unitPrice,
				total,
				fees,
				shipping,
				volume,
				priced: unitPrice !== null
			});
		}
	}

	addItem(i: LineItem) {
		this.add(i.typeId, i.name, i.quantity, i.unitPrice, i.fees, i.shipping, i.volume);
	}

	list(): LineItem[] {
		return [...this.items.values()].map(({ priced, ...item }) => ({
			...item,
			unitPrice: priced && item.quantity > 0 ? item.total / item.quantity : item.unitPrice
		}));
	}
}

export interface PricingContext {
	ctx: CalcContext;
	missing: Set<number>;
}

export function sellLine(
	bag: LineItemBag,
	pc: PricingContext,
	profile: ResolvedProfile,
	typeId: number,
	quantity: number,
	opts: { countMissing: boolean; withCosts: boolean }
) {
	const type = pc.ctx.dataset.types[typeId];
	const volume = quantity * (type?.volume ?? 0);
	const unit = outputUnitPrice(pc.ctx.outputPrices.hubs[profile.market.outputHub]?.[typeId], profile.market);
	if (!unit) {
		if (opts.countMissing) pc.missing.add(typeId);
		bag.add(typeId, type?.name ?? String(typeId), quantity, null, 0, 0, volume);
		return;
	}
	const fees = opts.withCosts ? quantity * unit.fee : 0;
	const shipping = opts.withCosts
		? shippingCost(quantity, type?.volume ?? 0, unit.price, profile.shipping.output)
		: 0;
	bag.add(typeId, type?.name ?? String(typeId), quantity, unit.price, fees, shipping, volume);
}

/** Reprocessing yield (%) of a reaction product of `tier`. */
export function reprocessYieldPct(settings: Settings, tier: Tier): number {
	const r = settings.reprocessing;
	return tier === 'unrefined_mineral' ? r.prismaticiteYieldPct : r.unrefinedYieldPct;
}

/** Units of `m` per portion at 100 % yield (a ranged quantity at the configured roll). */
export function perPortionQuantity(settings: Settings, m: ReprocessMaterial): number {
	return (
		m.quantity ??
		(m.quantityMin ?? 0) +
			((m.quantityMax ?? 0) - (m.quantityMin ?? 0)) * (settings.reprocessing.prismaticiteRollPct / 100)
	);
}

/** Reprocessed materials for `productQty` units of `typeId`, or null without reprocess data. */
export function reprocessOutputs(
	dataset: Dataset,
	settings: Settings,
	tier: Tier,
	typeId: number,
	productQty: number
): { typeId: number; quantity: number }[] | null {
	const entry = dataset.reprocess[typeId];
	if (!entry) return null;
	const yieldPct = reprocessYieldPct(settings, tier);
	const portions = Math.floor(productQty / entry.portionSize);
	return entry.materials.map((m) => ({
		typeId: m.typeId,
		quantity: Math.floor((portions * perPortionQuantity(settings, m) * yieldPct) / 100)
	}));
}

interface ChainBuild {
	node: ChainNode;
	/** Slot time of this job and all its descendants. */
	slotSeconds: number;
}

/** The regular reaction an unrefined job replaces and the units of its product the consumer needs. */
interface Replacement {
	regular: Reaction;
	typeId: number;
	need: number;
}

/**
 * The product types the `unrefined` view builds through their unrefined reaction when `viaUnrefined` is
 * not given: {@link chooseUnrefined} with the chain's own profit per slot-day (one line, jobs back to
 * back, unless `splitJobs`), memoised per context.
 */
export function bestUnrefined(
	reaction: Reaction,
	ctx: CalcContext,
	opts: Partial<Pick<CalcOptions, 'runs' | 'splitJobs' | 'outputMode'>> = {}
): readonly number[] {
	const { runs, splitJobs, outputMode = 'product' } = opts;
	const key = `chain:${reaction.blueprintTypeId}:${runs ?? ''}:${splitJobs ? 1 : 0}:${outputMode}`;
	return memoChoice(ctx, key, () =>
		chooseUnrefined(reaction, ctx, (viaUnrefined) => {
			const r = calculateReaction(reaction, ctx, {
				view: 'unrefined',
				outputMode,
				runs,
				splitJobs,
				viaUnrefined
			});
			return {
				profit: r.totals.profit,
				profitPerSlotDay: r.totals.profitPerSlotDay,
				finalUnits: r.runs * reaction.product.quantity
			};
		})
	);
}

interface PendingPurchase extends Purchase {
	line: StepMaterial & { source: 'buy' };
	/** Materials of the buying job (`ChainNode.materials`). */
	materials: StepMaterial[];
}

/**
 * Lets reprocessing byproducts replace purchases of their type, the most valuable use first (units ×
 * the buyer's unit price and fee at its input hub; ties in job order). With `steady` (one steady cycle
 * of the optimal allocation) every job uses the previous cycle's byproducts, its own included. Otherwise
 * (one line, jobs back to back) a job can only use the byproducts of unrefined jobs that have finished
 * before it starts: each use orders the producer before the consumer, and a use that would need the
 * consumer first (the producer itself, its sub-jobs, or an order already fixed the other way) is not
 * made. Updates the purchases, the jobs' materials and `output.used`/`sold`; returns, per job, the
 * unrefined jobs it waits for because of their byproducts.
 */
function assignByproducts(
	ctx: CalcContext,
	nodes: ChainNode[],
	pending: PendingPurchase[],
	byproducts: { node: ChainNode; output: ReprocessedOutput }[],
	steady: boolean
): Map<ChainNode, ChainNode[]> {
	const ownerOf = new Map(nodes.map((n) => [n.materials, n]));
	// Jobs finished before each job starts (sub-jobs; `nodes` lists children before their parents).
	const before = new Map<ChainNode, Set<ChainNode>>();
	for (const n of nodes) before.set(n, new Set(n.children.flatMap((c) => [c, ...before.get(c)!])));
	const waitsFor = new Map<ChainNode, ChainNode[]>();
	const unitValue = (p: PendingPurchase) => {
		const unit = inputUnitPrice(
			ctx.inputPrices.hubs[p.profile.market.inputHub]?.[p.typeId],
			p.profile.market
		);
		return unit ? unit.price + unit.fee : 0;
	};
	const left = byproducts.map((b) => b.output.quantity);
	for (;;) {
		let best: { b: number; purchase: PendingPurchase; value: number } | null = null;
		for (const [b, { node, output }] of byproducts.entries()) {
			if (left[b] === 0) continue;
			for (const purchase of pending) {
				if (purchase.typeId !== output.typeId || purchase.quantity === 0) continue;
				const consumer = ownerOf.get(purchase.materials)!;
				if (!steady && (consumer === node || before.get(node)!.has(consumer))) continue;
				const value = Math.min(left[b], purchase.quantity) * unitValue(purchase);
				if (!best || value > best.value) best = { b, purchase, value };
			}
		}
		if (!best) break;
		const { b, purchase } = best;
		const { node: producer, output } = byproducts[b];
		const consumer = ownerOf.get(purchase.materials)!;
		if (!steady && !before.get(consumer)!.has(producer)) {
			const earlier = [producer, ...before.get(producer)!];
			for (const n of nodes)
				if (n === consumer || before.get(n)!.has(consumer)) for (const e of earlier) before.get(n)!.add(e);
			waitsFor.set(consumer, [...(waitsFor.get(consumer) ?? []), producer]);
		}
		const take = Math.min(left[b], purchase.quantity);
		const unitVolume = ctx.dataset.types[output.typeId]?.volume ?? 0;
		left[b] -= take;
		output.used += take;
		purchase.quantity -= take;
		purchase.line.quantity = purchase.quantity;
		purchase.line.volume = purchase.quantity * unitVolume;
		const at = purchase.materials.indexOf(purchase.line);
		purchase.materials.splice(at, purchase.quantity === 0 ? 1 : 0, {
			source: 'byproduct',
			typeId: output.typeId,
			name: output.name,
			quantity: take,
			volume: take * unitVolume,
			blueprintTypeId: producer.blueprintTypeId
		});
	}
	for (const [b, { output }] of byproducts.entries()) output.sold = left[b];
	return waitsFor;
}

export function calculateReaction(reaction: Reaction, ctx: CalcContext, opts: CalcOptions): ReactionResult {
	const { dataset, settings } = ctx;
	const constants = dataset.constants;
	const producers = producerIndex(dataset);
	const alternatives = unrefinedIndex(dataset);
	const warnings = new Set<Warning>();
	const pc: PricingContext = { ctx, missing: new Set() };
	const inputs = new LineItemBag();
	const surplus = new LineItemBag();
	const profile = ctx.profiles[reaction.reactor];
	const chainView = opts.view !== 'single';
	const via = new Set(
		!chainView
			? []
			: (opts.viaUnrefined ?? (opts.view === 'unrefined' ? bestUnrefined(reaction, ctx, opts) : []))
	);
	const applied = new Set<number>();

	const topRunTime = runTimeSeconds(reaction, profile, constants);
	let runs = opts.runs;
	if (runs === undefined) {
		const detail = runsPerCycleDetail(reaction, profile, settings.cycleDays, constants);
		if (!detail.fits) warnings.add('CYCLE_SHORTER_THAN_RUN');
		if (detail.capped) warnings.add('MAX_RUNS_PER_JOB');
		runs = detail.runs;
	}

	// Pass 1 builds the job tree and collects every purchase and byproduct; byproducts then replace
	// purchases of their type (which may order jobs), and pass 2 prices the rest together so the units
	// listed at an input hub are shared by all jobs of the chain.
	const pending: PendingPurchase[] = [];
	const byproducts: { node: ChainNode; output: ReprocessedOutput }[] = [];
	const nodes: ChainNode[] = [];
	const build = (
		r: Reaction,
		rRuns: number,
		quantityUsed: number,
		ancestors: Set<number>,
		level: number,
		replaces?: Replacement
	): ChainBuild => {
		const p = ctx.profiles[r.reactor];
		if (p.costIndexMissing) warnings.add('COST_INDEX_MISSING');
		if (p.reactionsSkill < r.requiredSkillLevel) warnings.add('SKILL_TOO_LOW');
		const estimate = eiv(r, rRuns, ctx.inputPrices.adjusted);
		if (estimate.missing.length > 0) warnings.add('MISSING_ADJUSTED_PRICE');
		const rt = runTimeSeconds(r, p, constants);
		const mm = materialModifier(p, constants);
		const jobs = opts.splitJobs
			? splitIntoSlots(rRuns, runsPerCycleDetail(r, p, settings.cycleDays, constants).runs)
			: [rRuns];
		const children: ChainNode[] = [];
		const materials: StepMaterial[] = [];
		const ownSlotSeconds = rRuns * rt;
		let slotSeconds = ownSlotSeconds;
		for (const m of r.materials) {
			const need = jobs.reduce((acc, jobRuns) => acc + requiredQuantity(jobRuns, m.quantity, mm), 0);
			const type = dataset.types[m.typeId];
			const name = type?.name ?? String(m.typeId);
			const volume = need * (type?.volume ?? 0);
			const regular = chainView ? producers.get(m.typeId) : undefined;
			const alt = regular && via.has(m.typeId) ? alternatives.get(m.typeId) : undefined;
			const altRuns = alt ? unrefinedRuns(dataset, settings, alt, m.typeId, need) : null;
			const sub = alt && altRuns !== null && !ancestors.has(alt.blueprintTypeId) ? alt : regular;
			if (sub && !ancestors.has(sub.blueprintTypeId)) {
				const viaAlt = sub === alt;
				const subRuns = viaAlt ? altRuns! : Math.ceil(need / sub.product.quantity);
				const child = build(
					sub,
					subRuns,
					viaAlt ? subRuns * sub.product.quantity : need,
					new Set(ancestors).add(sub.blueprintTypeId),
					level + 1,
					viaAlt ? { regular: regular!, typeId: m.typeId, need } : undefined
				);
				if (viaAlt) applied.add(m.typeId);
				children.push(child.node);
				slotSeconds += child.slotSeconds;
				materials.push({
					source: 'chain',
					typeId: m.typeId,
					name,
					quantity: need,
					volume,
					blueprintTypeId: sub.blueprintTypeId
				});
				const left = child.node.reprocess?.surplus ?? child.node.surplus;
				if (left > 0) {
					sellLine(surplus, pc, ctx.profiles[sub.reactor], m.typeId, left, {
						countMissing: false,
						withCosts: false
					});
				}
			} else {
				const line = {
					source: 'buy' as const,
					typeId: m.typeId,
					name,
					quantity: need,
					unitPrice: null as number | null,
					total: 0,
					fees: 0,
					shipping: 0,
					volume
				};
				materials.push(line);
				pending.push({ profile: p, typeId: m.typeId, quantity: need, line, materials });
			}
		}
		const produced = rRuns * r.product.quantity;
		const job = jobCost(estimate.value, p);
		const node: ChainNode = {
			blueprintTypeId: r.blueprintTypeId,
			name: r.name,
			reactor: r.reactor,
			runs: rRuns,
			runTimeSeconds: rt,
			quantityProduced: produced,
			quantityUsed,
			surplus: produced - quantityUsed,
			jobCost: job,
			children,
			productTypeId: r.product.typeId,
			depth: level,
			// Set once byproduct uses have ordered the jobs (below).
			step: 1,
			materials,
			slotSeconds: ownSlotSeconds,
			...(opts.splitJobs ? { runsPerSlot: jobs } : {}),
			jobRates: { costIndex: p.costIndex, facilityTaxPct: p.facilityTaxPct, sccPct: p.sccPct },
			// Filled once the purchases are priced (below).
			subtotal: { purchaseCost: 0, purchaseFees: 0, purchaseShipping: 0, jobCost: 0, total: 0 }
		};
		if (replaces) {
			// `unrefinedRuns` returned runs, so the reprocess data exists and yields the need.
			const outputs = reprocessOutputs(dataset, settings, r.tier, r.product.typeId, produced)!.map((o) => ({
				typeId: o.typeId,
				name: dataset.types[o.typeId]?.name ?? String(o.typeId),
				quantity: o.quantity,
				used: o.typeId === replaces.typeId ? replaces.need : 0,
				sold: 0
			}));
			const made = outputs.find((o) => o.typeId === replaces.typeId)!.quantity;
			node.reprocess = {
				typeId: replaces.typeId,
				replacesBlueprintTypeId: replaces.regular.blueprintTypeId,
				replacesName: replaces.regular.name,
				yieldPct: reprocessYieldPct(settings, r.tier),
				outputs,
				surplus: made - replaces.need
			};
			for (const output of outputs)
				if (output.typeId !== replaces.typeId && output.quantity > 0) byproducts.push({ node, output });
		}
		nodes.push(node);
		return { node, slotSeconds };
	};

	const productQty = runs * reaction.product.quantity;
	const root = build(reaction, runs, productQty, new Set([reaction.blueprintTypeId]), 0);

	const waitsFor = assignByproducts(ctx, nodes, pending, byproducts, opts.splitJobs === true);
	const stepOf = (node: ChainNode): number =>
		Math.max(0, ...[...node.children, ...(waitsFor.get(node) ?? [])].map(stepOf)) + 1;
	for (const node of nodes) node.step = stepOf(node);
	const purchases = pending.filter((p) => p.quantity > 0);

	const sourcing = new InputSourcing(ctx, purchases);
	for (const { profile: p, typeId, quantity, line } of purchases) {
		const item = sourcing.buy(pc, p, typeId, quantity);
		Object.assign(line, item);
		inputs.addItem(item);
	}
	if (sourcing.short) warnings.add('INPUT_VOLUME_SHORT');
	for (const node of nodes) {
		let purchaseCost = 0;
		let purchaseFees = 0;
		let purchaseShipping = 0;
		for (const m of node.materials) {
			if (m.source !== 'buy') continue;
			purchaseCost += m.total;
			purchaseFees += m.fees;
			purchaseShipping += m.shipping;
		}
		const job = node.jobCost.total;
		node.subtotal = {
			purchaseCost,
			purchaseFees,
			purchaseShipping,
			jobCost: job,
			total: purchaseCost + purchaseFees + purchaseShipping + job
		};
	}

	const outputs = new LineItemBag();
	let outputMode = opts.outputMode;
	const reprocessed =
		outputMode === 'reprocessed'
			? reprocessOutputs(dataset, settings, reaction.tier, reaction.product.typeId, productQty)
			: null;
	if (outputMode === 'reprocessed' && !reprocessed) {
		warnings.add('NO_REPROCESS_DATA');
		outputMode = 'product';
	}
	const sold = reprocessed ?? [{ typeId: reaction.product.typeId, quantity: productQty }];
	for (const o of sold)
		sellLine(outputs, pc, profile, o.typeId, o.quantity, { countMissing: true, withCosts: true });
	for (const { node, output } of byproducts) {
		if (output.sold === 0) continue;
		sellLine(outputs, pc, ctx.profiles[node.reactor], output.typeId, output.sold, {
			countMissing: true,
			withCosts: true
		});
	}

	let totalJob = ZERO_JOB_COST;
	const sumJobs = (n: ChainNode) => {
		totalJob = addJobCosts(totalJob, n.jobCost);
		n.children.forEach(sumJobs);
	};
	sumJobs(root.node);

	const inputList = sourcing.annotate(inputs.list());
	const outputList = outputs.list();
	const sum = (items: LineItem[], key: 'total' | 'fees' | 'shipping') =>
		items.reduce((acc, i) => acc + i[key], 0);
	const inputCost = sum(inputList, 'total');
	const inputFees = sum(inputList, 'fees');
	const inputShipping = sum(inputList, 'shipping');
	const outputValue = sum(outputList, 'total');
	const outputFees = sum(outputList, 'fees');
	const outputShipping = sum(outputList, 'shipping');
	const totalCost = inputCost + inputFees + inputShipping + totalJob.total;
	const missingPrices = [...pc.missing].sort((a, b) => a - b);
	const complete = missingPrices.length === 0;
	const profit = complete ? outputValue - outputFees - outputShipping - totalCost : null;

	return {
		blueprintTypeId: reaction.blueprintTypeId,
		slug: reaction.slug,
		name: reaction.name,
		reactor: reaction.reactor,
		tier: reaction.tier,
		view: opts.view,
		outputMode,
		runs,
		runTimeSeconds: topRunTime,
		chainDepth: root.node.step,
		inputs: inputList,
		chain: chainView ? root.node : null,
		viaUnrefined: [...applied].sort((a, b) => a - b),
		outputs: outputList,
		surplus: surplus.list(),
		jobCost: totalJob,
		totals: {
			inputCost,
			inputFees,
			inputShipping,
			outputValue,
			outputFees,
			outputShipping,
			jobCost: totalJob.total,
			totalCost,
			profit,
			marginPct: profit !== null && outputValue !== 0 ? (profit / outputValue) * 100 : null,
			roiPct: profit !== null && totalCost !== 0 ? (profit / totalCost) * 100 : null,
			slotSeconds: root.slotSeconds,
			profitPerSlotDay:
				profit !== null && root.slotSeconds > 0 ? profit / (root.slotSeconds / SECONDS_PER_DAY) : null,
			profitPerRun: profit !== null && runs > 0 ? profit / runs : null
		},
		missingPrices,
		warnings: [...warnings]
	};
}
