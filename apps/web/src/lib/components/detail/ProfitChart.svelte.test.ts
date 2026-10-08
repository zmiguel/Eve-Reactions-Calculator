import { render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import ChartStub from '../../../test/ChartStub.svelte';
import ProfitChart from './ProfitChart.svelte';

// ApexCharts needs a real layout engine; the stub records the options each chart receives.
const loadChart = async () => ChartStub as unknown as Component<{ options: object }>;

const series = [
	{
		date: '2026-10-04',
		profitPerSlotDay: 4_000_000,
		outputValue: 90_000_000,
		inputCost: 80_000_000,
		approximate: true
	},
	{ date: '2026-10-05', profitPerSlotDay: null, outputValue: 91_000_000, inputCost: null, approximate: false }
];
const volumes = [
	{ date: '2026-10-03', volume: 1200 },
	{ date: '2026-10-04', volume: 1500 }
];

describe('ProfitChart', () => {
	it('shows an empty state without history', () => {
		const { container } = render(ProfitChart, { series: [], loadChart });
		expect(container.querySelector('[data-empty]')).not.toBeNull();
		expect(container.querySelector('[data-chart]')).toBeNull();
	});

	it('renders three charts client-side plus a data table fallback', async () => {
		const { container } = render(ProfitChart, { series, loadChart });
		expect([...container.querySelectorAll('[data-chart]')].map((c) => c.getAttribute('data-chart'))).toEqual([
			'profitPerSlotDay',
			'outputValue',
			'inputCost'
		]);
		await waitFor(() => expect(container.querySelectorAll('[data-chart-stub]')).toHaveLength(3));
		const first = container.querySelector('[data-chart-stub]')!;
		expect(JSON.parse(first.getAttribute('data-series')!)).toEqual([4_000_000, null]);
		expect(JSON.parse(first.getAttribute('data-categories')!)).toEqual(['2026-10-04', '2026-10-05']);

		const rows = [...container.querySelectorAll('[data-series-row]')];
		expect(rows).toHaveLength(2);
		expect(rows[1].textContent).toContain('n/a');
		expect(rows[0].textContent).toContain('80.00M');
		expect(container.querySelector('[data-field="volume"]')).toBeNull();
		// The first day used regional averages.
		expect(rows[0].querySelector('td')!.textContent).toBe('2026-10-04 ≈');
		expect(container.querySelector('[data-approximate]')!.textContent).toContain('1 of 2 days');
	});

	it('adds a traded volume chart on its own dates and a volume column to the table', async () => {
		const { container } = render(ProfitChart, { series, volumes, regionName: 'The Forge', loadChart });
		const volume = container.querySelector('[data-chart="volume"]')!;
		expect(volume.querySelector('figcaption')!.textContent).toBe('Traded per day, The Forge');
		await waitFor(() => expect(volume.querySelector('[data-chart-stub]')).not.toBeNull());
		const stub = volume.querySelector('[data-chart-stub]')!;
		expect(JSON.parse(stub.getAttribute('data-series')!)).toEqual([1200, 1500]);
		expect(JSON.parse(stub.getAttribute('data-categories')!)).toEqual(['2026-10-03', '2026-10-04']);
		expect([...container.querySelectorAll('[data-field="volume"]')].map((c) => c.textContent)).toEqual([
			'1,500',
			'n/a'
		]);
	});

	it('shows only the volume chart when there is no price history yet', () => {
		const { container } = render(ProfitChart, { series: [], volumes, loadChart });
		expect([...container.querySelectorAll('[data-chart]')].map((c) => c.getAttribute('data-chart'))).toEqual([
			'volume'
		]);
		expect(container.querySelector('[data-empty]')).toBeNull();
	});
});
