import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPage, setPage } from '../../../../test/shims/app/state';
import Page from './+page.svelte';

afterEach(() => resetPage());

const data = {
	user: { characterId: 90000001, name: 'Alpha', isAdmin: false },
	character: { characterId: 90000001, name: 'Alpha', features: ['corp_tracking' as const] },
	offeredFeatures: ['structures', 'assets', 'corp_assets', 'tracking', 'corp_tracking'] as const
};

describe('/account/permissions/[characterId]', () => {
	it('renders the permissions form as a page: POST to its save action, current grants ticked, Cancel back', () => {
		setPage({ url: '/account/permissions/90000001' });
		const { container } = render(Page, { props: { data, params: { characterId: '90000001' } } as never });
		expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBe('Permissions of Alpha');
		const form = container.querySelector('form')!;
		expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual([
			'POST',
			'/account/permissions/90000001?/save'
		]);
		expect(new FormData(form).getAll('features')).toEqual(['corp_tracking']);
		expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/account');
		expect(screen.getByRole('button', { name: 'Save and log in with EVE' }).getAttribute('type')).toBe(
			'submit'
		);
	});
});
