import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPage, setPage } from '../../test/shims/app/state';
import Navbar from './Navbar.svelte';

afterEach(() => resetPage());

const current = () =>
	screen
		.getAllByRole('link')
		.filter((a) => a.getAttribute('aria-current') === 'page')
		.map((a) => a.textContent?.trim());

describe('Navbar', () => {
	it('links Home and every main section', () => {
		const { container } = render(Navbar);
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		for (const href of ['/', '/composite', '/biochemical', '/hybrid', '/planner', '/settings', '/api']) {
			expect(hrefs).toContain(href);
		}
		expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
		expect(screen.getByRole('link', { name: 'EVE Reactions' }).getAttribute('href')).toBe('/');
		expect(screen.getByRole('button', { name: 'Toggle dark mode' })).toBeTruthy();
	});

	it.each([
		['/', 'Home'],
		['/composite', 'Composite'],
		['/biochemical/pure-synth-blue-pill-booster', 'Biochemical'],
		['/api', 'API']
	])('marks the link of %s as current', (path, label) => {
		setPage({ url: path });
		render(Navbar);
		expect(current()).toEqual([label]);
	});

	it('marks Home only on / and nothing on unrelated paths', () => {
		for (const path of ['/about', '/apifoo']) {
			setPage({ url: path });
			const { unmount } = render(Navbar);
			expect(current()).toEqual([]);
			unmount();
			resetPage();
		}
	});

	it('anonymous: a "Log in" dropdown with the official EVE SSO button only', () => {
		setPage({ url: '/composite?view=chain' });
		const { container } = render(Navbar);
		const menu = container.querySelector('details[data-account-menu]') as HTMLDetailsElement;
		expect(menu.open).toBe(false);
		expect(menu.querySelector('summary')?.textContent?.trim()).toBe('Log in');
		const images = screen.getAllByAltText('Log in with EVE Online') as HTMLImageElement[];
		expect(images.map((img) => img.getAttribute('src'))).toEqual([
			'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-small.png',
			'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-white-small.png'
		]);
		expect(images.every((img) => img.width === 195 && img.height === 30)).toBe(true);
		const link = images[0].closest('a')!;
		expect(link.getAttribute('href')).toBe('/auth/login?purpose=login&returnTo=%2Fcomposite%3Fview%3Dchain');
		expect(link.hasAttribute('data-sveltekit-reload')).toBe(true);
		expect(menu.textContent?.trim()).toBe('Log in');
		expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
	});

	it('closes the menu on Escape and on outside clicks', async () => {
		const { container } = render(Navbar);
		const menu = container.querySelector('details[data-account-menu]') as HTMLDetailsElement;
		menu.open = true;
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(menu.open).toBe(false);
		expect(document.activeElement).toBe(menu.querySelector('summary'));
		menu.open = true;
		await fireEvent.click(document.body);
		expect(menu.open).toBe(false);
	});

	it('logged in: portrait and name with Account, Structure markets, Add character and a POST log-out form; no Admin', () => {
		const { container } = render(Navbar, { user: { characterId: 90000001, name: 'Oxed G', isAdmin: false } });
		const summary = container.querySelector('details[data-account-menu] summary')!;
		expect(summary.getAttribute('aria-label')).toBe('Account menu for Oxed G');
		expect(summary.querySelector('img')?.getAttribute('src')).toBe(
			'https://images.evetech.net/characters/90000001/portrait?size=32'
		);
		expect(summary.textContent).toContain('Oxed G');
		expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account');
		expect(screen.getByRole('link', { name: 'Structure markets' }).getAttribute('href')).toBe(
			'/account/structures'
		);
		expect(screen.getByRole('link', { name: 'Add character' }).getAttribute('href')).toBe(
			'/auth/login?purpose=add_character&returnTo=%2Faccount'
		);
		expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
		const logout = screen.getByRole('button', { name: 'Log out' }).closest('form')!;
		expect([logout.getAttribute('method'), logout.getAttribute('action')]).toEqual(['POST', '/auth/logout']);
		expect(screen.queryByAltText('Log in with EVE Online')).toBeNull();
	});

	it('shows Admin only for admins', () => {
		render(Navbar, { user: { characterId: 90000001, name: 'Oxed G', isAdmin: true } });
		expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
	});
});
