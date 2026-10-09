import type { ChainAllocation } from '@reactions/engine';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { TIC_ALLOCATION, purchase } from '../../../test/chain';
import StartupCycles from './StartupCycles.svelte';

const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

describe('StartupCycles', () => {
	it('lists each one-time cycle with its jobs, buy list and costs; the steady cycle is left to the steps', () => {
		const { container } = render(StartupCycles, { allocation: TIC_ALLOCATION });
		const phases = [...container.querySelectorAll('[data-startup-phase]')];
		expect(phases.map((p) => p.getAttribute('data-startup-phase'))).toEqual(['1']);
		expect(text(phases[0].querySelector('h3'))).toBe('Cycle 1, start-up');
		expect(text(phases[0].querySelector('[data-startup-jobs]'))).toBe(
			'Runs Silicon Diborite (1 × 120 runs), Titanium Chromide (1 × 120 runs).'
		);
		expect(
			phases[0].querySelector('section[aria-label="Buy for cycle 1"] tr[data-type-id="16638"]')
		).not.toBeNull();
		expect(phases[0].querySelector('textarea')!.value).toBe('Oxygen Fuel Block\t586\nTitanium\t11712');
		expect(text(phases[0].querySelector('[data-startup-cost]'))).toBe(
			'Job cost 10.94M · with purchases 57.31M'
		);
		expect(container.querySelector('[data-startup-choice]')).toBeNull();
	});

	it('shows a chosen step 0 first and says why, as an info note', () => {
		const step0Phase = {
			cycle: 0,
			label: 'step_0' as const,
			blueprintTypeIds: [46182],
			slots: 1,
			purchases: [purchase(16638, 'Titanium', 11712, 3000)],
			jobCost: 5_000_000
		};
		const allocation: ChainAllocation = {
			...TIC_ALLOCATION,
			phases: [step0Phase, ...TIC_ALLOCATION.phases],
			startup: {
				mode: 'step0',
				reused: [{ typeId: 16641, name: 'Chromium', quantity: 5000 }],
				buy: { initialInvestment: 1_300_000_000, cycles: 2 },
				step0: {
					initialInvestment: 1_234_000_000,
					cycles: 3,
					blueprintTypeIds: [46182],
					saves: [{ typeId: 16641, name: 'Chromium', quantity: 5000 }],
					stock: []
				}
			}
		};
		const { container } = render(StartupCycles, { allocation });
		expect([...container.querySelectorAll('[data-startup-phase] h3')].map((h) => text(h))).toEqual([
			'Step 0, once before cycle 1',
			'Cycle 1, start-up'
		]);
		expect(container.querySelector('section[aria-label="Buy for step 0"]')).not.toBeNull();
		const note = container.querySelector('[data-startup-choice]')!;
		expect(note.getAttribute('role')).toBe('note');
		expect(note.querySelector('svg')).not.toBeNull();
		expect(text(note.querySelector('[data-startup-title]'))).toBe('Step 0, once before cycle 1');
		expect([...note.querySelectorAll('li')].map((li) => text(li))).toEqual([
			'Titanium Chromide runs one extra time before cycle 1, so cycle 1 already has 5,000 Chromium from reprocessing instead of buying it.',
			'Initial investment 1.23B instead of 1.30B, but one more cycle.',
			'From cycle 1, every unrefined reaction runs each cycle, like the other reactions.',
			'From the cycle after their first run, their reprocessing byproducts replace purchases: 5,000 Chromium per cycle. Until then, the start-up buys these.'
		]);
	});
});
