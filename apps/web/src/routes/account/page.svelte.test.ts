import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPage, setPage } from '../../test/shims/app/state';
import Page from './+page.svelte';

afterEach(() => resetPage());

const data = {
	user: { characterId: 90000001, name: 'Alpha', isAdmin: false },
	characters: [
		{
			characterId: 90000001,
			name: 'Alpha',
			isLogin: true,
			features: [],
			tokenStatus: 'none' as const,
			lastRefreshedAt: null,
			lastError: null
		},
		{
			characterId: 90000002,
			name: 'Beta',
			isLogin: false,
			features: ['structures' as const],
			tokenStatus: 'ok' as const,
			lastRefreshedAt: Date.UTC(2026, 9, 6, 12),
			lastError: null
		}
	],
	offeredFeatures: [],
	createdAt: Date.UTC(2026, 9, 1),
	settingsUpdatedAt: Date.UTC(2026, 9, 6, 12),
	notice: null
};

describe('/account', () => {
	it('lists every character with its controls and the account actions', () => {
		setPage({ url: '/account' });
		const { container } = render(Page, { props: { data, form: null, params: {} } as never });
		expect(
			[...container.querySelectorAll('tr[data-character]')].map((r) => r.getAttribute('data-character'))
		).toEqual(['90000001', '90000002']);
		expect(screen.getByRole('link', { name: 'Add character' }).getAttribute('href')).toBe(
			'/auth/login?purpose=add_character&returnTo=%2Faccount'
		);
		expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
		// A character with a granted feature exists, so the feature/token columns are shown.
		expect([...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual([
			'Character',
			'Features',
			'Token',
			'Last refresh',
			'Actions'
		]);
		expect(container.querySelector('[data-settings-sync]')?.textContent).toContain(
			'Last saved 2026-10-06 12:00 UTC'
		);
		expect(screen.getByRole('link', { name: 'Edit settings' }).getAttribute('href')).toBe('/settings');
		const del = container.querySelector('form[action="?/deleteAccount"]')!;
		expect(del.closest('details')).not.toBeNull();
		expect(del.getAttribute('method')).toBe('POST');
	});

	it('hides feature and token columns while no feature exists for any character', () => {
		const plain = { ...data, characters: [data.characters[0]] };
		const { container } = render(Page, { props: { data: plain, form: null, params: {} } as never });
		expect([...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual([
			'Character',
			'Actions'
		]);
		expect(container.textContent).toContain('You can log in with any of these characters.');
		expect(container.textContent).not.toMatch(/permission|coming|wallet/i);
	});

	it('shows action errors and notices', () => {
		render(Page, {
			props: { data: { ...data, notice: 'Character removed.' }, form: null, params: {} } as never
		});
		expect(screen.getByRole('status').textContent).toContain('Character removed.');
	});
});
