import { DEFAULT_SETTINGS, stockUnitValue } from '@reactions/engine';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryPageData } from '#lib/inventory/types.js';
import { loadCalc } from '#lib/server/context.js';
import { clearDataMemo } from '#lib/server/data.js';
import type { SessionUser } from '#lib/server/session.js';
import { seededEnv } from '../../../test/api';
import { FakeCookies, asEnv, type FakeEnv } from '../../../test/fakes';
import { NOW, insertUser } from '../../../test/fixtures';
import {
	insertItems,
	insertLocation,
	insertSource,
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

async function accounts() {
	const { env, sde } = await seededEnv();
	insertUser(env.DB, { userId: 'u1' }, [alpha, beta]);
	insertUser(env.DB, { userId: 'u2' }, [gamma]);
	return {
		env,
		types: typesByRole(sde.dataset),
		user: sessionUser('u1', [alpha, beta]),
		other: sessionUser('u2', [gamma])
	};
}

/** The page never asks ESI: any request to `fetch` answers 418. */
const noFetch = async () => new Response('unexpected request', { status: 418 });

function event(
	env: FakeEnv,
	user: SessionUser | null,
	path: string,
	fields?: Record<string, string | string[]>
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
		fetch: noFetch,
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark', env }
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

const pageData = async (env: FakeEnv, user: SessionUser) =>
	(await load(event(env, user, '/account/inventory'))) as InventoryPageData;

describe('/account/inventory load', () => {
	it('sends anonymous visitors to log in and back', async () => {
		const { env } = await accounts();
		expect(await settle(load(event(env, null, '/account/inventory')))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Finventory'
		});
	});

	it('without connections: no places and the no_sources summary', async () => {
		const { env, user } = await accounts();
		const data = await pageData(env, user);
		expect(data.sources).toEqual([]);
		expect(data.refreshing).toBe(false);
		expect(data.summary).toEqual({
			formulas: [],
			materials: { fuel: [], raw: [], intermediate: [], product: [] },
			totalValue: 0,
			showPaid: false,
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
		expect(data.sources.map((s) => [s.sourceId, s.kind, s.ownerName, s.characterName, s.status])).toEqual([
			[personal, 'character', 'Alpha', 'Alpha', 'ok'],
			[corp, 'corporation', 'Seed Corp', 'Alpha', 'ok']
		]);
		expect(data.sources[0]!.lastSyncedAt).toBe(NOW - 3_600_000);
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

	it('Paid: average cost of the remaining ledger lots, how much of the holding they cover, the user only', async () => {
		const { env, types, user, other } = await accounts();
		const source = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId, ownerName: 'Alpha' });
		insertItems(env.DB, source, JITA, 'hangar', { [types.raw]: 12, [types.intermediate]: 4 });
		selectBucket(env.DB, source, JITA, 'hangar');
		expect((await pageData(env, user)).summary.showPaid).toBe(false);

		const lot = (userId: string, lotId: number, typeId: number, remaining: number, unitCost: number) =>
			env.DB.sqlite
				.prepare(
					`INSERT INTO ledger_lots (user_id, lot_id, type_id, acquired_at, quantity, remaining, unit_cost, origin,
						origin_ref, price_source) VALUES (?, ?, ?, 1, ?, ?, ?, 'transaction', 'transaction:1', 'x')`
				)
				.run(userId, lotId, typeId, remaining + 5, remaining, unitCost);
		// Raw: 6 left at 100 and 4 left at 200 → average 140 over 10 of the 12 held.
		lot('u1', 1, types.raw, 6, 100);
		lot('u1', 2, types.raw, 4, 200);
		// Intermediate: used up (nothing remaining) → unknown.
		lot('u1', 3, types.intermediate, 0, 50);
		// Another account's lot of the same type changes nothing.
		lot(other.userId, 1, types.raw, 1000, 1);

		const { summary } = await pageData(env, user);
		expect(summary.showPaid).toBe(true);
		const byType = new Map(
			Object.values(summary.materials)
				.flat()
				.map((m) => [m.typeId, m.paid])
		);
		expect(byType.get(types.raw)).toEqual({ unitCost: 140, covered: 10 });
		expect(byType.get(types.intermediate)).toBeNull();
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
		expect(data.sources[0]).toMatchObject({ status: 'error' });
	});

	it('lists only connections with Inventory on and leaves the others out of "What you have"', async () => {
		const { env, types, user } = await accounts();
		const on = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId, ownerName: 'Alpha' });
		const off = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp',
			status: 'running',
			syncStartedAt: NOW,
			inventoryEnabled: false
		});
		insertItems(env.DB, on, JITA, 'hangar', { [types.raw]: 5 });
		insertItems(env.DB, off, JITA, 'hangar', { [types.raw]: 100 });
		selectBucket(env.DB, on, JITA, 'hangar');
		selectBucket(env.DB, off, JITA, 'hangar');
		let data = await pageData(env, user);
		expect(data.sources.map((s) => s.sourceId)).toEqual([on]);
		expect(data.summary.materials.raw.map((m) => m.quantity)).toEqual([5]);
		expect(data.refreshing).toBe(false);

		// With every connection's Inventory off: the no_sources empty state.
		env.DB.sqlite.exec(`UPDATE inventory_sources SET inventory_enabled = 0`);
		data = await pageData(env, user);
		expect(data.sources).toEqual([]);
		expect(data.summary.empty).toBe('no_sources');
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
			data: { error: 'That connection is not on your list.' }
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
