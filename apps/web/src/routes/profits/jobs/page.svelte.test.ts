import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRow, JobsPageData, JobTotalsView } from '#lib/jobs/types.js';
import { paginate } from '#lib/paging.js';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Page from './+page.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const FORMULA = { blueprintTypeId: 46182, name: 'Titanium Chromide Reaction Formula' };

const totals = (overrides: Partial<JobTotalsView> = {}): JobTotalsView => ({
	jobs: 1,
	runs: 2,
	spent: 1100,
	realizedProfit: 50,
	expectedProfit: 80,
	unvalued: 0,
	soldQty: 20,
	usedQty: 130,
	manufacturedQty: 20,
	unsoldQty: 30,
	...overrides
});

const row: JobRow = {
	jobId: 7001,
	formula: FORMULA,
	runs: 2,
	owner: 'Alpha',
	facility: 'Reactor One',
	startDate: NOW - 86_400_000,
	endDate: NOW,
	status: 'finished',
	marks: [],
	inputCost: 1000,
	jobCost: 100,
	output: null,
	realizedProfit: 50,
	expectedProfit: 80,
	expectedNote: null
};

function data(overrides: Partial<JobsPageData> = {}) {
	const page: JobsPageData = {
		now: NOW,
		defaultPeriod: '30',
		hasJobs: true,
		filters: { period: '30', status: null, formula: null, connection: null, sort: 'newest' },
		counts: { all: 1, running: 0, finished: 1, cancelled: 0 },
		totals: totals(),
		jobs: paginate([row], 1),
		reviewCount: 0,
		rebuiltAt: NOW,
		dirty: false,
		formulas: [FORMULA],
		connections: [{ sourceId: 3, name: 'Alpha', kind: 'character' }],
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, ...page };
}

const none = { jobs: paginate([] as JobRow[], 1), totals: totals({ jobs: 0 }) };

const renderPage = (pageData = data()) => render(Page, { props: { data: pageData, params: {} } as never });

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/profits/jobs' }));
afterEach(() => {
	resetPage();
	document.head.innerHTML = '';
});

describe('/profits/jobs page', () => {
	it('no jobs at all: explains how jobs arrive and links to the connections, no filters', () => {
		const { container } = renderPage(data({ hasJobs: false, ...none }));
		const empty = container.querySelector('[data-empty="no_jobs"]')!;
		expect(empty.querySelector('a')?.getAttribute('href')).toBe('/account/connections');
		expect(container.querySelector('[data-filters]')).toBeNull();
		expect(container.querySelector('table')).toBeNull();
	});

	it('no jobs in the period: keeps the filters and offers every period', () => {
		const { container } = renderPage(
			data({
				...none,
				filters: { period: '7', status: 'running', formula: null, connection: null, sort: 'newest' }
			})
		);
		expect(container.querySelector('[data-filters]')).not.toBeNull();
		expect(container.querySelector('[data-totals]')).toBeNull();
		expect(container.querySelector('[data-show-all]')?.getAttribute('href')).toBe(
			'/profits/jobs?status=running&period=all'
		);

		const all = renderPage(
			data({
				...none,
				filters: { period: 'all', status: 'running', formula: null, connection: null, sort: 'newest' }
			})
		);
		expect(all.container.querySelector('[data-empty="filtered"] a')?.getAttribute('href')).toBe(
			'/profits/jobs'
		);
	});

	it('with a default period of all, the show-all link leaves the period out', () => {
		const { container } = renderPage(
			data({
				...none,
				defaultPeriod: 'all',
				filters: { period: '7', status: null, formula: null, connection: null, sort: 'newest' }
			})
		);
		expect(container.querySelector('[data-show-all]')?.getAttribute('href')).toBe('/profits/jobs');
	});

	it('summarizes the filtered jobs: spent, realized, expected (estimated) and where the output went', () => {
		const { container } = renderPage();
		const total = (name: string) => container.querySelector(`[data-total="${name}"]`)!;
		expect(total('jobs').textContent?.trim()).toBe('1');
		expect(total('spent').querySelector('[data-isk]')?.getAttribute('data-isk')).toBe('1100');
		expect(total('realized').querySelector('[data-isk]')?.getAttribute('data-isk')).toBe('50');
		expect(total('expected').querySelector('[data-estimated]')).not.toBeNull();
		expect(
			[...total('output').querySelectorAll<HTMLElement>('[data-segment]')].map((s) => s.dataset.value)
		).toEqual(['20', '130', '20', '30']);
		expect(total('output').textContent).toContain('used in manufacturing');
		expect(container.querySelector('[data-unvalued]')).toBeNull();
		expect(
			renderPage(data({ totals: totals({ unvalued: 2 }) })).container.querySelector('[data-unvalued]')
		).not.toBeNull();
	});

	it('links prices needing review to the ledger only when there are some', () => {
		expect(renderPage().container.querySelector('[data-review]')).toBeNull();
		const { container } = renderPage(data({ reviewCount: 3 }));
		const review = container.querySelector('a[data-review]')!;
		expect(review.getAttribute('href')).toBe('/profits/ledger?review=1');
		expect(review.querySelector('[data-review-count]')?.textContent).toBe('3');
	});

	it('renders the job table page from the load', () => {
		const { container } = renderPage();
		expect(container.querySelector('table[data-paged="page"] tr[data-job="7001"]')).not.toBeNull();
	});
});
