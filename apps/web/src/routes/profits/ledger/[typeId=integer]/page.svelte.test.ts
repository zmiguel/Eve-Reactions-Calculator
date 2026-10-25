import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LedgerItemLot, LedgerItemPageData, LedgerItemTrade } from '$lib/ledger/types';
import { paginate } from '$lib/paging';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import Page from './+page.svelte';

const TYPE = 16634;
const NOW = Date.UTC(2026, 9, 12, 12);
const HOUR = 3_600_000;

function lot(lotId: number, overrides: Partial<LedgerItemLot> = {}): LedgerItemLot {
	return {
		lotId,
		acquiredAt: NOW - lotId * HOUR,
		origin: 'transaction',
		jobId: null,
		jobFormula: null,
		fuelBlockJob: false,
		priceSource: `Source ${lotId}`,
		quantity: 10,
		remaining: 5,
		unitCost: 100,
		correctionRef: null,
		corrected: false,
		uses: [],
		...overrides
	};
}

const sale: LedgerItemTrade = {
	ref: 'transaction:902',
	kind: 'market',
	direction: 'out',
	at: NOW - HOUR,
	quantity: 10,
	unitPrice: 14.5,
	sourceKind: 'market',
	sourceText: 'Market sale',
	needsReview: false,
	estimatedFees: true
};

const LOTS = [
	lot(1, {
		uses: [
			{
				kind: 'job',
				ref: 'job:7001',
				jobId: 7001,
				formula: { blueprintTypeId: 46166, name: 'Caesarium Cadmide Reaction Formula' },
				at: NOW - HOUR,
				saleUnitPrice: null,
				product: null,
				unitValue: null,
				quantity: 3,
				unitCost: 100
			},
			{
				kind: 'sale',
				ref: 'transaction:902',
				jobId: null,
				formula: null,
				at: NOW - HOUR,
				saleUnitPrice: 14.5,
				product: null,
				unitValue: null,
				quantity: 2,
				unitCost: 100
			}
		]
	}),
	lot(2, { origin: 'contract' }),
	lot(3, { origin: 'job', jobId: 7, jobFormula: 'Caesarium Cadmide Reaction Formula' }),
	lot(4, { origin: 'market', jobId: 11, remaining: 0, correctionRef: `job:11:${TYPE}` }),
	lot(5, { origin: 'correction', jobId: 12, remaining: 0, correctionRef: `job:12:${TYPE}`, corrected: true })
];

function data(overrides: Partial<LedgerItemPageData> = {}) {
	const page: LedgerItemPageData = {
		item: { typeId: TYPE, name: 'Atmospheric Gases', formula: false },
		heldQuantity: 15,
		averagePaid: 100,
		unitValue: 80,
		gain: -300,
		// The chart has its own test (`BatchChart.svelte.test.ts`): no points here keeps ApexCharts out of jsdom.
		points: [],
		batches: paginate(LOTS, 1),
		trades: paginate([sale], 1),
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, access: 'ok', ...page };
}

const renderPage = (pageData = data(), form: unknown = null) =>
	render(Page, { props: { data: pageData, form, params: { typeId: String(TYPE) } } as never }).container;

beforeEach(() => setPage({ url: `https://reactions.coalition.space/profits/ledger/${TYPE}?trades=1` }));
afterEach(() => {
	resetPage();
	document.head.innerHTML = '';
});

describe('/profits/ledger/[typeId] page', () => {
	it('shows what is held, the average paid, the value today and the loss, both marked as estimates', () => {
		const container = renderPage();
		expect(container.querySelector('[data-back]')?.getAttribute('href')).toBe('/profits/ledger');
		expect(container.querySelector('[data-card="held"] [data-value]')?.getAttribute('data-value')).toBe('15');
		const isk = (card: string) => container.querySelector(`[data-card="${card}"] [data-isk]`);
		expect(isk('average')?.getAttribute('data-isk')).toBe('100');
		expect(isk('value')?.getAttribute('data-isk')).toBe('80');
		expect(isk('gain')?.getAttribute('data-isk')).toBe('-300');
		expect(isk('gain')?.className).toContain('text-red');
		expect(container.querySelector('[data-card="value"] [data-estimated]')).not.toBeNull();
		expect(container.querySelector('[data-card="gain"] [data-estimated]')).not.toBeNull();
	});

	it('shows a gain in green and dashes when there is nothing to value', () => {
		const gain = renderPage(data({ gain: 250 }));
		expect(gain.querySelector('[data-card="gain"] [data-isk]')?.className).toContain('text-green');
		document.body.innerHTML = '';
		const none = renderPage(data({ heldQuantity: 0, averagePaid: null, unitValue: null, gain: null }));
		for (const card of ['average', 'value', 'gain']) {
			expect(none.querySelector(`[data-card="${card}"] [data-isk]`)?.getAttribute('data-isk')).toBe('none');
		}
	});

	it('words where each batch came from, linking the jobs by formula without their ids', () => {
		const container = renderPage();
		const origin = (lotId: number) => container.querySelector(`[data-lot="${lotId}"] [data-origin]`)!;
		const text = (lotId: number) => origin(lotId).textContent?.replace(/\s+/g, ' ').trim();
		expect(text(1)).toBe('Bought on the market');
		expect(text(2)).toBe('Bought by contract');
		expect(origin(3).querySelector('[data-job-link]')?.getAttribute('href')).toBe('/profits/jobs/7');
		expect(text(3)).toBe('Made by job Caesarium Cadmide Reaction Formula');
		expect(origin(4).querySelector('[data-job-link]')?.getAttribute('href')).toBe('/profits/jobs/11');
		expect(text(4)).toBe('Market estimate for Unknown formula');
		expect(text(5)).toBe('Your correction for Unknown formula');
		// Only the market estimate's unit cost is an estimate.
		expect(container.querySelectorAll('[data-lot] [data-estimated]')).toHaveLength(1);
		expect(container.querySelector('[data-lot="4"] [data-estimated]')).not.toBeNull();
	});

	it('tells a batch built in a fuel block job from reaction output, linking that job by its blueprint', () => {
		const built = lot(6, {
			origin: 'job',
			jobId: 8101,
			jobFormula: 'Nitrogen Fuel Block Blueprint',
			fuelBlockJob: true
		});
		const container = renderPage(data({ batches: paginate([built, LOTS[2]], 1) }));
		const origin = (lotId: number) => container.querySelector(`[data-lot="${lotId}"] [data-origin]`)!;
		expect(origin(6).hasAttribute('data-fuel-block-job')).toBe(true);
		expect(origin(3).hasAttribute('data-fuel-block-job')).toBe(false);
		expect(origin(6).querySelector('[data-job-link]')?.getAttribute('href')).toBe('/profits/jobs/8101');
		expect(origin(6).querySelector('[data-job-link]')?.textContent).toBe('Nitrogen Fuel Block Blueprint');
		expect(origin(6).textContent).not.toContain('8101');
		// Worded apart from a reaction job's batch.
		const words = (lotId: number) => origin(lotId).firstChild?.textContent?.trim();
		expect(words(6)).not.toBe(words(3));
		expect(container.querySelector('[data-lot="6"] [data-estimated]')).toBeNull();
	});

	it('lists where a batch went: jobs linked with their formula, sales with their price', () => {
		const container = renderPage();
		const uses = container.querySelector<HTMLDetailsElement>('[data-uses="1"]')!;
		expect(uses.open).toBe(false);
		expect(uses.querySelector('[data-use="job:7001"] a')?.getAttribute('href')).toBe('/profits/jobs/7001');
		expect(uses.querySelector('[data-use="job:7001"]')?.textContent).toContain('Caesarium Cadmide');
		expect(uses.querySelector('[data-use="job:7001"]')?.textContent).not.toContain('7001');
		expect(uses.querySelector('[data-use="transaction:902"] [data-isk]')?.getAttribute('data-isk')).toBe(
			'14.5'
		);
		expect(container.querySelector('[data-uses="2"]')).toBeNull();
	});

	it('offers Correct on market estimates and Undo on corrected batches, keeping the table pages', () => {
		const container = renderPage();
		const forms = (lotId: number) =>
			container.querySelectorAll<HTMLFormElement>(`[data-lot="${lotId}"] form`);
		expect(forms(1)).toHaveLength(0);
		expect(forms(3)).toHaveLength(0);
		const [correct] = forms(4);
		expect(correct.getAttribute('action')).toBe('?/correct&trades=1');
		expect(Object.fromEntries([...new FormData(correct)].map(([k, v]) => [k, String(v)]))).toMatchObject({
			kind: 'job_input',
			ref: `job:11:${TYPE}`
		});
		expect(container.querySelector(`[data-lot="4"] form[data-undo]`)).toBeNull();
		const undo = container.querySelector<HTMLFormElement>(`[data-lot="5"] form[data-undo]`)!;
		expect(undo.getAttribute('action')).toBe('?/undo&trades=1');
	});

	it('pages both tables through their endpoints', () => {
		const container = renderPage();
		expect(container.querySelector('table[data-paged="batches"]')).not.toBeNull();
		expect(container.querySelector('table[data-paged="trades"]')).not.toBeNull();
	});

	it('lists purchases and sales with a link to the ledger filtered by the item', () => {
		const container = renderPage();
		expect(container.querySelector('[data-ledger-link]')?.getAttribute('href')).toBe(
			`/profits/ledger?type=${TYPE}`
		);
		const row = container.querySelector('[data-trade="transaction:902"]')!;
		expect(row.querySelector('[data-pill]')?.textContent).toBe('Sold');
		expect(row.querySelector('[data-estimated]')).not.toBeNull();
		expect(row.querySelector('[data-source] [data-pill]')?.textContent).toBe('Estimated fees');
	});

	it('lists a trade of an untracked item with its badge and no price', () => {
		const untracked: LedgerItemTrade = {
			...sale,
			ref: 'transaction:903',
			sourceKind: 'untracked',
			sourceText: 'Not tracked'
		};
		const container = renderPage(data({ trades: paginate([untracked], 1) }));
		const row = container.querySelector('[data-trade="transaction:903"]')!;
		expect(row.hasAttribute('data-untracked')).toBe(true);
		expect(row.querySelector('[data-source]')?.getAttribute('data-source')).toBe('untracked');
		expect(row.querySelectorAll('[data-isk="none"]')).toHaveLength(2);
		expect(row.querySelector('[data-estimated]')).toBeNull();
	});

	it('says what to do when nothing of the item is tracked, without tables or chart', () => {
		const container = renderPage(
			data({
				heldQuantity: 0,
				averagePaid: null,
				unitValue: 80,
				gain: null,
				points: [],
				batches: paginate([], 1),
				trades: paginate([], 1)
			})
		);
		expect(container.querySelector('[data-empty] a')?.getAttribute('href')).toBe('/profits/ledger');
		expect(container.querySelector('table')).toBeNull();
		expect(container.querySelector('[data-chart]')).toBeNull();
	});

	it('shows a rejected correction once, next to its form', () => {
		const container = renderPage(data(), { action: 'correct', ref: `job:11:${TYPE}`, error: 'Bad price.' });
		expect(container.querySelector('[data-notice]')).toBeNull();
		const alerts = container.querySelectorAll('[role="alert"]');
		expect(alerts).toHaveLength(1);
		expect(container.querySelector('[data-lot="4"]')?.contains(alerts[0])).toBe(true);
		expect(container.querySelector<HTMLDetailsElement>('[data-lot="4"] [data-correct]')?.open).toBe(true);
	});

	it('without purchases or sales, says where the batches on the page come from', () => {
		const corrections = renderPage(
			data({ batches: paginate([LOTS[4], LOTS[2]], 1), trades: paginate([], 1) })
		);
		expect(corrections.querySelector('[data-empty="trades"]')?.getAttribute('data-batches-from')).toBe(
			'job correction'
		);
		document.body.innerHTML = '';
		const ownJobs = renderPage(data({ batches: paginate([LOTS[2]], 1), trades: paginate([], 1) }));
		expect(ownJobs.querySelector('[data-empty="trades"]')?.getAttribute('data-batches-from')).toBe('job');
	});

	it('words a batch entered by the user and uses by manufacturing jobs', () => {
		const manufacturing = {
			kind: 'manufacturing' as const,
			jobId: 8001,
			formula: null,
			at: NOW - HOUR,
			saleUnitPrice: null,
			quantity: 4,
			unitCost: 100
		};
		const entered = lot(6, {
			origin: 'manual',
			uses: [
				{
					...manufacturing,
					ref: 'job:8001',
					product: { typeId: 11535, name: 'Hypersynaptic Fibers' },
					unitValue: 130
				},
				{ ...manufacturing, ref: 'job:8002', jobId: 8002, product: null, unitValue: 100 }
			]
		});
		const container = renderPage(data({ batches: paginate([entered], 1) }));
		expect(container.querySelector('[data-lot="6"] [data-origin]')?.textContent?.trim()).toBe(
			'Entered by you'
		);
		expect(container.querySelector('[data-lot="6"] [data-correction-for]')).toBeNull();
		const used = (jobId: number) => container.querySelector(`[data-manufacturing="${jobId}"]`)?.textContent;
		expect(used(8001)?.trim()).toBe('Used to manufacture Hypersynaptic Fibers');
		expect(used(8002)?.trim()).toBe('Used in manufacturing');
		// No EVE job ids in the text: the date says which job it was.
		expect(container.querySelector('[data-lot="6"]')?.textContent).not.toMatch(/800[12]/);
		expect(container.querySelector('[data-use="job:8001"] [data-isk="130"]')).not.toBeNull();
	});

	it('words materials manufacturing jobs consumed, with the units and no value', () => {
		const consumed = {
			kind: 'consumed' as const,
			formula: null,
			at: NOW - HOUR,
			saleUnitPrice: null,
			unitValue: null,
			quantity: 368,
			unitCost: 100
		};
		const bought = lot(7, {
			quantity: 1000,
			remaining: 632,
			uses: [
				{
					...consumed,
					ref: 'job:8101',
					jobId: 8101,
					product: { typeId: 21037, name: 'Capital Construction Parts' }
				},
				{ ...consumed, ref: 'job:8102', jobId: 8102, product: null }
			]
		});
		const container = renderPage(data({ batches: paginate([bought], 1) }));
		const used = (jobId: number) => container.querySelector(`[data-consumed="${jobId}"]`)?.textContent;
		expect(used(8101)?.trim()).toBe('Used in manufacturing: Capital Construction Parts');
		expect(used(8102)?.trim()).toBe('Used in a manufacturing job');
		const use = container.querySelector('[data-use="job:8101"]')!;
		expect(use.textContent).toContain('368 units');
		expect(use.querySelector('[data-isk]')).toBeNull();
		expect(container.querySelector('[data-lot="7"]')?.textContent).not.toMatch(/810[12]/);
	});
});
