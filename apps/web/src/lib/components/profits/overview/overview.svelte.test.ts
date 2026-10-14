import { render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paginate } from '$lib/paging';
import type {
	OverviewCharts as Charts,
	OverviewKpis,
	ReactionTableRow,
	RunningTableRow,
	SaleTableRow
} from '$lib/profits/types';
import ChartStub from '../../../../test/ChartStub.svelte';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import AttentionBar from './AttentionBar.svelte';
import KpiCards from './KpiCards.svelte';
import OverviewCharts from './OverviewCharts.svelte';
import PeriodSwitch from './PeriodSwitch.svelte';
import ReactionsTable from './ReactionsTable.svelte';
import RunningTable from './RunningTable.svelte';
import SalesTable from './SalesTable.svelte';

const NOW = Date.UTC(2026, 9, 6, 12);
const loadChart = async () => ChartStub as unknown as Component<{ options: object }>;

beforeEach(() => {
	setPage({ url: 'https://reactions.coalition.space/profits?period=30' });
	// The charts measure their panel (`bind:clientWidth`); jsdom has no layout nor ResizeObserver.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});
afterEach(() => {
	resetPage();
	vi.unstubAllGlobals();
});

const kpis = (over: Partial<OverviewKpis> = {}): OverviewKpis => ({
	realized: 1_500_000,
	realizedPrevious: 2_000_000,
	manufacturedQty: 0,
	expected: 3_000_000,
	endedJobs: 4,
	unvaluedJobs: 0,
	expectedHasUnsold: true,
	salesIncome: 9_000_000,
	sales: 3,
	spent: 7_000_000,
	purchases: 5_000_000,
	jobCosts: 2_000_000,
	profitPerSlotDay: 750_000,
	slotDays: 4,
	unsold: { quantity: 10, value: 1_000_000, cost: 1_200_000, gain: -200_000, unvaluedTypes: 0 },
	reselling: null,
	...over
});

const card = (container: HTMLElement, key: string) => container.querySelector(`[data-kpi="${key}"]`)!;
const isk = (el: Element) => el.querySelector('[data-isk]')!;

describe('KpiCards', () => {
	it('colors profits by sign and shows the change against the previous period', () => {
		const { container } = render(KpiCards, { kpis: kpis(), period: '30' });
		expect(isk(card(container, 'realized')).className).toContain('text-green');
		const change = card(container, 'realized').querySelector('[data-change]')!;
		expect(change.getAttribute('data-change')).toBe('-500000');
		expect(change.querySelector('span')!.className).toContain('text-red');
		expect(change.textContent).toContain('-500.00K');
		const gain = card(container, 'unsold').querySelector('[data-gain]')!;
		expect(gain.getAttribute('data-gain')).toBe('loss');
		expect(gain.className).toContain('text-red');
		const held = render(KpiCards, {
			kpis: kpis({
				unsold: { quantity: 10, value: 1_500_000, cost: 1_200_000, gain: 300_000, unvaluedTypes: 0 }
			}),
			period: '30'
		});
		expect(card(held.container, 'unsold').querySelector('[data-gain]')!.getAttribute('data-gain')).toBe(
			'gain'
		);

		const loss = render(KpiCards, {
			kpis: kpis({ realized: -10, realizedPrevious: null, expected: 0 }),
			period: 'all'
		});
		expect(isk(card(loss.container, 'realized')).className).toContain('text-red');
		expect(isk(card(loss.container, 'expected')).className).toContain('text-gray');
		expect(card(loss.container, 'realized').querySelector('[data-change]')).toBeNull();
	});

	it('marks estimates: expected profit, profit per slot per day and unsold value', () => {
		const { container } = render(KpiCards, { kpis: kpis(), period: '30' });
		for (const key of ['expected', 'per-slot-day', 'unsold'])
			expect(card(container, key).querySelector('[data-estimated]')).not.toBeNull();
		for (const key of ['realized', 'sales', 'spent'])
			expect(card(container, key).querySelector('[data-estimated]')).toBeNull();

		const sold = render(KpiCards, {
			kpis: kpis({
				expectedHasUnsold: false,
				unsold: { quantity: 0, value: 0, cost: 0, gain: 0, unvaluedTypes: 0 }
			}),
			period: '30'
		});
		for (const key of ['expected', 'per-slot-day', 'unsold'])
			expect(card(sold.container, key).querySelector('[data-estimated]')).toBeNull();
	});

	it('shows reselling and unvalued jobs only when there are some', () => {
		const plain = render(KpiCards, { kpis: kpis(), period: '30' });
		expect(plain.container.querySelector('[data-reselling]')).toBeNull();
		expect(plain.container.querySelector('[data-unvalued]')).toBeNull();
		const { container } = render(KpiCards, {
			kpis: kpis({ reselling: { profit: 60, sales: 1 }, unvaluedJobs: 2 }),
			period: '30'
		});
		expect(container.querySelector('[data-reselling] [data-isk]')!.getAttribute('data-isk')).toBe('60');
		expect(container.querySelector('[data-unvalued]')).not.toBeNull();
	});

	it('says how many units used in manufacturing realized profit includes, only when there are some', () => {
		const plain = render(KpiCards, { kpis: kpis(), period: '30' });
		expect(plain.container.querySelector('[data-manufactured]')).toBeNull();
		const { container } = render(KpiCards, { kpis: kpis({ manufacturedQty: 1200 }), period: '30' });
		expect(card(container, 'realized').querySelector('[data-manufactured]')?.textContent).toBe(
			'Includes 1,200 units used in manufacturing'
		);
	});

	it('says why there is no profit per slot per day instead of showing a dash over 0 slot-days', () => {
		const none = render(KpiCards, {
			kpis: kpis({ profitPerSlotDay: null, slotDays: 0, endedJobs: 0, expectedHasUnsold: false }),
			period: '7'
		});
		const empty = card(none.container, 'per-slot-day');
		expect(empty.querySelector('[data-empty]')).not.toBeNull();
		expect(empty.querySelector('[data-isk]')).toBeNull();

		const { container } = render(KpiCards, { kpis: kpis(), period: '30' });
		expect(card(container, 'per-slot-day').querySelector('[data-empty]')).toBeNull();
		expect(isk(card(container, 'per-slot-day')).getAttribute('data-isk')).toBe('750000');
	});
});

describe('PeriodSwitch', () => {
	it('links every period (the default, 30 days, without a query) and marks the current one', () => {
		const { container } = render(PeriodSwitch, { period: '90' });
		const links = [...container.querySelectorAll('a')];
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/profits?period=7',
			'/profits',
			'/profits?period=90',
			'/profits?period=365',
			'/profits?period=all'
		]);
		expect(
			links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.dataset.period)
		).toEqual(['90']);
	});

	it("leaves the user's default period out of its link", () => {
		const { container } = render(PeriodSwitch, { period: '90', defaultPeriod: '90' });
		expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
			'/profits?period=7',
			'/profits?period=30',
			'/profits',
			'/profits?period=365',
			'/profits?period=all'
		]);
	});
});

describe('AttentionBar', () => {
	it('links each item to where it is fixed and renders nothing without items', () => {
		const { container } = render(AttentionBar, {
			items: [
				{ kind: 'review', count: 2 },
				{ kind: 'estimates', jobs: 3, share: 0.25 },
				{ kind: 'streams', connections: 1 }
			]
		});
		const href = (kind: string) =>
			container.querySelector(`[data-attention="${kind}"] a`)!.getAttribute('href');
		expect(href('review')).toBe('/profits/ledger?review=1');
		expect(href('estimates')).toBe('/profits/jobs');
		expect(href('streams')).toBe('/account/connections');
		expect(container.querySelector('[data-attention="estimates"]')!.textContent).toContain('25%');
		expect(render(AttentionBar, { items: [] }).container.querySelector('section')).toBeNull();
	});
});

const charts = (over: Partial<Charts> = {}): Charts => ({
	bucket: 'day',
	timeline: [
		{ label: '2026-10-05', realized: 100, cumulative: 100, salesIncome: 300, purchases: 50, jobCosts: 20 },
		{ label: '2026-10-06', realized: -40, cumulative: 60, salesIncome: 0, purchases: 0, jobCosts: 0 }
	],
	reactions: [
		{ blueprintTypeId: 46182, name: 'Titanium Chromide Reaction Formula', realized: 60, unrealized: 30 }
	],
	inputSources: [
		{ kind: 'transaction', cost: 750 },
		{ kind: 'market', cost: 250 }
	],
	...over
});

describe('OverviewCharts', () => {
	it('renders the four charts client-side with their series', async () => {
		const { container } = render(OverviewCharts, { charts: charts(), loadChart });
		await waitFor(() => expect(container.querySelectorAll('[data-chart-stub]')).toHaveLength(4));
		const stub = (key: string) => container.querySelector(`[data-chart="${key}"] [data-chart-stub]`)!;
		const all = (key: string) => JSON.parse(stub(key).getAttribute('data-series-all')!);

		expect(all('profit').map((s: { data: number[] }) => s.data)).toEqual([
			[100, -40],
			[100, 60]
		]);
		expect(JSON.parse(stub('profit').getAttribute('data-categories')!)).toEqual(['2026-10-05', '2026-10-06']);
		expect(all('money').map((s: { data: number[] }) => s.data)).toEqual([
			[300, 0],
			[50, 0],
			[20, 0]
		]);
		expect(all('reactions').map((s: { data: number[] }) => s.data)).toEqual([[60], [30]]);
		expect(all('inputs')).toEqual([750, 250]);
		expect(JSON.parse(stub('inputs').getAttribute('data-labels')!)).toHaveLength(2);
		expect(container.querySelector('[data-slice="market"]')!.textContent).toContain('25%');
		expect(container.querySelector('[data-empty]')).toBeNull();
	});

	it('shows an empty state per chart without data', () => {
		const quiet = charts().timeline.map((p) => ({
			...p,
			realized: 0,
			cumulative: 0,
			salesIncome: 0,
			purchases: 0,
			jobCosts: 0
		}));
		const { container } = render(OverviewCharts, {
			charts: charts({ timeline: quiet, reactions: [], inputSources: [] }),
			loadChart
		});
		expect(
			[...container.querySelectorAll('[data-chart]')].filter((c) => c.querySelector('[data-empty]')).length
		).toBe(4);
		expect(container.querySelector('[data-chart-stub]')).toBeNull();
	});

	it('recolours the charts when the theme is toggled, without a reload', async () => {
		const html = document.documentElement;
		html.classList.add('dark');
		try {
			const { container } = render(OverviewCharts, { charts: charts(), loadChart });
			await waitFor(() => expect(container.querySelectorAll('[data-chart-stub]')).toHaveLength(4));
			const themes = () =>
				[...container.querySelectorAll('[data-chart-stub]')].map((s) => s.getAttribute('data-theme'));
			expect(themes()).toEqual(['dark', 'dark', 'dark', 'dark']);
			// As the theme button does: the class flips in place.
			html.classList.remove('dark');
			await waitFor(() => expect(themes()).toEqual(['light', 'light', 'light', 'light']));
			html.classList.add('dark');
			await waitFor(() => expect(themes()).toEqual(['dark', 'dark', 'dark', 'dark']));
		} finally {
			html.classList.remove('dark');
		}
	});
});

describe('overview tables', () => {
	const sale = (over: Partial<SaleTableRow>): SaleTableRow => ({
		ref: 'transaction:1',
		kind: 'market',
		at: NOW - 3_600_000,
		typeId: 16670,
		name: 'Crystalline Carbonide',
		quantity: 10,
		netUnitPrice: 50,
		unitCost: 20,
		profit: 300,
		untrackedQty: 0,
		origin: 'made',
		...over
	});

	it('sales link the item to its ledger page and say when units had no tracked batch', () => {
		const rows = [
			sale({}),
			sale({
				ref: 'contract:2',
				kind: 'contract',
				unitCost: null,
				profit: null,
				untrackedQty: 10,
				origin: null
			}),
			sale({ ref: 'transaction:3', profit: 100, untrackedQty: 5 })
		];
		const { container } = render(SalesTable, { data: paginate(rows, 1), now: NOW });
		const row = (ref: string) => container.querySelector(`[data-sale="${ref}"]`)!;
		expect(row('transaction:1').querySelector('a')!.getAttribute('href')).toBe('/profits/ledger/16670');
		expect(row('contract:2').querySelectorAll('[data-isk="none"]')).toHaveLength(2);
		expect(row('transaction:3').querySelector('[data-untracked]')!.textContent).toContain('5 of 10');
	});

	it('sales and running jobs say what to do when empty', () => {
		const empty = paginate([], 1);
		expect(
			render(SalesTable, { data: empty, now: NOW }).container.querySelector('[data-empty]')
		).not.toBeNull();
		expect(
			render(RunningTable, { data: empty, now: NOW }).container.querySelector('[data-empty]')
		).not.toBeNull();
	});

	it('reactions show their total cost (inputs and job costs) with the margin over it', () => {
		const row: ReactionTableRow = {
			blueprintTypeId: 46182,
			name: 'Titanium Chromide Reaction Formula',
			jobs: 2,
			runs: 60,
			spent: 4_000_000,
			realized: 500_000,
			expected: 1_000_000,
			unvalued: 0,
			marginPct: 25,
			profitPerSlotDay: 200_000
		};
		const { container } = render(ReactionsTable, { data: paginate([row], 1), period: '30' });
		const tr = container.querySelector('[data-reaction="46182"]')!;
		expect(tr.querySelector('[data-total-cost] [data-isk]')!.getAttribute('data-isk')).toBe('4000000');
		expect([...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())).toContain('25.0%');
	});

	it('running jobs link to the job with a progress bar', () => {
		const job: RunningTableRow = {
			jobId: 7003,
			blueprintTypeId: 46182,
			name: 'Titanium Chromide Reaction Formula',
			runs: 2,
			owner: 'Alpha',
			startDate: NOW - 3_600_000,
			endDate: NOW + 3_600_000,
			output: { typeId: 16654, name: 'Titanium Chromide', quantity: 400 },
			outputValue: 12_000
		};
		const { container } = render(RunningTable, { data: paginate([job], 1), now: NOW });
		const row = container.querySelector('[data-running="7003"]')!;
		expect(row.querySelector('a')!.getAttribute('href')).toBe('/profits/jobs/7003');
		expect(row.querySelector('[data-progress]')!.getAttribute('data-progress')).toBe('50');
		expect(row.querySelector('[data-estimated]')).not.toBeNull();
	});
});
