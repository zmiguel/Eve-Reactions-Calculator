import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPage, setPage } from '../test/shims/app/state';
import ErrorPage from './+error.svelte';

afterEach(() => resetPage());

describe('site error page', () => {
	it('names a missing page, shows the reason, is not indexed and links back into the site', () => {
		setPage({ url: '/composite/nope', status: 404, error: { message: 'Reaction not found' } });
		render(ErrorPage);
		expect(screen.getByRole('heading').textContent?.trim()).toBe('Page not found');
		expect(screen.getByText('Reaction not found')).toBeTruthy();
		expect(document.title).toBe('Page not found | EVE Reactions Calculator');
		expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
		expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
			'/',
			'/composite',
			'/biochemical',
			'/hybrid',
			'/planner'
		]);
	});

	it('distinguishes bad requests from server errors', () => {
		setPage({ url: '/composite?date=x', status: 400, error: { message: 'Invalid date' } });
		const { unmount } = render(ErrorPage);
		expect(screen.getByRole('heading').textContent?.trim()).toBe('Bad request');
		unmount();
		setPage({ url: '/', status: 500, error: { message: 'Internal Error' } });
		render(ErrorPage);
		expect(screen.getByRole('heading').textContent?.trim()).toBe('Something went wrong');
	});
});
