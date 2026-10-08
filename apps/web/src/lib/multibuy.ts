import type { ChainNode, LineItem } from '@reactions/engine';

/**
 * EVE Online multibuy text: one `Name<TAB>Quantity` line per name, quantities merged, rounded up to whole
 * units and written without thousands separators; zero quantities dropped; first-seen order.
 */
function formatMultibuy(entries: Iterable<{ name: string; quantity: number }>): string {
	const quantities = new Map<string, number>();
	for (const { name, quantity } of entries) quantities.set(name, (quantities.get(name) ?? 0) + quantity);
	return [...quantities]
		.filter(([, quantity]) => quantity > 0)
		.map(([name, quantity]) => `${name}\t${Math.ceil(quantity)}`)
		.join('\n');
}

/** Multibuy text for every material bought by a job tree (the chain, or a single reaction as one job). */
export function multibuyText(root: ChainNode): string {
	const bought: { name: string; quantity: number }[] = [];
	const visit = (node: ChainNode) => {
		for (const m of node.materials) if (m.source === 'buy') bought.push(m);
		node.children.forEach(visit);
	};
	visit(root);
	return formatMultibuy(bought);
}

/** Multibuy text for a purchase list such as the planner's shopping lists. */
export function lineItemsMultibuy(items: readonly Pick<LineItem, 'name' | 'quantity'>[]): string {
	return formatMultibuy(items);
}
