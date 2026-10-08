import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { TIC_ALLOCATION } from '../../../test/chain';
import SlotAllocation from './SlotAllocation.svelte';

const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

describe('SlotAllocation', () => {
	it('summarises lines, slots, utilisation and the initial investment', () => {
		const { container } = render(SlotAllocation, { allocation: TIC_ALLOCATION });
		expect(text(container.querySelector('h2'))).toBe('Slot allocation');
		expect(text(container.querySelector('[data-allocation-summary]'))).toBe(
			'2 lines · 4 slots · 98.5% utilisation'
		);
		expect(text(container.querySelector('[data-allocation-investment]'))).toBe('Initial investment 1.23B');
		expect(text(container)).toContain(
			'Optimal slots: 2 parallel lines sized so every job fits one 7-day cycle'
		);
	});

	it('lists every reaction with its slots, runs and duration per slot and first cycle', () => {
		const { container } = render(SlotAllocation, { allocation: TIC_ALLOCATION });
		const rows = [...container.querySelectorAll('tr[data-allocation-reaction]')].map((tr) =>
			['name', 'slots', 'runs', 'duration', 'firstCycle'].map((f) =>
				text(tr.querySelector(`[data-field="${f}"]`))
			)
		);
		expect(rows).toEqual([
			['Titanium Carbide', '2', '122', '6d 22h 53m', '2'],
			['Silicon Diborite', '1', '120', '6d 20h 9m', '1'],
			['Titanium Chromide', '1', '120', '6d 20h 9m', '1']
		]);
	});

	it('shows the build-up and steady phases with their slot counts', () => {
		const { container } = render(SlotAllocation, { allocation: TIC_ALLOCATION });
		expect(text(container.querySelector('[data-phases]'))).toBe(
			'Cycle 1: 2 slots (intermediates) · Cycle 2+: 4 slots (steady state)'
		);
		expect(container.querySelector('[data-phase="1"]')!.getAttribute('title')).toBe(
			'Silicon Diborite, Titanium Chromide'
		);
	});

	it('shows n/a for an unpriced initial investment and uneven runs per slot', () => {
		const allocation = {
			...TIC_ALLOCATION,
			initialInvestment: null,
			reactions: [
				{ ...TIC_ALLOCATION.reactions[0], runsPerSlot: [64, 63], slotDurations: [64 * 4924.8, 63 * 4924.8] }
			]
		};
		const { container } = render(SlotAllocation, { allocation });
		expect(text(container.querySelector('[data-allocation-investment]'))).toBe('Initial investment n/a');
		expect(text(container.querySelector('[data-field="runs"]'))).toBe('64 / 63');
	});
});
