import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { InventorySummaryView } from '$lib/inventory/types';
import InventorySummary from './InventorySummary.svelte';

const summary: InventorySummaryView = {
	formulas: [
		{
			blueprintTypeId: 46166,
			name: 'Titanium Carbide Reaction Formula',
			count: 2,
			places: ['Jita IV - Moon 4 - Caldari Navy Assembly Plant · Hangar']
		}
	],
	materials: {
		fuel: [
			{
				typeId: 4312,
				name: 'Oxygen Fuel Block',
				quantity: 1500,
				unitValue: 20_000,
				value: 30_000_000,
				paid: null
			}
		],
		raw: [
			{
				typeId: 16634,
				name: 'Atmospheric Gases',
				quantity: 200_000,
				unitValue: 50,
				value: 10_000_000,
				paid: null
			},
			{ typeId: 16640, name: 'Cobalt', quantity: 10, unitValue: null, value: null, paid: null }
		],
		intermediate: [
			{
				typeId: 16663,
				name: 'Titanium Chromide',
				quantity: 4000,
				unitValue: 1000,
				value: 4_000_000,
				paid: null
			}
		],
		product: [
			{
				typeId: 16671,
				name: 'Titanium Carbide',
				quantity: 1234,
				unitValue: 2000,
				value: 2_468_000,
				paid: null
			}
		]
	},
	totalValue: 46_468_000,
	showPaid: false,
	empty: null
};

const group = (container: HTMLElement, role: string) => container.querySelector(`[data-group="${role}"]`);
const rows = (container: HTMLElement, role: string) =>
	[...group(container, role)!.querySelectorAll('tbody tr')].map((tr) => [
		tr.querySelector('td')?.textContent?.trim(),
		tr.querySelector('[data-quantity]')?.textContent,
		tr.querySelector('[data-value]')?.textContent
	]);

describe('InventorySummary', () => {
	it('groups materials into fuel blocks, raw materials, intermediates and products with values', () => {
		const { container } = render(InventorySummary, { props: { summary } });
		expect([...container.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))).toEqual([
			'formulas',
			'fuel',
			'raw',
			'intermediate',
			'product'
		]);
		expect(group(container, 'fuel')!.querySelector('h3')?.textContent).toContain('Fuel blocks');
		expect(group(container, 'raw')!.querySelector('h3')?.textContent).toContain('Raw materials');
		expect(group(container, 'intermediate')!.querySelector('h3')?.textContent).toContain('Intermediates');
		expect(group(container, 'product')!.querySelector('h3')?.textContent).toContain('Products');
		expect(rows(container, 'fuel')).toEqual([['Oxygen Fuel Block', '1,500', '30.00M']]);
		expect(rows(container, 'raw')).toEqual([
			['Atmospheric Gases', '200,000', '10.00M'],
			['Cobalt', '10', 'n/a']
		]);
		expect(rows(container, 'product')).toEqual([['Titanium Carbide', '1,234', '2.47M']]);
		expect(container.querySelector('[data-total]')?.textContent).toBe('46.47M');
		expect(group(container, 'fuel')!.querySelector('img')?.getAttribute('src')).toBe(
			'https://images.evetech.net/types/4312/icon?size=32'
		);
	});

	it('lists formulas with count and places', () => {
		const { container } = render(InventorySummary, { props: { summary } });
		const row = group(container, 'formulas')!.querySelector('tbody tr')!;
		expect(row.textContent).toContain('Titanium Carbide Reaction Formula');
		expect(row.textContent).toContain('2');
		expect(row.textContent).toContain('Jita IV - Moon 4 - Caldari Navy Assembly Plant · Hangar');
		// Formulas are blueprints: the image server serves them under `bp`, not `icon`.
		expect(row.querySelector('img')?.getAttribute('src')).toBe(
			'https://images.evetech.net/types/46166/bp?size=32'
		);
	});

	it('leaves out empty groups', () => {
		const only = {
			...summary,
			formulas: [],
			materials: { ...summary.materials, fuel: [], intermediate: [], product: [] }
		};
		const { container } = render(InventorySummary, { props: { summary: only } });
		expect([...container.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))).toEqual([
			'raw'
		]);
	});

	it('adds Paid only with a ledger: the average linked to the item page, the uncovered rest unknown', () => {
		const without = render(InventorySummary, { props: { summary } });
		expect(without.container.querySelector('[data-paid]')).toBeNull();
		without.unmount();

		const withPaid: InventorySummaryView = {
			...summary,
			showPaid: true,
			materials: {
				...summary.materials,
				intermediate: [{ ...summary.materials.intermediate[0], paid: { unitCost: 950, covered: 4000 } }],
				product: [{ ...summary.materials.product[0], paid: { unitCost: 1500, covered: 1000 } }]
			}
		};
		const { container } = render(InventorySummary, { props: { summary: withPaid } });
		const paid = (role: string) => group(container, role)!.querySelector('[data-paid]')!;
		expect(paid('intermediate').querySelector('a')?.getAttribute('href')).toBe('/profits/ledger/16663');
		expect(paid('intermediate').querySelector('a')?.textContent).toBe('950');
		expect(paid('intermediate').querySelector('[data-paid-covered]')).toBeNull();
		// 1,000 of the 1,234 held are covered by the ledger.
		expect(paid('product').querySelector('[data-paid-covered]')?.textContent).toContain('1,000');
		expect(paid('fuel').querySelector('a')).toBeNull();
	});

	it.each([
		['no_sources', /Switch Inventory on for a connection/],
		['no_selection', /Tick the hangars to use under each connection and press Save/]
	] as const)('explains the %s empty state', (empty, text) => {
		const blank: InventorySummaryView = {
			formulas: [],
			materials: { fuel: [], raw: [], intermediate: [], product: [] },
			totalValue: 0,
			showPaid: false,
			empty
		};
		const { container } = render(InventorySummary, { props: { summary: blank } });
		expect(container.querySelector(`[data-empty="${empty}"]`)?.textContent).toMatch(text);
		expect(container.querySelector('table')).toBeNull();
	});
});
