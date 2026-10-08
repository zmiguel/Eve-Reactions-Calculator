import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import AutoFillButton from './AutoFillButton.svelte';

const toggle = () => screen.getByRole('button', { name: /^Auto-fill picks:/ });
const items = () => screen.getAllByRole('menuitemradio');

describe('AutoFillButton', () => {
	it('runs auto-fill from the main button and shows the current scope on the toggle', async () => {
		const onfill = vi.fn();
		render(AutoFillButton, { props: { scope: 'composite_chains', onfill } });
		await fireEvent.click(screen.getByRole('button', { name: 'Auto-fill best' }));
		expect(onfill).toHaveBeenCalledOnce();
		expect(toggle().textContent!.trim()).toBe('Composite chains');
		expect(toggle().getAttribute('aria-haspopup')).toBe('menu');
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('picks a scope with the mouse; the checked item is marked', async () => {
		render(AutoFillButton, { props: { scope: 'all', onfill: () => {} } });
		await fireEvent.click(toggle());
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
		expect(items().map((i) => i.textContent!.replace('✓', '').trim())).toEqual([
			'All',
			'Composite chains',
			'Composites, buying intermediates',
			'Intermediates',
			'Biochemical: Strong / Improved boosters',
			'Molecular-Forged',
			'Hybrid polymers'
		]);
		expect(items()[0].getAttribute('aria-checked')).toBe('true');
		await fireEvent.click(screen.getByRole('menuitemradio', { name: /Hybrid polymers/ }));
		expect(screen.queryByRole('menu')).toBeNull();
		expect(toggle().textContent!.trim()).toBe('Hybrid polymers');
	});

	it('is keyboard operable: arrows move, Enter picks, Escape closes back to the toggle', async () => {
		render(AutoFillButton, { props: { scope: 'all', onfill: () => {} } });
		toggle().focus();
		await fireEvent.keyDown(toggle(), { key: 'ArrowDown' });
		await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
		const menu = screen.getByRole('menu');
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items()[2]);
		await fireEvent.keyDown(menu, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(items()[1]);
		await fireEvent.keyDown(menu, { key: 'End' });
		expect(document.activeElement).toBe(items()[6]);
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items()[0]);

		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(toggle());

		await fireEvent.keyDown(toggle(), { key: 'ArrowUp' });
		await vi.waitFor(() => expect(document.activeElement).toBe(items()[6]));
		// Native buttons activate on Enter; the menu item's click handler picks it.
		await fireEvent.click(document.activeElement!);
		expect(toggle().textContent!.trim()).toBe('Hybrid polymers');
		expect(document.activeElement).toBe(toggle());
	});

	it('closes when clicking outside', async () => {
		render(AutoFillButton, { props: { scope: 'all', onfill: () => {} } });
		await fireEvent.click(toggle());
		await fireEvent.pointerDown(document.body);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('disables only the main button', () => {
		render(AutoFillButton, { props: { scope: 'all', disabled: true, onfill: () => {} } });
		expect((screen.getByRole('button', { name: 'Auto-fill best' }) as HTMLButtonElement).disabled).toBe(true);
		expect((toggle() as HTMLButtonElement).disabled).toBe(false);
	});
});
