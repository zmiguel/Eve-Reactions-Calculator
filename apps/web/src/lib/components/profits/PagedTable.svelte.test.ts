import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paginate, pageParam, withPage } from '#lib/paging.js';
import { resetNavigation, shallowUrls } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Harness from '../../../test/PagedTableHarness.svelte';

const items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));
const ids = (container: HTMLElement) =>
	[...container.querySelectorAll('[data-row]')].map((r) => Number(r.getAttribute('data-row')));

beforeEach(() => setPage({ url: 'https://reactions.coalition.space/profits?period=30&p=2' }));
afterEach(() => {
	resetPage();
	resetNavigation();
	vi.unstubAllGlobals();
});

describe('paging helpers', () => {
	it('slices 10 rows per page and clamps the page', () => {
		expect(paginate(items, 3)).toMatchObject({ page: 3, pageCount: 3, total: 23 });
		expect(paginate(items, 3).rows.map((r) => r.id)).toEqual([21, 22, 23]);
		expect(paginate(items, 99).page).toBe(3);
		expect(paginate(items, 0).page).toBe(1);
		expect(paginate([], 4)).toEqual({ rows: [], page: 1, pageCount: 1, total: 0 });
	});

	it('reads and writes a page parameter, keeping the other parameters', () => {
		const url = new URL('https://x/profits?period=30&p=2');
		expect(pageParam(url, 'p')).toBe(2);
		expect(pageParam(new URL('https://x/?p=-1'), 'p')).toBe(1);
		expect(withPage(url, 'p', 3)).toBe('/profits?period=30&p=3');
		expect(withPage(url, 'p', 1)).toBe('/profits?period=30');
	});
});

describe('PagedTable', () => {
	it('renders the page with links that keep the other query parameters (works without JS)', () => {
		const { container } = render(Harness, { data: paginate(items, 2) });
		expect(ids(container)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
		expect(container.querySelector('[data-range]')?.textContent).toBe('11 to 20 of 23 items');
		expect(container.querySelector('a[rel="prev"]')?.getAttribute('href')).toBe('/profits?period=30');
		expect(container.querySelector('a[rel="next"]')?.getAttribute('href')).toBe('/profits?period=30&p=3');
	});

	it('Next fetches the next page from the endpoint and swaps the rows in place', async () => {
		const fetch = vi.fn(async () => Response.json(paginate(items, 3)));
		vi.stubGlobal('fetch', fetch);
		const { container } = render(Harness, { data: paginate(items, 2) });
		await fireEvent.click(container.querySelector('a[rel="next"]')!);
		await vi.waitFor(() => expect(ids(container)).toEqual([21, 22, 23]));
		expect(fetch).toHaveBeenCalledWith('/profits/data/test?period=30&p=3', {
			headers: { accept: 'application/json' }
		});
		expect(shallowUrls).toEqual(['/profits?period=30&p=3']);
		expect(container.querySelector('a[rel="next"]')).toBeNull();
	});

	it('paging one table keeps the page of another table on the same page', async () => {
		setPage({ url: 'https://reactions.coalition.space/profits?period=30' });
		const fetch = vi.fn(async () => Response.json(paginate(items, 2)));
		vi.stubGlobal('fetch', fetch);
		const a = render(Harness, { data: paginate(items, 1), param: 'a' });
		const b = render(Harness, { data: paginate(items, 1), param: 'b' });
		await fireEvent.click(a.container.querySelector('a[rel="next"]')!);
		await vi.waitFor(() => expect(shallowUrls).toEqual(['/profits?period=30&a=2']));
		await fireEvent.click(b.container.querySelector('a[rel="next"]')!);
		await vi.waitFor(() => expect(shallowUrls).toHaveLength(2));
		expect(shallowUrls[1]).toBe('/profits?period=30&a=2&b=2');
		expect(fetch).toHaveBeenLastCalledWith('/profits/data/test?period=30&a=2&b=2', {
			headers: { accept: 'application/json' }
		});
		// The links (used without JS or to open in a new tab) carry both pages too.
		expect(a.container.querySelector('a[rel="prev"]')?.getAttribute('href')).toBe('/profits?period=30&b=2');
		expect(b.container.querySelector('a[rel="prev"]')?.getAttribute('href')).toBe('/profits?period=30&a=2');
	});

	it('hides the pager for a single page and shows the empty state without rows', () => {
		const one = render(Harness, { data: paginate(items.slice(0, 4), 1) });
		expect(one.container.querySelector('[data-pager]')).toBeNull();
		one.unmount();
		const none = render(Harness, { data: paginate([], 1) });
		expect(none.container.querySelector('[data-empty]')).not.toBeNull();
		expect(none.container.querySelector('table')).toBeNull();
	});
});
