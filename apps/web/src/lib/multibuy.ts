import type { LineItem } from '@reactions/engine';

/**
 * EVE Online multibuy text for a purchase list (a reaction's inputs, the planner's shopping lists): one
 * `Name<TAB>Quantity` line per name, quantities merged, rounded up to whole units and written without
 * thousands separators; zero quantities dropped; list order (fuel blocks first, as the engine orders it).
 */
export function lineItemsMultibuy(items: readonly Pick<LineItem, 'name' | 'quantity'>[]): string {
	const quantities = new Map<string, number>();
	for (const { name, quantity } of items) quantities.set(name, (quantities.get(name) ?? 0) + quantity);
	return [...quantities]
		.filter(([, quantity]) => quantity > 0)
		.map(([name, quantity]) => `${name}\t${Math.ceil(quantity)}`)
		.join('\n');
}
