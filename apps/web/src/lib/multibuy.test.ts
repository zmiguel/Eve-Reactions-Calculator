import { describe, expect, it } from 'vitest';
import { lineItemsMultibuy } from './multibuy';

describe('lineItemsMultibuy', () => {
	const item = (typeId: number, name: string, quantity: number) => ({
		typeId,
		name,
		quantity,
		unitPrice: 1,
		total: quantity,
		fees: 0,
		shipping: 0,
		volume: 0
	});

	it('writes line items as Name<TAB>Quantity in list order, merged by name, rounded up, zeros dropped', () => {
		expect(
			lineItemsMultibuy([
				item(4247, 'Helium Fuel Block', 1_228.4),
				item(16640, 'Cobalt', 12_268),
				item(16638, 'Titanium', 1_234_567.2),
				item(16641, 'Chromium', 0),
				item(16640, 'Cobalt', 2)
			])
		).toBe('Helium Fuel Block\t1229\nCobalt\t12270\nTitanium\t1234568');
	});

	it('is empty for an empty list', () => {
		expect(lineItemsMultibuy([])).toBe('');
	});
});
