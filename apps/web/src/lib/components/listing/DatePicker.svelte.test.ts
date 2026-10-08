import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { gotoCalls, resetNavigation } from '../../../test/shims/app/navigation';
import DatePicker from './DatePicker.svelte';

const props = { min: '2025-09-01', max: '2026-10-05', path: '/biochemical' };
const input = () => screen.getByLabelText('Prices as of') as HTMLInputElement;

beforeEach(() => resetNavigation());

describe('DatePicker', () => {
	it('renders the bounds and the current value', () => {
		render(DatePicker, { ...props, value: '2026-10-01' });
		expect(input().type).toBe('date');
		expect(input().min).toBe('2025-09-01');
		expect(input().max).toBe('2026-10-05');
		expect(input().value).toBe('2026-10-01');
	});

	it('navigates to ?date=YYYY-MM-DD when a date in range is picked', async () => {
		render(DatePicker, { ...props, value: null });
		await fireEvent.change(input(), { target: { value: '2026-10-03' } });
		expect(gotoCalls.map((c) => c.url)).toEqual(['/biochemical?date=2026-10-03']);
	});

	it.each(['2026-10-06', '2025-08-31'])('does not navigate for %s outside the bounds', async (value) => {
		render(DatePicker, { ...props, value: null });
		await fireEvent.change(input(), { target: { value } });
		expect(gotoCalls).toEqual([]);
		expect(screen.getByText('Pick a date between 2025-09-01 and 2026-10-05.')).toBeTruthy();
		expect(input().getAttribute('aria-invalid')).toBe('true');
	});

	it('returns to live prices when cleared or via the button', async () => {
		render(DatePicker, { ...props, value: '2026-10-01' });
		await fireEvent.change(input(), { target: { value: '' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Live prices' }));
		expect(gotoCalls.map((c) => c.url)).toEqual(['/biochemical', '/biochemical']);
	});

	it('hides the live button when already live', () => {
		render(DatePicker, { ...props, value: null });
		expect(screen.queryByRole('button', { name: 'Live prices' })).toBeNull();
	});
});
