import type { SdeDataset } from '@reactions/sde';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManualActionResult, ManualAddPageData, ManualEntryView } from '#lib/ledger/types.js';
import type { Paged } from '#lib/paging.js';
import { clearDataMemo } from '#lib/server/data.js';
import { MESSAGES } from '#lib/server/manual-entries.js';
import { requestEvent, settle } from '../../../../test/actions';
import { fakeEnv } from '../../../../test/fakes';
import { NOW, insertUser, loadSde, putKv } from '../../../../test/fixtures';
import { insertSource } from '../../../../test/inventory';
import { insertManualEntry, manualEntries } from '../../../../test/ledger';
import { sessionUser } from '../../../../test/sso';
import { GET } from '../../data/manual-entries/+server';
import { actions, load } from './+page.server';

const ALPHA = { characterId: 90000001, name: 'Alpha' };
const BETA = { characterId: 90000002, name: 'Beta' };
const DAY = 86_400_000;

let sde: SdeDataset;
let ITEM: { typeId: number; name: string };
beforeAll(async () => {
	sde = await loadSde();
	const t = sde.dataset.types[sde.dataset.reactions[0].materials[0].typeId];
	ITEM = { typeId: t.typeId, name: t.name };
});
beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

/** u1 tracks Alpha; u2 is logged in without any tracking connection. */
async function setup(extra: Record<string, unknown> = {}) {
	const rebuildLedger = vi.fn(async (_userId: string) => ({
		rebuiltAt: NOW,
		lots: 0,
		jobs: 0,
		needsReview: 0
	}));
	const env = fakeEnv({ UPDATER: { rebuildLedger }, ...extra } as never);
	await putKv(env, sde);
	insertUser(env.DB, { userId: 'u1' }, [ALPHA]);
	insertUser(env.DB, { userId: 'u2' }, [BETA]);
	insertSource(env.DB, { userId: 'u1', characterId: ALPHA.characterId, trackingEnabled: true });
	return { env, rebuildLedger, user: sessionUser('u1', [ALPHA]), other: sessionUser('u2', [BETA]) };
}

const PATH = '/profits/ledger/add';
const form = (fields: Record<string, string> = {}) => ({
	item: ITEM.name,
	typeId: '',
	date: '2026-10-01',
	quantity: '1,000',
	unitPrice: '12.5',
	note: '',
	...fields
});

describe('/profits/ledger/add load', () => {
	it('returns empty data without work for anonymous visitors and accounts without tracking', async () => {
		const { env, other } = await setup();
		insertManualEntry(env.DB, 'u2', { typeId: ITEM.typeId });
		for (const visitor of [null, other]) {
			const data = (await load(requestEvent(env, visitor, PATH))) as ManualAddPageData;
			expect(data).toMatchObject({ choices: [], today: '2026-10-06', entries: { rows: [], total: 0 } });
		}
	});

	it('offers the item choices, today and the user’s purchases', async () => {
		const { env, user } = await setup();
		insertManualEntry(env.DB, 'u1', { typeId: ITEM.typeId, date: NOW - DAY });
		insertManualEntry(env.DB, 'u2', { typeId: ITEM.typeId });
		const data = (await load(requestEvent(env, user, PATH))) as ManualAddPageData;
		expect(data.today).toBe('2026-10-06');
		expect(data.choices[0].group).toBe('material');
		expect(data.entries.rows.map((r) => r.typeId)).toEqual([ITEM.typeId]);
	});
});

describe('GET /profits/data/manual-entries', () => {
	it('401 for anonymous visitors, 403 without a tracking connection', async () => {
		const { env, other } = await setup();
		expect(await settle(GET(requestEvent(env, null, '/profits/data/manual-entries')))).toEqual({
			error: 401
		});
		expect(await settle(GET(requestEvent(env, other, '/profits/data/manual-entries')))).toEqual({
			error: 403
		});
	});

	it.each(['', '?page=2', '?page=7'])('answers the same page as the load for %s', async (search) => {
		const { env, user } = await setup();
		for (let i = 1; i <= 13; i++)
			insertManualEntry(env.DB, 'u1', { typeId: ITEM.typeId, date: NOW - i * DAY });
		const response = await GET(requestEvent(env, user, `/profits/data/manual-entries${search}`));
		const paged = (await response.json()) as Paged<ManualEntryView>;
		const data = (await load(requestEvent(env, user, `${PATH}${search}`))) as ManualAddPageData;
		expect(paged).toEqual(data.entries);
	});
});

describe('/profits/ledger/add actions', () => {
	it('sends anonymous visitors to log in and answers 404 without tracking', async () => {
		const { env, other } = await setup();
		const anonymous = await settle(actions.add(requestEvent(env, null, `${PATH}?/add`, form())));
		expect(anonymous.redirect).toMatch(/^\/auth\/login\?purpose=login&returnTo=/);
		expect(await settle(actions.add(requestEvent(env, other, `${PATH}?/add`, form())))).toEqual({
			error: 404
		});
		expect(manualEntries(env.DB, 'u2')).toEqual([]);
	});

	it('adds one purchase from the typed name (works without JS) and asks for a rebuild', async () => {
		const { env, user, rebuildLedger } = await setup();
		const result = await settle(
			actions.add(
				requestEvent(env, user, `${PATH}?/add`, form({ item: ITEM.name.toLowerCase(), note: ' gift ' }))
			)
		);
		expect(result.data).toEqual({
			action: 'add',
			notice: `Purchase of ${ITEM.name} added. Results recalculated.`
		} satisfies ManualActionResult);
		expect(manualEntries(env.DB, 'u1')).toEqual([
			{
				entry_id: 1,
				date: Date.UTC(2026, 9, 1),
				type_id: ITEM.typeId,
				quantity: 1000,
				unit_price: 12.5,
				note: 'gift'
			}
		]);
		expect(rebuildLedger).toHaveBeenCalledWith('u1');
	});

	it.each([
		['an unknown item', { item: 'Nothing like this' }, MESSAGES.item],
		['a future date', { date: '2026-10-07' }, MESSAGES.future],
		['a quantity of 0', { quantity: '0' }, MESSAGES.quantity],
		['a negative price', { unitPrice: '-3' }, MESSAGES.price]
	])('rejects %s with 400 and keeps the values', async (_case, fields, message) => {
		const { env, user, rebuildLedger } = await setup();
		const values = form(fields);
		const result = await settle(actions.add(requestEvent(env, user, `${PATH}?/add`, values)));
		expect(result).toEqual({ status: 400, data: { action: 'add', error: message, values } });
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it('is rate limited like the other ledger actions', async () => {
		const limit = vi.fn(async () => ({ success: false }));
		const { env, user } = await setup({ ACCOUNT_RATE_LIMITER: { limit } });
		const result = await settle(actions.add(requestEvent(env, user, `${PATH}?/add`, form())));
		expect(result.status).toBe(429);
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
	});

	it('checks an import without storing it, then adds the readable lines', async () => {
		const { env, user, rebuildLedger } = await setup();
		const text = `2026-10-01 ${ITEM.name} 10 5\nnonsense\n2026-10-02\t${ITEM.name}\t2,000\t1,000.5`;
		const checked = await settle(actions.check(requestEvent(env, user, `${PATH}?/check`, { text })));
		expect(checked.data).toEqual({
			action: 'check',
			// Form fields carry CRLF line endings, as browsers send them.
			text: text.replace(/\n/g, '\r\n'),
			preview: {
				rows: [
					{
						line: 1,
						at: Date.UTC(2026, 9, 1),
						typeId: ITEM.typeId,
						name: ITEM.name,
						quantity: 10,
						unitPrice: 5
					},
					{
						line: 3,
						at: Date.UTC(2026, 9, 2),
						typeId: ITEM.typeId,
						name: ITEM.name,
						quantity: 2000,
						unitPrice: 1000.5
					}
				],
				errors: [{ line: 2, message: MESSAGES.shape }]
			}
		});
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();

		const imported = await settle(actions.import(requestEvent(env, user, `${PATH}?/import`, { text })));
		expect(imported.data).toEqual({
			action: 'import',
			notice: '2 purchases added. 1 line was left out. Results recalculated.'
		});
		expect(manualEntries(env.DB, 'u1').map((e) => e.quantity)).toEqual([10, 2000]);
		expect(rebuildLedger).toHaveBeenCalledTimes(1);
	});

	it('refuses an empty check and an import with no readable line', async () => {
		const { env, user } = await setup();
		expect(
			await settle(actions.check(requestEvent(env, user, `${PATH}?/check`, { text: '  ' })))
		).toMatchObject({
			status: 400
		});
		const result = await settle(actions.import(requestEvent(env, user, `${PATH}?/import`, { text: 'nope' })));
		expect(result).toMatchObject({ status: 400, data: { action: 'import', preview: { rows: [] } } });
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
	});

	it('refuses a text that is too long without sending it back', async () => {
		const { env, user, rebuildLedger } = await setup();
		const text = `2026-10-01 ${ITEM.name} 10 5\n`.repeat(5000);
		for (const action of ['check', 'import'] as const) {
			const result = await settle(actions[action](requestEvent(env, user, `${PATH}?/${action}`, { text })));
			expect(result).toMatchObject({ status: 400, data: { action } });
			expect(result.data).not.toHaveProperty('text');
			expect(result.data).not.toHaveProperty('preview');
		}
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it("deletes the user's purchase, never another user's", async () => {
		const { env, user, rebuildLedger } = await setup();
		const mine = insertManualEntry(env.DB, 'u1', { typeId: ITEM.typeId });
		const theirs = insertManualEntry(env.DB, 'u2', { typeId: ITEM.typeId });
		const refused = await settle(
			actions.remove(requestEvent(env, user, `${PATH}?/remove`, { entryId: String(theirs) }))
		);
		expect(refused).toMatchObject({ status: 404, data: { action: 'remove', entryId: theirs } });
		expect(manualEntries(env.DB, 'u2')).toHaveLength(1);
		expect(rebuildLedger).not.toHaveBeenCalled();
		const removed = await settle(
			actions.remove(requestEvent(env, user, `${PATH}?/remove`, { entryId: String(mine) }))
		);
		expect(removed.data).toEqual({
			action: 'remove',
			entryId: mine,
			notice: 'Purchase deleted. Results recalculated.'
		});
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).toHaveBeenCalledWith('u1');
	});
});
