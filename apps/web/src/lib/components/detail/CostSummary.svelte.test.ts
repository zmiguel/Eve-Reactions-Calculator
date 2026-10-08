import type { LineItem, ReactionResult } from '@reactions/engine';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { TIC_ALLOCATION, optimalTitaniumCarbide, titaniumCarbide } from '../../../test/chain';
import CostSummary from './CostSummary.svelte';
import { productionSteps } from './steps';

const line = (typeId: number, quantity: number, unitPrice: number | null, fees = 0): LineItem => ({
	typeId,
	name: `Type ${typeId}`,
	quantity,
	unitPrice,
	total: unitPrice === null ? 0 : quantity * unitPrice,
	fees,
	shipping: 0,
	volume: quantity
});

function resultFor(
	profit: number | null,
	options: { inputs?: LineItem[]; surplus?: LineItem[]; inputShipping?: number } = {}
): ReactionResult {
	const root = titaniumCarbide();
	const nodes = [root, ...root.children];
	const sum = (k: 'purchaseCost' | 'purchaseFees' | 'purchaseShipping' | 'jobCost' | 'total') =>
		nodes.reduce((a, n) => a + n.subtotal[k], 0);
	const jobCost = nodes.reduce(
		(a, n) => ({
			eiv: a.eiv + n.jobCost.eiv,
			systemCost: a.systemCost + n.jobCost.systemCost,
			facilityTax: a.facilityTax + n.jobCost.facilityTax,
			scc: a.scc + n.jobCost.scc,
			total: a.total + n.jobCost.total
		}),
		{ eiv: 0, systemCost: 0, facilityTax: 0, scc: 0, total: 0 }
	);
	return {
		blueprintTypeId: 46204,
		slug: 'titanium-carbide',
		name: 'Titanium Carbide',
		reactor: 'composite',
		tier: 'composite',
		view: 'chain',
		outputMode: 'product',
		runs: 122,
		runTimeSeconds: 4924.8,
		chainDepth: 2,
		inputs: options.inputs ?? [line(4312, 1182, 18000)],
		chain: root,
		viaUnrefined: [],
		outputs: [line(16671, 12200, 20000, 8_784_000)],
		surplus: options.surplus ?? [line(16654, 92, 3000), line(16658, 92, 3000)],
		jobCost,
		totals: {
			inputCost: sum('purchaseCost'),
			inputFees: sum('purchaseFees'),
			inputShipping: options.inputShipping ?? 0,
			outputValue: 244_000_000,
			outputFees: 8_784_000,
			outputShipping: 0,
			jobCost: sum('jobCost'),
			totalCost: sum('total'),
			profit,
			marginPct: profit === null ? null : (profit / 244_000_000) * 100,
			roiPct: profit === null ? null : 12.5,
			slotSeconds: 242 * 4924.8,
			profitPerSlotDay: profit === null ? null : 2_000_000,
			profitPerRun: profit === null ? null : profit / 122
		},
		missingPrices: [],
		warnings: []
	};
}

const field = (c: HTMLElement, key: string) =>
	c.querySelector(`[data-summary-field="${key}"]`)!.textContent!.trim();
const label = (c: HTMLElement, key: string) =>
	c.querySelector(`[data-summary-field="${key}"]`)!.previousElementSibling!.textContent;
const tables = (c: HTMLElement) =>
	[...c.querySelectorAll('[data-summary] > div:last-child h3')].map((h) => h.textContent!.trim());

describe('CostSummary', () => {
	it('totals the whole chain in one card: costs, sale and slot time', () => {
		const result = resultFor(40_000_000);
		const { container } = render(CostSummary, { result, steps: productionSteps(titaniumCarbide()) });
		expect(container.querySelectorAll('[data-summary] > div:first-child > section')).toHaveLength(3);
		expect(field(container, 'inputCost')).toBe('42.94M');
		expect(field(container, 'jobCost')).toBe(`${(result.totals.jobCost / 1e6).toFixed(2)}M`);
		expect(container.querySelector('[data-summary-field="jobCost"]')!.getAttribute('title')).toMatch(
			/^System .* \+ facility tax .* \+ SCC /
		);
		expect(field(container, 'outputFees')).toBe('8.78M');
		expect(field(container, 'profit')).toBe('40.00M');
		expect(container.querySelector('[data-summary-field="profit"]')!.className).toContain('text-green-600');
		expect(field(container, 'jobs')).toBe('3');
		expect(label(container, 'jobs')).toBe('Jobs (2 steps)');
		expect(field(container, 'slotTime')).toBe('13d 19h 3m');
		expect(field(container, 'profitPerSlotDay')).toBe('2.00M');
		expect(container.querySelector('[data-step-row]')).toBeNull();
	});

	it('leaves out zero shipping and repeats no per-step or purchase tables', () => {
		const { container } = render(CostSummary, {
			result: resultFor(1_000_000),
			steps: productionSteps(titaniumCarbide())
		});
		expect(container.querySelector('[data-summary-field="inputShipping"]')).toBeNull();
		expect(container.querySelector('[data-summary-field="outputShipping"]')).toBeNull();
		expect(tables(container)).toEqual(['Outputs', 'Surplus intermediates (not counted as profit)']);

		const shipped = render(CostSummary, {
			result: resultFor(1_000_000, { inputShipping: 1_500_000 }),
			steps: productionSteps(titaniumCarbide())
		});
		expect(field(shipped.container, 'inputShipping')).toBe('1.50M');
	});

	it('hides the surplus table without surplus', () => {
		const steps = productionSteps(titaniumCarbide().children[0]);
		const { container } = render(CostSummary, { result: resultFor(1_000_000, { surplus: [] }), steps });
		expect(tables(container)).toEqual(['Outputs']);
		expect(field(container, 'jobs')).toBe('1');
		expect(label(container, 'jobs')).toBe('Jobs');
	});

	it('shows n/a for profit metrics and unpriced purchases', () => {
		const result = resultFor(null, { inputs: [line(4312, 1182, null)] });
		const { container } = render(CostSummary, { result, steps: productionSteps(titaniumCarbide()) });
		for (const key of ['inputCost', 'totalCost', 'profit', 'profitPerRun', 'profitPerSlotDay'])
			expect(field(container, key)).toBe('n/a');
	});

	it('counts one job per slot and the allocated slot time with optimal slots', () => {
		const result = { ...resultFor(40_000_000), runs: 244, allocation: TIC_ALLOCATION };
		const { container } = render(CostSummary, { result, steps: productionSteps(optimalTitaniumCarbide()) });
		expect(field(container, 'jobs')).toBe('4');
		expect(label(container, 'slotTime')).toBe('Slot time (4 slots × 7 d)');
		expect(field(container, 'slotTime')).toBe('28d');
		expect(label(container, 'profitPerRun')).toBe('Profit / run (244 runs)');
	});
});
