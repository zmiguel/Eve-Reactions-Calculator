import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import JobStatusTable from './JobStatusTable.svelte';
import { summarizeDetail, type JobRunView } from './job-runs';

const NOW = Date.UTC(2026, 9, 7, 12);
const MIN = 60_000;

const idle = { progressJson: null, progressAt: null, workflow: null };

const runs: JobRunView[] = [
	{
		runId: 'prices-1',
		kind: 'prices',
		status: 'ok',
		startedAt: NOW - 5 * MIN,
		finishedAt: NOW - 4 * MIN - 15_000,
		detailJson: JSON.stringify({ snapshotAt: NOW, status: 'ok', esi: 1842, fuzzwork: 0, archived: 6 }),
		...idle
	},
	{
		runId: 'sde-3569502',
		kind: 'sde',
		status: 'failed',
		startedAt: NOW - 2 * 86_400_000,
		finishedAt: NOW - 2 * 86_400_000 + 3000,
		detailJson: JSON.stringify({ error: 'Error: validation failed' }),
		...idle
	},
	{
		runId: 'daily-x',
		kind: 'daily',
		status: 'running',
		startedAt: NOW - 90_000,
		finishedAt: null,
		detailJson: null,
		...idle
	}
];

/** A running workflow row; `overrides` replace its progress, activity time or live status. */
function runningRow(overrides: Partial<JobRunView> = {}): JobRunView {
	return {
		runId: 'history-backfill-manual-1',
		kind: 'history',
		status: 'running',
		startedAt: NOW - 20 * MIN,
		finishedAt: null,
		detailJson: null,
		progressJson: JSON.stringify({ step: 'region-10000043', done: 3, total: 12 }),
		progressAt: NOW - 2 * MIN,
		workflow: { status: 'running', error: null },
		...overrides
	};
}

function renderRow(run: JobRunView) {
	const { container } = render(JobStatusTable, { runs: [run], now: NOW });
	return container.querySelector('tbody tr') as HTMLTableRowElement;
}

describe('JobStatusTable', () => {
	it('shows one row per run in the given order with a status badge, relative start and duration', () => {
		const { container } = render(JobStatusTable, { runs, now: NOW });
		const rows = [...container.querySelectorAll('tbody tr')];
		expect(rows.map((r) => r.getAttribute('data-run'))).toEqual(['prices-1', 'sde-3569502', 'daily-x']);
		expect([...container.querySelectorAll('[data-status]')].map((b) => b.textContent)).toEqual([
			'ok',
			'failed',
			'running'
		]);
		expect(container.querySelector('[data-status="failed"]')?.className).toContain('bg-red-100');
		expect(container.querySelector('[data-status="ok"]')?.className).toContain('bg-green-100');
		expect(rows[0].textContent).toContain('5 min ago');
		expect(rows[0].textContent).toContain('45s');
		expect(rows[1].textContent).toContain('2 d ago');
		expect(rows[1].textContent).toContain('Error: validation failed');
		expect(rows[2].textContent).toContain('running 1m 30s');
		expect(screen.getByText('5 min ago').getAttribute('title')).toBe('2026-10-07 11:55 UTC');
		expect(container.querySelector('[data-stuck]')).toBeNull();
	});

	it('labels how each run was started from its id', () => {
		const { container } = render(JobStatusTable, {
			runs: [
				{ ...runs[0], runId: 'prices-1760000000000' },
				{ ...runs[0], runId: 'prices-manual-1760000000000' },
				{ ...runs[0], runId: 'daily-2026-10-06-retry-1' }
			],
			now: NOW
		});
		expect([...container.querySelectorAll('[data-trigger]')].map((t) => t.textContent)).toEqual([
			'cron',
			'manual',
			'retry'
		]);
	});

	it('shows the step in progress with a bar and the last activity of a running row', () => {
		const row = renderRow(runningRow());
		expect(row.querySelector('[data-progress]')?.textContent).toBe('Step 4 of 12: region-10000043');
		const bar = row.querySelector('[role="progressbar"]') as HTMLElement;
		expect(bar.getAttribute('aria-valuenow')).toBe('3');
		expect(bar.getAttribute('aria-valuemax')).toBe('12');
		expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%');
		expect(row.textContent).toContain('last activity 2 min ago');
		expect(row.querySelector('[data-workflow]')).toBeNull();
		expect(row.querySelector('[data-stuck]')).toBeNull();
	});

	it('shows the plan step without a total or bar', () => {
		const row = renderRow(
			runningRow({ progressJson: JSON.stringify({ step: 'plan', done: 0, total: null }) })
		);
		expect(row.querySelector('[data-progress]')?.textContent).toBe('Step 1: plan');
		expect(row.querySelector('[role="progressbar"]')).toBeNull();
	});

	it('keeps the detail summary and no progress for finished rows', () => {
		const row = renderRow(
			runningRow({ status: 'ok', finishedAt: NOW - MIN, detailJson: JSON.stringify({ regions: 64 }) })
		);
		expect(row.textContent).toContain('regions: 64');
		expect(row.textContent).toContain('19m');
		expect(row.querySelector('[data-progress]')).toBeNull();
		expect(row.textContent).not.toContain('last activity');
	});

	it('marks a running row possibly stuck after 15 minutes without activity', () => {
		expect(
			renderRow(runningRow({ progressAt: NOW - 16 * MIN })).querySelector('[data-stuck]')?.textContent
		).toBe('Possibly stuck');
		// No progress yet: the start time counts as the last activity.
		expect(
			renderRow(
				runningRow({ progressJson: null, progressAt: null, startedAt: NOW - 16 * MIN })
			).querySelector('[data-stuck]')
		).not.toBeNull();
		expect(renderRow(runningRow({ progressAt: NOW - 14 * MIN })).querySelector('[data-stuck]')).toBeNull();
		expect(
			renderRow(runningRow({ status: 'failed', finishedAt: NOW, progressAt: NOW - 60 * MIN })).querySelector(
				'[data-stuck]'
			)
		).toBeNull();
	});

	it('shows a live workflow status other than running and marks ended workflows possibly stuck', () => {
		const errored = renderRow(
			runningRow({ workflow: { status: 'errored', error: 'Error: step timed out' } })
		);
		expect(errored.querySelector('[data-workflow]')?.textContent).toBe(
			'Workflow errored: Error: step timed out'
		);
		expect(errored.querySelector('[data-stuck]')).not.toBeNull();

		for (const status of ['terminated', 'complete', 'unknown']) {
			const row = renderRow(runningRow({ workflow: { status, error: null } }));
			expect(row.querySelector('[data-workflow]')?.textContent).toBe(`Workflow ${status}`);
			expect(row.querySelector('[data-stuck]')).not.toBeNull();
		}

		const waiting = renderRow(runningRow({ workflow: { status: 'waiting', error: null } }));
		expect(waiting.querySelector('[data-workflow]')?.textContent).toBe('Workflow waiting');
		expect(waiting.querySelector('[data-stuck]')).toBeNull();

		expect(
			renderRow(runningRow({ workflow: { status: 'queued', error: null } })).querySelector('[data-workflow]')
		).toBeNull();
	});

	it('summarises job details without the status field', () => {
		expect(summarizeDetail(runs[0].detailJson)).toBe('esi: 1,842 · fuzzwork: 0 · archived: 6');
		expect(summarizeDetail(null)).toBe('');
		expect(summarizeDetail('not json')).toBe('not json');
	});

	it('says so when there are no runs', () => {
		render(JobStatusTable, { runs: [], now: NOW });
		expect(screen.getByText('No runs yet.')).toBeTruthy();
	});
});
