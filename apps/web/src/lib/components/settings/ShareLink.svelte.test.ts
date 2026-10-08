import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShareLink from './ShareLink.svelte';

const url = 'https://reactions.coalition.space/settings?import=q1YqU7Iy1FFKzs8tyM9LzSsBAA';

function mockClipboard(writeText: (data: string) => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
	return writeText;
}

afterEach(() => {
	Reflect.deleteProperty(navigator, 'clipboard');
});

describe('ShareLink', () => {
	it('shows the link read-only and copies it', async () => {
		const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));
		render(ShareLink, { url });
		const input = screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement;
		expect(input.readOnly).toBe(true);
		expect(input.value).toBe(url);
		await fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
		await vi.waitFor(() => expect(screen.getByRole('button').textContent!.trim()).toBe('Copied'));
		expect(writeText).toHaveBeenCalledWith(url);
	});

	it('selects the link when the clipboard is blocked', async () => {
		mockClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
		render(ShareLink, { url });
		await fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Clipboard unavailable/));
		const input = screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement;
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, url.length]);
	});
});
