import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	LedgerFilters,
	LedgerManualRow,
	LedgerPageData,
	LedgerSummary,
	LedgerTradeRow
} from '#lib/ledger/types.js';
import { paginate } from '#lib/paging.js';
import { gotoCalls, resetNavigation } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Page from './+page.svelte';

const AT = Date.UTC(2026, 9, 12, 12);

const trade: LedgerTradeRow = {
	kind: 'market',
	transactionId: 101,
	at: AT,
	owner: { name: 'Alpha', division: null },
	direction: 'bought',
	typeId: 16634,
	name: 'Atmospheric Gases',
	formula: false,
	quantity: 10,
	grossUnitPrice: 95,
	tax: null,
	taxSource: null,
	brokerFee: null,
	brokerFeeSource: null,
	price: {
		kind: 'transaction',
		ref: 'transaction:101',
		unitPrice: 100,
		total: 1000,
		sourceKind: 'market',
		sourceText: 'Market trade',
		needsReview: false,
		correction: null
	}
};

const NO_FILTERS: LedgerFilters = {
	period: null,
	typeId: null,
	direction: null,
	kind: null,
	connection: null,
	review: false
};

const SUMMARY: LedgerSummary = {
	bought: 1_500_000,
	sold: 2_250_000,
	fees: {
		brokerFees: 1000,
		salesTax: 2000,
		contractFees: 500,
		otherMarketFees: 0,
		total: 3500,
		estimated: true
	},
	reviewCount: 4
};

function data(overrides: Partial<LedgerPageData> = {}) {
	const page: LedgerPageData = {
		filters: { ...NO_FILTERS, period: 30, typeId: 16634, direction: 'in', connection: 7 },
		tracked: true,
		summary: SUMMARY,
		rows: { rows: [trade], page: 2, pageCount: 3, total: 25 },
		rebuiltAt: AT,
		dirty: false,
		missingCount: 3,
		types: [
			{ typeId: 16634, name: 'Atmospheric Gases', formula: false },
			{ typeId: 16635, name: 'Evaporite Deposits', formula: false }
		],
		connections: [
			{ sourceId: 7, name: 'Alpha', kind: 'character' },
			{ sourceId: 8, name: 'Moon Corp', kind: 'corporation' }
		],
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, access: 'ok', ...page };
}

const renderPage = (pageData = data(), form: unknown = null) =>
	render(Page, { props: { data: pageData, form, params: {} } as never }).container;

const select = (container: Element, name: string) =>
	[...container.querySelectorAll('select')].find((s) => s.name === name)!;

const URL_NOW =
	'https://reactions.coalition.space/profits/ledger?period=30&type=16634&direction=in&connection=7&page=2';

beforeEach(() => setPage({ url: URL_NOW }));
afterEach(() => {
	resetPage();
	resetNavigation();
	document.head.innerHTML = '';
});

describe('/profits/ledger page', () => {
	it('is a GET filter form preselecting the current filters', () => {
		const container = renderPage();
		const form = container.querySelector('form[data-filters]')!;
		expect(form.getAttribute('method')).toBe('GET');
		expect(form.getAttribute('action')).toBe('/profits/ledger');
		expect(select(container, 'period').value).toBe('30');
		expect(select(container, 'type').value).toBe('16634');
		expect(select(container, 'kind').value).toBe('');
		expect(select(container, 'connection').value).toBe('7');
		const checked = container.querySelector<HTMLInputElement>('input[name="direction"]:checked');
		expect(checked?.value).toBe('in');
		expect(container.querySelector<HTMLInputElement>('input[name="review"]')!.checked).toBe(false);
		expect(container.querySelector('[data-clear]')?.getAttribute('href')).toBe('/profits/ledger');
	});

	it('hides the connection choice with a single connection and the clear link without filters', () => {
		const container = renderPage(
			data({ filters: NO_FILTERS, connections: [{ sourceId: 7, name: 'Alpha', kind: 'character' }] })
		);
		expect(container.querySelector('select[name="connection"]')).toBeNull();
		expect(container.querySelector('[data-clear]')).toBeNull();
		expect(container.querySelector<HTMLInputElement>('input[name="direction"]:checked')?.value).toBe('');
	});

	it('shows the totals, the fee split in a tooltip and an estimate marker', () => {
		const container = renderPage();
		const value = (card: string) =>
			container.querySelector(`[data-card="${card}"] [data-value]`)?.getAttribute('data-value');
		expect([value('bought'), value('sold'), value('fees'), value('review')]).toEqual([
			'1500000',
			'2250000',
			'3500',
			'4'
		]);
		const fees = container.querySelector('[data-card="fees"] [data-value]')!;
		expect(fees.getAttribute('title')?.split('\n')).toHaveLength(3);
		expect(container.querySelector('[data-card="fees"] [data-estimated]')).not.toBeNull();
	});

	it('links the review count to the same filters with the review filter on, back to page 1', () => {
		const container = renderPage();
		const href = container.querySelector('[data-card="review"] [data-review-link]')?.getAttribute('href');
		const url = new URL(href!, 'https://x');
		expect(url.pathname).toBe('/profits/ledger');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			period: '30',
			type: '16634',
			direction: 'in',
			connection: '7',
			review: '1'
		});
	});

	it('offers to show everything again while the review filter is on, and nothing when nothing needs review', () => {
		setPage({ url: 'https://reactions.coalition.space/profits/ledger?review=1' });
		const on = renderPage(data({ filters: { ...NO_FILTERS, review: true } }));
		expect(on.querySelector('[data-review-link]')?.getAttribute('href')).toBe('/profits/ledger');
		document.body.innerHTML = '';
		const none = renderPage(data({ summary: { ...SUMMARY, reviewCount: 0 } }));
		expect(none.querySelector('[data-review-link]')).toBeNull();
	});

	it('pages the table through its JSON endpoint, with links that keep the filters', () => {
		const container = renderPage();
		expect(container.querySelector('table[data-paged="page"]')).not.toBeNull();
		expect(container.querySelector('a[rel="prev"]')?.getAttribute('href')).toBe(
			'/profits/ledger?period=30&type=16634&direction=in&connection=7'
		);
		expect(container.querySelector('a[rel="next"]')?.getAttribute('href')).toBe(
			'/profits/ledger?period=30&type=16634&direction=in&connection=7&page=3'
		);
	});

	it('tells apart nothing tracked yet from nothing matching the filters', () => {
		const filtered = renderPage(data({ rows: paginate([], 1) }));
		expect(filtered.querySelector('[data-empty="filtered"] a')?.getAttribute('href')).toBe('/profits/ledger');
		expect(filtered.querySelector('table')).toBeNull();
		document.body.innerHTML = '';
		const none = renderPage(data({ tracked: false, rows: paginate([], 1), filters: NO_FILTERS }));
		expect(none.querySelector('[data-empty="none"] a')?.getAttribute('href')).toBe('/account/connections');
		expect(none.querySelector('form[data-filters]')).toBeNull();
		expect(none.querySelector('[data-summary]')).toBeNull();
	});

	it('shows the result of a correction: a notice, or one inline alert next to its form keeping the values typed', () => {
		const ok = renderPage(data(), { action: 'correct', ref: 'transaction:101', notice: 'Price corrected.' });
		expect(ok.querySelector('[data-notice="ok"]')?.getAttribute('role')).toBe('status');
		document.body.innerHTML = '';
		const failed = renderPage(data(), {
			action: 'correct',
			ref: 'transaction:101',
			error: 'Nope.',
			values: { unitPrice: '115.5x', note: 'typed' }
		});
		expect(failed.querySelector('[data-notice]')).toBeNull();
		const alerts = failed.querySelectorAll('[role="alert"]');
		expect(alerts).toHaveLength(1);
		const row = failed.querySelector('[data-trade="101"]')!;
		expect(row.contains(alerts[0])).toBe(true);
		expect(row.querySelector<HTMLInputElement>('input[name="unitPrice"]')?.value).toBe('115.5x');
		expect(row.querySelector<HTMLInputElement>('input[name="note"]')?.value).toBe('typed');
		document.body.innerHTML = '';
		const undo = renderPage(data(), { action: 'undo', ref: 'transaction:101', error: 'Nope.' });
		expect(undo.querySelectorAll('[role="alert"]')).toHaveLength(1);
		document.body.innerHTML = '';
		// A price not on this page: the error shows above the table.
		const elsewhere = renderPage(data(), { action: 'correct', ref: 'transaction:999', error: 'Nope.' });
		expect(elsewhere.querySelector('[data-notice="error"]')?.getAttribute('role')).toBe('alert');
	});

	it('shows a corrected price as entered, with its decimals', () => {
		const corrected = {
			...trade,
			price: { ...trade.price, unitPrice: 115.5, correction: { unitPrice: 115.5, note: null } }
		};
		const container = renderPage(data({ rows: paginate([corrected], 1) }));
		expect(container.querySelector('[data-trade="101"] [data-correction]')?.textContent).toContain('115.50');
	});

	it('applies the filters with JS to an address without empty fields', async () => {
		const container = renderPage(data({ filters: NO_FILTERS }));
		const sold = container.querySelector<HTMLInputElement>('input[name="direction"][value="out"]')!;
		sold.checked = true;
		await fireEvent.change(sold);
		expect(gotoCalls.map((c) => c.url)).toEqual(['/profits/ledger?direction=out']);
	});

	it('links to "Add purchases" and "Missing prices (N)"', () => {
		const container = renderPage();
		expect(container.querySelector('[data-add-purchases]')?.getAttribute('href')).toBe('/profits/ledger/add');
		const missing = container.querySelector('[data-missing-prices]')!;
		expect(missing.getAttribute('href')).toBe('/profits/ledger/reconcile');
		expect(missing.textContent?.trim()).toBe('Missing prices (3)');
	});

	it('shows a purchase the user entered as bought, with its badge and a link to manage it on the add page', () => {
		const manual: LedgerManualRow = {
			kind: 'manual',
			entryId: 9,
			at: AT,
			typeId: 16634,
			name: 'Atmospheric Gases',
			formula: false,
			quantity: 4,
			unitPrice: 25,
			total: 100,
			note: 'From a friend'
		};
		const container = renderPage(data({ rows: paginate([manual], 1) }));
		const row = container.querySelector('[data-manual="9"]')!;
		expect(row.querySelector('[data-direction]')?.textContent?.trim()).toBe('Bought');
		expect(row.querySelector('[data-source] [data-pill]')?.textContent).toContain('Entered by you');
		expect(row.querySelector('[data-source-text]')?.textContent).toContain('From a friend');
		expect(row.querySelector('[data-manual-manage]')?.getAttribute('href')).toBe('/profits/ledger/add');
		expect(row.querySelector('[data-item="16634"]')?.getAttribute('href')).toBe('/profits/ledger/16634');
	});

	it('offers the "Entered by you" kind filter', () => {
		const container = renderPage(data({ filters: { ...NO_FILTERS, kind: 'manual' } }));
		expect(select(container, 'kind').value).toBe('manual');
	});
});
