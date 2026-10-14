import { DEFAULT_SETTINGS } from '@reactions/engine';
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobsPageData } from '$lib/jobs/types';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, type FakeEnv } from '../../../test/fakes';
import { NOW, insertUser } from '../../../test/fixtures';
import { ALPHA, JOB, jobsScenario } from '../../../test/jobs';
import { sessionUser } from '../../../test/sso';
import { load } from './+page.server';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

function event(env: FakeEnv, user: SessionUser | null, path: string) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	return {
		url,
		params: {},
		request: new Request(url),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

const run = (e: never) => Promise.resolve(load(e)) as Promise<JobsPageData>;

describe('/profits/jobs load', () => {
	it('anonymous visitors and accounts without tracking get no jobs (the layout shows the gate)', async () => {
		const { env } = await jobsScenario();
		const delta = { characterId: 90000004, name: 'Delta' };
		insertUser(env.DB, { userId: 'u3' }, [delta]);
		for (const user of [null, sessionUser('u3', [delta])]) {
			const data = await run(event(env, user, '/profits/jobs?period=all'));
			expect(data).toMatchObject({ hasJobs: false, jobs: { rows: [], total: 0 }, connections: [] });
			expect(data.filters.period).toBe('all');
		}
	});

	it("returns the caller's jobs filtered and sorted by the query string", async () => {
		const { env } = await jobsScenario();
		const user = sessionUser('u1', [ALPHA]);
		const data = await run(event(env, user, '/profits/jobs?period=all&status=cancelled'));
		expect(data.filters).toEqual({
			period: 'all',
			status: 'cancelled',
			formula: null,
			connection: null,
			sort: 'newest'
		});
		expect(data.jobs.rows.map((r) => r.jobId)).toEqual([JOB.cancelled]);
		expect(data.counts).toEqual({ all: 6, running: 1, finished: 4, cancelled: 1 });

		const defaults = await run(event(env, user, '/profits/jobs'));
		expect(defaults.filters.period).toBe('30');
		expect(defaults.jobs.rows.map((r) => r.jobId)).not.toContain(JOB.old);
		expect(defaults.jobs.rows.map((r) => r.jobId)).not.toContain(JOB.trackingOff);

		const ending = await run(event(env, user, '/profits/jobs?sort=ending'));
		expect(ending.jobs.rows[0].jobId).toBe(JOB.running);
	});
});
