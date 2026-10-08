import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPage, setPage } from '../../test/shims/app/state';
import ErrorPage from './+error.svelte';

afterEach(() => resetPage());

describe('auth error page', () => {
	it('shows the message and a fresh login link when logged out', () => {
		setPage({ url: '/auth/callback', status: 400, error: { message: 'Login expired, try again.' } });
		render(ErrorPage);
		expect(screen.getByRole('heading').textContent?.trim()).toBe('Login problem');
		expect(screen.getByText('Login expired, try again.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Log in again' }).getAttribute('href')).toBe(
			'/auth/login?purpose=login'
		);
	});

	it('links back to the account when logged in', () => {
		setPage({
			url: '/auth/callback',
			status: 409,
			error: { message: 'This character is linked to another account.' },
			data: { user: { characterId: 1, name: 'Alpha', isAdmin: false } }
		});
		render(ErrorPage);
		expect(screen.getByRole('link', { name: 'Back to your account' }).getAttribute('href')).toBe('/account');
	});
});
