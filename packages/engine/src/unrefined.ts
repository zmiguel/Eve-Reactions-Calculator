import {
	calculateReaction,
	chainable,
	perPortionQuantity,
	producerIndex,
	reprocessOutputs,
	reprocessYieldPct,
	type CalcContext
} from './calculate.ts';
import { inputUnitPrice, outputUnitPrice } from './formulas.ts';
import type { Settings } from './settings.ts';
import type { Dataset, Reaction, Tier } from './types.ts';

const UNREFINED_TIERS: readonly Tier[] = ['unrefined', 'unrefined_mineral'];

/** Most substitutable types of one chain whose combinations {@link chooseUnrefined} evaluates. */
export const MAX_UNREFINED_CANDIDATES = 6;

const indexCache = new WeakMap<Dataset, Map<number, Reaction>>();

/**
 * Product type id → unrefined reaction whose reprocessed product includes that type, for types a regular
 * reaction also makes (lowest blueprint id wins).
 */
export function unrefinedIndex(dataset: Dataset): Map<number, Reaction> {
	let index = indexCache.get(dataset);
	if (!index) {
		index = new Map();
		const producers = producerIndex(dataset);
		const sorted = dataset.reactions
			.filter((r) => UNREFINED_TIERS.includes(r.tier))
			.sort((a, b) => a.blueprintTypeId - b.blueprintTypeId);
		for (const r of sorted) {
			for (const m of dataset.reprocess[r.product.typeId]?.materials ?? []) {
				const regular = producers.get(m.typeId);
				if (regular && regular !== r && !index.has(m.typeId)) index.set(m.typeId, r);
			}
		}
		indexCache.set(dataset, index);
	}
	return index;
}

/**
 * Fewest runs of `alt` whose reprocessed product (all of it, at the configured yield) holds at least
 * `need` units of `typeId`; null without reprocess data or when the yield makes none.
 */
export function unrefinedRuns(
	dataset: Dataset,
	settings: Settings,
	alt: Reaction,
	typeId: number,
	need: number
): number | null {
	const entry = dataset.reprocess[alt.product.typeId];
	const material = entry?.materials.find((m) => m.typeId === typeId);
	if (!entry || !material) return null;
	const perPortion = perPortionQuantity(settings, material);
	const yieldPct = reprocessYieldPct(settings, alt.tier);
	if (!(perPortion * yieldPct > 0)) return null;
	// Same rounding as `reprocessOutputs`.
	const yielded = (portions: number) => Math.floor((portions * perPortion * yieldPct) / 100);
	let portions = Math.max(1, Math.ceil((need * 100) / (perPortion * yieldPct)));
	while (yielded(portions) < need) portions++;
	while (portions > 1 && yielded(portions - 1) >= need) portions--;
	return Math.max(1, Math.ceil((portions * entry.portionSize) / alt.product.quantity));
}

const choiceCache = new WeakMap<CalcContext, Map<string, readonly number[]>>();

/** Memoises a route choice per context (contexts are treated as immutable) and key. */
export function memoChoice(
	ctx: CalcContext,
	key: string,
	compute: () => readonly number[]
): readonly number[] {
	let byKey = choiceCache.get(ctx);
	if (!byKey) choiceCache.set(ctx, (byKey = new Map()));
	let choice = byKey.get(key);
	if (!choice) {
		choice = compute();
		byKey.set(key, choice);
	}
	return choice;
}

const edgeCache = new WeakMap<CalcContext, Map<number, number | null>>();

/**
 * Per-unit screen of one type's unrefined route against its regular reaction, each priced on its own
 * for one cycle of runs: cost per unit = job cost + purchases (fees, shipping) ÷ units of the type, the
 * unrefined route crediting its byproducts at the better of their purchase cost and net sale value.
 * Returns the cost saving per unit (regular − unrefined), or null when the unrefined route is neither
 * cheaper nor faster per unit (it cannot improve a chain), makes none of the type, or a purchase has no
 * price.
 */
function unitSaving(ctx: CalcContext, typeId: number): number | null {
	let byType = edgeCache.get(ctx);
	if (!byType) edgeCache.set(ctx, (byType = new Map()));
	if (byType.has(typeId)) return byType.get(typeId)!;

	const { dataset, settings } = ctx;
	const regular = producerIndex(dataset).get(typeId)!;
	const alt = unrefinedIndex(dataset).get(typeId)!;
	const reg = calculateReaction(regular, ctx, {
		view: chainable(regular, dataset) ? 'chain' : 'single',
		outputMode: 'product',
		viaUnrefined: []
	});
	const un = calculateReaction(alt, ctx, { view: 'single', outputMode: 'product' });
	const outputs =
		reprocessOutputs(dataset, settings, alt.tier, alt.product.typeId, un.runs * alt.product.quantity) ?? [];
	const made = outputs.find((o) => o.typeId === typeId)?.quantity ?? 0;
	const unpriced = [...reg.inputs, ...un.inputs].some((i) => i.unitPrice === null);
	let saving: number | null = null;
	if (made > 0 && !unpriced) {
		const { market } = ctx.profiles[alt.reactor];
		let credit = 0;
		for (const o of outputs) {
			if (o.typeId === typeId) continue;
			const sale = outputUnitPrice(ctx.outputPrices.hubs[market.outputHub]?.[o.typeId], market);
			const purchase = inputUnitPrice(ctx.inputPrices.hubs[market.inputHub]?.[o.typeId], market);
			credit +=
				o.quantity * Math.max(sale ? sale.price - sale.fee : 0, purchase ? purchase.price + purchase.fee : 0);
		}
		const regUnits = reg.runs * regular.product.quantity;
		const regCost = reg.totals.totalCost / regUnits;
		const unCost = (un.totals.totalCost - credit) / made;
		const faster = un.totals.slotSeconds / made < reg.totals.slotSeconds / regUnits;
		if (unCost < regCost || faster) saving = regCost - unCost;
	}
	byType.set(typeId, saving);
	return saving;
}

/**
 * Whether `reaction`'s full chain builds an intermediate that also has an unrefined route (the
 * "Using unrefined" view exists); structural, independent of prices and settings.
 */
export function unrefinable(reaction: Reaction, dataset: Dataset): boolean {
	const producers = producerIndex(dataset);
	const alternatives = unrefinedIndex(dataset);
	const visit = (r: Reaction, ancestors: Set<number>): boolean =>
		r.materials.some((m) => {
			if (alternatives.has(m.typeId)) return true;
			const sub = producers.get(m.typeId);
			return (
				sub !== undefined &&
				!ancestors.has(sub.blueprintTypeId) &&
				visit(sub, new Set(ancestors).add(sub.blueprintTypeId))
			);
		});
	return visit(reaction, new Set([reaction.blueprintTypeId]));
}

/**
 * Types of `reaction`'s full chain that have an unrefined route passing the per-unit screen, ascending;
 * at most {@link MAX_UNREFINED_CANDIDATES} (largest saving per unit first).
 */
export function unrefinedCandidates(reaction: Reaction, ctx: CalcContext): number[] {
	const producers = producerIndex(ctx.dataset);
	const alternatives = unrefinedIndex(ctx.dataset);
	const found = new Set<number>();
	const visit = (r: Reaction, ancestors: Set<number>) => {
		for (const m of r.materials) {
			const subs = [producers.get(m.typeId), alternatives.get(m.typeId)];
			if (subs[1]) found.add(m.typeId);
			for (const sub of subs)
				if (sub && !ancestors.has(sub.blueprintTypeId))
					visit(sub, new Set(ancestors).add(sub.blueprintTypeId));
		}
	};
	visit(reaction, new Set([reaction.blueprintTypeId]));
	return [...found]
		.map((typeId) => ({ typeId, saving: unitSaving(ctx, typeId) }))
		.filter((c): c is { typeId: number; saving: number } => c.saving !== null)
		.sort((a, b) => b.saving - a.saving || a.typeId - b.typeId)
		.slice(0, MAX_UNREFINED_CANDIDATES)
		.map((c) => c.typeId)
		.sort((a, b) => a - b);
}

/** A chain variant's economics, as the objective of {@link chooseUnrefined} sees them. */
export interface RouteScore {
	profit: number | null;
	profitPerSlotDay: number | null;
	/** Units of the final product `profit` is for. */
	finalUnits: number;
}

const perUnit = (s: RouteScore) => s.profit! / s.finalUnits;

/**
 * Which types of `reaction`'s chain to build through their unrefined reaction: every combination of the
 * {@link unrefinedCandidates} is priced by `evaluate` (the chain as shown, so rounding, byproduct use
 * and slot allocation count) and compared with the regular chain.
 *
 * A combination qualifies when its profit per slot-day is higher than the regular chain's and, while
 * it still loses money, it also loses less per unit of the final product (a slower route must not look
 * better merely by spreading a loss over more slot-days). The best qualifying combination wins: a
 * profitable one by profit per slot-day, else the smallest loss per unit; ties keep fewer
 * substitutions. Without a profit for the regular chain nothing is substituted.
 */
export function chooseUnrefined(
	reaction: Reaction,
	ctx: CalcContext,
	evaluate: (viaUnrefined: number[]) => RouteScore
): number[] {
	const types = unrefinedCandidates(reaction, ctx);
	if (types.length === 0) return [];
	const base = evaluate([]);
	if (base.profit === null || base.profitPerSlotDay === null || base.finalUnits <= 0) return [];

	const qualifies = (s: RouteScore) =>
		s.profit !== null &&
		s.profitPerSlotDay !== null &&
		s.profitPerSlotDay > base.profitPerSlotDay! &&
		(s.profit > 0 || perUnit(s) > perUnit(base));
	const beats = (s: RouteScore, current: RouteScore) => {
		if (s.profit! > 0 !== current.profit! > 0) return s.profit! > 0;
		return s.profit! > 0 ? s.profitPerSlotDay! > current.profitPerSlotDay! : perUnit(s) > perUnit(current);
	};

	const masks = Array.from({ length: 2 ** types.length - 1 }, (_, i) => i + 1);
	const size = (mask: number) => types.reduce((n, _, bit) => n + ((mask >> bit) & 1), 0);
	masks.sort((a, b) => size(a) - size(b) || a - b);
	let best: { via: number[]; score: RouteScore } = { via: [], score: base };
	for (const mask of masks) {
		const via = types.filter((_, bit) => (mask >> bit) & 1);
		const score = evaluate(via);
		if (qualifies(score) && beats(score, best.score)) best = { via, score };
	}
	return best.via;
}
