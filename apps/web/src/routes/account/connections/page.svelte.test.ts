import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionsPageData } from '#lib/inventory/types.js';
import { refreshAllCalls, resetNavigation } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Page from './+page.svelte';

const NOW = Date.UTC(2026, 9, 12, 12);
const ALLOW =
	'/auth/login?purpose=feature&feature=corp_assets&characterId=90000002&returnTo=%2Faccount%2Fconnections';
const ALLOW_TRACKING =
	'/auth/login?purpose=feature&feature=corp_tracking&characterId=90000002&returnTo=%2Faccount%2Fconnections';

function data(overrides: Partial<ConnectionsPageData> = {}) {
	const page: ConnectionsPageData = {
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
				inventoryEnabled: true,
				tracking: {
					enabled: false,
					status: null,
					lastError: null,
					syncedAt: null,
					streams: [],
					walletDivisions: []
				}
			}
		],
		addGroups: [
			{
				label: 'Characters',
				options: [{ value: 'character:90000002', label: 'Beta' }]
			},
			{
				label: 'Corporations',
				options: [
					{ value: 'corporation:90000001', label: 'Alpha Corp via Alpha' },
					{ value: 'corporation:90000003', label: 'Gamma (corporation unknown)', disabled: true }
				]
			}
		],
		allowLinks: [
			{ characterId: 90000002, characterName: 'Beta', feature: 'corp_assets', href: ALLOW },
			{ characterId: 90000002, characterName: 'Beta', feature: 'corp_tracking', href: ALLOW_TRACKING }
		],
		limit: 10,
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
	setPage({ url: 'https://reactions.coalition.space/account/connections' });
});

afterEach(() => {
	vi.useRealTimers();
	resetPage();
	document.head.innerHTML = '';
});

describe('/account/connections page', () => {
	it('is noindex and offers the grouped add select, Allow links and a card per connection', () => {
		const { container } = renderPage();
		expect(document.title).toContain('Connections');
		expect(document.head.innerHTML).toContain('noindex');
		const add = container.querySelector('form[action="?/add"]')!;
		expect(screen.getByRole('combobox', { name: 'Connection' })).toBe(add.querySelector('select'));
		expect(
			[...add.querySelectorAll('select[name="source"] optgroup')].map((g) => [
				g.getAttribute('label'),
				[...g.querySelectorAll('option')].map((o) => [o.getAttribute('value'), o.textContent, o.disabled])
			])
		).toEqual([
			['Characters', [['character:90000002', 'Beta', false]]],
			[
				'Corporations',
				[
					['corporation:90000001', 'Alpha Corp via Alpha', false],
					['corporation:90000003', 'Gamma (corporation unknown)', true]
				]
			]
		]);
		expect(
			[...container.querySelectorAll('article[data-source]')].map((a) => a.getAttribute('aria-label'))
		).toEqual(['Alpha']);
		expect(container.querySelector('form[action="?/sync"]')).not.toBeNull();
	});

	it("shows a character's missing features on one line, each with its Allow link", () => {
		const { container } = renderPage();
		const lines = container.querySelectorAll('[data-allow] [data-allow-character]');
		expect(lines).toHaveLength(1);
		expect(lines[0]!.textContent).toContain('Beta');
		expect([...lines[0]!.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
			['Corporation assets', ALLOW],
			['Corporation profit tracking', ALLOW_TRACKING]
		]);
		expect(
			screen.getByRole('link', { name: 'Allow Corporation profit tracking for Beta' }).getAttribute('href')
		).toBe(ALLOW_TRACKING);
	});

	it('without options left below the limit, says everything is connected instead of the form', () => {
		const { container } = renderPage(data({ addGroups: [] }));
		expect(container.querySelector('form[action="?/add"]')).toBeNull();
		expect(container.querySelector('[data-all-added]')).not.toBeNull();
		expect(container.querySelector('[data-limit]')).toBeNull();
	});

	it('replaces the add form with a note at the limit when nothing can join a pool', () => {
		const { container } = renderPage(data({ limit: 1, addGroups: [] }));
		expect(container.querySelector('form[action="?/add"]')).toBeNull();
		expect(container.querySelector('[data-limit]')).not.toBeNull();
		expect(container.querySelector('[data-all-added]')).toBeNull();
	});

	it('at the limit still offers joining a pool', () => {
		const addGroups: ConnectionsPageData['addGroups'] = [
			{
				label: 'Corporations',
				options: [{ value: 'corporation:90000002', label: 'Alpha Corp via Beta' }]
			}
		];
		const { container } = renderPage(data({ limit: 1, addGroups }));
		expect(container.querySelector('[data-limit]')).not.toBeNull();
		expect(container.querySelector('form[action="?/add"] option')?.textContent).toBe('Alpha Corp via Beta');
	});

	it('without connections, lists no cards', () => {
		const { container } = renderPage(data({ sources: [] }));
		expect(container.querySelector('article[data-source]')).toBeNull();
		expect(container.querySelector('form[action="?/add"]')).not.toBeNull();
	});

	it('shows notices, errors and the Allow link of a failed add', () => {
		const ok = renderPage(data(), { notice: { ok: true, text: 'Sync started.' } });
		expect(screen.getByRole('status').textContent).toContain('Sync started.');
		expect(screen.getByRole('status').getAttribute('data-notice')).toBe('ok');
		ok.unmount();
		const busy = renderPage(data(), { notice: { ok: false, text: 'The updater is not reachable.' } });
		expect(screen.getByRole('alert').getAttribute('data-notice')).toBe('error');
		busy.unmount();
		renderPage(data({ allowLinks: [] }), {
			error: 'Beta does not allow reading corporation assets.',
			allow: { characterId: 90000002, characterName: 'Beta', feature: 'corp_assets', href: ALLOW }
		});
		const status = screen.getByRole('alert');
		expect(status.getAttribute('data-notice')).toBe('error');
		expect(status.textContent).toContain('Beta does not allow reading corporation assets.');
		expect(status.querySelector('a')?.getAttribute('href')).toBe(ALLOW);
	});

	it('refreshes the page data every 10 s while refreshing, then stops', async () => {
		const view = renderPage(data({ refreshing: true }));
		await tick();
		expect(screen.getByText('Updating every 10 s')).toBeTruthy();
		await vi.advanceTimersByTimeAsync(25_000);
		expect(refreshAllCalls).toEqual([NOW + 10_000, NOW + 20_000]);

		await view.rerender({ data: data() } as never);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(refreshAllCalls).toHaveLength(2);
		expect(screen.queryByText('Updating every 10 s')).toBeNull();
	});

	it('does not refresh when nothing syncs, and stops when the page is left', async () => {
		renderPage();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(refreshAllCalls).toEqual([]);

		const view = renderPage(data({ refreshing: true }));
		await tick();
		view.unmount();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(refreshAllCalls).toEqual([]);
	});
});
