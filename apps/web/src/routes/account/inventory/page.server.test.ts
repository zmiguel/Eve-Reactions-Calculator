import { DEFAULT_SETTINGS, stockUnitValue } from '@reactions/engine';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryPageData } from '$lib/inventory/types';
import { loadCalc } from '$lib/server/context';
import { clearDataMemo } from '$lib/server/data';
import { INVENTORY_SOURCE_LIMIT } from '$lib/server/inventory';
import type { SessionUser } from '$lib/server/session';
import { seededEnv } from '../../../test/api';
import { FakeCookies, asEnv, type FakeEnv } from '../../../test/fakes';
import { NOW, insertUser } from '../../../test/fixtures';
import {
	addReader,
	grantInventory,
	insertItems,
	insertLocation,
	insertSource,
	poolOf,
	selectBucket,
	selection,
	typesByRole
} from '../../../test/inventory';
import { sessionUser } from '../../../test/sso';
import { actions, load } from './+page.server';

const alpha = { characterId: 90000001, name: 'Alpha' };
const beta = { characterId: 90000002, name: 'Beta' };
const gamma = { characterId: 90000003, name: 'Gamma' };
const JITA = 60003760;
const STRUCTURE = 1035466617946;
const HIDDEN = 1040000000001;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

function updaterStub(result: unknown = { instanceId: 'inventory-1-manual' }) {
	return {
		triggerInventorySync: vi.fn(async (_sourceId: number) => {
			if (result instanceof Error) throw result;
			return result;
		})
	};
}

async function accounts(UPDATER: unknown = updaterStub()) {
	const { env, sde } = await seededEnv({ UPDATER });
	insertUser(env.DB, { userId: 'u1' }, [alpha, beta]);
	insertUser(env.DB, { userId: 'u2' }, [gamma]);
	grantInventory(env.DB, alpha.characterId, ['assets', 'corp_assets']);
	grantInventory(env.DB, gamma.characterId, ['assets', 'corp_assets']);
	env.DB.sqlite.exec(
		`UPDATE characters SET corporation_id = 98000001, corporation_name = 'Seed Corp' WHERE character_id IN (${alpha.characterId}, ${gamma.characterId})`
	);
	return {
		env,
		types: typesByRole(sde.dataset),
		user: sessionUser('u1', [alpha, beta]),
		other: sessionUser('u2', [gamma])
	};
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Any request to `fetch` (ESI) answers 418 unless a fake is given. */
const noFetch: Fetch = async () => new Response('unexpected request', { status: 418 });

function event(
	env: FakeEnv,
	user: SessionUser | null,
	path: string,
	fields?: Record<string, string | string[]>,
	fetch: Fetch = noFetch
) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) for (const value of [v].flat()) body.append(k, value);
	}
	return {
		url,
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		fetch,
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function settle(promise: unknown): Promise<{ status?: number; data?: unknown; redirect?: string }> {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

const pageData = async (env: FakeEnv, user: SessionUser, fetch?: Fetch) =>
	(await load(event(env, user, '/account/inventory', undefined, fetch))) as InventoryPageData;

/** Public ESI: Beta is in Moon Corp (alliance Moon Alliance); `down` refuses everything (404, no retry). */
function esi(answer: 'ok' | 'down') {
	const calls: string[] = [];
	const fetch: Fetch = async (input, init) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		calls.push(`${url.pathname} ${init?.body ?? ''}`);
		if (answer === 'down') return Response.json({ error: 'down' }, { status: 404 });
		if (url.pathname === '/characters/affiliation') {
			return Response.json([
				{ character_id: beta.characterId, corporation_id: 98000042, alliance_id: 99000042 }
			]);
		}
		if (url.pathname === '/universe/names') {
			return Response.json([
				{ id: 98000042, name: 'Moon Corp', category: 'corporation' },
				{ id: 99000042, name: 'Moon Alliance', category: 'alliance' }
			]);
		}
		return new Response('unexpected', { status: 418 });
	};
	return { fetch, calls };
}

const sourceIds = (env: FakeEnv, userId: string) =>
	env.DB.rows<{ source_id: number }>('SELECT source_id FROM inventory_sources WHERE user_id = ?', userId).map(
		(r) => r.source_id
	);

describe('/account/inventory load', () => {
	it('sends anonymous visitors to log in and back', async () => {
		const { env } = await accounts();
		expect(await settle(load(event(env, null, '/account/inventory')))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Finventory'
		});
	});

	it('without sources: add options, Allow links and the no_sources summary', async () => {
		const { env, user } = await accounts();
		const data = await pageData(env, user);
		expect(data.sources).toEqual([]);
		expect(data.limit).toBe(INVENTORY_SOURCE_LIMIT);
		expect(data.refreshing).toBe(false);
		expect(data.addGroups).toEqual([
			{
				label: 'Personal assets',
				options: [{ value: 'character:90000001', label: 'Alpha: personal assets' }]
			},
			{
				label: 'Corporation assets',
				options: [{ value: 'corporation:90000001', label: 'Seed Corp via Alpha' }]
			}
		]);
		expect(data.allowLinks).toEqual([
			{
				characterId: beta.characterId,
				characterName: 'Beta',
				feature: 'assets',
				href: '/auth/login?purpose=feature&feature=assets&characterId=90000002&returnTo=%2Faccount%2Finventory'
			},
			{
				characterId: beta.characterId,
				characterName: 'Beta',
				feature: 'corp_assets',
				href: '/auth/login?purpose=feature&feature=corp_assets&characterId=90000002&returnTo=%2Faccount%2Finventory'
			}
		]);
		expect(data.summary).toEqual({
			formulas: [],
			materials: { fuel: [], raw: [], intermediate: [], product: [] },
			totalValue: 0,
			empty: 'no_sources'
		});
	});

	it('builds places with bucket labels and counts, and values the selected items', async () => {
		const { env, types, user, other } = await accounts();
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
			divisionNames: { '2': 'Moon goo' }
		});
		insertLocation(env.DB, personal, JITA, {
			kind: 'station',
			name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
			systemId: 30000142
		});
		insertLocation(env.DB, personal, HIDDEN, { kind: 'unknown' });
		insertLocation(env.DB, corp, STRUCTURE, {
			kind: 'structure',
			name: '671-ST - Reactor',
			systemId: 30004604
		});
		insertItems(env.DB, personal, JITA, 'hangar', { [types.formula]: 2, [types.fuel]: 100, [types.raw]: 5 });
		insertItems(env.DB, personal, JITA, 'deliveries', { [types.raw]: 1000 });
		insertItems(env.DB, personal, HIDDEN, 'hangar', { [types.product]: 3 });
		insertItems(env.DB, corp, STRUCTURE, 'div2', {
			[types.raw]: 7,
			[types.intermediate]: 4,
			[types.formula]: 1
		});
		insertItems(env.DB, corp, STRUCTURE, 'div3', { [types.fuel]: 9 });
		insertItems(env.DB, corp, STRUCTURE, 'deliveries', { [types.fuel]: 11 });
		selectBucket(env.DB, personal, JITA, 'hangar');
		selectBucket(env.DB, personal, HIDDEN, 'hangar');
		selectBucket(env.DB, corp, STRUCTURE, 'div2');
		// A selected bucket that no longer holds anything is still listed.
		selectBucket(env.DB, corp, STRUCTURE, 'div5');
		// Another account's source in the same places never shows.
		const foreign = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		insertItems(env.DB, foreign, JITA, 'hangar', { [types.fuel]: 1_000_000 });
		selectBucket(env.DB, foreign, JITA, 'hangar');

		const data = await pageData(env, user);
		expect(data.refreshing).toBe(false);
		// Both owners are added and Alpha reads the corporation: no options left.
		expect(data.addGroups).toEqual([]);
		expect(data.sources.map((s) => [s.sourceId, s.kind, s.ownerName, s.characterName, s.status])).toEqual([
			[personal, 'character', 'Alpha', 'Alpha', 'ok'],
			[corp, 'corporation', 'Seed Corp', 'Alpha', 'ok']
		]);
		expect(data.sources[0]).toMatchObject({ lastSyncedAt: NOW - 3_600_000, dataAsOf: NOW - 4_000_000 });
		expect(data.sources[0]!.places).toEqual([
			{
				locationId: JITA,
				kind: 'station',
				name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
				systemName: 'Jita',
				buckets: [
					{ bucket: 'hangar', label: 'Hangar', selected: true, formulas: 1, materials: 2 },
					{ bucket: 'deliveries', label: 'Deliveries', selected: false, formulas: 0, materials: 1 }
				]
			},
			{
				locationId: HIDDEN,
				kind: 'unknown',
				name: null,
				systemName: null,
				buckets: [{ bucket: 'hangar', label: 'Hangar', selected: true, formulas: 0, materials: 1 }]
			}
		]);
		expect(data.sources[1]!.places).toEqual([
			{
				locationId: STRUCTURE,
				kind: 'structure',
				name: '671-ST - Reactor',
				systemName: '671-ST',
				buckets: [
					{ bucket: 'div2', label: 'Moon goo', selected: true, formulas: 1, materials: 2 },
					{ bucket: 'div3', label: 'Division 3', selected: false, formulas: 0, materials: 1 },
					{ bucket: 'div5', label: 'Division 5', selected: true, formulas: 0, materials: 0 },
					{ bucket: 'deliveries', label: 'Deliveries', selected: false, formulas: 0, materials: 1 }
				]
			}
		]);

		const { summary } = data;
		expect(summary.empty).toBeNull();
		expect(summary.formulas).toHaveLength(1);
		expect(summary.formulas[0]).toMatchObject({
			blueprintTypeId: types.formula,
			count: 3,
			places: ['671-ST - Reactor · Moon goo', 'Jita IV - Moon 4 - Caldari Navy Assembly Plant · Hangar']
		});
		const quantities = Object.fromEntries(
			Object.entries(summary.materials).map(([role, list]) => [role, list.map((m) => [m.typeId, m.quantity])])
		);
		expect(quantities).toEqual({
			fuel: [[types.fuel, 100]],
			raw: [[types.raw, 12]],
			intermediate: [[types.intermediate, 4]],
			product: [[types.product, 3]]
		});
		const calc = (await loadCalc(asEnv(env), { user, settings: DEFAULT_SETTINGS }))!;
		const all = Object.values(summary.materials).flat();
		for (const m of all) {
			expect(m.name).toBe(calc.dataset.types[m.typeId]!.name);
			expect(m.unitValue).toBe(stockUnitValue(calc.ctx, m.typeId));
			expect(m.value).toBe(m.unitValue === null ? null : m.unitValue * m.quantity);
		}
		expect(all.some((m) => m.value !== null)).toBe(true);
		expect(summary.totalValue).toBeCloseTo(all.reduce((sum, m) => sum + (m.value ?? 0), 0));

		// The other account sees only its own source.
		const theirs = await pageData(env, other);
		expect(theirs.sources.map((s) => s.sourceId)).toEqual([foreign]);
		expect(theirs.summary.materials.fuel).toMatchObject([{ typeId: types.fuel, quantity: 1_000_000 }]);
	});

	it('nothing selected gives no_selection; running sources make the page refresh', async () => {
		const { env, types, user } = await accounts();
		const personal = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		insertItems(env.DB, personal, JITA, 'hangar', { [types.raw]: 5 });
		let data = await pageData(env, user);
		expect(data.summary.empty).toBe('no_selection');
		expect(data.refreshing).toBe(false);

		env.DB.sqlite.exec(`UPDATE inventory_sources SET status = 'running', sync_started_at = ${NOW - 60_000}`);
		data = await pageData(env, user);
		expect(data.refreshing).toBe(true);

		env.DB.sqlite.exec(`UPDATE inventory_sources SET sync_started_at = ${NOW - 20 * 60_000}`);
		data = await pageData(env, user);
		expect(data.refreshing).toBe(false);
		expect(data.sources[0]).toMatchObject({ status: 'error', lastError: 'sync did not finish' });
	});

	it('lists only pool members as readers and offers every corporation reader not in its pool', async () => {
		const { env, user } = await accounts();
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000001, corporation_name = 'Seed Corp' WHERE character_id = ${beta.characterId}`
		);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		let data = await pageData(env, user);
		// Beta could read Seed Corp but was not added: not a reader, offered instead.
		expect(data.sources[0]).toMatchObject({
			characterId: alpha.characterId,
			characterName: 'Alpha',
			otherReaders: []
		});
		expect(data.addGroups).toEqual([
			{
				label: 'Personal assets',
				options: [{ value: 'character:90000001', label: 'Alpha: personal assets' }]
			},
			{
				label: 'Corporation assets',
				options: [{ value: 'corporation:90000002', label: 'Seed Corp via Beta' }]
			}
		]);

		addReader(env.DB, corp, beta.characterId, NOW + 1);
		data = await pageData(env, user);
		expect(data.sources[0]!.otherReaders).toEqual([{ characterId: beta.characterId, name: 'Beta' }]);
		expect(data.addGroups.map((g) => g.label)).toEqual(['Personal assets']);

		// A pool member stays listed after moving corporations (the sync skips it); its new one is offered.
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000002, corporation_name = 'Other Corp' WHERE character_id = ${beta.characterId}`
		);
		data = await pageData(env, user);
		expect(data.sources[0]!.otherReaders).toEqual([{ characterId: beta.characterId, name: 'Beta' }]);
		expect(data.addGroups[1]).toEqual({
			label: 'Corporation assets',
			options: [{ value: 'corporation:90000002', label: 'Other Corp via Beta' }]
		});
	});

	it('looks up an unknown corporation on public ESI once, stores it and labels the option with it', async () => {
		const { env, user } = await accounts();
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
		const { fetch, calls } = esi('ok');
		const data = await pageData(env, user, fetch);
		expect(calls).toEqual([
			`/characters/affiliation [${beta.characterId}]`,
			'/universe/names [98000042,99000042]'
		]);
		expect(data.addGroups[1]).toEqual({
			label: 'Corporation assets',
			options: [
				{ value: 'corporation:90000001', label: 'Seed Corp via Alpha' },
				{ value: 'corporation:90000002', label: 'Moon Corp via Beta' }
			]
		});
		expect(
			env.DB.rows(
				'SELECT corporation_id, corporation_name, alliance_id, alliance_name, affiliation_updated_at FROM characters WHERE character_id = ?',
				beta.characterId
			)
		).toEqual([
			{
				corporation_id: 98000042,
				corporation_name: 'Moon Corp',
				alliance_id: 99000042,
				alliance_name: 'Moon Alliance',
				affiliation_updated_at: NOW
			}
		]);
	});

	it('lists a character whose corporation ESI cannot tell as unknown and not selectable', async () => {
		const { env, user } = await accounts();
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
		const data = await pageData(env, user, esi('down').fetch);
		expect(data.addGroups[1]!.options).toEqual([
			{ value: 'corporation:90000001', label: 'Seed Corp via Alpha' },
			{ value: 'corporation:90000002', label: 'Beta (corporation unknown)', disabled: true }
		]);
	});

	it("ignores another account's source of the same corporation", async () => {
		const { env, user, other } = await accounts();
		insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		const data = await pageData(env, user);
		expect(data.sources).toEqual([]);
		expect(data.addGroups[1]!.options).toEqual([
			{ value: 'corporation:90000001', label: 'Seed Corp via Alpha' }
		]);
		expect((await pageData(env, other)).sources[0]).toMatchObject({
			characterName: 'Gamma',
			otherReaders: []
		});
	});

	it('at the source limit still offers joining the pool of a corporation on the list', async () => {
		const { env, user } = await accounts();
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000001, corporation_name = 'Seed Corp' WHERE character_id = ${beta.characterId}`
		);
		insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		for (let i = 1; i < INVENTORY_SOURCE_LIMIT; i++) {
			insertSource(env.DB, {
				userId: 'u1',
				characterId: alpha.characterId,
				kind: 'corporation',
				ownerId: 98100000 + i
			});
		}
		const data = await pageData(env, user);
		expect(data.addGroups).toEqual([
			{
				label: 'Corporation assets',
				options: [{ value: 'corporation:90000002', label: 'Seed Corp via Beta' }]
			}
		]);
	});
});

describe('add', () => {
	const add = (env: FakeEnv, user: SessionUser, source: string) =>
		settle(actions.add(event(env, user, '/account/inventory?/add', { source })));

	it('creates the source and starts a sync', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		expect(await add(env, user, 'corporation:90000001')).toEqual({
			data: { notice: { ok: true, text: 'Seed Corp added. Sync started.' } }
		});
		const [sourceId] = sourceIds(env, 'u1');
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
		expect(
			env.DB.rows('SELECT user_id, character_id, kind, owner_id, owner_name, status FROM inventory_sources')
		).toEqual([
			{
				user_id: 'u1',
				character_id: alpha.characterId,
				kind: 'corporation',
				owner_id: 98000001,
				owner_name: 'Seed Corp',
				status: 'pending'
			}
		]);
		expect(poolOf(env.DB, sourceId!)).toEqual([alpha.characterId]);
	});

	it('keeps the source with a notice when the sync cannot start', async () => {
		const { env, user } = await accounts(updaterStub(new Error('connection refused')));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await add(env, user, 'character:90000001')).toEqual({
			data: {
				notice: {
					ok: false,
					text: 'Alpha: personal assets added, but the sync could not be started. Use Sync now to try again.'
				}
			}
		});
		expect(sourceIds(env, 'u1')).toHaveLength(1);
	});

	it('requires the feature: form error with the Allow link', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		expect(await add(env, user, 'character:90000002')).toEqual({
			status: 400,
			data: {
				error: 'Allow personal assets for Beta first.',
				allow: {
					characterId: beta.characterId,
					characterName: 'Beta',
					feature: 'assets',
					href: '/auth/login?purpose=feature&feature=assets&characterId=90000002&returnTo=%2Faccount%2Finventory'
				}
			}
		});
		env.DB.sqlite.exec(
			`UPDATE characters SET token_status = 'invalid' WHERE character_id = ${alpha.characterId}`
		);
		expect(await add(env, user, 'corporation:90000001')).toMatchObject({
			status: 400,
			data: { allow: { characterId: alpha.characterId, feature: 'corp_assets' } }
		});
		expect(sourceIds(env, 'u1')).toEqual([]);
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
	});

	it('refuses characters of other accounts and malformed values', async () => {
		const { env, user } = await accounts();
		for (const source of [
			'character:90000003',
			'corporation:90000003',
			'character:abc',
			'wallet:90000001',
			''
		]) {
			expect(await add(env, user, source)).toEqual({
				status: 400,
				data: { error: 'Pick one of your characters.' }
			});
		}
		expect(env.DB.rows('SELECT * FROM inventory_sources')).toEqual([]);
	});

	it('refuses a duplicate and the source after the limit', async () => {
		const { env, user } = await accounts();
		expect((await add(env, user, 'character:90000001')).data).toMatchObject({ notice: { ok: true } });
		expect(await add(env, user, 'character:90000001')).toEqual({
			status: 400,
			data: { error: 'This inventory is already on your list.' }
		});
		for (let i = 1; i < INVENTORY_SOURCE_LIMIT; i++) {
			insertSource(env.DB, {
				userId: 'u1',
				characterId: alpha.characterId,
				kind: 'corporation',
				ownerId: 98100000 + i
			});
		}
		expect(sourceIds(env, 'u1')).toHaveLength(INVENTORY_SOURCE_LIMIT);
		expect(await add(env, user, 'corporation:90000001')).toEqual({
			status: 400,
			data: { error: `You can add up to ${INVENTORY_SOURCE_LIMIT} inventories.` }
		});
		expect(sourceIds(env, 'u1')).toHaveLength(INVENTORY_SOURCE_LIMIT);
	});

	it('a corporation already on the list gets the character added to its pool, without a sync', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000001, corporation_name = 'Seed Corp' WHERE character_id = ${beta.characterId}`
		);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		expect(await add(env, user, 'corporation:90000002')).toEqual({
			data: { notice: { ok: true, text: 'Beta will also be used to read Seed Corp.' } }
		});
		expect(sourceIds(env, 'u1')).toEqual([corp]);
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId, beta.characterId]);
		expect(env.DB.rows('SELECT character_id FROM inventory_sources')).toEqual([
			{ character_id: alpha.characterId }
		]);
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();

		expect(await add(env, user, 'corporation:90000002')).toEqual({
			status: 400,
			data: { error: 'Beta already reads Seed Corp.' }
		});
	});

	it('two accounts in the same corporation each get their own source and pool', async () => {
		const UPDATER = updaterStub();
		const { env, user, other } = await accounts(UPDATER);
		expect((await add(env, user, 'corporation:90000001')).data).toMatchObject({ notice: { ok: true } });
		expect((await add(env, other, 'corporation:90000003')).data).toMatchObject({
			notice: { ok: true, text: 'Seed Corp added. Sync started.' }
		});
		const [mine] = sourceIds(env, 'u1');
		const [theirs] = sourceIds(env, 'u2');
		expect(mine).not.toBe(theirs);
		expect(poolOf(env.DB, mine!)).toEqual([alpha.characterId]);
		expect(poolOf(env.DB, theirs!)).toEqual([gamma.characterId]);
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[mine], [theirs]]);
	});

	it('joins a pool at the source limit', async () => {
		const { env, user } = await accounts();
		grantInventory(env.DB, beta.characterId, ['corp_assets']);
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000001, corporation_name = 'Seed Corp' WHERE character_id = ${beta.characterId}`
		);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		for (let i = 1; i < INVENTORY_SOURCE_LIMIT; i++) {
			insertSource(env.DB, {
				userId: 'u1',
				characterId: alpha.characterId,
				kind: 'corporation',
				ownerId: 98100000 + i
			});
		}
		expect((await add(env, user, 'corporation:90000002')).data).toMatchObject({ notice: { ok: true } });
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId, beta.characterId]);
	});

	it('is rate limited per account', async () => {
		const { env, user } = await accounts();
		const limit = vi.fn(async () => ({ success: false }));
		Object.assign(env, { ACCOUNT_RATE_LIMITER: { limit } });
		expect(await add(env, user, 'character:90000001')).toEqual({
			status: 429,
			data: { error: 'Too many requests. Wait a minute and try again.' }
		});
		expect(limit).toHaveBeenCalledWith({ key: 'inventory:u1' });
		expect(sourceIds(env, 'u1')).toEqual([]);
	});
});

describe('removeReader', () => {
	const removeReader = (env: FakeEnv, user: SessionUser, sourceId: number, characterId: number) =>
		settle(
			actions.removeReader(
				event(env, user, '/account/inventory?/removeReader', {
					sourceId: String(sourceId),
					characterId: String(characterId)
				})
			)
		);

	async function pool() {
		const accountsData = await accounts();
		const corp = insertSource(accountsData.env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		addReader(accountsData.env.DB, corp, beta.characterId, NOW + 1);
		return { ...accountsData, corp };
	}

	it('stops using a reader; the last one stays', async () => {
		const { env, user, corp } = await pool();
		expect(await removeReader(env, user, corp, beta.characterId)).toEqual({
			data: { notice: { ok: true, text: 'Beta no longer reads Seed Corp.' } }
		});
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId]);
		expect(await removeReader(env, user, corp, alpha.characterId)).toEqual({
			status: 400,
			data: { error: 'Alpha is the only character reading Seed Corp. Remove the inventory instead.' }
		});
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId]);
	});

	it('stopping the preferred reader makes another pool member preferred', async () => {
		const { env, user, corp } = await pool();
		expect((await removeReader(env, user, corp, alpha.characterId)).data).toMatchObject({
			notice: { ok: true }
		});
		expect(poolOf(env.DB, corp)).toEqual([beta.characterId]);
		expect(env.DB.rows('SELECT character_id FROM inventory_sources')).toEqual([
			{ character_id: beta.characterId }
		]);
	});

	it("cannot touch another account's pool or remove another account's character", async () => {
		const { env, user, other, corp } = await pool();
		const theirs = insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		expect(await removeReader(env, user, theirs, gamma.characterId)).toEqual({
			status: 404,
			data: { error: 'That inventory is not on your list.' }
		});
		expect(await removeReader(env, other, corp, beta.characterId)).toEqual({
			status: 404,
			data: { error: 'That inventory is not on your list.' }
		});
		expect(await removeReader(env, user, corp, gamma.characterId)).toEqual({
			status: 400,
			data: { error: 'That character does not read Seed Corp.' }
		});
		expect(poolOf(env.DB, theirs)).toEqual([gamma.characterId]);
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId, beta.characterId]);
	});

	it('a personal source has no pool: 404', async () => {
		const { env, user } = await pool();
		const personal = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect((await removeReader(env, user, personal, alpha.characterId)).status).toBe(404);
	});
});

describe('sync', () => {
	const sync = (env: FakeEnv, user: SessionUser, sourceId: number) =>
		settle(actions.sync(event(env, user, '/account/inventory?/sync', { sourceId: String(sourceId) })));

	it('calls the updater RPC for the source', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect(await sync(env, user, sourceId)).toEqual({
			data: { notice: { ok: true, text: 'Sync started.' } }
		});
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
	});

	it('busy, an unreachable updater and a missing binding become notices', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const busy = await accounts(updaterStub({ busy: true }));
		const busyId = insertSource(busy.env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect(await sync(busy.env, busy.user, busyId)).toEqual({
			data: { notice: { ok: false, text: 'A sync of this inventory is already running.' } }
		});

		const unavailable = { ok: false, text: 'The sync could not be started right now. Try again later.' };
		const down = await accounts(updaterStub(new Error('connection refused')));
		const downId = insertSource(down.env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect(await sync(down.env, down.user, downId)).toEqual({ data: { notice: unavailable } });

		const missing = await accounts();
		Reflect.deleteProperty(missing.env, 'UPDATER');
		const missingId = insertSource(missing.env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect(await sync(missing.env, missing.user, missingId)).toEqual({ data: { notice: unavailable } });
	});

	it('before the ESI data expires: a notice, without calling the updater', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp',
			dataExpiresAt: NOW + 5 * 60_000
		});
		expect(await sync(env, user, sourceId)).toEqual({
			data: { notice: { ok: false, text: 'ESI has no newer data for Seed Corp before 12:05 UTC.' } }
		});
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();

		// Expired: the updater is asked, and its own notBefore answer becomes the same notice.
		env.DB.sqlite.exec(`UPDATE inventory_sources SET data_expires_at = ${NOW}`);
		const refused = await accounts(updaterStub({ notBefore: Date.UTC(2026, 9, 7, 1, 30) }));
		const refusedId = insertSource(refused.env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha'
		});
		expect(await sync(refused.env, refused.user, refusedId)).toEqual({
			data: { notice: { ok: false, text: 'ESI has no newer data for Alpha before 2026-10-07 01:30 UTC.' } }
		});
		expect(await sync(env, user, sourceId)).toEqual({
			data: { notice: { ok: true, text: 'Sync started.' } }
		});
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
	});

	it('is rate limited per account', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		Object.assign(env, { ACCOUNT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } });
		expect(await sync(env, user, sourceId)).toEqual({
			status: 429,
			data: { error: 'Too many requests. Wait a minute and try again.' }
		});
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
	});

	it("another account's source is a 404", async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		expect(await sync(env, user, theirs)).toEqual({
			status: 404,
			data: { error: 'That inventory is not on your list.' }
		});
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
	});
});

describe('remove', () => {
	it("deletes only the caller's source with its data; another account's id is a 404", async () => {
		const { env, types, user } = await accounts();
		const mine = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		for (const id of [mine, theirs]) {
			insertLocation(env.DB, id, JITA, { name: 'Jita 4-4' });
			insertItems(env.DB, id, JITA, 'hangar', { [types.raw]: 5 });
			selectBucket(env.DB, id, JITA, 'hangar');
		}
		const remove = (sourceId: number) =>
			settle(actions.remove(event(env, user, '/account/inventory?/remove', { sourceId: String(sourceId) })));

		expect(await remove(theirs)).toEqual({
			status: 404,
			data: { error: 'That inventory is not on your list.' }
		});
		expect(await remove(mine)).toEqual({ data: { notice: { ok: true, text: 'Inventory removed.' } } });
		expect(await remove(mine)).toMatchObject({ status: 404 });
		for (const table of [
			'inventory_sources',
			'inventory_locations',
			'inventory_items',
			'inventory_selection'
		]) {
			expect(env.DB.rows<{ source_id: number }>(`SELECT source_id FROM ${table}`)).toEqual([
				{ source_id: theirs }
			]);
		}
	});
});

describe('select', () => {
	it("accepts only buckets of the caller's sources", async () => {
		const { env, types, user } = await accounts();
		const mine = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001
		});
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		insertItems(env.DB, mine, JITA, 'hangar', { [types.raw]: 5 });
		insertItems(env.DB, mine, STRUCTURE, 'deliveries', { [types.fuel]: 5 });
		insertItems(env.DB, mine, STRUCTURE, 'jobs', { [types.formula]: 1 });
		insertItems(env.DB, corp, STRUCTURE, 'div4', { [types.raw]: 5 });
		insertItems(env.DB, theirs, HIDDEN, 'hangar', { [types.raw]: 5 });
		const select = (fields: Record<string, string | string[]>) =>
			settle(actions.select(event(env, user, '/account/inventory?/select', fields)));
		const saved = { data: { notice: { ok: true, text: 'Selection saved.' } } };
		const bad = { status: 400, data: { error: 'Pick places of this inventory.' } };

		expect(
			await select({ sourceId: String(mine), place: [`${JITA}:hangar`, `${STRUCTURE}:deliveries`] })
		).toEqual(saved);
		expect(selection(env.DB, mine)).toEqual([`${JITA}:hangar`, `${STRUCTURE}:deliveries`]);
		expect(await select({ sourceId: String(mine), place: `${JITA}:hangar` })).toEqual(saved);
		expect(selection(env.DB, mine)).toEqual([`${JITA}:hangar`]);
		expect(await select({ sourceId: String(mine), place: `${STRUCTURE}:jobs` })).toEqual(saved);
		expect(selection(env.DB, mine)).toEqual([`${STRUCTURE}:jobs`]);
		expect(await select({ sourceId: String(mine), place: `${JITA}:hangar` })).toEqual(saved);
		expect(selection(env.DB, mine)).toEqual([`${JITA}:hangar`]);

		// Buckets of another source of the account, of another account, or malformed: nothing changes.
		for (const place of [`${STRUCTURE}:div4`, `${HIDDEN}:hangar`, `${JITA}:cargo`, 'jita:hangar']) {
			expect(await select({ sourceId: String(mine), place })).toEqual(bad);
		}
		expect(selection(env.DB, mine)).toEqual([`${JITA}:hangar`]);

		expect(await select({ sourceId: String(theirs), place: `${HIDDEN}:hangar` })).toEqual({
			status: 404,
			data: { error: 'That inventory is not on your list.' }
		});
		expect(await select({ sourceId: String(theirs), mode: 'all' })).toMatchObject({ status: 404 });
		expect(selection(env.DB, theirs)).toEqual([]);

		// Select all / none ignore the posted places.
		expect(await select({ sourceId: String(mine), mode: 'all', place: `${HIDDEN}:hangar` })).toEqual(saved);
		expect(selection(env.DB, mine)).toEqual([
			`${JITA}:hangar`,
			`${STRUCTURE}:deliveries`,
			`${STRUCTURE}:jobs`
		]);
		expect(await select({ sourceId: String(mine), mode: 'none', place: `${JITA}:hangar` })).toEqual(saved);
		expect(selection(env.DB, mine)).toEqual([]);
		expect(selection(env.DB, corp)).toEqual([]);
	});
});
