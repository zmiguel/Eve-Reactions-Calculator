import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isActionFailure, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/server/session';
import { JOBS } from '$lib/admin/jobs';
import type { InlineRunResult, WorkflowStatus } from '$lib/server/updater';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, insertLatestPrice, insertStructureHub } from '../../test/fixtures';
import { resetPage, setPage } from '../../test/shims/app/state';
import { sessionUser } from '../../test/sso';
import { actions, load } from './+page.server';
import Page from './+page.svelte';
import type { PageServerData } from './$types';

const admin = sessionUser('u1', [{ characterId: 90000001, name: 'Admin' }], true);
const pilot = sessionUser('u2', [{ characterId: 90000002, name: 'Pilot' }]);

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	resetPage();
});

function updaterStub() {
	return {
		triggerPriceRefresh: vi.fn(async () => ({ instanceId: `prices-manual-${NOW}` })),
		triggerSdeSync: vi.fn(async () => ({ instanceId: `sde-3569502-manual-${NOW}` })),
		triggerDaily: vi.fn(async (date: string) => ({ instanceId: `daily-${date}-manual-${NOW}` })),
		triggerHistoryBackfill: vi.fn(async () => ({ instanceId: `history-backfill-manual-${NOW}` })),
		triggerAdjustedPrices: vi.fn(async (): Promise<InlineRunResult> => ({
			runId: `adjusted_prices-manual-${NOW}`,
			status: 'ok',
			summary: '4 adjusted prices written'
		})),
		triggerCostIndices: vi.fn(async (): Promise<InlineRunResult> => ({
			runId: `cost_indices-manual-${NOW}`,
			status: 'ok',
			summary: 'not modified'
		})),
		triggerAffiliations: vi.fn(async (): Promise<InlineRunResult> => ({
			runId: `affiliations-manual-${NOW}`,
			status: 'ok',
			summary: '3 of 3 characters updated (2 corporations, 1 alliances)'
		})),
		publishMarketSnapshot: vi.fn(async () => ({ snapshotAt: NOW, hubIds: ['jita'] })),
		workflowStatus: vi.fn(
			async (runs: { kind: string; runId: string }[]): Promise<Record<string, WorkflowStatus>> =>
				Object.fromEntries(runs.map((r) => [r.runId, { status: 'running', error: null }]))
		)
	};
}

function seeded(UPDATER: unknown = updaterStub()) {
	const env = fakeEnv({ UPDATER });
	const run = env.DB.sqlite.prepare(
		'INSERT INTO job_runs (run_id, kind, started_at, finished_at, status, detail_json, progress_json, progress_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	run.run('prices-1', 'prices', NOW - 3_600_000, NOW - 3_500_000, 'ok', '{"esi":1842}', null, null);
	run.run(
		'prices-2',
		'prices',
		NOW - 600_000,
		null,
		'running',
		null,
		'{"step":"region-10000043","done":2,"total":12}',
		NOW - 120_000
	);
	run.run(
		'sde-1',
		'sde',
		NOW - 86_400_000,
		NOW - 86_390_000,
		'failed',
		'{"error":"Error: boom"}',
		null,
		null
	);
	env.DB.sqlite.exec(
		`INSERT INTO sde_state (id, build_number, release_date, imported_at, constants_json, warnings_json) VALUES (1, 3569502, '2026-10-01', ${NOW - 86_400_000}, '{}', '[]')`
	);
	insertLatestPrice(env.DB, 'jita', 34, 4, 5);
	insertLatestPrice(env.DB, 'amarr', 34, 4, 5);
	return env;
}

function event(env: FakeEnv, user: SessionUser | null, path = '/admin') {
	const url = new URL(`https://reactions.coalition.space${path}`);
	return {
		url,
		request: new Request(url, { method: 'POST', body: new FormData() }),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function status(promise: unknown) {
	try {
		await promise;
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

describe('/admin', () => {
	it('is a 404 for anonymous visitors and non-admins (page and actions)', async () => {
		for (const user of [null, pilot]) {
			expect(await status(load(event(seeded(), user)))).toBe(404);
			expect(await status(actions.prices(event(seeded(), user, '/admin?/prices')))).toBe(404);
		}
	});

	it('loads every registry job in order with its runs newest first, plus SDE build, price counts and hub errors', async () => {
		const env = seeded();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Broken Market' });
		env.DB.sqlite.exec(`UPDATE market_hubs SET last_error = 'HTTP 403' WHERE hub_id = 'structure-1001'`);
		const data = (await load(event(env, admin))) as PageServerData;
		expect(data.jobs.map((j) => j.kind)).toEqual(JOBS.map((j) => j.kind));
		const runIds = Object.fromEntries(data.jobs.map((j) => [j.kind, j.runs.map((r) => r.runId)]));
		expect(runIds).toEqual({
			prices: ['prices-2', 'prices-1'],
			adjusted_prices: [],
			cost_indices: [],
			sde: ['sde-1'],
			daily: [],
			history: [],
			market_snapshot: [],
			affiliations: []
		});
		expect(data.jobs[0]!.runs[0]).toEqual({
			runId: 'prices-2',
			kind: 'prices',
			status: 'running',
			startedAt: NOW - 600_000,
			finishedAt: null,
			detailJson: null,
			progressJson: '{"step":"region-10000043","done":2,"total":12}',
			progressAt: NOW - 120_000,
			workflow: { status: 'running', error: null }
		});
		expect(data.sde).toEqual({
			buildNumber: 3569502,
			releaseDate: '2026-10-01',
			importedAt: NOW - 86_400_000
		});
		expect(data.prices).toEqual([{ source: 'esi', rows: 2 }]);
		expect(data.hubErrors).toEqual([
			{ hubId: 'structure-1001', name: 'Broken Market', lastError: 'HTTP 403', lastSuccessAt: null }
		]);
		expect(data.now).toBe(NOW);
	});

	it('keeps the 25 newest runs of each kind, by start time then run id', async () => {
		const env = seeded();
		const insert = env.DB.sqlite.prepare(
			'INSERT INTO job_runs (run_id, kind, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?)'
		);
		for (let i = 1; i <= 30; i++)
			insert.run(`cost_indices-${i}`, 'cost_indices', NOW - 7_200_000 + i * 1000, NOW, 'ok');
		// Same start as cost_indices-30: the larger run id comes first.
		insert.run('cost_indices-manual-30', 'cost_indices', NOW - 7_200_000 + 30_000, NOW, 'ok');
		const data = (await load(event(env, admin))) as PageServerData;
		const cost = data.jobs.find((j) => j.kind === 'cost_indices')!.runs.map((r) => r.runId);
		expect(cost).toHaveLength(25);
		expect(cost.slice(0, 3)).toEqual(['cost_indices-manual-30', 'cost_indices-30', 'cost_indices-29']);
		expect(cost.at(-1)).toBe('cost_indices-7');
		expect(data.jobs.find((j) => j.kind === 'prices')!.runs.map((r) => r.runId)).toEqual([
			'prices-2',
			'prices-1'
		]);
	});

	it('asks the updater once for the live status of running workflow rows only', async () => {
		const UPDATER = updaterStub();
		UPDATER.workflowStatus.mockResolvedValue({
			'prices-2': { status: 'errored', error: 'Error: step timed out' }
		});
		const env = seeded(UPDATER);
		env.DB.sqlite.exec(
			`INSERT INTO job_runs (run_id, kind, started_at, status) VALUES ('adjusted-1', 'adjusted_prices', ${NOW - 60_000}, 'running'), ('daily-x', 'daily', ${NOW - 30_000}, 'running'), ('daily-old', 'daily', ${NOW - 90_000_000}, 'running')`
		);
		const data = (await load(event(env, admin))) as PageServerData;
		expect(UPDATER.workflowStatus).toHaveBeenCalledTimes(1);
		const asked = UPDATER.workflowStatus.mock.calls[0]![0];
		expect(asked).toEqual(
			expect.arrayContaining([
				{ kind: 'prices', runId: 'prices-2' },
				{ kind: 'daily', runId: 'daily-x' },
				{ kind: 'daily', runId: 'daily-old' }
			])
		);
		expect(asked).toHaveLength(3);
		const workflows = Object.fromEntries(data.jobs.flatMap((j) => j.runs).map((r) => [r.runId, r.workflow]));
		expect(workflows).toEqual({
			'daily-x': null,
			'daily-old': null,
			'adjusted-1': null,
			'prices-2': { status: 'errored', error: 'Error: step timed out' },
			'prices-1': null,
			'sde-1': null
		});
	});

	it('loads without live status when the updater fails or the binding is missing', async () => {
		const failing = updaterStub();
		failing.workflowStatus.mockRejectedValue(new Error('connection refused'));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const missing = seeded();
		Reflect.deleteProperty(missing, 'UPDATER');
		for (const env of [seeded(failing), missing]) {
			const data = (await load(event(env, admin))) as PageServerData;
			expect(data.jobs.flatMap((j) => j.runs).map((r) => [r.runId, r.workflow])).toEqual([
				['prices-2', null],
				['prices-1', null],
				['sde-1', null]
			]);
		}
		expect(failing.workflowStatus).toHaveBeenCalledTimes(1);
		error.mockRestore();
	});

	it('does not call the updater when nothing runs', async () => {
		const UPDATER = updaterStub();
		const env = seeded(UPDATER);
		env.DB.sqlite.exec(`UPDATE job_runs SET status = 'ok', finished_at = ${NOW} WHERE run_id = 'prices-2'`);
		await load(event(env, admin));
		expect(UPDATER.workflowStatus).not.toHaveBeenCalled();
	});

	it('renders for admins with noindex, job statuses, progress and a run button per action', async () => {
		const env = seeded();
		const data = (await load(event(env, admin))) as PageServerData;
		setPage({ url: 'https://reactions.coalition.space/admin' });
		const { head, body } = render(Page, { props: { data, form: null, params: {} } as never });
		expect(head).toContain('<meta name="robots" content="noindex"');
		for (const { action } of JOBS.flatMap((j) => j.actions)) expect(body).toContain(`action="?/${action}"`);
		expect(body).toContain('data-status="failed"');
		expect(body).toContain('3569502');
		expect(body).toContain('Step 3 of 12: region-10000043');
		expect(body).toContain('Updating every 10 s');
		expect(body.match(/data-never/g)).toHaveLength(JOBS.length - 2);
	});

	it('lists every job as never run, with its buttons, when no job has run', async () => {
		const env = fakeEnv({ UPDATER: updaterStub() });
		const data = (await load(event(env, admin))) as PageServerData;
		expect(data.jobs.map((j) => [j.kind, j.runs])).toEqual(JOBS.map((j) => [j.kind, []]));
		setPage({ url: 'https://reactions.coalition.space/admin' });
		const { body } = render(Page, { props: { data, form: null, params: {} } as never });
		expect(body.match(/data-never/g)).toHaveLength(JOBS.length);
		for (const { action } of JOBS.flatMap((j) => j.actions)) expect(body).toContain(`action="?/${action}"`);
	});

	it('RPC buttons call the UPDATER binding with the right method and arguments', async () => {
		const UPDATER = updaterStub();
		const env = seeded(UPDATER);
		expect(await actions.prices(event(env, admin, '/admin?/prices'))).toEqual({
			notice: { ok: true, text: `Price refresh started: workflow instance prices-manual-${NOW}.` }
		});
		await actions.sde_check(event(env, admin, '/admin?/sde_check'));
		await actions.sde_force(event(env, admin, '/admin?/sde_force'));
		await actions.daily(event(env, admin, '/admin?/daily'));
		expect(await actions.history(event(env, admin, '/admin?/history'))).toEqual({
			notice: {
				ok: true,
				text: `Market history import started: workflow instance history-backfill-manual-${NOW}.`
			}
		});
		expect(await actions.adjusted_prices(event(env, admin, '/admin?/adjusted_prices'))).toEqual({
			notice: {
				ok: true,
				text: `Adjusted prices run adjusted_prices-manual-${NOW} finished: 4 adjusted prices written.`
			}
		});
		await actions.cost_indices(event(env, admin, '/admin?/cost_indices'));
		await actions.market_snapshot(event(env, admin, '/admin?/market_snapshot'));
		expect(await actions.affiliations(event(env, admin, '/admin?/affiliations'))).toEqual({
			notice: {
				ok: true,
				text: `Affiliations run affiliations-manual-${NOW} finished: 3 of 3 characters updated (2 corporations, 1 alliances).`
			}
		});
		expect(UPDATER.triggerPriceRefresh).toHaveBeenCalledTimes(1);
		expect(UPDATER.triggerSdeSync.mock.calls).toEqual([[false], [true]]);
		expect(UPDATER.triggerDaily).toHaveBeenCalledWith('2026-10-06');
		expect(UPDATER.triggerHistoryBackfill).toHaveBeenCalledTimes(1);
		expect(UPDATER.triggerAdjustedPrices).toHaveBeenCalledTimes(1);
		expect(UPDATER.triggerCostIndices).toHaveBeenCalledTimes(1);
		expect(UPDATER.publishMarketSnapshot).toHaveBeenCalledTimes(1);
	});

	it('a failed inline run gives a 503 notice', async () => {
		const UPDATER = updaterStub();
		UPDATER.triggerCostIndices.mockResolvedValueOnce({
			runId: `cost_indices-manual-${NOW}`,
			status: 'failed',
			summary: 'Error: ESI 502'
		});
		const result: unknown = await actions.cost_indices(event(seeded(UPDATER), admin, '/admin?/cost_indices'));
		expect(result).toMatchObject({
			status: 503,
			data: {
				notice: { ok: false, text: `Cost indices run cost_indices-manual-${NOW} failed: Error: ESI 502` }
			}
		});
	});

	it('an unreachable updater gives a 503 notice, not an exception', async () => {
		const UPDATER = {
			...updaterStub(),
			triggerDaily: vi.fn(async () => {
				throw new Error('connection refused');
			})
		};
		const result: unknown = await actions.daily(event(seeded(UPDATER), admin, '/admin?/daily'));
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({
			status: 503,
			data: { notice: { ok: false, text: expect.stringContaining('connection refused') } }
		});
	});
});
