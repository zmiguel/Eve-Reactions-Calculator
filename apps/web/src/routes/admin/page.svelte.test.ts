import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS } from '$lib/admin/jobs';
import { invalidateAllCalls, resetNavigation } from '../../test/shims/app/navigation';
import { resetPage, setPage } from '../../test/shims/app/state';
import Page from './+page.svelte';
import type { PageServerData } from './$types';

const NOW = Date.UTC(2026, 9, 7, 12);

function run(runId: string, status: string) {
	return {
		runId,
		kind: 'prices',
		status,
		startedAt: NOW - 60_000,
		finishedAt: status === 'running' ? null : NOW,
		detailJson: null,
		progressJson: null,
		progressAt: null,
		workflow: null
	};
}

/** The prices job with its latest run in `status` and an older run in `olderStatus`. */
function data(status: string, olderStatus = 'ok'): PageServerData {
	return {
		now: NOW,
		jobs: [{ ...JOBS[0], runs: [run('prices-2', status), run('prices-1', olderStatus)] }],
		sde: null,
		prices: [],
		hubErrors: []
	} as unknown as PageServerData;
}

function renderPage(pageData: PageServerData) {
	return render(Page, { props: { data: pageData, form: null, params: {} } as never });
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	resetNavigation();
	setPage({ url: 'https://reactions.coalition.space/admin' });
});

afterEach(() => {
	vi.useRealTimers();
	resetPage();
	document.head.innerHTML = '';
});

describe('/admin page', () => {
	it('refreshes the page data every 10 s while a run is running, then stops', async () => {
		const view = renderPage(data('running'));
		await tick();
		expect(screen.getByText('Updating every 10 s')).toBeTruthy();
		await vi.advanceTimersByTimeAsync(25_000);
		expect(invalidateAllCalls).toEqual([NOW + 10_000, NOW + 20_000]);

		await view.rerender({ data: data('ok') } as never);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(invalidateAllCalls).toHaveLength(2);
		expect(screen.queryByText('Updating every 10 s')).toBeNull();
	});

	it('also refreshes for an older run that is still running', async () => {
		renderPage(data('ok', 'running'));
		await vi.advanceTimersByTimeAsync(10_000);
		expect(invalidateAllCalls).toHaveLength(1);
	});

	it('does not refresh when nothing runs, and stops when the page is left', async () => {
		renderPage(data('ok'));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(invalidateAllCalls).toEqual([]);
		expect(screen.queryByText('Updating every 10 s')).toBeNull();

		const view = renderPage(data('running'));
		await tick();
		view.unmount();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(invalidateAllCalls).toEqual([]);
	});
});
