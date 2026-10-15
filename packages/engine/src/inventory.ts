import { LineItemBag, producerIndex, sellLine, type CalcContext } from './calculate.ts';
import { isFuelBlock } from './constants.ts';
import type { Dataset, Reaction } from './types.ts';
import { UNREFINED_TIERS } from './unrefined.ts';

/** What a relevant inventory type is to the reactions of a dataset. */
export type InventoryRole = 'formula' | 'fuel' | 'raw' | 'intermediate' | 'product';

interface InventoryIndex {
	relevant: ReadonlySet<number>;
	formulas: ReadonlySet<number>;
	consumed: ReadonlySet<number>;
	/** Material type id → first consuming reaction (lowest blueprint id). */
	firstConsumer: ReadonlyMap<number, Reaction>;
}

const inventoryCache = new WeakMap<Dataset, InventoryIndex>();

function inventoryIndex(dataset: Dataset): InventoryIndex {
	let index = inventoryCache.get(dataset);
	if (!index) {
		const relevant = new Set<number>();
		const formulas = new Set<number>();
		const consumed = new Set<number>();
		const firstConsumer = new Map<number, Reaction>();
		for (const r of [...dataset.reactions].sort((a, b) => a.blueprintTypeId - b.blueprintTypeId))
			for (const m of r.materials) if (!firstConsumer.has(m.typeId)) firstConsumer.set(m.typeId, r);
		for (const r of dataset.reactions) {
			formulas.add(r.blueprintTypeId);
			relevant.add(r.blueprintTypeId);
			relevant.add(r.product.typeId);
			for (const m of r.materials) {
				consumed.add(m.typeId);
				relevant.add(m.typeId);
			}
			if (UNREFINED_TIERS.includes(r.tier)) {
				for (const m of dataset.reprocess[r.product.typeId]?.materials ?? []) relevant.add(m.typeId);
			}
		}
		index = { relevant, formulas, consumed, firstConsumer };
		inventoryCache.set(dataset, index);
	}
	return index;
}

/**
 * Types worth reading from an inventory: every reaction's formula (blueprint), materials and product,
 * plus the reprocessed outputs of the unrefined reactions' products (Unrefined and Prismaticite tiers).
 * Also the types the profit tracking ledger tracks (`runLedger`); trades and contract items of other
 * types are recorded as `untracked`.
 */
export function inventoryTypeIds(dataset: Dataset): ReadonlySet<number> {
	return inventoryIndex(dataset).relevant;
}

/**
 * Role of `typeId` among the dataset's reactions, null when not in {@link inventoryTypeIds}. First match
 * wins: `formula` (a reaction blueprint), `fuel` (a fuel block), `intermediate` (produced by a reaction
 * and consumed by another), `product` (produced, consumed by none), `raw` (produced by no reaction).
 */
export function inventoryRole(dataset: Dataset, typeId: number): InventoryRole | null {
	const { relevant, formulas, consumed } = inventoryIndex(dataset);
	if (!relevant.has(typeId)) return null;
	if (formulas.has(typeId)) return 'formula';
	if (isFuelBlock(dataset, typeId)) return 'fuel';
	if (producerIndex(dataset).has(typeId)) return consumed.has(typeId) ? 'intermediate' : 'product';
	return 'raw';
}

/**
 * Net realisable value of one unit of `typeId`: its output price (output hub, sell method, price %) minus
 * sell fees, tax and output shipping, with the profile of the reaction making it, else of the first
 * reaction consuming it. Null when no reaction makes or consumes the type, or when it has no price.
 */
export function stockUnitValue(ctx: CalcContext, typeId: number): number | null {
	const reaction =
		producerIndex(ctx.dataset).get(typeId) ?? inventoryIndex(ctx.dataset).firstConsumer.get(typeId);
	const profile = reaction && ctx.profiles[reaction.reactor];
	if (!profile) return null;
	const bag = new LineItemBag();
	sellLine(bag, { ctx, missing: new Set() }, profile, typeId, 1, { countMissing: false, withCosts: true });
	const [line] = bag.list();
	return line.unitPrice === null ? null : line.total - line.fees - line.shipping;
}
