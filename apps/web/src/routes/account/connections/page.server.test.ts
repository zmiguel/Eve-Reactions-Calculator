import { DEFAULT_SETTINGS } from '@reactions/engine';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionsPageData } from '$lib/inventory/types';
import { clearDataMemo } from '$lib/server/data';
import { INVENTORY_SOURCE_LIMIT } from '$lib/server/inventory';
import type { SessionUser } from '$lib/server/session';
import { seededEnv } from '../../../test/api';
import { FakeCookies, type FakeEnv } from '../../../test/fakes';
import { NOW, insertUser } from '../../../test/fixtures';
import {
	addReader,
	grantInventory,
	insertItems,
	insertLocation,
	insertSource,
	insertStream,
	poolOf,
	selectBucket,
	typesByRole
} from '../../../test/inventory';
import { sessionUser } from '../../../test/sso';
import { actions, load } from './+page.server';

const alpha = { characterId: 90000001, name: 'Alpha' };
const beta = { characterId: 90000002, name: 'Beta' };
const gamma = { characterId: 90000003, name: 'Gamma' };
const JITA = 60003760;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

/** Updater RPC stub: `result` answers both sync triggers (an Error is thrown); rebuilds succeed. */
function updaterStub(result: unknown = { instanceId: 'sync-1-manual' }) {
	const answer = async () => {
		if (result instanceof Error) throw result;
		return result;
	};
	return {
		triggerInventorySync: vi.fn(async (_sourceId: number) => answer()),
		triggerTrackingSync: vi.fn(async (_sourceId: number) => answer()),
		rebuildLedger: vi.fn(async (_userId: string) => ({ rebuiltAt: NOW, lots: 0, jobs: 0, needsReview: 0 }))
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
	(await load(event(env, user, '/account/connections', undefined, fetch))) as ConnectionsPageData;

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

const allowHref = (feature: string, characterId: number) =>
	`/auth/login?purpose=feature&feature=${feature}&characterId=${characterId}&returnTo=%2Faccount%2Fconnections`;

describe('/account/connections load', () => {
	it('sends anonymous visitors to log in and back', async () => {
		const { env } = await accounts();
		expect(await settle(load(event(env, null, '/account/connections')))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Fconnections'
		});
	});

	it('without connections: add options and an Allow link per missing feature, back to this page', async () => {
		const { env, user } = await accounts();
		const data = await pageData(env, user);
		expect(data.sources).toEqual([]);
		expect(data.limit).toBe(INVENTORY_SOURCE_LIMIT);
		expect(data.refreshing).toBe(false);
		expect(data.addGroups).toEqual([
			{ label: 'Characters', options: [{ value: 'character:90000001', label: 'Alpha' }] },
			{
				label: 'Corporations',
				options: [{ value: 'corporation:90000001', label: 'Seed Corp via Alpha' }]
			}
		]);
		// Alpha has both asset features; Beta has none.
		expect(data.allowLinks.map((l) => [l.characterName, l.feature, l.href])).toEqual([
			['Alpha', 'tracking', allowHref('tracking', alpha.characterId)],
			['Alpha', 'corp_tracking', allowHref('corp_tracking', alpha.characterId)],
			['Beta', 'assets', allowHref('assets', beta.characterId)],
			['Beta', 'corp_assets', allowHref('corp_assets', beta.characterId)],
			['Beta', 'tracking', allowHref('tracking', beta.characterId)],
			['Beta', 'corp_tracking', allowHref('corp_tracking', beta.characterId)]
		]);
	});

	it('offers a character with only a tracking feature', async () => {
		const { env, user } = await accounts();
		grantInventory(env.DB, beta.characterId, ['tracking']);
		const data = await pageData(env, user);
		expect(data.addGroups[0]!.options).toEqual([
			{ value: 'character:90000001', label: 'Alpha' },
			{ value: 'character:90000002', label: 'Beta' }
		]);
		expect(data.allowLinks.filter((l) => l.characterName === 'Beta').map((l) => l.feature)).toEqual([
			'assets',
			'corp_assets',
			'corp_tracking'
		]);
	});

	it("lists the account's connections; owners on the list are not offered again", async () => {
		const { env, user, other } = await accounts();
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
			ownerName: 'Seed Corp'
		});
		const foreign = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });

		const data = await pageData(env, user);
		expect(data.refreshing).toBe(false);
		// Both owners are added and Alpha reads the corporation: no options left.
		expect(data.addGroups).toEqual([]);
		expect(data.sources.map((s) => [s.sourceId, s.kind, s.ownerName, s.characterName, s.status])).toEqual([
			[personal, 'character', 'Alpha', 'Alpha', 'ok'],
			[corp, 'corporation', 'Seed Corp', 'Alpha', 'ok']
		]);
		expect(data.sources[0]).toMatchObject({
			lastSyncedAt: NOW - 3_600_000,
			dataAsOf: NOW - 4_000_000,
			inventoryEnabled: true,
			tracking: { enabled: false, status: null }
		});

		// The other account sees only its own connection.
		expect((await pageData(env, other)).sources.map((s) => s.sourceId)).toEqual([foreign]);
	});

	it('running connections make the page refresh; a stale run becomes an error', async () => {
		const { env, user } = await accounts();
		insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		env.DB.sqlite.exec(`UPDATE inventory_sources SET status = 'running', sync_started_at = ${NOW - 60_000}`);
		let data = await pageData(env, user);
		expect(data.refreshing).toBe(true);

		env.DB.sqlite.exec(`UPDATE inventory_sources SET sync_started_at = ${NOW - 20 * 60_000}`);
		data = await pageData(env, user);
		expect(data.refreshing).toBe(false);
		expect(data.sources[0]).toMatchObject({ status: 'error', lastError: 'sync did not finish' });
	});

	it('refreshes for a tracking sync too, but not for the queued sync of a switch that is off', async () => {
		const { env, user } = await accounts();
		const id = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			status: 'pending',
			inventoryEnabled: false,
			trackingEnabled: true,
			trackingStatus: 'ok'
		});
		expect((await pageData(env, user)).refreshing).toBe(false);

		env.DB.sqlite.exec(
			`UPDATE inventory_sources SET tracking_status = 'running', tracking_started_at = ${NOW - 60_000} WHERE source_id = ${id}`
		);
		expect((await pageData(env, user)).refreshing).toBe(true);

		// A tracking run past 15 minutes did not finish.
		env.DB.sqlite.exec(`UPDATE inventory_sources SET tracking_started_at = ${NOW - 20 * 60_000}`);
		const data = await pageData(env, user);
		expect(data.refreshing).toBe(false);
		expect(data.sources[0]!.tracking).toMatchObject({ status: 'error', lastError: 'sync did not finish' });
	});

	it('lists the personal tracking streams by name; streams without a row are waiting', async () => {
		const { env, user, other } = await accounts();
		const id = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha',
			trackingEnabled: true,
			trackingStatus: 'ok'
		});
		env.DB.sqlite.exec(`UPDATE inventory_sources SET tracking_synced_at = ${NOW - 60_000}`);
		insertStream(env.DB, 'u1', id, 'jobs', 'ok');
		insertStream(env.DB, 'u1', id, 'transactions', 'error');
		insertStream(env.DB, 'u1', id, 'orders', 'denied', 'ESI denied access');
		const data = await pageData(env, user);
		expect(data.sources[0]!.tracking).toEqual({
			enabled: true,
			status: 'ok',
			lastError: null,
			syncedAt: NOW - 60_000,
			walletDivisions: [],
			streams: [
				{ key: 'jobs', label: 'Jobs', status: 'ok', lastError: null },
				{ key: 'transactions', label: 'Wallet transactions', status: 'error', lastError: null },
				{ key: 'journal', label: 'Wallet journal', status: 'pending', lastError: null },
				{ key: 'orders', label: 'Orders', status: 'denied', lastError: 'ESI denied access' },
				{ key: 'contracts', label: 'Contracts', status: 'pending', lastError: null }
			]
		});
		expect((await pageData(env, other)).sources).toEqual([]);
	});

	it('lists one line per counted corporation wallet division, combining its streams', async () => {
		const { env, user } = await accounts();
		const id = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp',
			trackingEnabled: true,
			trackingStatus: 'ok',
			walletDivisions: [1, 3],
			walletNames: { '1': 'Master Wallet' }
		});
		const denied = 'Alpha needs the Accountant or Junior Accountant role';
		for (const stream of ['jobs', 'orders', 'contracts', 'transactions:1'])
			insertStream(env.DB, 'u1', id, stream, 'ok');
		insertStream(env.DB, 'u1', id, 'journal:1', 'denied', denied);
		insertStream(env.DB, 'u1', id, 'transactions:3', 'ok');
		insertStream(env.DB, 'u1', id, 'journal:3', 'ok');
		// A division no longer counted keeps its rows; it is not listed.
		insertStream(env.DB, 'u1', id, 'transactions:2', 'error');
		const { tracking } = (await pageData(env, user)).sources[0]!;
		expect(tracking.streams).toEqual([
			{ key: 'jobs', label: 'Jobs', status: 'ok', lastError: null },
			{ key: 'wallet:1', label: 'Master Wallet', status: 'denied', lastError: denied },
			{ key: 'wallet:3', label: 'Division 3', status: 'ok', lastError: null },
			{ key: 'orders', label: 'Orders', status: 'ok', lastError: null },
			{ key: 'contracts', label: 'Contracts', status: 'ok', lastError: null }
		]);
		// Blueprints are read only once a manufacturing job needs its ME: listed once that stream exists.
		insertStream(env.DB, 'u1', id, 'blueprints', 'denied', 'Alpha needs the Director role');
		const after = (await pageData(env, user)).sources[0]!.tracking.streams;
		expect(after.at(-1)).toEqual({
			key: 'blueprints',
			label: 'Blueprints',
			status: 'denied',
			lastError: 'Alpha needs the Director role'
		});
		expect(tracking.walletDivisions.map((d) => [d.division, d.name, d.counted])).toEqual([
			[1, 'Master Wallet', true],
			[2, 'Division 2', false],
			[3, 'Division 3', true],
			[4, 'Division 4', false],
			[5, 'Division 5', false],
			[6, 'Division 6', false],
			[7, 'Division 7', false]
		]);
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
			{ label: 'Characters', options: [{ value: 'character:90000001', label: 'Alpha' }] },
			{
				label: 'Corporations',
				options: [{ value: 'corporation:90000002', label: 'Seed Corp via Beta' }]
			}
		]);

		addReader(env.DB, corp, beta.characterId, NOW + 1);
		data = await pageData(env, user);
		expect(data.sources[0]!.otherReaders).toEqual([{ characterId: beta.characterId, name: 'Beta' }]);
		expect(data.addGroups.map((g) => g.label)).toEqual(['Characters']);

		// A pool member stays listed after moving corporations (the sync skips it); its new one is offered.
		env.DB.sqlite.exec(
			`UPDATE characters SET corporation_id = 98000002, corporation_name = 'Other Corp' WHERE character_id = ${beta.characterId}`
		);
		data = await pageData(env, user);
		expect(data.sources[0]!.otherReaders).toEqual([{ characterId: beta.characterId, name: 'Beta' }]);
		expect(data.addGroups[1]).toEqual({
			label: 'Corporations',
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
			label: 'Corporations',
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
				label: 'Corporations',
				options: [{ value: 'corporation:90000002', label: 'Seed Corp via Beta' }]
			}
		]);
	});
});

describe('add', () => {
	const add = (env: FakeEnv, user: SessionUser, source: string) =>
		settle(actions.add(event(env, user, '/account/connections?/add', { source })));

	const switches = (env: FakeEnv) =>
		env.DB.rows(
			'SELECT kind, status, inventory_enabled, tracking_enabled, tracking_status FROM inventory_sources'
		);

	it('creates the source and starts a sync', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		expect(await add(env, user, 'corporation:90000001')).toEqual({
			data: { notice: { ok: true, text: 'Seed Corp added. Inventory sync started.' } }
		});
		const [sourceId] = sourceIds(env, 'u1');
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();
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

	it('with both features turns both switches on and starts both syncs', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		grantInventory(env.DB, alpha.characterId, ['assets', 'tracking']);
		expect(await add(env, user, 'character:90000001')).toEqual({
			data: { notice: { ok: true, text: 'Alpha added. Inventory and profit tracking syncs started.' } }
		});
		const [sourceId] = sourceIds(env, 'u1');
		expect(switches(env)).toEqual([
			{
				kind: 'character',
				status: 'pending',
				inventory_enabled: 1,
				tracking_enabled: 1,
				tracking_status: 'pending'
			}
		]);
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
		expect(UPDATER.triggerTrackingSync.mock.calls).toEqual([[sourceId]]);
	});

	it('with only a tracking feature turns only Profit tracking on', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		grantInventory(env.DB, beta.characterId, ['tracking']);
		expect(await add(env, user, 'character:90000002')).toEqual({
			data: { notice: { ok: true, text: 'Beta added. Profit tracking sync started.' } }
		});
		const [sourceId] = sourceIds(env, 'u1');
		expect(switches(env)).toMatchObject([{ inventory_enabled: 0, tracking_enabled: 1 }]);
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
		expect(UPDATER.triggerTrackingSync.mock.calls).toEqual([[sourceId]]);
		expect((await pageData(env, user)).sources[0]).toMatchObject({
			inventoryEnabled: false,
			tracking: { enabled: true, status: 'pending' }
		});
	});

	it('with only an inventory feature turns only Inventory on', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		expect((await add(env, user, 'character:90000001')).data).toEqual({
			notice: { ok: true, text: 'Alpha added. Inventory sync started.' }
		});
		expect(switches(env)).toMatchObject([
			{ inventory_enabled: 1, tracking_enabled: 0, tracking_status: null }
		]);
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();
	});

	it('says which sync did not start', async () => {
		const { env, user } = await accounts({
			triggerInventorySync: vi.fn(async () => ({ instanceId: 'inventory-1' })),
			triggerTrackingSync: vi.fn(async () => ({ busy: true }))
		});
		grantInventory(env.DB, alpha.characterId, ['assets', 'tracking']);
		expect((await add(env, user, 'character:90000001')).data).toEqual({
			notice: {
				ok: false,
				text: 'Alpha added. Inventory sync started, but the profit tracking sync could not be started. Use Sync now to try again.'
			}
		});
	});

	it('keeps the source with a notice when the sync cannot start', async () => {
		const { env, user } = await accounts(updaterStub(new Error('connection refused')));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await add(env, user, 'character:90000001')).toEqual({
			data: {
				notice: {
					ok: false,
					text: 'Alpha added, but the inventory sync could not be started. Use Sync now to try again.'
				}
			}
		});
		expect(sourceIds(env, 'u1')).toHaveLength(1);
	});

	it('requires a feature: form error with the Allow link', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		expect(await add(env, user, 'character:90000002')).toEqual({
			status: 400,
			data: {
				error: 'Allow personal assets or profit tracking for Beta first.',
				allow: {
					characterId: beta.characterId,
					characterName: 'Beta',
					feature: 'assets',
					href: '/auth/login?purpose=feature&feature=assets&characterId=90000002&returnTo=%2Faccount%2Fconnections'
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
			data: { error: 'This connection is already on your list.' }
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
			data: { error: `You can add up to ${INVENTORY_SOURCE_LIMIT} connections.` }
		});
		expect(sourceIds(env, 'u1')).toHaveLength(INVENTORY_SOURCE_LIMIT);
	});

	it('a character with only Corporation profit tracking joins the pool too', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		grantInventory(env.DB, beta.characterId, ['corp_tracking']);
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
		expect((await pageData(env, user)).addGroups[1]!.options).toEqual([
			{ value: 'corporation:90000002', label: 'Seed Corp via Beta' }
		]);
		expect(await add(env, user, 'corporation:90000002')).toEqual({
			data: { notice: { ok: true, text: 'Beta will also be used to read Seed Corp.' } }
		});
		expect(poolOf(env.DB, corp)).toEqual([alpha.characterId, beta.characterId]);
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();
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
			notice: { ok: true, text: 'Seed Corp added. Inventory sync started.' }
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
				event(env, user, '/account/connections?/removeReader', {
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
			data: { error: 'Alpha is the only character reading Seed Corp. Remove the connection instead.' }
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
			data: { error: 'That connection is not on your list.' }
		});
		expect(await removeReader(env, other, corp, beta.characterId)).toEqual({
			status: 404,
			data: { error: 'That connection is not on your list.' }
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
		settle(actions.sync(event(env, user, '/account/connections?/sync', { sourceId: String(sourceId) })));

	it('calls the updater RPC for the source', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect(await sync(env, user, sourceId)).toEqual({
			data: { notice: { ok: true, text: 'Sync started.' } }
		});
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
	});

	it('refuses a connection with Inventory off', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha',
			inventoryEnabled: false
		});
		expect(await sync(env, user, sourceId)).toEqual({
			data: { notice: { ok: false, text: 'Inventory is off for Alpha. Switch it on first.' } }
		});
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
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
			data: { error: 'That connection is not on your list.' }
		});
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
	});
});

describe('remove', () => {
	it("deletes only the caller's source with its data; another account's id is a 404", async () => {
		const UPDATER = updaterStub();
		const { env, types, user } = await accounts(UPDATER);
		const mine = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		for (const id of [mine, theirs]) {
			insertLocation(env.DB, id, JITA, { name: 'Jita 4-4' });
			insertItems(env.DB, id, JITA, 'hangar', { [types.raw]: 5 });
			selectBucket(env.DB, id, JITA, 'hangar');
		}
		const remove = (sourceId: number) =>
			settle(
				actions.remove(event(env, user, '/account/connections?/remove', { sourceId: String(sourceId) }))
			);

		expect(await remove(theirs)).toEqual({
			status: 404,
			data: { error: 'That connection is not on your list.' }
		});
		expect(await remove(mine)).toEqual({ data: { notice: { ok: true, text: 'Connection removed.' } } });
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
		// Its Profit tracking was off: nothing of it was in the ledger.
		expect(UPDATER.rebuildLedger).not.toHaveBeenCalled();
	});

	it('rebuilds the ledger when the removed connection had Profit tracking on', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			trackingEnabled: true
		});
		expect(
			await settle(
				actions.remove(event(env, user, '/account/connections?/remove', { sourceId: String(sourceId) }))
			)
		).toEqual({ data: { notice: { ok: true, text: 'Connection removed.' } } });
		expect(UPDATER.rebuildLedger.mock.calls).toEqual([['u1']]);
	});
});

describe('syncTracking', () => {
	const syncTracking = (env: FakeEnv, user: SessionUser, sourceId: number) =>
		settle(
			actions.syncTracking(
				event(env, user, '/account/connections?/syncTracking', { sourceId: String(sourceId) })
			)
		);

	async function tracked(UPDATER: unknown = updaterStub()) {
		const accountsData = await accounts(UPDATER);
		const sourceId = insertSource(accountsData.env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha',
			trackingEnabled: true,
			trackingStatus: 'ok'
		});
		return { ...accountsData, sourceId };
	}

	it('calls the tracking RPC for the connection', async () => {
		const UPDATER = updaterStub();
		const { env, user, sourceId } = await tracked(UPDATER);
		expect(await syncTracking(env, user, sourceId)).toEqual({
			data: { notice: { ok: true, text: 'Sync started.' } }
		});
		expect(UPDATER.triggerTrackingSync.mock.calls).toEqual([[sourceId]]);
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();
	});

	it('busy, fresh ESI data, an unreachable updater and a missing binding become notices', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const busy = await tracked(updaterStub({ busy: true }));
		expect(await syncTracking(busy.env, busy.user, busy.sourceId)).toEqual({
			data: { notice: { ok: false, text: 'A profit tracking sync of this connection is already running.' } }
		});

		const fresh = await tracked(updaterStub({ notBefore: NOW + 5 * 60_000 }));
		expect(await syncTracking(fresh.env, fresh.user, fresh.sourceId)).toEqual({
			data: { notice: { ok: false, text: 'ESI has no newer data for Alpha before 12:05 UTC.' } }
		});

		const unavailable = { ok: false, text: 'The sync could not be started right now. Try again later.' };
		const down = await tracked(updaterStub(new Error('connection refused')));
		expect(await syncTracking(down.env, down.user, down.sourceId)).toEqual({ data: { notice: unavailable } });

		const missing = await tracked();
		Reflect.deleteProperty(missing.env, 'UPDATER');
		expect(await syncTracking(missing.env, missing.user, missing.sourceId)).toEqual({
			data: { notice: unavailable }
		});
	});

	it('refuses a connection with Profit tracking off', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha'
		});
		expect(await syncTracking(env, user, sourceId)).toEqual({
			data: { notice: { ok: false, text: 'Profit tracking is off for Alpha. Switch it on first.' } }
		});
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();
	});

	it("is rate limited per account; another account's connection is a 404", async () => {
		const UPDATER = updaterStub();
		const { env, user, sourceId } = await tracked(UPDATER);
		const theirs = insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			trackingEnabled: true
		});
		expect(await syncTracking(env, user, theirs)).toEqual({
			status: 404,
			data: { error: 'That connection is not on your list.' }
		});
		const limit = vi.fn(async () => ({ success: false }));
		Object.assign(env, { ACCOUNT_RATE_LIMITER: { limit } });
		expect(await syncTracking(env, user, sourceId)).toEqual({
			status: 429,
			data: { error: 'Too many requests. Wait a minute and try again.' }
		});
		expect(limit).toHaveBeenCalledWith({ key: 'inventory:u1' });
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();
	});
});

describe('switch', () => {
	const flip = (env: FakeEnv, user: SessionUser, sourceId: number | string, feature: string, on: string) =>
		settle(
			actions.switch(
				event(env, user, '/account/connections?/switch', { sourceId: String(sourceId), feature, on })
			)
		);

	const columns = (env: FakeEnv, sourceId: number) =>
		env.DB.rows(
			'SELECT inventory_enabled, tracking_enabled, tracking_status FROM inventory_sources WHERE source_id = ?',
			sourceId
		)[0];

	it('turning a switch on needs its feature: 400 with the Allow link, nothing changes', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const personal = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha'
		});
		expect(await flip(env, user, personal, 'tracking', '1')).toEqual({
			status: 400,
			data: {
				error: 'Allow profit tracking for Alpha first.',
				allow: {
					characterId: alpha.characterId,
					characterName: 'Alpha',
					feature: 'tracking',
					href: allowHref('tracking', alpha.characterId)
				}
			}
		});
		expect(columns(env, personal)).toEqual({
			inventory_enabled: 1,
			tracking_enabled: 0,
			tracking_status: null
		});
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();
	});

	it('a corporation needs the feature on one of its pool members; the Allow link is for the preferred reader', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		// Beta has the feature but is not in the pool yet.
		grantInventory(env.DB, beta.characterId, ['corp_tracking']);
		expect(await flip(env, user, corp, 'tracking', '1')).toMatchObject({
			status: 400,
			data: { allow: { characterId: alpha.characterId, feature: 'corp_tracking' } }
		});
		addReader(env.DB, corp, beta.characterId, NOW + 1);
		expect(await flip(env, user, corp, 'tracking', '1')).toEqual({
			data: { notice: { ok: true, text: 'Profit tracking is on for Seed Corp. Sync started.' } }
		});
		expect(columns(env, corp)).toMatchObject({ tracking_enabled: 1, tracking_status: 'pending' });
		expect(UPDATER.triggerTrackingSync.mock.calls).toEqual([[corp]]);
	});

	it('Inventory on starts an inventory sync; off keeps the assets and stops using them', async () => {
		const UPDATER = updaterStub();
		const { env, types, user } = await accounts(UPDATER);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha'
		});
		insertItems(env.DB, sourceId, JITA, 'hangar', { [types.raw]: 5 });
		expect(await flip(env, user, sourceId, 'inventory', '0')).toEqual({
			data: {
				notice: {
					ok: true,
					text: 'Inventory is off for Alpha. Its assets are kept but not used until you switch it on again.'
				}
			}
		});
		expect(columns(env, sourceId)).toMatchObject({ inventory_enabled: 0 });
		expect(env.DB.rows('SELECT quantity FROM inventory_items WHERE source_id = ?', sourceId)).toEqual([
			{ quantity: 5 }
		]);
		expect(UPDATER.triggerInventorySync).not.toHaveBeenCalled();

		expect(await flip(env, user, sourceId, 'inventory', '1')).toEqual({
			data: { notice: { ok: true, text: 'Inventory is on for Alpha. Sync started.' } }
		});
		expect(columns(env, sourceId)).toMatchObject({ inventory_enabled: 1 });
		expect(UPDATER.triggerInventorySync.mock.calls).toEqual([[sourceId]]);
	});

	it('Profit tracking off keeps its data and requests a ledger rebuild; on again resumes', async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		grantInventory(env.DB, alpha.characterId, ['assets', 'tracking']);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha',
			trackingEnabled: true,
			trackingStatus: 'ok'
		});
		insertStream(env.DB, 'u1', sourceId, 'jobs', 'ok');
		expect(await flip(env, user, sourceId, 'tracking', '0')).toEqual({
			data: {
				notice: {
					ok: true,
					text: 'Profit tracking is off for Alpha. Its data is kept but not counted until you switch it on again.'
				}
			}
		});
		expect(columns(env, sourceId)).toEqual({
			inventory_enabled: 1,
			tracking_enabled: 0,
			tracking_status: 'ok'
		});
		expect(env.DB.rows('SELECT stream FROM tracking_streams WHERE source_id = ?', sourceId)).toEqual([
			{ stream: 'jobs' }
		]);
		expect(UPDATER.rebuildLedger.mock.calls).toEqual([['u1']]);
		expect(UPDATER.triggerTrackingSync).not.toHaveBeenCalled();

		expect(await flip(env, user, sourceId, 'tracking', '1')).toEqual({
			data: { notice: { ok: true, text: 'Profit tracking is on for Alpha. Sync started.' } }
		});
		// The earlier status stays until the new sync runs.
		expect(columns(env, sourceId)).toMatchObject({ tracking_enabled: 1, tracking_status: 'ok' });
		expect(UPDATER.triggerTrackingSync.mock.calls).toEqual([[sourceId]]);
	});

	it('tracking on with fresh streams rebuilds the ledger so the kept data counts again', async () => {
		const UPDATER = updaterStub({ notBefore: NOW + 5 * 60_000 });
		const { env, user } = await accounts(UPDATER);
		grantInventory(env.DB, alpha.characterId, ['tracking']);
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerName: 'Alpha',
			trackingStatus: 'ok'
		});
		expect(await flip(env, user, sourceId, 'tracking', '1')).toEqual({
			data: {
				notice: {
					ok: false,
					text: 'Profit tracking is on for Alpha. ESI has no newer data for Alpha before 12:05 UTC.'
				}
			}
		});
		expect(UPDATER.rebuildLedger.mock.calls).toEqual([['u1']]);
	});

	it('an unreachable updater leaves the ledger marked dirty', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env, user } = await accounts(updaterStub(new Error('connection refused')));
		Object.assign(env.UPDATER as object, {
			rebuildLedger: vi.fn(async () => {
				throw new Error('connection refused');
			})
		});
		const sourceId = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			trackingEnabled: true,
			trackingStatus: 'ok'
		});
		expect((await flip(env, user, sourceId, 'tracking', '0')).data).toMatchObject({ notice: { ok: true } });
		expect(env.DB.rows('SELECT dirty FROM ledger_state WHERE user_id = ?', 'u1')).toEqual([{ dirty: 1 }]);
	});

	it("another account's connection is a 404; bad fields are a 400", async () => {
		const UPDATER = updaterStub();
		const { env, user } = await accounts(UPDATER);
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId });
		expect(await flip(env, user, theirs, 'inventory', '0')).toEqual({
			status: 404,
			data: { error: 'That connection is not on your list.' }
		});
		expect(columns(env, theirs)).toMatchObject({ inventory_enabled: 1 });
		const mine = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect((await flip(env, user, mine, 'wallet', '1')).status).toBe(400);
		expect((await flip(env, user, mine, 'inventory', 'yes')).status).toBe(400);
		expect((await flip(env, user, 'abc', 'inventory', '1')).status).toBe(404);
		expect(UPDATER.rebuildLedger).not.toHaveBeenCalled();
	});
});

describe('walletDivisions', () => {
	const save = (env: FakeEnv, user: SessionUser, sourceId: number, division: string[]) =>
		settle(
			actions.walletDivisions(
				event(env, user, '/account/connections?/walletDivisions', { sourceId: String(sourceId), division })
			)
		);

	const stored = (env: FakeEnv, sourceId: number) =>
		env.DB.rows<{ wallet_divisions_json: string | null }>(
			'SELECT wallet_divisions_json FROM inventory_sources WHERE source_id = ?',
			sourceId
		)[0]!.wallet_divisions_json;

	async function corporation() {
		const UPDATER = updaterStub();
		const accountsData = await accounts(UPDATER);
		const corp = insertSource(accountsData.env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp',
			trackingEnabled: true,
			trackingStatus: 'ok',
			walletDivisions: [2]
		});
		return { ...accountsData, UPDATER, corp };
	}

	it('stores a subset and requests a ledger rebuild; every division stores null', async () => {
		const { env, user, UPDATER, corp } = await corporation();
		expect(await save(env, user, corp, ['3', '1', '3'])).toEqual({
			data: { notice: { ok: true, text: 'Wallet divisions of Seed Corp saved.' } }
		});
		expect(stored(env, corp)).toBe('[1,3]');
		expect(UPDATER.rebuildLedger.mock.calls).toEqual([['u1']]);

		expect((await save(env, user, corp, ['1', '2', '3', '4', '5', '6', '7'])).data).toMatchObject({
			notice: { ok: true }
		});
		expect(stored(env, corp)).toBeNull();
		expect(UPDATER.rebuildLedger).toHaveBeenCalledTimes(2);
	});

	it('refuses none, unknown divisions and personal connections', async () => {
		const { env, user, UPDATER, corp } = await corporation();
		expect(await save(env, user, corp, [])).toEqual({
			status: 400,
			data: { error: 'Tick at least one wallet division.' }
		});
		expect((await save(env, user, corp, ['8'])).status).toBe(400);
		expect((await save(env, user, corp, ['x'])).status).toBe(400);
		const personal = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		expect((await save(env, user, personal, ['1'])).status).toBe(400);
		expect(stored(env, corp)).toBe('[2]');
		expect(UPDATER.rebuildLedger).not.toHaveBeenCalled();
	});

	it("another account's connection is a 404", async () => {
		const { env, user } = await corporation();
		const theirs = insertSource(env.DB, {
			userId: 'u2',
			characterId: gamma.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			walletDivisions: [2]
		});
		expect(await save(env, user, theirs, ['1'])).toEqual({
			status: 404,
			data: { error: 'That connection is not on your list.' }
		});
		expect(stored(env, theirs)).toBe('[2]');
	});
});
