import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { optimalTitaniumCarbide, titaniumCarbide, unrefinedChain } from '../../../test/chain';
import StepCard from './StepCard.svelte';
import { productionSteps } from './steps';

const text = (el: Element, sel: string) => el.querySelector(sel)!.textContent!.replace(/\s+/g, ' ').trim();
const headers = (el: Element) =>
	[...el.querySelectorAll('th[scope="col"]')].map((th) => th.textContent!.trim());

describe('StepCard', () => {
	it('lists every job of the step in one table and the aggregated purchases in another', () => {
		const [step] = productionSteps(titaniumCarbide());
		const { container } = render(StepCard, { step, count: 2 });
		const card = container.querySelector('[data-step="1"]')!;
		expect(card.id).toBe('step-1');
		expect(text(card, 'h3')).toBe('Step 1 of 2 · 2 intermediates in parallel');

		const jobs = [...card.querySelectorAll('tr[data-job]')];
		expect(jobs.map((r) => r.getAttribute('data-job'))).toEqual(['0-0', '0-1']);
		const chromide = card.querySelector('tr[data-job="0-0"]')!;
		expect(text(chromide, '[data-field="name"]')).toBe('Titanium Chromide');
		expect(text(chromide, '[data-field="runs"]')).toBe('60');
		expect(text(chromide, '[data-field="runTime"]')).toBe('1h 22m 5s');
		// 60 runs × 4924.8 s = 295,488 s
		expect(text(chromide, '[data-field="duration"]')).toBe('3d 10h 4m');
		expect(text(chromide, '[data-field="produced"]')).toBe('12,000');
		expect(text(chromide, '[data-field="used"]')).toBe('11,908');
		expect(text(chromide, '[data-field="surplus"]')).toBe('92');
		expect(text(chromide, '[data-field="jobCost"]')).toBe('5.47M');

		const buy = card.querySelector('section[aria-label="Buy for step 1"]')!;
		expect(buy.querySelector('h4')!.textContent!.trim()).toBe('Buy for step 1');
		expect(headers(buy)).toEqual(['Item', 'Quantity', 'Unit price', 'Total', 'Broker fee']);
		expect(text(buy, 'tr[data-type-id="4312"]')).toContain('586');
		expect(text(buy, 'tr[data-type-id="16638"]')).toContain('5.56M');
		expect(card.querySelector('[data-intermediates]')).toBeNull();
	});

	it('shows the job cost components with rates in one line and the step subtotal', () => {
		const [step] = productionSteps(titaniumCarbide());
		const { container } = render(StepCard, { step, count: 2 });
		expect(text(container, '[data-step-job-cost]')).toBe(
			'Job cost 10.94M = system 4.94M (4.12%) + facility tax 1.20M (1.00%) + SCC 4.80M (4.00%)'
		);
		expect(text(container, '[data-step-subtotal]')).toBe(`${(step.subtotal.total / 1e6).toFixed(2)}M`);
	});

	it('names the final step, links the intermediates it uses and hides an all-zero surplus column', () => {
		const steps = productionSteps(titaniumCarbide());
		const { container } = render(StepCard, { step: steps[1], count: 2 });
		expect(text(container, 'h3')).toBe('Step 2 of 2 · final product');
		expect(headers(container)).not.toContain('Surplus');
		expect(text(container, '[data-intermediates]')).toBe(
			'Uses 11,908 Titanium Chromide from step 1, 11,908 Silicon Diborite from step 1.'
		);
		expect(
			[...container.querySelectorAll('[data-intermediates] a')].map((a) => a.getAttribute('href'))
		).toEqual(['#step-1', '#step-1']);
	});

	it('shows n/a for a step with an unpriced material', () => {
		const [step] = productionSteps(titaniumCarbide({ titanium: null }));
		const { container } = render(StepCard, { step, count: 2 });
		expect(text(container, 'tr[data-type-id="16638"]')).toContain('n/a');
		expect(text(container, '[data-total]')).toBe('n/a');
		expect(text(container, '[data-step-subtotal]')).toBe('n/a');
		expect(text(container, '[data-step-job-cost]')).toContain('Job cost 10.94M');
	});

	it('labels a lone job as a single reaction', () => {
		const steps = productionSteps(titaniumCarbide().children[0]);
		const { container } = render(StepCard, { step: steps[0], count: 1 });
		expect(text(container, 'h3')).toBe('Step 1 · single reaction');
	});

	it('shows slots, runs per slot and duration per slot with optimal slots', () => {
		const [intermediates, final] = productionSteps(optimalTitaniumCarbide());
		const top = render(StepCard, { step: final, count: 2 }).container;
		expect(headers(top).slice(0, 5)).toEqual(['Job', 'Slots', 'Runs / slot', 'Per run', 'Duration / slot']);
		const tic = top.querySelector('tr[data-job="0"]')!;
		expect(text(tic, '[data-field="slots"]')).toBe('2');
		expect(text(tic, '[data-field="runs"]')).toBe('122');
		expect(tic.querySelector('[data-field="runs"]')!.getAttribute('title')).toBe('244 runs in total');
		expect(text(tic, '[data-field="duration"]')).toBe('6d 22h 53m');
		expect(text(tic, '[data-field="produced"]')).toBe('24,400');

		const sub = render(StepCard, { step: intermediates, count: 2 }).container;
		const chromide = sub.querySelector('tr[data-job="0-0"]')!;
		expect(text(chromide, '[data-field="slots"]')).toBe('1');
		// 120 runs × 4924.8 s = 590,976 s
		expect(text(chromide, '[data-field="duration"]')).toBe('6d 20h 9m');
	});

	it('has no slot columns with a single slot', () => {
		const [step] = productionSteps(titaniumCarbide());
		const { container } = render(StepCard, { step, count: 2 });
		expect(headers(container)).not.toContain('Slots');
		expect(headers(container)).toContain('Runs');
	});

	it('explains an unrefined job replacing a reaction and where its reprocessed materials go', () => {
		const [first, second] = productionSteps(unrefinedChain());
		const { container } = render(StepCard, { step: first, count: 3 });
		expect(text(container, '[data-reprocess="0-1"]')).toBe(
			'Unrefined Prometium replaces the Prometium reaction: 5 units reprocessed at 55% yield give 475 Cadmium (100 replace purchases, 375 sold), 200 Prometium (200 used).'
		);
		expect(container.querySelector('[data-intermediates]')).toBeNull();
		const later = render(StepCard, { step: second, count: 3 }).container;
		expect(text(later, '[data-intermediates]')).toBe('Uses 100 Cadmium reprocessed in step 1.');
	});

	it("says a steady cycle's byproduct comes from the previous cycle", () => {
		const root = unrefinedChain();
		root.children[0].step = 1;
		root.step = 2;
		const [step] = productionSteps(root);
		const { container } = render(StepCard, { step, count: 2 });
		expect(text(container, '[data-intermediates]')).toBe(
			"Uses 100 Cadmium from the previous cycle's reprocessing in step 1."
		);
	});
});
