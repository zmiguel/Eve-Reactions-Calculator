import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerPageData, LedgerRow } from '$lib/ledger/types';
import type { Paged } from '$lib/paging';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../../../test/fakes';
import { NOW, insertUser, loadSde, putKv } from '../../../../test/fixtures';
import { insertSource } from '../../../../test/inventory';
import { insertPrice, insertTransaction } from '../../../../test/ledger';
import { sessionUser } from '../../../../test/sso';
import { load } from '../../ledger/+page.server';
import { GET } from './+server';

const ALPHA = { characterId: 90000001, name: 'Alpha' };
const BETA = { characterId: 90000002, name: 'Beta' };
const DAY = 86_400_000;

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

/** u1 tracks Alpha: 30 trades, one per day (bought on even days, sold on odd ones); u2 tracks nothing. */
async function scenario() {
	const env = fakeEnv();
	const sde = await loadSde();
	await putKv(env, sde);
	const typeId = sde.dataset.reactions[0].materials[0].typeId;
	insertUser(env.DB, { userId: 'u1' }, [ALPHA]);
	insertUser(env.DB, { userId: 'u2' }, [BETA]);
	const sourceId = insertSource(env.DB, {
		userId: 'u1',
		characterId: ALPHA.characterId,
		trackingEnabled: true
	});
	for (let day = 1; day <= 30; day++) {
		const isBuy = day % 2 === 0;
		insertTransaction(env.DB, { userId: 'u1', sourceId, transactionId: day, typeId, isBuy });
		insertPrice(env.DB, {
			userId: 'u1',
			ref: `transaction:${day}`,
			typeId,
			incoming: isBuy,
			at: NOW - day * DAY
		});
	}
	return { env, user: sessionUser('u1', [ALPHA]), stranger: sessionUser('u2', [BETA]) };
}

const ids = (rows: LedgerRow[]) =>
	rows.map((r) =>
		r.kind === 'market' ? r.transactionId : r.kind === 'contract' ? -r.contractId : -r.entryId
	);

describe('GET /profits/data/ledger', () => {
	it('401 for anonymous visitors, 403 without a tracking connection', async () => {
		const { env, stranger } = await scenario();
		expect(await status(Promise.resolve(GET(event(env, null, '/profits/data/ledger'))))).toBe(401);
		expect(await status(Promise.resolve(GET(event(env, stranger, '/profits/data/ledger'))))).toBe(403);
	});

	it.each(['?page=2', '?direction=out&page=2', '?period=7', '?period=30&direction=in&page=9'])(
		'answers the same table page as the ledger page load for %s',
		async (search) => {
			const { env, user } = await scenario();
			const response = await GET(event(env, user, `/profits/data/ledger${search}`));
			const paged = (await response.json()) as Paged<LedgerRow>;
			const page = (await load(event(env, user, `/profits/ledger${search}`))) as LedgerPageData;
			expect(paged).toEqual(page.rows);
		}
	);

	it('pages 10 rows with the filters applied', async () => {
		const { env, user } = await scenario();
		const response = await GET(event(env, user, '/profits/data/ledger?direction=out&page=2'));
		const paged = (await response.json()) as Paged<LedgerRow>;
		expect(paged).toMatchObject({ page: 2, pageCount: 2, total: 15 });
		expect(ids(paged.rows)).toEqual([21, 23, 25, 27, 29]);
	});
});
