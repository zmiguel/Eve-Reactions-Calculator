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
		fuel: [{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 1500, unitValue: 20_000, value: 30_000_000 }],
		raw: [
			{ typeId: 16634, name: 'Atmospheric Gases', quantity: 200_000, unitValue: 50, value: 10_000_000 },
			{ typeId: 16640, name: 'Cobalt', quantity: 10, unitValue: null, value: null }
		],
		intermediate: [
			{ typeId: 16663, name: 'Titanium Chromide', quantity: 4000, unitValue: 1000, value: 4_000_000 }
		],
		product: [{ typeId: 16671, name: 'Titanium Carbide', quantity: 1234, unitValue: 2000, value: 2_468_000 }]
	},
	totalValue: 46_468_000,
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

	it.each([
		['no_sources', /Add the assets of a character or corporation/],
		['no_selection', /Tick the hangars to use under each source and press Save/]
	] as const)('explains the %s empty state', (empty, text) => {
		const blank: InventorySummaryView = {
			formulas: [],
			materials: { fuel: [], raw: [], intermediate: [], product: [] },
			totalValue: 0,
			empty
		};
		const { container } = render(InventorySummary, { props: { summary: blank } });
		expect(container.querySelector(`[data-empty="${empty}"]`)?.textContent).toMatch(text);
		expect(container.querySelector('table')).toBeNull();
	});
});
