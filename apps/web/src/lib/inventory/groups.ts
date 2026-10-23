import { compareMaterials, inventoryRole, type Dataset } from '@reactions/engine';
import type { InventoryRole } from './types';

/** Material groups in display order. */
export const MATERIAL_GROUPS: readonly { role: InventoryRole; title: string; hint: string }[] = [
	{ role: 'fuel', title: 'Fuel blocks', hint: 'Fuel for reactions.' },
	{ role: 'raw', title: 'Raw materials', hint: 'Used by reactions, made by none.' },
	{ role: 'intermediate', title: 'Intermediates', hint: 'Made and used by reactions.' },
	{ role: 'product', title: 'Products', hint: 'Made by reactions, used by none.' }
];

export interface RoleGroup<T> {
	role: InventoryRole | 'other';
	title: string;
	items: T[];
}

/**
 * `items` grouped by their role among the reactions ({@link MATERIAL_GROUPS} order), then "Other" for
 * types without one; within a group in the material order (raw moon materials by class R4 to R64, each
 * class and everything else by name). Empty groups are left out.
 */
export function groupByRole<T extends { typeId: number; name: string }>(
	dataset: Dataset,
	items: readonly T[]
): RoleGroup<T>[] {
	const groups: RoleGroup<T>[] = [
		...MATERIAL_GROUPS.map((g) => ({ role: g.role, title: g.title, items: [] as T[] })),
		{ role: 'other', title: 'Other', items: [] }
	];
	for (const item of items) {
		const role = inventoryRole(dataset, item.typeId);
		(groups.find((g) => g.role === role) ?? groups[groups.length - 1]).items.push(item);
	}
	for (const g of groups) g.items.sort((a, b) => compareMaterials(dataset, a.typeId, b.typeId));
	return groups.filter((g) => g.items.length > 0);
}
