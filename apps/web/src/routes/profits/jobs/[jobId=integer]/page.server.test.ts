import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobDetailData } from '#lib/jobs/types.js';
import { clearDataMemo } from '#lib/server/data.js';
import type { SessionUser } from '#lib/server/session.js';
import { FakeCookies, type FakeEnv } from '../../../../test/fakes';
import { NOW, insertUser } from '../../../../test/fixtures';
import { ALPHA, JOB, jobsScenario } from '../../../../test/jobs';
import { sessionUser } from '../../../../test/sso';
import { actions, load } from './+page.server';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

async function scenario(extra: Record<string, unknown> = {}) {
	const UPDATER = { rebuildLedger: vi.fn(async (_userId: string) => ({ users: 1 })) };
	const setup = await jobsScenario({ UPDATER, ...extra } as never);
	const fallbackRef = `job:${JOB.intermediate}:${setup.intermediate.materials[1].typeId}`;
	return { ...setup, UPDATER, fallbackRef, user: sessionUser('u1', [ALPHA]) };
}

function event(
	env: FakeEnv,
	user: SessionUser | null,
	jobId: number | string,
	fields?: Record<string, string>
) {
	const url = new URL(`https://reactions.coalition.space/profits/jobs/${jobId}`);
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
	}
	return {
		url,
		params: { jobId: String(jobId) },
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark', env }
	} as unknown as RequestEvent as never;
}

async function settle(
	promise: unknown
): Promise<{ status?: number; data?: unknown; redirect?: string; error?: number }> {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		if (isHttpError(e)) return { error: e.status };
		throw e;
	}
}

const corrections = (env: FakeEnv) =>
	env.DB.rows<{ user_id: string; target_kind: string; target_ref: string; unit_price: number }>(
		'SELECT user_id, target_kind, target_ref, unit_price FROM price_corrections ORDER BY user_id, target_ref'
	);

/** u3: an account whose only connection has Profit tracking off. */
function untracked(env: FakeEnv) {
	const delta = { characterId: 90000004, name: 'Delta' };
	insertUser(env.DB, { userId: 'u3' }, [delta]);
	return sessionUser('u3', [delta]);
}

describe('/profits/jobs/[jobId] load', () => {
	it('anonymous visitors and accounts without tracking get no job (the layout shows the gate)', async () => {
		const { env } = await scenario();
		for (const user of [null, untracked(env)]) {
			expect(await settle(load(event(env, user, JOB.final)))).toEqual({ data: { detail: null } });
		}
	});

	it("404 for unknown jobs, another user's job and a tracking-off connection's job", async () => {
		const { env, user } = await scenario();
		for (const jobId of [999_999, 8001, JOB.trackingOff, 0]) {
			expect(await settle(load(event(env, user, jobId)))).toEqual({ error: 404 });
		}
	});

	it("returns the caller's job", async () => {
		const { env, user, intermediate } = await scenario();
		const { data } = await settle(load(event(env, user, JOB.final)));
		const page = (data as { detail: JobDetailData }).detail;
		expect(page.job.jobId).toBe(JOB.final);
		expect(page.chain.from.map((j) => j.jobId)).toEqual([JOB.intermediate]);
		expect(page.inputs.map((i) => i.typeId)).toEqual([intermediate.product.typeId]);
	});
});

describe('/profits/jobs/[jobId] actions', () => {
	it('send anonymous visitors to log in; 404 without a tracking connection', async () => {
		const { env, fallbackRef } = await scenario();
		const fields = { kind: 'job_input', ref: fallbackRef, unitPrice: '12' };
		const login = `/auth/login?purpose=login&returnTo=%2Fprofits%2Fjobs%2F${JOB.intermediate}`;
		expect(await settle(actions.correct(event(env, null, JOB.intermediate, fields)))).toEqual({
			redirect: login
		});
		expect(await settle(actions.undo(event(env, null, JOB.intermediate, fields)))).toEqual({
			redirect: login
		});
		const u3 = untracked(env);
		expect(await settle(actions.correct(event(env, u3, JOB.intermediate, fields)))).toEqual({ error: 404 });
		expect(corrections(env)).toEqual([]);
	});

	it('correct stores the job input price and rebuilds; undo removes it', async () => {
		const { env, user, fallbackRef, UPDATER } = await scenario();
		const saved = await settle(
			actions.correct(
				event(env, user, JOB.intermediate, { kind: 'job_input', ref: fallbackRef, unitPrice: '1,234.5' })
			)
		);
		expect(saved.status).toBeUndefined();
		expect(saved.data).toMatchObject({ ref: fallbackRef });
		expect(corrections(env)).toEqual([
			{ user_id: 'u1', target_kind: 'job_input', target_ref: fallbackRef, unit_price: 1234.5 }
		]);
		expect(UPDATER.rebuildLedger).toHaveBeenCalledWith('u1');

		const undone = await settle(
			actions.undo(event(env, user, JOB.intermediate, { kind: 'job_input', ref: fallbackRef }))
		);
		expect(undone.status).toBeUndefined();
		expect(corrections(env)).toEqual([]);
		expect(UPDATER.rebuildLedger).toHaveBeenCalledTimes(2);

		const again = await settle(
			actions.undo(event(env, user, JOB.intermediate, { kind: 'job_input', ref: fallbackRef }))
		);
		expect(again.status).toBe(404);
	});

	it('only inputs of this job of a tracking-on connection: other refs are a 404 and store nothing', async () => {
		const { env, user, intermediate, UPDATER } = await scenario();
		const typeId = intermediate.materials[1].typeId;
		for (const [jobId, fields] of [
			// An input of another job, posted to this job's page.
			[JOB.intermediate, { kind: 'job_input', ref: `job:${JOB.running}:${typeId}`, unitPrice: '5' }],
			// A job of the tracking-off connection and a job of another user.
			[JOB.trackingOff, { kind: 'job_input', ref: `job:${JOB.trackingOff}:${typeId}`, unitPrice: '5' }],
			[8001, { kind: 'job_input', ref: `job:8001:${typeId}`, unitPrice: '5' }],
			// Not a job input.
			[JOB.intermediate, { kind: 'transaction', ref: 'transaction:901', unitPrice: '5' }],
			[JOB.intermediate, { kind: 'job_input', ref: 'job:abc', unitPrice: '5' }]
		] as const) {
			expect((await settle(actions.correct(event(env, user, jobId, fields)))).status).toBe(404);
		}
		expect(corrections(env)).toEqual([]);
		expect(UPDATER.rebuildLedger).not.toHaveBeenCalled();
	});

	it('rejects invalid prices, giving back the values typed', async () => {
		const { env, user, fallbackRef } = await scenario();
		for (const unitPrice of ['-1', '1e14', 'abc']) {
			const fields = { kind: 'job_input', ref: fallbackRef, unitPrice, note: 'mine' };
			expect(await settle(actions.correct(event(env, user, JOB.intermediate, fields)))).toMatchObject({
				status: 400,
				data: { action: 'correct', ref: fallbackRef, values: { unitPrice, note: 'mine' } }
			});
		}
		expect(corrections(env)).toEqual([]);
	});

	it('rate limited per account: 429 and nothing stored', async () => {
		const limiter = { limit: vi.fn(async (_o: { key: string }) => ({ success: false })) };
		const { env, user, fallbackRef } = await scenario({ ACCOUNT_RATE_LIMITER: limiter });
		const result = await settle(
			actions.correct(
				event(env, user, JOB.intermediate, { kind: 'job_input', ref: fallbackRef, unitPrice: '5' })
			)
		);
		expect(result.status).toBe(429);
		expect(limiter.limit).toHaveBeenCalledWith({ key: 'inventory:u1' });
		expect(corrections(env)).toEqual([]);
	});
});
