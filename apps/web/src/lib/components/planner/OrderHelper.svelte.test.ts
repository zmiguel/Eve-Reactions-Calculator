import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import OrderHelper from './OrderHelper.svelte';

describe('OrderHelper', () => {
	it('splits an order total over N cycles, rounding up', async () => {
		const onapply = vi.fn();
		const { container } = render(OrderHelper, { props: { label: 'target 1', onapply } });
		const use = screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement;
		expect(use.disabled).toBe(true);

		await fireEvent.input(screen.getByRole('textbox', { name: 'Total needed for target 1' }), {
			target: { value: '35,280,000' }
		});
		expect(container.querySelector('[data-field="perCycle"]')!.textContent).toBe('35,280,000');
		await fireEvent.input(screen.getByRole('spinbutton', { name: 'Cycles for target 1' }), {
			target: { value: '4' }
		});
		expect(container.querySelector('[data-field="perCycle"]')!.textContent).toBe('8,820,000');
		await fireEvent.click(use);
		expect(onapply).toHaveBeenCalledWith(8_820_000);
	});

	it('needs a whole total and at least one cycle', async () => {
		const { container } = render(OrderHelper, { props: { label: 'target 1', onapply: () => {} } });
		await fireEvent.input(screen.getByRole('textbox', { name: 'Total needed for target 1' }), {
			target: { value: '1.5' }
		});
		expect(container.querySelector('[data-field="perCycle"]')!.textContent).toBe('–');
		await fireEvent.input(screen.getByRole('textbox', { name: 'Total needed for target 1' }), {
			target: { value: '7' }
		});
		await fireEvent.input(screen.getByRole('spinbutton', { name: 'Cycles for target 1' }), {
			target: { value: '0' }
		});
		expect(container.querySelector('[data-field="perCycle"]')!.textContent).toBe('–');
		expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
