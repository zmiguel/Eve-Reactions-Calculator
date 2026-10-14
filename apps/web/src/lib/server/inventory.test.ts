import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, insertUser, loadSde, putKv } from '../../test/fixtures';
import {
	addReader,
	grantInventory,
	insertItems,
	insertSource,
	poolOf,
	selectBucket,
	selection,
	typesByRole
} from '../../test/inventory';
import { getCharacter } from './auth/accounts';
import { clearDataMemo } from './data';
import {
	STALE_SYNC_ERROR,
	addSource,
	bucketLabel,
	getUserInventory,
	listSources,
	removeReader,
	saveSelection
} from './inventory';

const alpha = { characterId: 90000001, name: 'Alpha' };
const beta = { characterId: 90000002, name: 'Beta' };
const gamma = { characterId: 90000003, name: 'Gamma' };
const JITA = 60003760;
const STRUCTURE = 1035466617946;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

async function accounts() {
	const env = fakeEnv();
	const sde = await loadSde();
	await putKv(env, sde);
	insertUser(env.DB, { userId: 'u1' }, [alpha]);
	insertUser(env.DB, { userId: 'u2' }, [gamma]);
	return { env, types: typesByRole(sde.dataset) };
}

describe('getUserInventory', () => {
	it('sums the selected buckets of ok/error sources and splits formulas from stock', async () => {
		const { env, types } = await accounts();
		const personal = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha'
		});
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp',
			status: 'error',
			lastSyncedAt: NOW - 7_200_000
		});
		const pending = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000002,
			status: 'running',
			syncStartedAt: NOW
		});
		insertItems(env.DB, personal, JITA, 'hangar', { [types.formula]: 2, [types.fuel]: 100, [types.raw]: 5 });
		insertItems(env.DB, personal, JITA, 'deliveries', { [types.raw]: 1000 });
		insertItems(env.DB, personal, STRUCTURE, 'hangar', { [types.raw]: 7, [types.product]: 3 });
		// Formulas installed in reaction jobs count as formulas when selected.
		insertItems(env.DB, personal, STRUCTURE, 'jobs', { [types.formula]: 1 });
		insertItems(env.DB, personal, JITA, 'jobs', { [types.formula]: 5 });
		insertItems(env.DB, corp, STRUCTURE, 'div2', { [types.fuel]: 40, [types.formula]: 1 });
		insertItems(env.DB, corp, STRUCTURE, 'div3', { [types.intermediate]: 9 });
		insertItems(env.DB, pending, JITA, 'hangar', { [types.intermediate]: 500 });
		selectBucket(env.DB, personal, JITA, 'hangar');
		selectBucket(env.DB, personal, STRUCTURE, 'hangar');
		selectBucket(env.DB, personal, STRUCTURE, 'jobs');
		selectBucket(env.DB, corp, STRUCTURE, 'div2');
		selectBucket(env.DB, pending, JITA, 'hangar');

		// Another account with the same owner and places: never counted.
		const other = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		insertItems(env.DB, other, JITA, 'hangar', { [types.fuel]: 1_000_000, [types.formula]: 50 });
		selectBucket(env.DB, other, JITA, 'hangar');

		const inventory = await getUserInventory(asEnv(env), 'u1');
		expect(inventory.formulas).toEqual({ [types.formula]: 4 });
		expect(inventory.stock).toEqual({ [types.fuel]: 140, [types.raw]: 12, [types.product]: 3 });
		expect(inventory.sources).toEqual([
			{
				sourceId: personal,
				ownerName: 'Alpha',
				kind: 'character',
				status: 'ok',
				lastSyncedAt: NOW - 3_600_000,
				dataAsOf: NOW - 4_000_000
			},
			{
				sourceId: corp,
				ownerName: 'Seed Corp',
				kind: 'corporation',
				status: 'error',
				lastSyncedAt: NOW - 7_200_000,
				dataAsOf: NOW - 4_000_000
			}
		]);
		expect(inventory.oldestSyncAt).toBe(NOW - 7_200_000);

		expect(await getUserInventory(asEnv(env), 'u3')).toEqual({
			stock: {},
			formulas: {},
			sources: [],
			oldestSyncAt: null
		});
	});

	it('leaves out connections with Inventory off; their data is kept', async () => {
		const { env, types } = await accounts();
		const on = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId, ownerName: 'Alpha' });
		const off = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp',
			inventoryEnabled: false,
			trackingEnabled: true
		});
		insertItems(env.DB, on, JITA, 'hangar', { [types.raw]: 5 });
		insertItems(env.DB, off, JITA, 'hangar', { [types.raw]: 100, [types.formula]: 1 });
		selectBucket(env.DB, on, JITA, 'hangar');
		selectBucket(env.DB, off, JITA, 'hangar');

		const inventory = await getUserInventory(asEnv(env), 'u1');
		expect(inventory.stock).toEqual({ [types.raw]: 5 });
		expect(inventory.formulas).toEqual({});
		expect(inventory.sources.map((s) => s.sourceId)).toEqual([on]);
		expect(env.DB.rows('SELECT quantity FROM inventory_items WHERE source_id = ?', off)).toHaveLength(2);
	});
});

describe('listSources', () => {
	it('marks syncs running for more than 15 minutes as error, as the updater does', async () => {
		const { env } = await accounts();
		const stale = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			status: 'running',
			syncStartedAt: NOW - 15 * 60_000
		});
		const fresh = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			status: 'running',
			syncStartedAt: NOW - 14 * 60_000
		});
		const otherStale = insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			status: 'running',
			syncStartedAt: NOW - 60 * 60_000
		});
		const listed = await listSources(asEnv(env), 'u1');
		expect(listed.map((s) => [s.sourceId, s.status, s.lastError, s.characterName])).toEqual([
			[stale, 'error', STALE_SYNC_ERROR, 'Alpha'],
			[fresh, 'running', null, 'Alpha']
		]);
		expect(
			env.DB.rows('SELECT source_id, status, last_error FROM inventory_sources ORDER BY source_id')
		).toEqual([
			{ source_id: stale, status: 'error', last_error: STALE_SYNC_ERROR },
			{ source_id: fresh, status: 'running', last_error: null },
			{ source_id: otherStale, status: 'running', last_error: null }
		]);
	});
});

describe('addSource corporation lookup', () => {
	const corpFetch = (answer: 'ok' | 'down') => {
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input instanceof Request ? input.url : input));
			calls.push(`${url.pathname} ${init?.body ?? ''}`);
			if (answer === 'down') return Response.json({ error: 'not found' }, { status: 404 });
			if (url.pathname === '/characters/affiliation') {
				return Response.json([{ character_id: alpha.characterId, corporation_id: 98000042 }]);
			}
			if (url.pathname === '/universe/names') {
				return Response.json([{ id: 98000042, name: 'Moon Corp', category: 'corporation' }]);
			}
			return new Response('unexpected', { status: 418 });
		});
		return { fetch, calls };
	};

	async function corpCharacter(env: FakeEnv) {
		grantInventory(env.DB, alpha.characterId, ['corp_assets']);
		return (await getCharacter(asEnv(env), alpha.characterId))!;
	}

	it('uses the affiliation columns when the daily job filled them', async () => {
		const { env } = await accounts();
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000001, corporation_name = 'Seed Corp' WHERE character_id = ${alpha.characterId}`
		);
		const { fetch, calls } = corpFetch('ok');
		const outcome = await addSource(asEnv(env), fetch, 'u1', await corpCharacter(env), 'corporation');
		expect(outcome).toMatchObject({ ok: true, ownerName: 'Seed Corp', inventory: true, tracking: false });
		expect(calls).toEqual([]);
		const [source] = env.DB.rows<{ source_id: number }>('SELECT source_id FROM inventory_sources');
		expect(
			env.DB.rows('SELECT kind, owner_id, owner_name, status, character_id FROM inventory_sources')
		).toEqual([
			{
				kind: 'corporation',
				owner_id: 98000001,
				owner_name: 'Seed Corp',
				status: 'pending',
				character_id: alpha.characterId
			}
		]);
		expect(poolOf(env.DB, source.source_id)).toEqual([alpha.characterId]);
	});

	it('else asks public ESI for the affiliation and the corporation name', async () => {
		const { env } = await accounts();
		const { fetch, calls } = corpFetch('ok');
		const outcome = await addSource(asEnv(env), fetch, 'u1', await corpCharacter(env), 'corporation');
		expect(outcome).toMatchObject({ ok: true, ownerName: 'Moon Corp' });
		expect(calls).toEqual([`/characters/affiliation [${alpha.characterId}]`, '/universe/names [98000042]']);
		expect(env.DB.rows('SELECT owner_id, owner_name FROM inventory_sources')).toEqual([
			{ owner_id: 98000042, owner_name: 'Moon Corp' }
		]);
		// Learned for the add options.
		expect(
			env.DB.rows(
				'SELECT corporation_id, corporation_name FROM characters WHERE character_id = ?',
				alpha.characterId
			)
		).toEqual([{ corporation_id: 98000042, corporation_name: 'Moon Corp' }]);
	});

	/** Beta joins account u1, in Moon Corp with corporation assets. */
	function addBeta(env: FakeEnv) {
		env.DB.sqlite.exec(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, created_at, corporation_id, corporation_name)
			VALUES (${beta.characterId}, 'u1', 'Beta', 'hash-b', 2, 98000042, 'Moon Corp')`
		);
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
	}

	it('a corporation already on the list gets the character added to its pool, without a new source', async () => {
		const { env } = await accounts();
		addBeta(env);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: beta.characterId,
			kind: 'corporation',
			ownerId: 98000042,
			ownerName: 'Moon Corp',
			createdAt: NOW - 60_000
		});
		const { fetch, calls } = corpFetch('ok');
		const outcome = await addSource(asEnv(env), fetch, 'u1', await corpCharacter(env), 'corporation');
		expect(outcome).toEqual({
			ok: true,
			joined: true,
			message: 'Alpha will also be used to read Moon Corp.'
		});
		// Only the public corporation lookup; no asset call.
		expect(calls).toEqual([`/characters/affiliation [${alpha.characterId}]`, '/universe/names [98000042]']);
		expect(env.DB.rows('SELECT source_id, character_id FROM inventory_sources')).toEqual([
			{ source_id: corp, character_id: beta.characterId }
		]);
		expect(poolOf(env.DB, corp)).toEqual([beta.characterId, alpha.characterId]);

		const again = await addSource(asEnv(env), fetch, 'u1', await corpCharacter(env), 'corporation');
		expect(again).toEqual({ ok: false, message: 'Alpha already reads Moon Corp.' });
		expect(poolOf(env.DB, corp)).toEqual([beta.characterId, alpha.characterId]);
	});

	it("never joins another account's source of the same corporation: each account gets its own", async () => {
		const { env } = await accounts();
		grantInventory(env.DB, gamma.characterId, ['corp_assets']);
		const theirs = insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			kind: 'corporation',
			ownerId: 98000042,
			ownerName: 'Moon Corp'
		});
		const { fetch } = corpFetch('ok');
		const outcome = await addSource(asEnv(env), fetch, 'u1', await corpCharacter(env), 'corporation');
		expect(outcome).toMatchObject({ ok: true, ownerName: 'Moon Corp' });
		if (!outcome.ok || outcome.joined) throw new Error('expected a new source');
		const ours = outcome.sourceId;
		expect(ours).not.toBe(theirs);
		expect(env.DB.rows('SELECT user_id, owner_id FROM inventory_sources ORDER BY source_id')).toEqual([
			{ user_id: 'u2', owner_id: 98000042 },
			{ user_id: 'u1', owner_id: 98000042 }
		]);
		expect(poolOf(env.DB, ours)).toEqual([alpha.characterId]);
		expect(poolOf(env.DB, theirs)).toEqual([gamma.characterId]);
	});

	it("refuses another account's character", async () => {
		const { env } = await accounts();
		grantInventory(env.DB, gamma.characterId, ['corp_assets']);
		const { fetch, calls } = corpFetch('ok');
		const gammaRow = (await getCharacter(asEnv(env), gamma.characterId))!;
		expect(await addSource(asEnv(env), fetch, 'u1', gammaRow, 'corporation')).toEqual({
			ok: false,
			message: 'Pick one of your characters.'
		});
		expect(calls).toEqual([]);
		expect(env.DB.rows('SELECT * FROM inventory_sources')).toEqual([]);
	});

	it('adds nothing when ESI does not answer', async () => {
		const { env } = await accounts();
		const { fetch } = corpFetch('down');
		const outcome = await addSource(asEnv(env), fetch, 'u1', await corpCharacter(env), 'corporation');
		expect(outcome).toEqual({ ok: false, message: 'EVE Online did not answer. Try again later.' });
		expect(env.DB.rows('SELECT * FROM inventory_sources')).toEqual([]);
	});
});

describe('removeReader', () => {
	async function pool() {
		const { env } = await accounts();
		env.DB.sqlite.exec(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (${beta.characterId}, 'u1', 'Beta', 'hash-b', 2)`
		);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		addReader(env.DB, corp, beta.characterId, NOW + 1);
		return { env, corp };
	}

	const preferred = (env: FakeEnv, sourceId: number) =>
		env.DB.rows('SELECT character_id FROM inventory_sources WHERE source_id = ?', sourceId)[0];

	it('takes a non-preferred reader out of the pool', async () => {
		const { env, corp } = await pool();
		expect(await removeReader(asEnv(env), 'u1', corp, beta.characterId)).toEqual({
			ok: true,
			message: 'Beta no longer reads Seed Corp.'
		});
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId]);
		expect(preferred(env, corp)).toEqual({ character_id: alpha.characterId });
	});

	it('hands the source to another pool member when the preferred reader is taken out', async () => {
		const { env, corp } = await pool();
		expect(await removeReader(asEnv(env), 'u1', corp, alpha.characterId)).toMatchObject({ ok: true });
		expect(poolOf(env.DB, corp)).toEqual([beta.characterId]);
		expect(preferred(env, corp)).toEqual({ character_id: beta.characterId });
	});

	it('keeps the last pool member', async () => {
		const { env, corp } = await pool();
		await removeReader(asEnv(env), 'u1', corp, beta.characterId);
		expect(await removeReader(asEnv(env), 'u1', corp, alpha.characterId)).toEqual({
			ok: false,
			status: 400,
			message: 'Alpha is the only character reading Seed Corp. Remove the connection instead.'
		});
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId]);
	});

	it("refuses another account's source and characters outside the pool", async () => {
		const { env, corp } = await pool();
		const theirs = insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			kind: 'corporation',
			ownerId: 98000001
		});
		addReader(env.DB, theirs, beta.characterId, NOW + 1);
		// A bad row linking u2's character to u1's source is never treated as a reader.
		addReader(env.DB, corp, gamma.characterId, NOW + 2);
		expect(await removeReader(asEnv(env), 'u1', theirs, beta.characterId)).toMatchObject({
			ok: false,
			status: 404
		});
		expect(await removeReader(asEnv(env), 'u1', corp, gamma.characterId)).toEqual({
			ok: false,
			status: 400,
			message: 'That character does not read Seed Corp.'
		});
		expect(poolOf(env.DB, theirs)).toEqual([gamma.characterId, beta.characterId]);
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId, beta.characterId, gamma.characterId]);
	});
});

describe('saveSelection', () => {
	it('replaces the selection with buckets of the source only', async () => {
		const { env, types } = await accounts();
		const source = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		const other = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		insertItems(env.DB, source, JITA, 'hangar', { [types.raw]: 1 });
		insertItems(env.DB, source, JITA, 'deliveries', { [types.raw]: 1 });
		insertItems(env.DB, other, STRUCTURE, 'hangar', { [types.raw]: 1 });
		// A selected bucket whose items are gone stays selectable.
		selectBucket(env.DB, source, STRUCTURE, 'div1');
		const e = asEnv(env);

		expect(
			await saveSelection(e, 'u1', source, { places: [{ locationId: JITA, bucket: 'deliveries' }] })
		).toBe('saved');
		expect(selection(env.DB, source)).toEqual([`${JITA}:deliveries`]);

		expect(
			await saveSelection(e, 'u1', source, { places: [{ locationId: STRUCTURE, bucket: 'hangar' }] })
		).toBe('invalid');
		expect(await saveSelection(e, 'u1', source, { places: [{ locationId: JITA, bucket: 'div1' }] })).toBe(
			'invalid'
		);
		expect(selection(env.DB, source)).toEqual([`${JITA}:deliveries`]);

		expect(await saveSelection(e, 'u1', source, { mode: 'all' })).toBe('saved');
		expect(selection(env.DB, source)).toEqual([`${JITA}:deliveries`, `${JITA}:hangar`]);
		expect(await saveSelection(e, 'u1', source, { mode: 'none' })).toBe('saved');
		expect(selection(env.DB, source)).toEqual([]);

		expect(await saveSelection(e, 'u1', other, { mode: 'all' })).toBe('missing');
		expect(selection(env.DB, other)).toEqual([]);
	});

	it('keeps a selected bucket without items selectable', async () => {
		const { env } = await accounts();
		const source = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		selectBucket(env.DB, source, STRUCTURE, 'hangar');
		expect(
			await saveSelection(asEnv(env), 'u1', source, { places: [{ locationId: STRUCTURE, bucket: 'hangar' }] })
		).toBe('saved');
		expect(selection(env.DB, source)).toEqual([`${STRUCTURE}:hangar`]);
	});

	it('writes selections larger than one insert chunk', async () => {
		const { env } = await accounts();
		const source = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		for (let i = 0; i < 40; i++) insertItems(env.DB, source, JITA + i, 'hangar', { 34: 1 });
		expect(await saveSelection(asEnv(env), 'u1', source, { mode: 'all' })).toBe('saved');
		expect(selection(env.DB, source)).toHaveLength(40);
	});
});

describe('bucketLabel', () => {
	it('names hangars, deliveries, industry jobs and divisions with the "Division N" fallback', () => {
		const names = { '2': 'Moon goo' };
		expect(bucketLabel('hangar', names)).toBe('Hangar');
		expect(bucketLabel('deliveries', names)).toBe('Deliveries');
		expect(bucketLabel('jobs', names)).toBe('Industry jobs');
		expect(bucketLabel('div2', names)).toBe('Moon goo');
		expect(bucketLabel('div7', names)).toBe('Division 7');
	});
});
