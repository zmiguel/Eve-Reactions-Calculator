import { DEFAULT_SETTINGS, TrackingSettings } from '@reactions/engine';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfitsOverviewData } from '$lib/profits/types';
import { clearDataMemo } from '$lib/server/data';
import { saveTrackingSettings } from '$lib/server/tracking-settings';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, asEnv, type FakeEnv } from '../../test/fakes';
import { NOW, insertUser } from '../../test/fixtures';
import { ALPHA, BETA } from '../../test/jobs';
import { overviewScenario } from '../../test/profits';
import { sessionUser } from '../../test/sso';
import { load } from './+page.server';
import { GET as reactions } from './data/reactions/+server';
import { GET as running } from './data/running/+server';
import { GET as sales } from './data/sales/+server';
import { GET as unsold } from './data/unsold/+server';

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

const ENDPOINTS = { reactions, sales, unsold, running } as const;

describe('/profits load', () => {
	it('returns no data when the layout shows the login or enable message', async () => {
		const { env } = await overviewScenario();
		expect(await load(event(env, null, '/profits'))).toEqual({ overview: null });
		insertUser(env.DB, { userId: 'u3' }, [{ characterId: 90000009, name: 'Delta' }]);
		const u3 = sessionUser('u3', [{ characterId: 90000009, name: 'Delta' }]);
		expect(await load(event(env, u3, '/profits'))).toEqual({ overview: null });
	});

	it("returns the caller's overview for the period in the query string", async () => {
		const { env } = await overviewScenario();
		const user = sessionUser('u1', [ALPHA, BETA]);
		const { overview } = (await load(event(env, user, '/profits?period=7'))) as {
			overview: ProfitsOverviewData;
		};
		expect(overview.period).toBe('7');
		expect(overview.kpis.realized).toBe(1680 + 150);
	});

	it("without ?period opens on the user's default period; the endpoints follow it", async () => {
		const { env } = await overviewScenario();
		const user = sessionUser('u1', [ALPHA, BETA]);
		const overviewOf = async (path: string) =>
			((await load(event(env, user, path))) as { overview: ProfitsOverviewData }).overview;
		expect((await overviewOf('/profits')).period).toBe('30');
		await saveTrackingSettings(asEnv(env), 'u1', TrackingSettings.parse({ defaultPeriod: 'all' }));
		const all = await overviewOf('/profits');
		expect(all).toMatchObject({ period: 'all', defaultPeriod: 'all' });
		expect((await overviewOf('/profits?period=7')).period).toBe('7');
		const response = await sales(event(env, user, '/profits/data/sales'));
		expect(await response.json()).toEqual(all.sales);
	});
});

describe('/profits/data endpoints', () => {
	it('answer 401 to anonymous visitors and 403 without a tracking connection', async () => {
		const { env } = await overviewScenario();
		insertUser(env.DB, { userId: 'u3' }, [{ characterId: 90000009, name: 'Delta' }]);
		const u3 = sessionUser('u3', [{ characterId: 90000009, name: 'Delta' }]);
		for (const [name, handler] of Object.entries(ENDPOINTS)) {
			const anonymous = await Promise.resolve(handler(event(env, null, `/profits/data/${name}`))).catch(
				(e: unknown) => e
			);
			expect(isHttpError(anonymous) && anonymous.status).toBe(401);
			const off = await Promise.resolve(handler(event(env, u3, `/profits/data/${name}`))).catch(
				(e: unknown) => e
			);
			expect(isHttpError(off) && off.status).toBe(403);
		}
	});

	it('return the same table page as the page load for the same query string', async () => {
		const { env } = await overviewScenario();
		const user = sessionUser('u1', [ALPHA, BETA]);
		const query = '?period=all&sales=1&reactions=1&unsold=1&running=1';
		const { overview } = (await load(event(env, user, `/profits${query}`))) as unknown as {
			overview: Record<keyof typeof ENDPOINTS, unknown>;
		};
		for (const [name, handler] of Object.entries(ENDPOINTS)) {
			const response = await handler(event(env, user, `/profits/data/${name}${query}`));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(overview[name as keyof typeof ENDPOINTS]);
		}
	});
});
