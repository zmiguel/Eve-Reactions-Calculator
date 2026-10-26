import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManualActionResult, ManualAddPageData, ManualEntryView } from '#lib/ledger/types.js';
import { paginate } from '#lib/paging.js';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import Page from './+page.svelte';

const AT = Date.UTC(2026, 9, 1, 12);

const entry = (entryId: number, overrides: Partial<ManualEntryView> = {}): ManualEntryView => ({
	entryId,
	at: AT,
	typeId: 16634,
	name: 'Atmospheric Gases',
	formula: false,
	quantity: 10,
	unitPrice: 25,
	total: 250,
	note: null,
	remaining: 6,
	...overrides
});

function data(overrides: Partial<ManualAddPageData> = {}) {
	const page: ManualAddPageData = {
		choices: [
			{ typeId: 16634, name: 'Atmospheric Gases', group: 'material' },
			{ typeId: 16635, name: 'Evaporite Deposits', group: 'material' },
			{ typeId: 16663, name: 'Caesarium Cadmide', group: 'product' },
			{ typeId: 34, name: 'Tritanium', group: 'other' }
		],
		today: '2026-10-06',
		entries: paginate([entry(1, { note: 'From a friend' }), entry(2, { remaining: null })], 1),
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, access: 'ok', ...page };
}

const renderPage = (pageData = data(), form: ManualActionResult | null = null) =>
	render(Page, { props: { data: pageData, form, params: {} } as never }).container;

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/profits/ledger/add?page=1' }));
afterEach(() => {
	resetPage();
	document.head.innerHTML = '';
});

describe('/profits/ledger/add page', () => {
	it('explains how purchases work and links back to the ledger', () => {
		const container = renderPage();
		expect(container.querySelector('[data-back]')?.getAttribute('href')).toBe('/profits/ledger');
		expect(container.textContent).toContain('jobs started after its date use it');
	});

	it('posts one purchase as a plain form: item text, hidden type, date defaulting to today', () => {
		const container = renderPage();
		const form = container.querySelector<HTMLFormElement>('form[data-add-form]')!;
		expect(form.getAttribute('method')).toBe('POST');
		expect(form.getAttribute('action')).toBe('?/add');
		const item = form.querySelector<HTMLInputElement>('input[name="item"]')!;
		expect(item.type).toBe('text');
		expect(item.required).toBe(true);
		expect(form.querySelector<HTMLInputElement>('input[name="typeId"]')?.value).toBe('');
		const date = form.querySelector<HTMLInputElement>('input[name="date"]')!;
		expect([date.value, date.max]).toEqual(['2026-10-06', '2026-10-06']);
		for (const name of ['quantity', 'unitPrice', 'note'])
			expect(form.querySelector(`[name="${name}"]`)).not.toBeNull();
		expect(form.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('+ Add');
	});

	it('suggests items as the visitor types and fills the hidden type when one is picked', async () => {
		const container = renderPage();
		const item = container.querySelector<HTMLInputElement>('input[name="item"]')!;
		await fireEvent.input(item, { target: { value: 'ga' } });
		const options = [...container.querySelectorAll('[role="option"]')];
		expect(options.map((o) => o.getAttribute('data-choice'))).toEqual(['16634']);
		await fireEvent.input(item, { target: { value: 'ca' } });
		expect(
			[...container.querySelectorAll('[role="option"]')].map((o) => o.getAttribute('data-choice'))
		).toEqual(['16663']);
		await fireEvent.mouseDown(container.querySelector('[data-choice="16663"]')!);
		expect(item.value).toBe('Caesarium Cadmide');
		expect(container.querySelector<HTMLInputElement>('input[name="typeId"]')?.value).toBe('16663');
		// Typing something else drops the picked type: the server matches the text instead.
		await fireEvent.input(item, { target: { value: 'Caesarium' } });
		expect(container.querySelector<HTMLInputElement>('input[name="typeId"]')?.value).toBe('');
	});

	it('keeps the values and shows the error of a rejected purchase', () => {
		const values = {
			item: 'Nope',
			typeId: '',
			date: '2026-10-02',
			quantity: '5',
			unitPrice: '1',
			note: 'n'
		};
		const container = renderPage(data(), { action: 'add', error: 'Pick an item from the list.', values });
		expect(container.querySelector('[data-add-error]')?.textContent).toBe('Pick an item from the list.');
		expect(container.querySelector<HTMLInputElement>('input[name="item"]')?.value).toBe('Nope');
		expect(container.querySelector<HTMLInputElement>('input[name="date"]')?.value).toBe('2026-10-02');
		expect(container.querySelector<HTMLInputElement>('input[name="quantity"]')?.value).toBe('5');
		expect(container.querySelector('[data-notice]')).toBeNull();
	});

	it('explains the import format with an example and checks it first', () => {
		const container = renderPage();
		const check = container.querySelector<HTMLFormElement>('[data-import] form[action="?/check"]')!;
		expect(check.querySelector('textarea[name="text"]')).not.toBeNull();
		expect(container.querySelector('[data-example]')?.textContent).toContain(
			'2026-10-01 Neodymium 10,000 1,250.50'
		);
		expect(container.querySelector('[data-preview]')).toBeNull();
	});

	it('previews a checked import with its errors and offers to add the readable lines', () => {
		const text = '2026-10-01 Atmospheric Gases 10 5\nnope';
		const container = renderPage(data(), {
			action: 'check',
			text,
			preview: {
				rows: [
					{
						line: 1,
						at: Date.UTC(2026, 9, 1),
						typeId: 16634,
						name: 'Atmospheric Gases',
						quantity: 10,
						unitPrice: 5
					}
				],
				errors: [{ line: 2, message: 'Expected a date, an item, a quantity and a unit price.' }]
			}
		});
		expect(container.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe(text);
		expect(container.querySelector('[data-preview-row="1"]')?.textContent).toContain('Atmospheric Gases');
		expect(container.querySelector('[data-error-line="2"]')?.textContent).toBe(
			'Line 2: Expected a date, an item, a quantity and a unit price.'
		);
		const add = container.querySelector<HTMLFormElement>('form[action="?/import"]')!;
		expect(add.querySelector<HTMLInputElement>('input[name="text"]')?.value).toBe(text);
		const button = add.querySelector<HTMLButtonElement>('[data-import-submit]')!;
		expect(button.textContent?.trim()).toBe('Add 1 purchase');
		expect(button.disabled).toBe(false);
	});

	it('cannot add an import with no readable line', () => {
		const container = renderPage(data(), {
			action: 'check',
			text: 'nope',
			preview: { rows: [], errors: [{ line: 1, message: 'Bad.' }] }
		});
		expect(container.querySelector<HTMLButtonElement>('[data-import-submit]')?.disabled).toBe(true);
	});

	it('lists the purchases with what is left and a Delete form keeping the page', () => {
		const container = renderPage();
		expect(container.querySelector('table[data-paged="page"]')).not.toBeNull();
		const first = container.querySelector('[data-entry="1"]')!;
		expect(first.querySelector('[data-left]')?.textContent?.trim()).toBe('6');
		expect(first.textContent).toContain('From a friend');
		expect(container.querySelector('[data-entry="2"] [data-left]')?.textContent?.trim()).toBe(
			'Not calculated yet'
		);
		const form = first.querySelector('form')!;
		expect(form.getAttribute('action')).toBe('?/remove&page=1');
		expect(form.querySelector<HTMLInputElement>('input[name="entryId"]')?.value).toBe('1');
		expect(form.querySelector('[data-delete="1"]')?.textContent?.trim()).toBe('Delete');
	});

	it('says when there are no purchases yet, and shows notices', () => {
		const container = renderPage(data({ entries: paginate([], 1) }), {
			action: 'remove',
			entryId: 3,
			notice: 'Purchase deleted. Results recalculated.'
		});
		expect(container.querySelector('[data-empty="entries"]')).not.toBeNull();
		expect(container.querySelector('[data-notice="ok"]')?.textContent?.trim()).toBe(
			'Purchase deleted. Results recalculated.'
		);
	});
});
