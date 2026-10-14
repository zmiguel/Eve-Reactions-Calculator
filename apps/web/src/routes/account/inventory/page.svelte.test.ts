import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryPageData, InventorySourcePlacesView } from '$lib/inventory/types';
import { invalidateAllCalls, resetNavigation } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Page from './+page.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const JITA = 60003760;

const alpha: InventorySourcePlacesView = {
	sourceId: 1,
	kind: 'character',
	ownerName: 'Alpha',
	characterName: 'Alpha',
	status: 'ok',
	lastSyncedAt: Date.UTC(2026, 9, 12, 11, 59),
	places: [
		{
			locationId: JITA,
			kind: 'station',
			name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
			systemName: 'Jita',
			buckets: [{ bucket: 'hangar', label: 'Hangar', selected: true, formulas: 1, materials: 2 }]
		}
	]
};

const seedCorp: InventorySourcePlacesView = {
	sourceId: 2,
	kind: 'corporation',
	ownerName: 'Seed Corp',
	characterName: 'Alpha',
	status: 'pending',
	lastSyncedAt: null,
	places: []
};

function data(overrides: Partial<InventoryPageData> = {}) {
	const page: InventoryPageData = {
		sources: [alpha, seedCorp],
		summary: {
			formulas: [],
			materials: { fuel: [], raw: [], intermediate: [], product: [] },
			totalValue: 0,
			showPaid: false,
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
	it('is noindex and lists the places of each connection with its status, and the summary', () => {
		const { container } = renderPage();
		expect(document.title).toContain('Inventory');
		expect(document.head.innerHTML).toContain('noindex');
		const [first, second] = [...container.querySelectorAll('article[data-source]')];
		expect([first, second].map((a) => a?.getAttribute('aria-label'))).toEqual(['Alpha', 'Seed Corp']);

		expect(first!.querySelector('[data-status]')?.textContent).toContain('Synced 2026-10-12 11:59 UTC');
		expect(first!.querySelector('form[action="?/select"]')?.getAttribute('data-places')).toBe('1');
		expect(
			[...first!.querySelectorAll<HTMLInputElement>('[data-place] input[type="checkbox"]')].map((i) => [
				i.value,
				i.checked
			])
		).toEqual([[`${JITA}:hangar`, true]]);

		// Never synced and nothing found yet: the status line only.
		expect(second!.querySelector('[data-status]')?.textContent).toContain('Not synced yet');
		expect(second!.querySelector('form[action="?/select"]')).toBeNull();
		expect(second!.querySelector('[data-no-places]')).toBeNull();

		expect(container.querySelector('[data-no-connections]')).toBeNull();
		expect(container.querySelector('[data-empty="no_selection"]')).not.toBeNull();
		// Connections are managed on their own page.
		expect(
			container.querySelector('form[action="?/sync"], form[action="?/remove"], form[action="?/add"]')
		).toBeNull();
	});

	it('a synced connection without places says so', () => {
		const { container } = renderPage(data({ sources: [{ ...alpha, places: [] }] }));
		expect(container.querySelector('[data-no-places]')).not.toBeNull();
	});

	it('without connections, links to the Connections page', () => {
		const { container } = renderPage(
			data({
				sources: [],
				summary: { ...data().summary, empty: 'no_sources' }
			})
		);
		expect(container.querySelector('article[data-source]')).toBeNull();
		expect(container.querySelector('[data-no-connections] a')?.getAttribute('href')).toBe(
			'/account/connections'
		);
		expect(container.querySelector('[data-empty="no_sources"]')).not.toBeNull();
	});

	it('shows the notice of a save', () => {
		renderPage(data(), { notice: { ok: true, text: 'Selection saved.' } });
		expect(screen.getByRole('status').getAttribute('data-notice')).toBe('ok');
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
