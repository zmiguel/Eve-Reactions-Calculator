import {
	LineItemBag,
	type ChainNode,
	type JobCostBreakdown,
	type LineItem,
	type StepSubtotal
} from '@reactions/engine';

/** One industry job of the detail page. */
export interface ProductionJob {
	/** Tree path of the job (`0` = final product, `0-1` = its second sub-job, …); unique per page. */
	id: string;
	node: ChainNode;
}

/** An intermediate a step's jobs take from an earlier step (or a reprocessing byproduct) instead of buying it. */
export interface StepIntermediate {
	typeId: number;
	name: string;
	quantity: number;
	/**
	 * Number of the step producing it. A byproduct can come from the same or a later step only in a steady
	 * cycle of optimal slots, where every job uses the previous cycle's reprocessing.
	 */
	step: number;
	/** A byproduct of an unrefined job's reprocessing, used in place of buying it. */
	byproduct: boolean;
}

/** One build cycle: every job of one build step, run side by side. */
export interface ProductionStep {
	/** Build step, 1-based (`ChainNode.step`): the last step builds the final product. */
	number: number;
	/** The step's jobs in tree order. */
	jobs: ProductionJob[];
	/**
	 * Bought materials of every job of the step, merged per type (quantity-weighted unit price), with the
	 * aggregated input's `availableAtInputHub` and its `sources` spread over the steps.
	 */
	purchases: LineItem[];
	/** Intermediates consumed from earlier steps, merged per type. */
	intermediates: StepIntermediate[];
	jobCost: JobCostBreakdown;
	/** Rates shared by every job of the step; `null` when the jobs' reactor profiles differ. */
	jobRates: ChainNode['jobRates'] | null;
	/** Sum of the jobs' own subtotals (purchases, broker fees, shipping, job cost). */
	subtotal: StepSubtotal;
	/** Total time the step's jobs occupy reaction slots. */
	slotSeconds: number;
	/** A bought material has no market price, so the purchases and the step total are unknown. */
	unpriced: boolean;
}

/** Regular reactions the job tree replaces with an unrefined job, in tree order, each name once. */
export function replacedReactions(root: ChainNode): string[] {
	const names = new Set<string>();
	const visit = (node: ChainNode) => {
		if (node.reprocess) names.add(node.reprocess.replacesName);
		node.children.forEach(visit);
	};
	visit(root);
	return [...names];
}

/**
 * Groups a job tree into its build steps (`ChainNode.step`: one after its sub-jobs and, in a single-line
 * chain, after the unrefined jobs whose byproducts it uses), so every step only consumes what earlier
 * steps produced; the final product is the last step. `inputs` (the result's aggregated purchases, fuel
 * blocks first) orders each step's purchases and gives them their availability and their share of each
 * market when a type is split (see {@link spreadSources}).
 */
export function productionSteps(root: ChainNode, inputs: LineItem[] = []): ProductionStep[] {
	const jobs: ProductionJob[] = [];
	const visit = (node: ChainNode, id: string) => {
		jobs.push({ id, node });
		node.children.forEach((child, i) => visit(child, `${id}-${i}`));
	};
	visit(root, '0');
	const reprocessStep = new Map(
		jobs.filter((j) => j.node.reprocess).map((j) => [j.node.blueprintTypeId, j.node.step])
	);

	const steps: ProductionStep[] = [];
	for (let level = 1; level <= root.step; level++) {
		const stepJobs = jobs.filter((job) => job.node.step === level);
		const bag = new LineItemBag();
		const intermediates = new Map<string, StepIntermediate>();
		for (const { node } of stepJobs) {
			for (const m of node.materials) {
				if (m.source === 'buy') {
					bag.add(m.typeId, m.name, m.quantity, m.unitPrice, m.fees, m.shipping, m.volume);
					continue;
				}
				const byproduct = m.source === 'byproduct';
				const producer = node.children.find(
					(child) => (child.reprocess?.typeId ?? child.productTypeId) === m.typeId
				);
				const key = `${m.source}:${m.typeId}`;
				const known = intermediates.get(key);
				if (known) known.quantity += m.quantity;
				else
					intermediates.set(key, {
						typeId: m.typeId,
						name: m.name,
						quantity: m.quantity,
						step: byproduct ? reprocessStep.get(m.blueprintTypeId)! : producer!.step,
						byproduct
					});
			}
		}
		const sum = <K extends string>(pick: (node: ChainNode) => Record<K, number>, keys: K[]) =>
			Object.fromEntries(
				keys.map((k) => [k, stepJobs.reduce((a, { node }) => a + pick(node)[k], 0)])
			) as Record<K, number>;
		const [first, ...rest] = stepJobs.map(({ node }) => node.jobRates);
		steps.push({
			number: level,
			jobs: stepJobs,
			purchases: bag.list(),
			intermediates: [...intermediates.values()],
			jobCost: sum((n) => n.jobCost, ['eiv', 'systemCost', 'facilityTax', 'scc', 'total']),
			jobRates: rest.every(
				(r) =>
					r.costIndex === first.costIndex &&
					r.facilityTaxPct === first.facilityTaxPct &&
					r.sccPct === first.sccPct
			)
				? first
				: null,
			subtotal: sum(
				(n) => n.subtotal,
				['purchaseCost', 'purchaseFees', 'purchaseShipping', 'jobCost', 'total']
			),
			slotSeconds: stepJobs.reduce((a, { node }) => a + node.slotSeconds, 0),
			unpriced: stepJobs.some(({ node }) =>
				node.materials.some((m) => m.source === 'buy' && m.unitPrice === null)
			)
		});
	}
	spreadSources(steps, inputs);
	const order = new Map(inputs.map((i, index) => [i.typeId, index]));
	for (const step of steps)
		step.purchases.sort((a, b) => (order.get(a.typeId) ?? Infinity) - (order.get(b.typeId) ?? Infinity));
	return steps;
}

/**
 * Every purchase of a split type is priced at one blended unit price, so a step's market quantities are
 * its share of the aggregated `sources`. Cumulative rounding over the steps (and over the markets) keeps
 * whole units that add up exactly to each market's total.
 */
function spreadSources(steps: ProductionStep[], inputs: LineItem[]) {
	const byType = new Map(inputs.map((i) => [i.typeId, i]));
	const done = new Map<number, number>();
	for (const step of steps) {
		step.purchases = step.purchases.map((p) => {
			const total = byType.get(p.typeId);
			if (!total) return p;
			const item: LineItem =
				total.availableAtInputHub === undefined
					? p
					: { ...p, availableAtInputHub: total.availableAtInputHub };
			if (!total.sources) return item;
			const before = done.get(p.typeId) ?? 0;
			const after = before + p.quantity;
			done.set(p.typeId, after);
			let share = 0;
			let prev = { before: 0, after: 0 };
			const sources = total.sources.map((s) => {
				share += s.quantity;
				const at = (q: number) => Math.round((q * share) / total.quantity);
				const cum = { before: at(before), after: at(after) };
				const quantity = cum.after - prev.after - (cum.before - prev.before);
				prev = cum;
				return {
					...s,
					quantity,
					total: s.unitPrice === null ? 0 : quantity * s.unitPrice,
					fees: s.quantity > 0 ? (s.fees * quantity) / s.quantity : 0
				};
			});
			return { ...item, sources: sources.filter((s) => s.quantity > 0) };
		});
	}
}
