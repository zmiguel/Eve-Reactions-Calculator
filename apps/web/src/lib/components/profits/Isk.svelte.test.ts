import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Isk from './Isk.svelte';

describe('Isk', () => {
	it('shows the compact value with the full value as its title', () => {
		const { container } = render(Isk, { value: 1_234_567 });
		const value = container.querySelector('[data-isk]')!;
		expect(value.textContent).toBe('1.23M');
		expect(value.getAttribute('title')).toBe('1,234,567.00 ISK');
		expect(container.querySelector('[data-estimated]')).toBeNull();
	});

	it('colors profits by sign: green above zero, red below, gray at zero', () => {
		const tone = (value: number) =>
			render(Isk, { value, profit: true }).container.querySelector('[data-isk]')!.className;
		expect(tone(5)).toContain('text-green');
		expect(tone(-5)).toContain('text-red');
		expect(tone(0)).toContain('text-gray');
		expect(render(Isk, { value: -5 }).container.querySelector('[data-isk]')!.className).not.toContain(
			'text-red'
		);
	});

	it('a missing value is a dash explaining why; estimates carry a marker with the reason', () => {
		const missing = render(Isk, { value: null, missing: 'Still running.' }).container;
		const dash = missing.querySelector('[data-isk="none"]')!;
		expect(dash.textContent).toBe('–');
		expect(dash.getAttribute('title')).toBe('Still running.');

		const estimated = render(Isk, { value: 10, estimated: 'Valued at today’s price.' }).container;
		expect(estimated.querySelector('[data-estimated]')?.getAttribute('title')).toBe(
			'Valued at today’s price.'
		);
		expect(
			render(Isk, { value: null, estimated: 'x' }).container.querySelector('[data-estimated]')
		).toBeNull();
	});
});
