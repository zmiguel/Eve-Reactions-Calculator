import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSummary } from '$lib/settings/fields';
import SystemAutocomplete from './SystemAutocomplete.svelte';

const system = (id: number, name: string, securityBand = 'nullsec'): SystemSummary => ({
	id,
	name,
	regionName: 'Fountain',
	securityBand,
	securityStatus: -0.2,
	reactionCostIndex: 0.05
});
const RESULTS = [system(30004604, '671-ST'), system(30004605, '67-PBA')];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn(async () => new Response(JSON.stringify(RESULTS)));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function setup(selected: SystemSummary | null = system(30002647, 'Ignoitton', 'lowsec')) {
	const { container } = render(SystemAutocomplete, {
		prefix: 'shared',
		selected,
		text: selected?.name ?? ''
	});
	const hidden = () => container.querySelector<HTMLInputElement>('input[name="shared.systemId"]')!;
	return { input: screen.getByRole('combobox', { name: 'System' }) as HTMLInputElement, hidden };
}

async function type(input: HTMLInputElement, value: string) {
	await fireEvent.input(input, { target: { value } });
}

describe('SystemAutocomplete', () => {
	it('posts the selected id in a hidden field and the name as text', () => {
		const { input, hidden } = setup();
		expect(hidden().value).toBe('30002647');
		expect(input.name).toBe('shared.system');
		expect(input.value).toBe('Ignoitton');
	});

	it('debounces the query: one request after typing stops, none for a single letter', async () => {
		const { input } = setup(null);
		await type(input, '6');
		await vi.advanceTimersByTimeAsync(500);
		expect(fetchMock).not.toHaveBeenCalled();

		await type(input, '67');
		await vi.advanceTimersByTimeAsync(100);
		await type(input, '671');
		await vi.advanceTimersByTimeAsync(249);
		expect(fetchMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/systems?q=671&limit=10');
		await vi.waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
	});

	it('keyboard selection fills the text and the hidden systemId', async () => {
		const { input, hidden } = setup();
		await type(input, '67');
		expect(hidden().value).toBe('');
		await vi.advanceTimersByTimeAsync(250);
		await vi.waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
		expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
		expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		input.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
		expect(hidden().value).toBe('30004605');
		expect(input.value).toBe('67-PBA');
		expect(screen.getByText(/cost index 5\.00%/)).toBeTruthy();
	});

	it('ArrowUp wraps to the last result and Escape closes the list', async () => {
		const { input } = setup(null);
		await type(input, '67');
		await vi.advanceTimersByTimeAsync(250);
		await vi.waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('shows an empty state and a failure hint', async () => {
		const { input } = setup(null);
		fetchMock.mockResolvedValueOnce(new Response('[]'));
		await type(input, 'zz');
		await vi.advanceTimersByTimeAsync(250);
		await vi.waitFor(() => expect(screen.getByText('No reaction system found')).toBeTruthy());
		fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
		await type(input, 'zzz');
		await vi.advanceTimersByTimeAsync(250);
		await vi.waitFor(() => expect(screen.getByText(/Search failed/)).toBeTruthy());
	});

	it('renders a field error', () => {
		render(SystemAutocomplete, { prefix: 'shared', selected: null, text: 'Jita', error: 'Jita is highsec' });
		expect(screen.getByText('Jita is highsec')).toBeTruthy();
		expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
	});
});
