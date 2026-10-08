import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { PriceTiming } from '$lib/server/detail';
import PriceTimingCard from './PriceTimingCard.svelte';

const timing = (then: number | null, now: number | null, approximate = false): PriceTiming => ({
	days: 14,
	defaultDays: 14,
	asOf: '2026-09-22T12:00:00.000Z',
	approximate,
	then: { profit: then, profitPerSlotDay: null, inputCost: 1 },
	now: { profit: now, profitPerSlotDay: null, inputCost: 1 }
});

const delta = (c: HTMLElement) => c.querySelector('[data-delta]')!;

describe('PriceTimingCard', () => {
	it('shows a positive delta in green with a plus sign', () => {
		const { container } = render(PriceTimingCard, {
			timing: timing(3_000_000, 1_000_000),
			action: '/composite/titanium-carbide'
		});
		expect(container.querySelector('[data-then]')!.textContent!.trim()).toBe('3.00M');
		expect(container.querySelector('[data-now]')!.textContent!.trim()).toBe('1.00M');
		expect(delta(container).textContent!.trim()).toBe('+2.00M');
		expect(delta(container).className).toContain('text-green-600');
		expect(container.textContent).toContain('2026-09-22 12:00 UTC');
		expect(container.querySelector('[data-approximate]')).toBeNull();
	});

	it('shows a negative delta in red with a minus sign and the approximate flag', () => {
		const { container } = render(PriceTimingCard, {
			timing: timing(-500_000, 1_000_000, true),
			action: '/x'
		});
		expect(delta(container).textContent!.trim()).toBe('-1.50M');
		expect(delta(container).className).toContain('text-red-600');
		expect(container.querySelector('[data-approximate]')).not.toBeNull();
	});

	it('n/a when either profit is unknown', () => {
		const { container } = render(PriceTimingCard, { timing: timing(null, 1), action: '/x' });
		expect(delta(container).textContent!.trim()).toBe('n/a');
		expect(delta(container).className).toContain('text-gray-500');
	});

	it('submits a GET form with the days input and keeps other query params', () => {
		const { container } = render(PriceTimingCard, {
			timing: timing(1, 1),
			action: '/composite/titanium-carbide',
			hidden: { view: 'chain' }
		});
		const form = container.querySelector('form')!;
		expect(form.getAttribute('method')).toBe('GET');
		expect(form.getAttribute('action')).toBe('/composite/titanium-carbide');
		const input = form.querySelector<HTMLInputElement>('input[name="bought"]')!;
		expect([input.value, input.min, input.max]).toEqual(['14', '0', '60']);
		expect(form.querySelector<HTMLInputElement>('input[name="view"]')!.value).toBe('chain');
	});
});
