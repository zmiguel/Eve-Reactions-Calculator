import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerItemPageData } from '$lib/ledger/types';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, type FakeEnv } from '../../../../../test/fakes';
import { NOW, insertUser } from '../../../../../test/fixtures';
import { ALPHA, ledgerItemScenario } from '../../../../../test/ledger-item';
import { sessionUser } from '../../../../../test/sso';
import { load } from '../../../ledger/[typeId=integer]/+page.server';
import { GET as trades } from '../../item-trades/[typeId=integer]/+server';
import { GET as batches } from './+server';

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

function event(env: FakeEnv, user: SessionUser | null, path: string, typeId: number) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	return {
		url,
		params: { typeId: String(typeId) },
		request: new Request(url),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function answer(promise: unknown): Promise<{ status: number; body?: unknown }> {
	try {
		const response = (await promise) as Response;
		return { status: response.status, body: await response.json() };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
}

const ENDPOINTS = [
	['item-batches', batches, 'batches'],
	['item-trades', trades, 'trades']
] as const;

describe.each(ENDPOINTS)('GET /profits/data/%s/[typeId]', (name, GET, param) => {
	it('401 for anonymous visitors, 403 without a tracking connection, 404 for an unknown type', async () => {
		const { env, typeId } = await ledgerItemScenario();
		const delta = { characterId: 90000009, name: 'Delta' };
		insertUser(env.DB, { userId: 'u3' }, [delta]);
		const path = (id: number) => `/profits/data/${name}/${id}`;
		expect((await answer(GET(event(env, null, path(typeId), typeId)))).status).toBe(401);
		expect((await answer(GET(event(env, sessionUser('u3', [delta]), path(typeId), typeId)))).status).toBe(
			403
		);
		const user = sessionUser('u1', [ALPHA]);
		expect((await answer(GET(event(env, user, path(999_999_999), 999_999_999)))).status).toBe(404);
	});

	it.each([1, 2])('answers the same page as the item page load for page %i', async (pageNumber) => {
		const { env, typeId } = await ledgerItemScenario();
		const user = sessionUser('u1', [ALPHA]);
		const search = `?${param}=${pageNumber}`;
		const { status, body } = await answer(
			GET(event(env, user, `/profits/data/${name}/${typeId}${search}`, typeId))
		);
		expect(status).toBe(200);
		const page = (await load(
			event(env, user, `/profits/ledger/${typeId}${search}`, typeId)
		)) as LedgerItemPageData;
		expect(body).toEqual(page[param]);
		expect(page[param].total).toBeGreaterThan(0);
	});
});
