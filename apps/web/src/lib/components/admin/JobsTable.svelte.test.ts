import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOBS } from '$lib/admin/jobs';
import JobsTable from './JobsTable.svelte';
import type { JobRunView, JobView } from './job-runs';

const NOW = Date.UTC(2026, 9, 7, 12);
const MIN = 60_000;

function run(runId: string, kind: string, startedAt: number, status = 'ok'): JobRunView {
	return {
		runId,
		kind,
		status,
		startedAt,
		finishedAt: status === 'running' ? null : startedAt + MIN,
		detailJson: null,
		progressJson: null,
		progressAt: null,
		workflow: null
	};
}

/** Every registry job; `runs` per kind (newest first, as the page loads them), the others never ran. */
function jobs(runs: Record<string, JobRunView[]> = {}): JobView[] {
	return JOBS.map((job) => ({ ...job, runs: runs[job.kind] ?? [] }));
}

function row(container: HTMLElement, kind: string) {
	return container.querySelector(`tbody tr[data-kind="${kind}"]`) as HTMLTableRowElement;
}

afterEach(() => vi.unstubAllGlobals());

describe('JobsTable', () => {
	it('lists every job with its run buttons, its latest run or never run', () => {
		const { container } = render(JobsTable, {
			jobs: jobs({
				sde: [run('sde-2', 'sde', NOW - 5 * MIN, 'failed'), run('sde-1', 'sde', NOW - 60 * MIN)]
			}),
			now: NOW
		});
		expect([...container.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-kind'))).toEqual(
			JOBS.map((j) => j.kind)
		);
		const sde = row(container, 'sde');
		expect(sde.querySelector('[data-status]')?.textContent).toBe('failed');
		expect(sde.textContent).toContain('5 min ago');
		expect(sde.querySelector('[data-never]')).toBeNull();
		expect([...sde.querySelectorAll('form')].map((f) => f.getAttribute('action'))).toEqual([
			'?/sde_check',
			'?/sde_force'
		]);
		const prices = row(container, 'prices');
		expect(prices.querySelector('[data-never]')?.textContent).toBe('Never run');
		expect(prices.querySelector('form')?.getAttribute('action')).toBe('?/prices');
		expect(container.querySelectorAll('[data-never]')).toHaveLength(JOBS.length - 1);
	});

	it('opens the history of one job, in the given newest-first order', async () => {
		const { container } = render(JobsTable, {
			jobs: jobs({
				cost_indices: [
					run('cost_indices-manual-3', 'cost_indices', NOW - MIN),
					run('cost_indices-2', 'cost_indices', NOW - 10 * MIN),
					run('cost_indices-1', 'cost_indices', NOW - 20 * MIN)
				],
				prices: [run('prices-9', 'prices', NOW)]
			}),
			now: NOW
		});
		const history = (kind: string) =>
			[...row(container, kind).querySelectorAll('button')].find((b) => b.textContent === 'History')!;
		expect(history('daily').disabled).toBe(true);

		await fireEvent.click(history('cost_indices'));
		await tick();

		const dialog = document.querySelector('dialog') as HTMLDialogElement;
		expect(dialog.textContent).toContain('Cost indices: recent runs');
		expect([...dialog.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-run'))).toEqual([
			'cost_indices-manual-3',
			'cost_indices-2',
			'cost_indices-1'
		]);
	});

	it('asks before starting a job whose latest run is still running', async () => {
		const confirm = vi.fn(() => false);
		vi.stubGlobal('confirm', confirm);
		const { container } = render(JobsTable, {
			jobs: jobs({
				prices: [run('prices-2', 'prices', NOW - MIN, 'running')],
				daily: [run('daily-1', 'daily', NOW - MIN)]
			}),
			now: NOW
		});
		const submitted: string[] = [];
		for (const form of container.querySelectorAll('form'))
			form.addEventListener('submit', (event) => {
				event.preventDefault();
				submitted.push(form.getAttribute('action')!);
			});
		const button = (kind: string) => row(container, kind).querySelector('form button') as HTMLButtonElement;

		await fireEvent.click(button('prices'));
		expect(confirm).toHaveBeenCalledWith('Prices is still running. Start another run anyway?');
		expect(submitted).toEqual([]);

		confirm.mockReturnValue(true);
		await fireEvent.click(button('prices'));
		await fireEvent.click(button('daily'));
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(submitted).toEqual(['?/prices', '?/daily']);
	});
});
