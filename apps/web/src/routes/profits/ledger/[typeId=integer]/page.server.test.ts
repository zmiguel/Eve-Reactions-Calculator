import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isActionFailure, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import type { LedgerItemPageData } from '$lib/ledger/types';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../../../test/fakes';
import { NOW, insertUser } from '../../../../test/fixtures';
import {
	ALPHA,
	CORRECTED_JOB,
	FALLBACK_JOB,
	FOREIGN_JOB,
	ledgerItemScenario
} from '../../../../test/ledger-item';
import { sessionUser } from '../../../../test/sso';
import { actions, load } from './+page.server';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

function updaterStub() {
	return { rebuildLedger: vi.fn(async (_userId: string) => ({ users: 1 })) };
}

async function scenario(extra: Record<string, unknown> = {}) {
	const UPDATER = updaterStub();
	const setup = await ledgerItemScenario(fakeEnv({ UPDATER, ...extra } as never));
	return { ...setup, UPDATER, user: sessionUser('u1', [ALPHA]) };
}

function event(
	env: FakeEnv,
	user: SessionUser | null,
	typeId: number | string,
	fields?: Record<string, string>
) {
	const url = new URL(`https://reactions.coalition.space/profits/ledger/${typeId}`);
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
	}
	return {
		url,
		params: { typeId: String(typeId) },
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
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
	env.DB.rows<{
		user_id: string;
		target_kind: string;
		target_ref: string;
		unit_price: number;
		note: string | null;
	}>(
		'SELECT user_id, target_kind, target_ref, unit_price, note FROM price_corrections ORDER BY user_id, target_ref'
	);

describe('/profits/ledger/[typeId] load', () => {
	it('returns empty data for anonymous visitors and accounts without tracking (the layout shows the gate)', async () => {
		const { env, typeId } = await scenario();
		const delta = { characterId: 90000009, name: 'Delta' };
		insertUser(env.DB, { userId: 'u3' }, [delta]);
		for (const visitor of [null, sessionUser('u3', [delta])]) {
			const { data } = await settle(load(event(env, visitor, typeId)));
			expect(data).toMatchObject({ heldQuantity: 0, batches: { total: 0 }, trades: { total: 0 } });
		}
	});

	it('404 for a type outside the dataset', async () => {
		const { env, user } = await scenario();
		expect(await settle(load(event(env, user, 999_999_999)))).toEqual({ error: 404 });
		expect(await settle(load(event(env, user, 0)))).toEqual({ error: 404 });
	});

	it("returns the caller's item page with the requested table pages", async () => {
		const { env, user, typeId } = await scenario();
		const { data } = await settle(load(event(env, user, typeId)));
		const page = data as LedgerItemPageData;
		expect(page.item.typeId).toBe(typeId);
		expect([page.heldQuantity, page.averagePaid]).toEqual([100, 12.5]);
		expect(page.unitValue).not.toBeNull();
		expect(page.batches).toMatchObject({ page: 1, total: 5 });
		expect(page.trades).toMatchObject({ page: 1, total: 4 });
	});
});

describe('/profits/ledger/[typeId] actions', () => {
	it('send anonymous visitors to log in', async () => {
		const { env, typeId } = await scenario();
		const fields = { kind: 'job_input', ref: `job:${FALLBACK_JOB}:${typeId}`, unitPrice: '12' };
		const login = `/auth/login?purpose=login&returnTo=%2Fprofits%2Fledger%2F${typeId}`;
		expect(await settle(actions.correct(event(env, null, typeId, fields)))).toEqual({ redirect: login });
		expect(await settle(actions.undo(event(env, null, typeId, fields)))).toEqual({ redirect: login });
		expect(corrections(env)).toEqual([]);
	});

	it('correct stores the job input price and rebuilds; undo removes it', async () => {
		const { env, user, typeId, UPDATER } = await scenario();
		const ref = `job:${FALLBACK_JOB}:${typeId}`;
		const saved = await settle(
			actions.correct(
				event(env, user, typeId, { kind: 'job_input', ref, unitPrice: '1,234.5', note: 'Bought in Jita' })
			)
		);
		expect(saved.status).toBeUndefined();
		expect(saved.data).toMatchObject({ ref });
		expect(corrections(env)).toEqual([
			{ user_id: 'u1', target_kind: 'job_input', target_ref: ref, unit_price: 1234.5, note: 'Bought in Jita' }
		]);
		expect(UPDATER.rebuildLedger).toHaveBeenCalledWith('u1');

		const undone = await settle(actions.undo(event(env, user, typeId, { kind: 'job_input', ref })));
		expect(undone.status).toBeUndefined();
		expect(corrections(env)).toEqual([]);
		expect(UPDATER.rebuildLedger).toHaveBeenCalledTimes(2);
	});

	it('undo without a correction is a 404', async () => {
		const { env, user, typeId } = await scenario();
		const ref = `job:${CORRECTED_JOB}:${typeId}`;
		expect((await settle(actions.undo(event(env, user, typeId, { kind: 'job_input', ref })))).status).toBe(
			404
		);
	});

	it("another user's job is a 404 and stores nothing", async () => {
		const { env, user, typeId, UPDATER } = await scenario();
		const ref = `job:${FOREIGN_JOB}:${typeId}`;
		const result = await settle(
			actions.correct(event(env, user, typeId, { kind: 'job_input', ref, unitPrice: '5' }))
		);
		expect(result.status).toBe(404);
		expect(corrections(env)).toEqual([]);
		expect(UPDATER.rebuildLedger).not.toHaveBeenCalled();
	});

	it('rejects malformed or foreign targets with 404 and invalid prices with 400', async () => {
		const { env, user, typeId } = await scenario();
		const ref = `job:${FALLBACK_JOB}:${typeId}`;
		for (const [fields, status] of [
			[{ kind: 'job_input', ref: 'job:abc', unitPrice: '5' }, 404],
			[{ kind: 'nope', ref, unitPrice: '5' }, 404],
			[{ kind: 'transaction', ref: 'transaction:901', unitPrice: '5' }, 404],
			[{ kind: 'job_input', ref, unitPrice: '-1' }, 400],
			[{ kind: 'job_input', ref, unitPrice: '1e14' }, 400]
		] as const) {
			expect((await settle(actions.correct(event(env, user, typeId, fields)))).status).toBe(status);
		}
		expect(corrections(env)).toEqual([]);
	});

	it('answers 404 to an account without Profit tracking', async () => {
		const { env, typeId } = await scenario();
		const delta = { characterId: 90000009, name: 'Delta' };
		insertUser(env.DB, { userId: 'u3' }, [delta]);
		const fields = { kind: 'job_input', ref: `job:${FALLBACK_JOB}:${typeId}`, unitPrice: '12' };
		expect(await settle(actions.correct(event(env, sessionUser('u3', [delta]), typeId, fields)))).toEqual({
			error: 404
		});
		expect(corrections(env)).toEqual([]);
	});

	it('rate limited per account: 429 and nothing stored', async () => {
		const limiter = { limit: vi.fn(async (_o: { key: string }) => ({ success: false })) };
		const { env, user, typeId } = await scenario({ ACCOUNT_RATE_LIMITER: limiter });
		const ref = `job:${FALLBACK_JOB}:${typeId}`;
		const result = await settle(
			actions.correct(event(env, user, typeId, { kind: 'job_input', ref, unitPrice: '5' }))
		);
		expect(result.status).toBe(429);
		expect(limiter.limit).toHaveBeenCalledWith({ key: 'inventory:u1' });
		expect(corrections(env)).toEqual([]);
	});
});
