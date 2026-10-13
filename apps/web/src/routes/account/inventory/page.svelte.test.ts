import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryPageData } from '$lib/inventory/types';
import { invalidateAllCalls, resetNavigation } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Page from './+page.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const ALLOW =
	'/auth/login?purpose=feature&feature=corp_assets&characterId=90000002&returnTo=%2Faccount%2Finventory';

function data(overrides: Partial<InventoryPageData> = {}) {
	const page: InventoryPageData = {
		sources: [
			{
				sourceId: 1,
				kind: 'character',
				ownerName: 'Alpha',
				characterId: 90000001,
				characterName: 'Alpha',
				otherReaders: [],
				status: 'ok',
				lastError: null,
				lastSyncedAt: NOW - 60_000,
				dataAsOf: NOW - 120_000,
				places: []
			}
		],
		addGroups: [
			{
				label: 'Personal assets',
				options: [{ value: 'character:90000002', label: 'Beta: personal assets' }]
			},
			{
				label: 'Corporation assets',
				options: [
					{ value: 'corporation:90000001', label: 'Alpha Corp via Alpha' },
					{ value: 'corporation:90000003', label: 'Gamma (corporation unknown)', disabled: true }
				]
			}
		],
		allowLinks: [{ characterId: 90000002, characterName: 'Beta', feature: 'corp_assets', href: ALLOW }],
		limit: 10,
		summary: {
			formulas: [],
			materials: { fuel: [], raw: [], intermediate: [], product: [] },
			totalValue: 0,
			empty: 'no_selection'
		},
		refreshing: false,
		...overrides
	};
	return { user: { characterId: 90000001, name: 'Alpha', isAdmin: false }, ...page };
}

function renderPage(pageData = data(), form: unknown = null) {
	return render(Page, { props: { data: pageData, form, params: {} } as never });
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	resetNavigation();
	setPage({ url: 'https://reactions.coalition.space/account/inventory' });
});

afterEach(() => {
	vi.useRealTimers();
	resetPage();
	document.head.innerHTML = '';
});

describe('/account/inventory page', () => {
	it('is noindex and offers the grouped add select, Allow links, sources and the summary', () => {
		const { container } = renderPage();
		expect(document.title).toContain('Inventory');
		expect(document.head.innerHTML).toContain('noindex');
		const add = container.querySelector('form[action="?/add"]')!;
		expect(
			[...add.querySelectorAll('select[name="source"] optgroup')].map((g) => [
				g.getAttribute('label'),
				[...g.querySelectorAll('option')].map((o) => [o.getAttribute('value'), o.textContent, o.disabled])
			])
		).toEqual([
			['Personal assets', [['character:90000002', 'Beta: personal assets', false]]],
			[
				'Corporation assets',
				[
					['corporation:90000001', 'Alpha Corp via Alpha', false],
					['corporation:90000003', 'Gamma (corporation unknown)', true]
				]
			]
		]);
		expect(screen.getByRole('link', { name: 'Allow' }).getAttribute('href')).toBe(ALLOW);
		expect(container.querySelector('[data-allow]')?.textContent).toContain('Corporation assets');
		expect(container.querySelector('article[data-source="1"]')).not.toBeNull();
		expect(container.querySelector('[data-empty="no_selection"]')).not.toBeNull();
	});

	it('replaces the add form with a note at the limit when nothing can join a pool', () => {
		const { container } = renderPage(data({ limit: 1, addGroups: [] }));
		expect(container.querySelector('form[action="?/add"]')).toBeNull();
		expect(container.querySelector('[data-limit]')?.textContent).toContain('the most an account can add');
		expect(container.querySelector('[data-all-added]')).toBeNull();
	});

	it('at the limit still offers joining a pool', () => {
		const addGroups: InventoryPageData['addGroups'] = [
			{
				label: 'Corporation assets',
				options: [{ value: 'corporation:90000002', label: 'Alpha Corp via Beta' }]
			}
		];
		const { container } = renderPage(data({ limit: 1, addGroups }));
		expect(container.querySelector('[data-limit]')).not.toBeNull();
		expect(container.querySelector('form[action="?/add"] option')?.textContent).toBe('Alpha Corp via Beta');
	});

	it('shows notices, errors and the Allow link of a failed add', () => {
		const ok = renderPage(data(), { notice: { ok: true, text: 'Sync started.' } });
		expect(screen.getByRole('status').textContent).toContain('Sync started.');
		expect(screen.getByRole('status').getAttribute('data-notice')).toBe('ok');
		ok.unmount();
		const busy = renderPage(data(), { notice: { ok: false, text: 'The updater is not reachable.' } });
		expect(screen.getByRole('status').getAttribute('data-notice')).toBe('error');
		busy.unmount();
		renderPage(data({ allowLinks: [] }), {
			error: 'Beta does not allow reading corporation assets.',
			allow: { characterId: 90000002, characterName: 'Beta', feature: 'corp_assets', href: ALLOW }
		});
		const status = screen.getByRole('status');
		expect(status.getAttribute('data-notice')).toBe('error');
		expect(status.textContent).toContain('Beta does not allow reading corporation assets.');
		expect(status.querySelector('a')?.getAttribute('href')).toBe(ALLOW);
	});

	it('refreshes the page data every 10 s while refreshing, then stops', async () => {
		const view = renderPage(data({ refreshing: true }));
		await tick();
		expect(screen.getByText('Updating every 10 s')).toBeTruthy();
		await vi.advanceTimersByTimeAsync(25_000);
		expect(invalidateAllCalls).toEqual([NOW + 10_000, NOW + 20_000]);

		await view.rerender({ data: data() } as never);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(invalidateAllCalls).toHaveLength(2);
		expect(screen.queryByText('Updating every 10 s')).toBeNull();
	});

	it('does not refresh when nothing syncs, and stops when the page is left', async () => {
		renderPage();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(invalidateAllCalls).toEqual([]);

		const view = renderPage(data({ refreshing: true }));
		await tick();
		view.unmount();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(invalidateAllCalls).toEqual([]);
	});
});
