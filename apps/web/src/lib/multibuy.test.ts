import { describe, expect, it } from 'vitest';
import { bought, node, titaniumCarbide } from '../test/chain';
import { lineItemsMultibuy, multibuyText } from './multibuy';

describe('multibuyText', () => {
	it('writes one Name<TAB>Quantity line per bought material, whole numbers without separators', () => {
		const single = node({
			blueprintTypeId: 1,
			name: 'Solo',
			productTypeId: 2,
			runs: 5,
			depth: 0,
			materials: [
				bought(4312, 'Oxygen Fuel Block', 12_345, 18000),
				bought(16638, 'Titanium', 1_234_567.2, 950)
			]
		});
		expect(multibuyText(single)).toBe('Oxygen Fuel Block\t12345\nTitanium\t1234568');
	});

	it('aggregates the whole chain and skips intermediates built by the chain', () => {
		expect(multibuyText(titaniumCarbide()).split('\n')).toEqual([
			'Oxygen Fuel Block\t1182',
			'Titanium\t5856',
			'Chromium\t5856',
			'Evaporite Deposits\t5856',
			'Silicates\t5856'
		]);
	});

	it('covers only the shown job in the single view', () => {
		expect(multibuyText(titaniumCarbide().children[0])).toBe(
			'Oxygen Fuel Block\t293\nTitanium\t5856\nChromium\t5856'
		);
	});

	it('keeps unpriced materials and drops zero quantities', () => {
		const root = node({
			blueprintTypeId: 1,
			name: 'Solo',
			productTypeId: 2,
			runs: 1,
			depth: 0,
			materials: [bought(16638, 'Titanium', 10, null), bought(16641, 'Chromium', 0, 900)]
		});
		expect(multibuyText(root)).toBe('Titanium\t10');
	});
});

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

	it('writes plan line items as Name<TAB>Quantity, merged by name, rounded up, zeros dropped', () => {
		expect(
			lineItemsMultibuy([
				item(16640, 'Cobalt', 12_268),
				item(4247, 'Helium Fuel Block', 1_228.4),
				item(16641, 'Chromium', 0),
				item(16640, 'Cobalt', 2)
			])
		).toBe('Cobalt\t12270\nHelium Fuel Block\t1229');
	});

	it('is empty for an empty list', () => {
		expect(lineItemsMultibuy([])).toBe('');
	});
});
