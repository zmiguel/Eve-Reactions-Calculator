import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPage, setPage } from '../../../test/shims/app/state';
import AccountTabs, { ACCOUNT_TABS } from './AccountTabs.svelte';

afterEach(() => resetPage());

function tabsAt(path: string) {
	setPage({ url: `https://reactions.coalition.space${path}` });
	const { container } = render(AccountTabs);
	return [...container.querySelectorAll('nav a')].map((a) => [
		a.getAttribute('href'),
		a.getAttribute('aria-current')
	]);
}

describe('AccountTabs', () => {
	it.each([
		['/account', '/account'],
		['/account/connections', '/account/connections'],
		['/account/inventory?x=1', '/account/inventory'],
		['/account/tracking', '/account/tracking'],
		['/account/structures', '/account/structures'],
		['/account/permissions/90000001', '/account']
	])('on %s links every account page and marks only %s as current', (path, current) => {
		expect(tabsAt(path)).toEqual(ACCOUNT_TABS.map((tab) => [tab.href, tab.href === current ? 'page' : null]));
	});

	it('links the five account pages', () => {
		expect(tabsAt('/account').map(([href]) => href)).toEqual([
			'/account',
			'/account/connections',
			'/account/inventory',
			'/account/tracking',
			'/account/structures'
		]);
	});
});
