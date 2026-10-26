import { render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerItemBatchPoint } from '#lib/ledger/types.js';
import ChartStub from '../../../test/ChartStub.svelte';
import BatchChart from './BatchChart.svelte';

// ApexCharts needs a real layout engine; the stub records the options the chart receives.
const loadChart = async () => ChartStub as unknown as Component<{ options: object }>;

const DAY = 86_400_000;
const points: LedgerItemBatchPoint[] = [
	{ at: 10 * DAY, unitCost: 120, quantity: 100, origin: 'transaction' },
	{ at: 12 * DAY, unitCost: 95.5, quantity: 40, origin: 'contract' },
	{ at: 15 * DAY, unitCost: 140, quantity: 10, origin: 'job' }
];

describe('BatchChart', () => {
	it('plots the unit cost of every batch by acquired date, with the value today as a line', async () => {
		const { container } = render(BatchChart, { points, unitValue: 110, loadChart });
		await vi.waitFor(() => expect(container.querySelector('[data-chart-stub]')).not.toBeNull());
		const series = JSON.parse(container.querySelector('[data-chart-stub]')!.getAttribute('data-series')!);
		expect(series).toEqual([
			[10 * DAY, 120],
			[12 * DAY, 95.5],
			[15 * DAY, 140]
		]);
		expect(container.querySelector('[data-value-line]')?.getAttribute('data-value-line')).toBe('110');
	});

	it('has no value line without a price today', async () => {
		const { container } = render(BatchChart, { points, unitValue: null, loadChart });
		await vi.waitFor(() => expect(container.querySelector('[data-chart-stub]')).not.toBeNull());
		expect(container.querySelector('[data-value-line]')).toBeNull();
	});

	it('says what will show up when there are no batches, without loading the chart', () => {
		const load = vi.fn(loadChart);
		const { container } = render(BatchChart, { points: [], unitValue: 110, loadChart: load });
		expect(container.querySelector('[data-empty]')).not.toBeNull();
		expect(container.querySelector('[data-chart]')).toBeNull();
		expect(load).not.toHaveBeenCalled();
	});
});
