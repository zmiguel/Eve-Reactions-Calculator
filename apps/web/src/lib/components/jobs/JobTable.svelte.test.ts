import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRow } from '$lib/jobs/types';
import { paginate } from '$lib/paging';
import { resetPage, setPage } from '../../../test/shims/app/state';
import JobTable from './JobTable.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const DAY = 86_400_000;

function job(jobId: number, overrides: Partial<JobRow> = {}): JobRow {
	return {
		jobId,
		formula: { blueprintTypeId: 46182, name: 'Titanium Chromide Reaction Formula' },
		runs: 30,
		owner: 'Alpha',
		facility: 'Reactor One',
		startDate: NOW - 2 * DAY,
		endDate: NOW - DAY,
		status: 'finished',
		marks: [],
		inputCost: 1000,
		jobCost: 100,
		output: {
			typeId: 16654,
			name: 'Titanium Chromide',
			quantity: 200,
			soldQty: 20,
			usedQty: 130,
			manufacturedQty: 20,
			unsoldQty: 30
		},
		realizedProfit: 50,
		expectedProfit: 80,
		expectedNote: null,
		...overrides
	};
}

const renderTable = (rows: JobRow[], page = 1) =>
	render(JobTable, { data: paginate(rows, page), now: NOW }).container;

const rowOf = (container: Element, jobId: number) =>
	container.querySelector(`tr[data-job="${jobId}"]`) as HTMLTableRowElement;

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/profits/jobs?period=all' }));
afterEach(() => resetPage());

describe('JobTable', () => {
	it('links each job to its page with the formula icon and its runs, owner and facility', () => {
		const container = renderTable([job(1), job(2, { formula: { blueprintTypeId: 9, name: null } })]);
		const links = [...container.querySelectorAll('a[data-job-link]')];
		expect(links.map((a) => a.getAttribute('href'))).toEqual(['/profits/jobs/1', '/profits/jobs/2']);
		expect(links[0].querySelector('img')?.getAttribute('src')).toContain('/types/46182/bp');
		expect(
			rowOf(container, 1).querySelector('[data-job-facts]')?.textContent?.replace(/\s+/g, ' ').trim()
		).toBe('30 runs · Alpha · Reactor One');
	});

	it('shows status pills, the running progress, and a mark per flag', () => {
		const container = renderTable([
			job(1, { marks: ['market_fallback', 'unpriced_input', 'no_cost'] }),
			job(2, { status: 'running', startDate: NOW - DAY, endDate: NOW + DAY, output: null }),
			job(3, { status: 'cancelled', output: null })
		]);
		const status = (id: number) =>
			rowOf(container, id).querySelector('[data-status]')?.getAttribute('data-status');
		expect([status(1), status(2), status(3)]).toEqual(['finished', 'running', 'cancelled']);
		expect(rowOf(container, 2).querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
			'50'
		);
		expect(
			[...rowOf(container, 1).querySelectorAll('[data-mark]')].map((m) => m.getAttribute('data-mark'))
		).toEqual(['market_fallback', 'unpriced_input', 'no_cost']);
		for (const mark of rowOf(container, 1).querySelectorAll('[data-mark]')) {
			expect(mark.getAttribute('title')).toBeTruthy();
		}
		expect(rowOf(container, 2).querySelectorAll('[data-mark]')).toHaveLength(0);
	});

	it('cost is inputs + job cost with the breakdown in the title; a market estimate marks it', () => {
		const container = renderTable([
			job(1),
			job(2, { marks: ['market_fallback'] }),
			job(3, { inputCost: null })
		]);
		const cost = (id: number) => rowOf(container, id).querySelector('[data-cost]')!;
		expect(cost(1).querySelector('[data-isk]')?.getAttribute('data-isk')).toBe('1100');
		expect(cost(1).getAttribute('title')).toBe('Inputs 1,000.00 ISK + job cost 100.00 ISK');
		expect(cost(1).querySelector('[data-estimated]')).toBeNull();
		expect(cost(2).querySelector('[data-estimated]')).not.toBeNull();
		expect(cost(3).querySelector('[data-isk="none"]')?.getAttribute('title')).toBeTruthy();
	});

	it('a null expected profit is a dash whose title explains why; unsold output marks it estimated', () => {
		const note = 'Some output could not be valued.';
		const container = renderTable([
			job(1),
			job(2, { expectedProfit: null, expectedNote: note }),
			job(3, {
				output: {
					typeId: 1,
					name: 'X',
					quantity: 10,
					soldQty: 10,
					usedQty: 0,
					manufacturedQty: 0,
					unsoldQty: 0
				}
			})
		]);
		const expected = (id: number) => rowOf(container, id).querySelector('[data-expected]')!;
		expect(expected(1).querySelector('[data-isk]')?.getAttribute('data-isk')).toBe('80');
		expect(expected(1).querySelector('[data-estimated]')).not.toBeNull();
		const missing = expected(2).querySelector('[data-isk="none"]');
		expect(missing?.textContent).toBe('–');
		expect(missing?.getAttribute('title')).toBe(note);
		expect(rowOf(container, 2).querySelector('[data-realized] [data-isk]')?.getAttribute('data-isk')).toBe(
			'50'
		);
		// Everything sold: the expected profit is not an estimate.
		expect(expected(3).querySelector('[data-estimated]')).toBeNull();
	});

	it('shows the output quantity with a sold / used / used in manufacturing / unsold bar; no output is a dash', () => {
		const container = renderTable([job(1), job(2, { status: 'running', output: null })]);
		const output = rowOf(container, 1).querySelector('[data-output]')!;
		expect(output.textContent).toContain('200');
		expect(
			[...output.querySelectorAll<HTMLElement>('[data-segment]')].map((s) => [
				s.dataset.segment,
				s.dataset.value
			])
		).toEqual([
			['sold', '20'],
			['used by later jobs', '130'],
			['used in manufacturing', '20'],
			['unsold', '30']
		]);
		expect(rowOf(container, 2).querySelector('[data-no-output]')).not.toBeNull();
	});

	it('pages by 10 with links that keep the filters', () => {
		const rows = Array.from({ length: 23 }, (_, i) => job(i + 1));
		const container = renderTable(rows, 2);
		expect(container.querySelectorAll('tr[data-job]')).toHaveLength(10);
		expect(container.querySelector('a[rel="next"]')?.getAttribute('href')).toBe(
			'/profits/jobs?period=all&page=3'
		);
	});
});
