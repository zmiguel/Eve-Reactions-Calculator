import type { Dataset } from '@reactions/engine';

/** Lower-cased, whitespace-collapsed name → type id (or blueprint id for formulas). */
export type NameIndex = ReadonlyMap<string, number>;

export interface PasteError {
	/** 1-based line number in the pasted text. */
	line: number;
	/** The name (unknown name) or the quantity text (invalid quantity) as pasted. */
	text: string;
	reason: 'unknown_name' | 'invalid_quantity';
}

export interface PasteResult {
	/** Summed quantity per id. */
	quantities: Record<number, number>;
	errors: PasteError[];
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Tracked item names of the dataset (materials, products, formulas) for the stock editor. */
export function typeNameIndex(dataset: Dataset): Map<string, number> {
	return new Map(Object.values(dataset.types).map((t) => [normalizeName(t.name), t.typeId]));
}

/** Formula (blueprint) names → blueprint type id for the owned-formulas editor. */
export function formulaNameIndex(dataset: Dataset): Map<string, number> {
	return new Map(dataset.reactions.map((r) => [normalizeName(r.formulaName), r.blueprintTypeId]));
}

/** Plain digits, or digit groups of three split by `,` `.` `'` or a (no-break) space. */
const QUANTITY = /^(?:\d+|\d{1,3}(?:[,.'\s\u00a0\u202f]\d{3})+)$/;

/** A whole quantity, optionally with thousands separators (`12,345`, `12.345`, `12 345`); else `null`. */
export function parseQuantity(text: string): number | null {
	const trimmed = text.trim();
	return QUANTITY.test(trimmed) ? Number(trimmed.replace(/\D/g, '')) : null;
}

/**
 * Parses lines copied from an EVE inventory (`Name<TAB>Quantity<TAB>Group…`, or columns separated by
 * two or more spaces). Only the first two columns are read; an empty or missing quantity counts as 1
 * (single unstacked items). Thousands separators are accepted, blank lines skipped, duplicate names
 * summed; unknown names and malformed quantities are reported with their line number.
 */
export function parsePaste(text: string, index: NameIndex): PasteResult {
	const quantities: Record<number, number> = {};
	const errors: PasteError[] = [];
	text.split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim();
		if (line === '') return;
		const [name, quantityText = ''] = line.split(/\t| {2,}/).map((s) => s.trim());
		const id = index.get(normalizeName(name));
		if (id === undefined) {
			errors.push({ line: i + 1, text: name, reason: 'unknown_name' });
			return;
		}
		const quantity = quantityText === '' ? 1 : parseQuantity(quantityText);
		if (quantity === null) {
			errors.push({ line: i + 1, text: quantityText, reason: 'invalid_quantity' });
			return;
		}
		quantities[id] = (quantities[id] ?? 0) + quantity;
	});
	return { quantities, errors };
}
