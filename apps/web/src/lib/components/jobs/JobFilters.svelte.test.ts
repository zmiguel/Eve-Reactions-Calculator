import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobFilters as Filters } from '$lib/jobs/types';
import { gotoCalls, resetNavigation } from '../../../test/shims/app/navigation';
import JobFilters, { jobsHref } from './JobFilters.svelte';

const DEFAULTS: Filters = { period: '30', status: null, formula: null, connection: null, sort: 'newest' };
const props = (filters: Partial<Filters> = {}) => ({
	filters: { ...DEFAULTS, ...filters },
	counts: { all: 12, running: 2, finished: 9, cancelled: 1 },
	formulas: [{ blueprintTypeId: 46182, name: 'Titanium Chromide Reaction Formula' }],
	connections: [
		{ sourceId: 3, name: 'Alpha', kind: 'character' as const },
		{ sourceId: 4, name: 'Alpha Corp', kind: 'corporation' as const }
	]
});

afterEach(() => resetNavigation());

describe('jobsHref', () => {
	it('leaves the defaults out of the query string', () => {
		expect(jobsHref(DEFAULTS)).toBe('/profits/jobs');
		expect(
			jobsHref({ period: 'all', status: 'running', formula: 46182, connection: 3, sort: 'ending' })
		).toBe('/profits/jobs?status=running&period=all&reaction=46182&connection=3&sort=ending');
		expect(jobsHref({ ...DEFAULTS, period: '7' }, { period: 'all' })).toBe('/profits/jobs?period=all');
	});

	it("leaves the user's default period out and keeps 30 days when it is not the default", () => {
		expect(jobsHref({ ...DEFAULTS, period: '90' }, {}, '90')).toBe('/profits/jobs');
		expect(jobsHref(DEFAULTS, {}, '90')).toBe('/profits/jobs?period=30');
		expect(jobsHref({ ...DEFAULTS, period: '90' }, { period: 'all' }, 'all')).toBe('/profits/jobs');
	});
});

describe('JobFilters', () => {
	it('a GET form with the current values selected and a count per status', () => {
		const { container } = render(
			JobFilters,
			props({ status: 'finished', period: '90', formula: 46182, connection: 4, sort: 'spent' })
		);
		const form = container.querySelector('form[data-filters]') as HTMLFormElement;
		expect(form.getAttribute('method')?.toUpperCase()).toBe('GET');
		expect(form.getAttribute('action')).toBe('/profits/jobs');
		// Typed as an input: the workers DOM types make `HTMLSelectElement` unusable; `.value` is shared.
		const value = (name: string) => (form.querySelector(`select[name="${name}"]`) as HTMLInputElement).value;
		expect([value('period'), value('reaction'), value('connection'), value('sort')]).toEqual([
			'90',
			'46182',
			'4',
			'spent'
		]);
		const checked = form.querySelector<HTMLInputElement>('input[name="status"]:checked');
		expect(checked?.value).toBe('finished');
		const counts = Object.fromEntries(
			[...form.querySelectorAll('[data-status-option]')].map((o) => [
				o.getAttribute('data-status-option'),
				o.querySelector('[data-count]')?.textContent
			])
		);
		expect(counts).toEqual({ all: '12', running: '2', finished: '9', cancelled: '1' });
		expect(container.querySelector('a[data-clear]')).not.toBeNull();
	});

	it('applies itself on change with JS (no Filter button), dropping defaults and the page', async () => {
		const { container } = render(JobFilters, props({ sort: 'spent' }));
		expect(container.querySelector('[data-filter-submit]')).toBeNull();
		const running = container.querySelector<HTMLInputElement>('input[name="status"][value="running"]')!;
		running.checked = true;
		await fireEvent.change(running);
		expect(gotoCalls.map((c) => c.url)).toEqual(['/profits/jobs?status=running&sort=spent']);
	});

	it('hides the connection choice with a single connection and Clear filters at the defaults', () => {
		const one = { ...props(), connections: [props().connections[0]] };
		const { container } = render(JobFilters, one);
		expect(container.querySelector('select[name="connection"]')).toBeNull();
		expect(container.querySelector('a[data-clear]')).toBeNull();
	});

	it("treats the user's default period as no filter", async () => {
		const { container } = render(JobFilters, { ...props({ period: '7' }), defaultPeriod: '7' as const });
		expect(container.querySelector('a[data-clear]')).toBeNull();
		const sort = container.querySelector('select[name="sort"]') as HTMLInputElement;
		sort.value = 'spent';
		await fireEvent.change(sort);
		expect(gotoCalls.map((c) => c.url)).toEqual(['/profits/jobs?sort=spent']);
	});
});
