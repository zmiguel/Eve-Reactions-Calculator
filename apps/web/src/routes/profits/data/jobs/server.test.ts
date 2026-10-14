import { DEFAULT_SETTINGS, TrackingSettings } from '@reactions/engine';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRow, JobsPageData } from '$lib/jobs/types';
import type { Paged } from '$lib/paging';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import { saveTrackingSettings } from '$lib/server/tracking-settings';
import { FakeCookies, asEnv, type FakeEnv } from '../../../../test/fakes';
import { NOW, insertUser } from '../../../../test/fixtures';
import { ALPHA, insertTrackedJob, jobsScenario } from '../../../../test/jobs';
import { DAY } from '../../../../test/ledger-item';
import { sessionUser } from '../../../../test/sso';
import { load } from '../../jobs/+page.server';
import { GET } from './+server';

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

async function status(promise: Promise<unknown>): Promise<number> {
	try {
		await promise;
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

describe('GET /profits/data/jobs', () => {
	it('401 for anonymous visitors, 403 without a tracking connection', async () => {
		const { env } = await jobsScenario();
		const delta = { characterId: 90000004, name: 'Delta' };
		insertUser(env.DB, { userId: 'u3' }, [delta]);
		expect(await status(Promise.resolve(GET(event(env, null, '/profits/data/jobs'))))).toBe(401);
		expect(
			await status(Promise.resolve(GET(event(env, sessionUser('u3', [delta]), '/profits/data/jobs'))))
		).toBe(403);
	});

	it('answers the same page as the jobs page load for the same query string', async () => {
		const { env, mine } = await jobsScenario();
		for (let i = 0; i < 25; i++) {
			insertTrackedJob(env.DB, 'u1', {
				jobId: 10_000 + i,
				sourceId: mine,
				blueprintTypeId: 46182,
				cost: 10 + i,
				endDate: NOW - 10 * DAY - i * 60_000
			});
		}
		const user = sessionUser('u1', [ALPHA]);
		for (const query of ['?page=2', '?period=all&sort=spent&page=3', '?status=finished&page=2']) {
			const response = await GET(event(env, user, `/profits/data/jobs${query}`));
			const paged = (await response.json()) as Paged<JobRow>;
			const page = (await load(event(env, user, `/profits/jobs${query}`))) as JobsPageData;
			expect(paged).toEqual(page.jobs);
			expect(paged.rows.length).toBeGreaterThan(0);
		}
	});

	it("the page load and the endpoint use the user's default period unless ?period is given", async () => {
		const { env, mine } = await jobsScenario();
		// Ended 200 days ago: only in 365 days and all.
		insertTrackedJob(env.DB, 'u1', {
			jobId: 10_500,
			sourceId: mine,
			blueprintTypeId: 46182,
			endDate: NOW - 200 * DAY
		});
		const user = sessionUser('u1', [ALPHA]);
		const ids = (rows: JobRow[]) => rows.map((r) => r.jobId);
		const loaded = async (query: string) =>
			(await load(event(env, user, `/profits/jobs${query}`))) as JobsPageData;
		const fetched = async (query: string) =>
			(await (await GET(event(env, user, `/profits/data/jobs${query}`))).json()) as Paged<JobRow>;
		expect(ids((await loaded('')).jobs.rows)).not.toContain(10_500);

		await saveTrackingSettings(asEnv(env), 'u1', TrackingSettings.parse({ defaultPeriod: '365' }));
		const page = await loaded('');
		expect(page).toMatchObject({ defaultPeriod: '365', filters: { period: '365' } });
		expect(ids(page.jobs.rows)).toContain(10_500);
		expect(await fetched('')).toEqual(page.jobs);
		const week = await loaded('?period=7');
		expect(week.filters.period).toBe('7');
		expect(ids(week.jobs.rows)).not.toContain(10_500);
		expect(await fetched('?period=7')).toEqual(week.jobs);
	});
});
