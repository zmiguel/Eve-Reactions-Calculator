import type { ReactionTotals } from '@reactions/engine';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { TIC_ALLOCATION } from '../../../test/chain';
import MetricsCards from './MetricsCards.svelte';

const totals = (profit: number | null): ReactionTotals => ({
	inputCost: 80_000_000,
	inputFees: 1_200_000,
	inputShipping: 0,
	outputValue: 120_000_000,
	outputFees: 6_120_000,
	outputShipping: 0,
	jobCost: 4_000_000,
	totalCost: 85_200_000,
	profit,
	marginPct: profit === null ? null : 23.4,
	roiPct: profit === null ? null : 33.8,
	slotSeconds: 600_825.6,
	profitPerSlotDay: profit === null ? null : 4_116_000,
	profitPerRun: profit === null ? null : 234_000
});

function values(container: HTMLElement) {
	return Object.fromEntries(
		[...container.querySelectorAll('[data-metric]')].map((el) => [
			el.getAttribute('data-metric'),
			el.querySelector('dd')!
		])
	);
}

describe('MetricsCards', () => {
	it('renders every metric with profit colouring', () => {
		const { container } = render(MetricsCards, {
			result: { totals: totals(28_680_000), runs: 122, runTimeSeconds: 4924.8 }
		});
		const v = values(container);
		expect(Object.keys(v)).toEqual([
			'Profit / slot / day',
			'Profit',
			'Margin',
			'ROI',
			'Total cost',
			'Output value',
			'Runs',
			'Time per run',
			'Job duration'
		]);
		expect(v['Profit'].textContent!.trim()).toBe('28.68M');
		expect(v['Profit'].className).toContain('text-green-600');
		expect(v['Profit / slot / day'].textContent!.trim()).toBe('4.12M');
		expect(v['Margin'].textContent!.trim()).toBe('23.4%');
		expect(v['Total cost'].textContent!.trim()).toBe('85.20M');
		expect(v['Runs'].textContent!.trim()).toBe('122');
		expect(v['Time per run'].textContent!.trim()).toBe('1h 22m 5s');
		// 122 runs × 4924.8 s = 600,825.6 s; a single job's slot time equals its duration, so no separate card.
		expect(v['Job duration'].textContent!.trim()).toBe('6d 22h 53m');
	});

	it('adds the slot time of all chain jobs when it differs from the top job duration', () => {
		const chainTotals = { ...totals(28_680_000), slotSeconds: (122 + 120) * 4924.8 };
		const { container } = render(MetricsCards, {
			result: { totals: chainTotals, runs: 122, runTimeSeconds: 4924.8 }
		});
		const v = values(container);
		expect(v['Job duration'].textContent!.trim()).toBe('6d 22h 53m');
		expect(v['Slot time'].textContent!.trim()).toBe('13d 19h 3m');
	});

	it('marks runs capped by the formula maximum per job', () => {
		const capped = { ...totals(1_000_000), slotSeconds: 100 * 4769.28 };
		const { container } = render(MetricsCards, {
			result: { totals: capped, runs: 100, runTimeSeconds: 4769.28, warnings: ['MAX_RUNS_PER_JOB'] }
		});
		const v = values(container);
		expect(v['Runs'].textContent!.trim()).toBe('100 max');
		expect(v['Runs'].getAttribute('title')).toContain("100 runs is this formula's maximum per job");
		expect(v['Job duration'].textContent!.trim()).toBe('5d 12h 28m');
	});

	it('shows n/a for profit-derived metrics when profit is null', () => {
		const { container } = render(MetricsCards, {
			result: { totals: totals(null), runs: 122, runTimeSeconds: 4924.8 }
		});
		const v = values(container);
		for (const key of ['Profit / slot / day', 'Profit', 'Margin', 'ROI']) {
			expect(v[key].textContent!.trim()).toBe('n/a');
			expect(v[key].className).not.toMatch(/text-(green|red)-600/);
		}
		expect(v['Output value'].textContent!.trim()).toBe('120.00M');
	});

	it('shows the allocated slots and the per-slot job with optimal slots', () => {
		const chainTotals = { ...totals(28_680_000), slotSeconds: (244 + 240) * 4924.8 };
		const { container } = render(MetricsCards, {
			result: { totals: chainTotals, runs: 244, runTimeSeconds: 4924.8, allocation: TIC_ALLOCATION }
		});
		const v = values(container);
		expect(Object.keys(v).slice(-4)).toEqual(['Runs', 'Time per run', 'Job duration', 'Slots']);
		expect(v['Runs'].textContent!.trim()).toBe('244');
		expect(v['Runs'].getAttribute('title')).toBe('2 lines × 122 runs');
		expect(v['Job duration'].textContent!.trim()).toBe('6d 22h 53m');
		expect(v['Slots'].textContent!.trim()).toBe('4');
		expect(v['Slots'].getAttribute('title')).toBe('4 slots × 7 days, 98.5% busy');
	});
});
