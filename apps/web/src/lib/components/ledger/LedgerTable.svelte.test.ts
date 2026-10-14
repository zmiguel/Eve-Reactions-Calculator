import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	LedgerActionResult,
	LedgerContractRow,
	LedgerPriceView,
	LedgerRow,
	LedgerTradeRow
} from '$lib/ledger/types';
import { paginate } from '$lib/paging';
import { resetPage, setPage } from '../../../test/shims/app/state';
import LedgerTable from './LedgerTable.svelte';
import PriceSource from './PriceSource.svelte';

const AT = Date.UTC(2026, 9, 12, 12);

const price = (ref: string, overrides: Partial<LedgerPriceView> = {}): LedgerPriceView => ({
	kind: ref.startsWith('transaction:') ? 'transaction' : 'contract_item',
	ref,
	unitPrice: 100,
	total: 1000,
	sourceKind: 'market',
	sourceText: 'Market trade',
	needsReview: false,
	correction: null,
	...overrides
});

const trade = (id: number, overrides: Partial<LedgerTradeRow> = {}): LedgerTradeRow => ({
	kind: 'market',
	transactionId: id,
	at: AT,
	owner: { name: 'Alpha', division: null },
	direction: 'bought',
	typeId: 16634,
	name: 'Atmospheric Gases',
	formula: false,
	quantity: 10,
	grossUnitPrice: 95,
	tax: 0,
	taxSource: 'none',
	brokerFee: 50,
	brokerFeeSource: 'journal',
	price: price(`transaction:${id}`),
	...overrides
});

const contract = (overrides: Partial<LedgerContractRow> = {}): LedgerContractRow => ({
	kind: 'contract',
	contractId: 201,
	at: AT,
	owner: { name: 'Moon Corp', division: null },
	direction: 'buy',
	title: 'Moon goo',
	janiceCode: 'AbC',
	total: 1_000_000,
	itemCount: 2,
	needsReview: true,
	items: [
		{
			typeId: 16634,
			name: 'Atmospheric Gases',
			formula: false,
			quantity: 100,
			incoming: true,
			price: price('contract:201:16634', { sourceKind: 'janice', sourceText: 'Janice appraisal AbC' })
		},
		{
			typeId: 16635,
			name: 'Evaporite Deposits',
			formula: false,
			quantity: 50,
			incoming: true,
			price: price('contract:201:16635', {
				sourceKind: 'review',
				sourceText: 'No reference price',
				needsReview: true,
				correction: { unitPrice: 8000, note: 'Agreed' }
			})
		}
	],
	...overrides
});

const transfer = contract({
	contractId: 202,
	direction: 'transfer',
	title: null,
	janiceCode: null,
	itemCount: 1,
	needsReview: false,
	items: [
		{ typeId: 16634, name: 'Atmospheric Gases', formula: false, quantity: 5, incoming: null, price: null }
	]
});

const renderTable = (rows: LedgerRow[], form: LedgerActionResult | null = null) =>
	render(LedgerTable, { data: paginate(rows, 1), form }).container;

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/profits/ledger?type=16634&page=2' }));
afterEach(() => resetPage());

describe('PriceSource', () => {
	it.each([
		['market', false, false, 'Market'],
		['market', false, true, 'Estimated fees'],
		['contract_single', false, false, 'Contract'],
		['janice', false, false, 'Janice'],
		['rule_match', false, false, 'Price rule'],
		['rule_outside', true, false, 'Price rule: check'],
		['review', true, false, 'Needs review'],
		['janice', true, false, 'Needs review'],
		['correction', false, false, 'Your correction'],
		['correction', true, false, 'Your correction'],
		['market_fallback', false, false, 'Market estimate']
	])(
		'%s (review %s, estimated fees %s) shows "%s" and the full text',
		(kind, needsReview, estimatedFees, label) => {
			const { container } = render(PriceSource, {
				kind,
				needsReview,
				estimatedFees,
				text: 'Full source text'
			});
			expect(container.querySelector('summary [data-pill]')?.textContent).toBe(label);
			expect(container.querySelector('details')?.open).toBe(false);
			expect(container.querySelector('[data-source-text]')?.textContent).toBe('Full source text');
		}
	);

	it('gives each kind of attention its own color: review amber, correction purple, plain gray', () => {
		const tone = (kind: string, needsReview = false) =>
			render(PriceSource, { kind, needsReview, text: 'x' })
				.container.querySelector('[data-pill]')
				?.getAttribute('data-pill');
		expect([tone('review', true), tone('correction'), tone('market'), tone('janice')]).toEqual([
			'amber',
			'purple',
			'gray',
			'blue'
		]);
	});
});

describe('LedgerTable', () => {
	it('links items to their page and shows the direction, owner and date', () => {
		const container = renderTable([trade(101, { owner: { name: 'Moon Corp', division: 'Industry' } })]);
		const row = container.querySelector('[data-trade="101"]')!;
		expect(row.querySelector('[data-item]')?.getAttribute('href')).toBe('/profits/ledger/16634');
		expect(row.querySelector('[data-direction] [data-pill]')?.textContent).toBe('Bought');
		expect(row.textContent).toContain('Moon Corp · Industry');
		expect(row.querySelector('[data-date]')?.getAttribute('title')).toBe('2026-10-12 12:00 UTC');
	});

	it('explains a trade price: gross price and fees in the title, fee lines in the source', () => {
		const sale = trade(102, {
			direction: 'sold',
			tax: 30,
			taxSource: 'estimated',
			brokerFee: 0,
			brokerFeeSource: 'none'
		});
		const row = renderTable([sale]).querySelector('[data-trade="102"]')!;
		const title = row.querySelector('[data-unit-price]')?.getAttribute('title') ?? '';
		expect(title).toContain('95.00 ISK');
		expect(title).toContain('30.00 ISK');
		expect(row.querySelectorAll('[data-source-line]')).toHaveLength(2);
		// The estimated sales tax marks the unit price and the badge.
		expect(row.querySelector('[data-estimated]')).not.toBeNull();
		expect(row.querySelector('[data-source] [data-pill]')?.textContent).toBe('Estimated fees');
	});

	it('has no sales tax line on purchases and no estimate marker when fees come from the journal', () => {
		const row = renderTable([trade(101)]).querySelector('[data-trade="101"]')!;
		expect(row.querySelectorAll('[data-source-line]')).toHaveLength(1);
		expect(row.querySelector('[data-estimated]')).toBeNull();
	});

	it('offers a correction form that works without JS and keeps the filters and page', () => {
		const row = renderTable([trade(101)]).querySelector('[data-trade="101"]')!;
		const form = row.querySelector<HTMLFormElement>('[data-correct] form')!;
		expect(form.method).toBe('post');
		expect(form.getAttribute('action')).toBe('?/correct&type=16634&page=2');
		const fields = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));
		expect(fields).toEqual({ kind: 'transaction', ref: 'transaction:101', unitPrice: '', note: '' });
		expect(row.querySelector('[data-undo]')).toBeNull();
	});

	it('offers Undo for a corrected price and prefills the form with it', () => {
		const corrected = trade(101, {
			price: price('transaction:101', {
				sourceKind: 'correction',
				correction: { unitPrice: 90, note: 'Cash' }
			})
		});
		const row = renderTable([corrected]).querySelector('[data-trade="101"]')!;
		const undo = row.querySelector<HTMLFormElement>('form[data-undo]')!;
		expect(undo.getAttribute('action')).toBe('?/undo&type=16634&page=2');
		expect(row.querySelector<HTMLInputElement>('input[name="unitPrice"]')?.value).toBe('90');
		expect(row.querySelector<HTMLInputElement>('input[name="note"]')?.value).toBe('Cash');
	});

	it('does not offer corrections on transfer trades', () => {
		const row = renderTable([trade(103, { direction: 'transfer' })]).querySelector('[data-trade="103"]')!;
		expect(row.querySelector('form')).toBeNull();
		expect(row.querySelector('[data-direction] [data-pill]')?.textContent).toBe('Transfer');
	});

	it('shows a contract as one row with its item count, title and Janice link, items folded below', () => {
		const container = renderTable([contract()]);
		const row = container.querySelector('[data-contract="201"]')!;
		expect(row.querySelector('[data-contract-label]')?.textContent).toBe('Contract · 2 items');
		expect(row.querySelector('[data-title]')?.textContent).toBe('Moon goo');
		expect(row.querySelector('[data-janice]')?.getAttribute('href')).toBe('https://janice.e-351.com/a/AbC');
		expect(row.querySelector('[data-source] [data-pill]')?.textContent).toBe('Needs review');

		const items = container.querySelector<HTMLDetailsElement>('[data-contract-items="201"] details')!;
		expect(items.open).toBe(false);
		const lines = [...items.querySelectorAll('[data-contract-item]')];
		expect(lines.map((l) => l.querySelector('[data-item]')?.getAttribute('href'))).toEqual([
			'/profits/ledger/16634',
			'/profits/ledger/16635'
		]);
		expect(lines.map((l) => l.querySelector('[data-source] [data-pill]')?.textContent)).toEqual([
			'Janice',
			'Needs review'
		]);
		// Each priced item has its own correction form; the corrected one also Undo.
		expect(lines.map((l) => l.querySelector<HTMLInputElement>('input[name="ref"]')?.value)).toEqual([
			'contract:201:16634',
			'contract:201:16635'
		]);
		expect(lines.map((l) => l.querySelector('form[data-undo]') !== null)).toEqual([false, true]);
	});

	it('opens the items and the form of a rejected item correction, with its error', () => {
		const container = renderTable([contract()], {
			action: 'correct',
			ref: 'contract:201:16635',
			error: 'Enter a unit price of 0 ISK or more.'
		});
		expect(container.querySelector<HTMLDetailsElement>('[data-contract-items="201"] details')?.open).toBe(
			true
		);
		const line = container.querySelector('[data-contract-item="16635"]')!;
		expect(line.querySelector<HTMLDetailsElement>('[data-correct]')?.open).toBe(true);
		expect(line.querySelector('[data-form-error]')?.textContent).toBe('Enter a unit price of 0 ISK or more.');
		expect(
			container.querySelector<HTMLDetailsElement>('[data-contract-item="16634"] [data-correct]')?.open
		).toBe(false);
	});

	it('shows transfer contracts without prices or forms', () => {
		const container = renderTable([transfer]);
		expect(container.querySelector('[data-contract="202"] [data-direction] [data-pill]')?.textContent).toBe(
			'Transfer'
		);
		expect(container.querySelector('[data-contract-items="202"] form')).toBeNull();
	});
});
