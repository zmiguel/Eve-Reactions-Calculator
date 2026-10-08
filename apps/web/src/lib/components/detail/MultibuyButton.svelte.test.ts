import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MultibuyButton from './MultibuyButton.svelte';

const text = 'Oxygen Fuel Block\t1182\nTitanium\t5856';

function mockClipboard(writeText: (data: string) => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
	return writeText;
}

afterEach(() => {
	Reflect.deleteProperty(navigator, 'clipboard');
	vi.useRealTimers();
});

describe('MultibuyButton', () => {
	it('copies the multibuy text and confirms with "Copied", then resets', async () => {
		vi.useFakeTimers();
		const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));
		render(MultibuyButton, { text });
		await fireEvent.click(screen.getByRole('button', { name: 'Copy multibuy' }));
		await vi.waitFor(() => expect(screen.getByRole('button').textContent!.trim()).toBe('Copied'));
		expect(writeText).toHaveBeenCalledWith(text);
		expect(screen.getByRole('status').textContent).toContain('2 items copied');

		await vi.advanceTimersByTimeAsync(2000);
		expect(screen.getByRole('button').textContent!.trim()).toBe('Copy multibuy');
	});

	it('offers the list in a collapsed read-only textarea and opens it when the clipboard is blocked', async () => {
		mockClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
		const { container } = render(MultibuyButton, { text });
		const details = container.querySelector('details')!;
		const area = screen.getByRole('textbox', { name: 'Multibuy list' }) as HTMLTextAreaElement;
		expect(details.open).toBe(false);
		expect(area.readOnly).toBe(true);
		expect(area.value).toBe(text);

		await fireEvent.click(screen.getByRole('button', { name: 'Copy multibuy' }));
		await vi.waitFor(() => expect(details.open).toBe(true));
		expect(screen.getByRole('status').textContent).toContain('Clipboard unavailable');
	});

	it('renders nothing without bought materials', () => {
		const { container } = render(MultibuyButton, { text: '' });
		expect(container.querySelector('[data-multibuy]')).toBeNull();
	});
});
