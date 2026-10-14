import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import JobStatusPill from './JobStatusPill.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const HOUR = 3_600_000;

describe('JobStatusPill', () => {
	it('a running job shows its progress and when it ends', () => {
		const { container } = render(JobStatusPill, {
			status: 'running',
			startDate: NOW - 4 * HOUR,
			endDate: NOW + 28 * HOUR,
			now: NOW
		});
		expect(container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('running');
		expect(container.querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('blue');
		expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('13');
		expect(container.textContent).toContain('ends in 1d 4h');
	});

	it('a finished job says how long ago it ended, with the date in a tooltip', () => {
		const endDate = NOW - 2 * 24 * HOUR;
		const { container } = render(JobStatusPill, {
			status: 'finished',
			startDate: endDate - HOUR,
			endDate,
			now: NOW
		});
		expect(container.querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('green');
		expect(container.querySelector('[role="progressbar"]')).toBeNull();
		const ended = [...container.querySelectorAll('span')].find((s) => s.textContent?.startsWith('ended'));
		expect(ended?.textContent).toBe('ended 2 d ago');
		expect(ended?.getAttribute('title')).toBe('2026-10-10 12:00 UTC');
	});

	it('a cancelled job is red, without progress', () => {
		const { container } = render(JobStatusPill, {
			status: 'cancelled',
			startDate: NOW - 24 * HOUR,
			endDate: NOW + 24 * HOUR,
			now: NOW
		});
		expect(container.querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('red');
		expect(container.querySelector('[role="progressbar"]')).toBeNull();
		expect(container.textContent).not.toContain('ends in');
	});
});
