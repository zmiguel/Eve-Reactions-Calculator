import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	ReconcileActionResult,
	ReconcileContractRow,
	ReconcileInputRow,
	ReconcilePageData
} from '#lib/ledger/types.js';
import { paginate } from '#lib/paging.js';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import Page from './+page.svelte';

const AT = Date.UTC(2026, 9, 6, 9);
const X = { typeId: 16634, name: 'Atmospheric Gases', formula: false };
const Y = { typeId: 16635, name: 'Evaporite Deposits', formula: false };

const input = (ref: string, overrides: Partial<ReconcileInputRow> = {}): ReconcileInputRow => ({
	ref,
	item: X,
	first: false,
	itemRows: 2,
	itemQuantity: 40,
	itemConfirmable: 2,
	jobId: Number(ref.split(':')[1]),
	formula: { blueprintTypeId: 46166, name: 'Caesarium Cadmide Reaction Formula' },
	startedAt: AT,
	quantity: 30,
	estimate: 15,
	estimateText: 'No purchase found: buy value at job start (Jita 4-4 buy)',
	saved: null,
	...overrides
});

const contract: ReconcileContractRow = {
	ref: 'contract:21:16634',
	item: X,
	contractId: 21,
	at: AT,
	title: 'Moon goo',
	incoming: true,
	quantity: 40,
	unitPrice: 12,
	sourceText: 'Outside your rule (140.0% of Jita 4-4 buy): check',
	saved: null
};

const INPUTS = [
	input('job:31:16634', { first: true }),
	input('job:32:16634', { saved: { unitPrice: 16, note: null } }),
	input('job:31:16635', {
		item: Y,
		first: true,
		itemRows: 1,
		itemQuantity: 20,
		itemConfirmable: 0,
		estimate: null,
		estimateText: 'No purchase found and no buy value at job start (2026-10-06 09:00 UTC)'
	})
];

function data(overrides: Partial<ReconcilePageData> = {}) {
	const page: ReconcilePageData = {
		counts: { estimated: 1, unpriced: 1, items: 2, contracts: 1, total: 3 },
		inputs: paginate(INPUTS, 1),
		contracts: paginate([contract], 1),
		dirty: false,
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, access: 'ok', ...page };
}

const renderPage = (pageData = data(), form: ReconcileActionResult | null = null) =>
	render(Page, { props: { data: pageData, form, params: {} } as never }).container;

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/profits/ledger/reconcile?inputs=1' }));
afterEach(() => {
	resetPage();
	document.head.innerHTML = '';
});

describe('/profits/ledger/reconcile page', () => {
	it('shows the counts at the top', () => {
		const container = renderPage();
		const count = (key: string) => container.querySelector(`[data-count="${key}"] p`)?.textContent?.trim();
		expect([count('estimated'), count('unpriced'), count('contracts')]).toEqual(['1', '1', '1']);
	});

	it('groups job inputs by item, with "Use buy value for all" per item', () => {
		const container = renderPage();
		const headings = [...container.querySelectorAll('[data-item-heading]')].map((h) =>
			h.getAttribute('data-item-heading')
		);
		expect(headings).toEqual(['16634', '16635']);
		const all = container.querySelector<HTMLFormElement>('form[data-confirm-all="16634"]')!;
		expect(all.getAttribute('action')).toBe('?/confirmAll&inputs=1');
		expect(all.querySelector<HTMLInputElement>('input[name="typeId"]')?.value).toBe('16634');
		expect(all.textContent?.trim()).toBe('Use buy value for all (2)');
		// Nothing to confirm without any buy value.
		expect(container.querySelector('form[data-confirm-all="16635"]')).toBeNull();
	});

	it('offers a unit price form and "Use buy value" for an estimated input', () => {
		const container = renderPage();
		const row = container.querySelector('[data-input="job:31:16634"]')!;
		expect(row.querySelector('[data-isk="15"]')).not.toBeNull();
		expect(row.querySelector('[data-estimate-text]')?.textContent).toContain('buy value at job start');
		const job = row.querySelector('a[data-job-link="31"]');
		expect(job?.getAttribute('href')).toBe('/profits/jobs/31');
		expect(job?.textContent?.trim()).toBe('Caesarium Cadmide Reaction Formula');
		const price = row.querySelector<HTMLFormElement>('form[data-price-form="job:31:16634"]')!;
		expect(price.getAttribute('action')).toBe('?/correct&inputs=1');
		expect(price.querySelector<HTMLInputElement>('input[name="kind"]')?.value).toBe('job_input');
		expect(price.querySelector<HTMLInputElement>('input[name="ref"]')?.value).toBe('job:31:16634');
		expect(price.querySelector('input[name="unitPrice"]')).not.toBeNull();
		const confirm = row.querySelector<HTMLFormElement>('form[data-confirm="job:31:16634"]')!;
		expect(confirm.getAttribute('action')).toBe('?/confirm&inputs=1');
		expect(confirm.querySelector<HTMLInputElement>('input[name="ref"]')?.value).toBe('job:31:16634');
		expect(confirm.textContent?.trim()).toBe('Use buy value');
	});

	it('has no "Use buy value" for an input with no price, and shows saved rows as recalculating', () => {
		const container = renderPage();
		const unpriced = container.querySelector('[data-input="job:31:16635"]')!;
		expect(unpriced.querySelector('[data-isk="none"]')).not.toBeNull();
		expect(unpriced.querySelector('form[data-confirm]')).toBeNull();
		expect(unpriced.querySelector('form[data-price-form]')).not.toBeNull();
		const saved = container.querySelector('[data-input="job:32:16634"]')!;
		expect(saved.querySelector('[data-saved]')?.textContent).toContain('Saved, recalculating');
		expect(saved.querySelector('form')).toBeNull();
	});

	it('lists contract items needing a check with a contract item price form', () => {
		const container = renderPage();
		const row = container.querySelector('[data-contract-item="contract:21:16634"]')!;
		// The contract is described by its date and title, never by its ESI id.
		const label = row.querySelector('[data-contract-label]')!.textContent!;
		expect(label).toContain('2026-10-06 09:00');
		expect(label).toContain('Moon goo');
		expect(label).not.toMatch(/\b21\b/);
		expect(row.textContent).toContain('Outside your rule');
		const form = row.querySelector<HTMLFormElement>('form[data-price-form="contract:21:16634"]')!;
		expect(form.querySelector<HTMLInputElement>('input[name="kind"]')?.value).toBe('contract_item');
	});

	it('shows a rejected price next to its form and a notice after a save', () => {
		const failed = renderPage(data(), { action: 'confirm', ref: 'job:31:16634', error: 'Nope.' });
		expect(failed.querySelector('[data-input="job:31:16634"] [role="alert"]')?.textContent).toBe('Nope.');
		document.body.innerHTML = '';
		const priced = renderPage(data(), { action: 'correct', ref: 'contract:21:16634', error: 'Bad price.' });
		expect(priced.querySelector('[data-price-form="contract:21:16634"] [data-form-error]')?.textContent).toBe(
			'Bad price.'
		);
		document.body.innerHTML = '';
		const ok = renderPage(data(), { action: 'confirmAll', ref: 'type:16634', notice: '2 prices confirmed.' });
		expect(ok.querySelector('[data-notice="ok"]')?.textContent?.trim()).toBe('2 prices confirmed.');
	});

	it('says "Nothing to reconcile" when nothing is missing', () => {
		const container = renderPage(
			data({
				counts: { estimated: 0, unpriced: 0, items: 0, contracts: 0, total: 0 },
				inputs: paginate([], 1),
				contracts: paginate([], 1)
			})
		);
		expect(container.querySelector('[data-empty="reconcile"]')?.textContent).toContain(
			'Nothing to reconcile'
		);
		expect(container.querySelector('table')).toBeNull();
	});
});
