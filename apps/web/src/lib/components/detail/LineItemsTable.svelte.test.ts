import type { LineItem } from '@reactions/engine';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import LineItemsTable from './LineItemsTable.svelte';

const item = (typeId: number, quantity: number, unitPrice: number | null): LineItem => ({
	typeId,
	name: `Type ${typeId}`,
	quantity,
	unitPrice,
	total: unitPrice === null ? 0 : quantity * unitPrice,
	fees: unitPrice === null ? 0 : quantity * unitPrice * 0.015,
	shipping: 0,
	volume: quantity * 0.05
});

const text = (c: HTMLElement, sel: string) => c.querySelector(sel)!.textContent!.trim();

describe('LineItemsTable', () => {
	it('lists items and sums totals, fees and volume', () => {
		const { container } = render(LineItemsTable, {
			title: 'Inputs',
			items: [item(16643, 11908, 1000), item(16647, 11908, 500)]
		});
		expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
		expect(text(container, 'tr[data-type-id="16643"]')).toContain('11,908');
		expect(text(container, '[data-total]')).toBe('17.86M');
		expect(text(container, '[data-fees]')).toBe('267.93K');
		expect(text(container, '[data-totals]')).toContain('1,190.80');
	});

	it('shows n/a for unpriced items and for the total', () => {
		const { container } = render(LineItemsTable, {
			title: 'Inputs',
			items: [item(16643, 100, 1000), item(16647, 100, null)]
		});
		expect(text(container, 'tr[data-type-id="16647"]')).toContain('n/a');
		expect(text(container, '[data-total]')).toBe('n/a');
		expect(text(container, '[data-fees]')).toBe('1.50K');
	});

	it('hides fee/shipping columns when costs are off and shows the empty text', () => {
		const { container } = render(LineItemsTable, {
			title: 'Surplus',
			items: [item(16654, 92, 2000)],
			costs: false
		});
		expect(container.querySelector('[data-fees]')).toBeNull();
		expect(text(container, '[data-total]')).toBe('184.00K');

		const empty = render(LineItemsTable, { title: 'Surplus', items: [], emptyText: 'No surplus.' });
		expect(empty.container.textContent).toContain('No surplus.');
		expect(empty.container.querySelector('table')).toBeNull();
	});

	it('drops all-zero fee and shipping columns and shows them once any item has a value', () => {
		const headers = (items: LineItem[], extra: Record<string, unknown> = {}) =>
			[
				...render(LineItemsTable, { title: 'Buy', items, ...extra }).container.querySelectorAll(
					'th[scope="col"]'
				)
			].map((th) => th.textContent!.trim());
		const free = { ...item(16643, 100, 1000), fees: 0 };
		expect(headers([free])).toEqual(['Item', 'Quantity', 'Unit price', 'Total', 'Volume m³']);
		expect(headers([item(16643, 100, 1000), { ...item(16647, 10, 5), shipping: 250 }])).toEqual([
			'Item',
			'Quantity',
			'Unit price',
			'Total',
			'Fees',
			'Shipping',
			'Volume m³'
		]);
		expect(headers([item(16643, 100, 1000)], { volume: false, feesLabel: 'Broker fee' })).toEqual([
			'Item',
			'Quantity',
			'Unit price',
			'Total',
			'Broker fee'
		]);
	});

	it('renders the title at the requested heading level', () => {
		const { container } = render(LineItemsTable, { title: 'Buy for step 1', items: [], level: 4 });
		expect(container.querySelector('h4')!.textContent!.trim()).toBe('Buy for step 1');
		expect(container.querySelector('h3')).toBeNull();
	});

	it('shows the units listed at the input hub and the quantity bought per market', () => {
		const split: LineItem = {
			...item(16638, 16268, 950),
			availableAtInputHub: 12000,
			sources: [
				{ hubId: 'structure-1', quantity: 12000, unitPrice: 1000, total: 12_000_000, fees: 180_000 },
				{ hubId: 'jita', quantity: 4268, unitPrice: 900, total: 3_841_200, fees: 57_618 }
			]
		};
		const plenty: LineItem = { ...item(16641, 500, 900), availableAtInputHub: 80000 };
		const unknown: LineItem = { ...item(4312, 10, 18000), availableAtInputHub: null };
		const markets = { 'structure-1': 'Seed Market', jita: 'Jita 4-4' };
		const { container } = render(LineItemsTable, {
			title: 'Buy',
			items: [split, plenty, unknown],
			available: true,
			markets
		});
		expect([...container.querySelectorAll('th[scope="col"]')].map((th) => th.textContent!.trim())).toEqual([
			'Item',
			'Quantity',
			'Available',
			'Unit price',
			'Total',
			'Fees',
			'Volume m³'
		]);
		const available = (id: number) => text(container, `tr[data-type-id="${id}"] [data-field="available"]`);
		expect([available(16638), available(16641), available(4312)]).toEqual(['12,000', '80,000', 'n/a']);
		expect(container.querySelector('tr[data-type-id="16638"] [data-field="available"]')!.className).toContain(
			'text-amber-700'
		);
		expect(text(container, 'tr[data-type-id="16638"] [data-sources]')).toBe(
			'12,000 Seed Market · 4,268 Jita 4-4'
		);
		expect(container.querySelector('tr[data-type-id="16641"] [data-sources]')).toBeNull();
		expect(container.querySelector('[data-totals]')!.querySelectorAll('td')).toHaveLength(6);

		const hidden = render(LineItemsTable, { title: 'Buy', items: [split] }).container;
		expect(hidden.querySelector('[data-field="available"]')).toBeNull();
	});
});
