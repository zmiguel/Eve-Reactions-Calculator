import { Settings, decodeSettings } from '@reactions/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import {
	NOW,
	defaults,
	insertLatestPrice,
	insertStructureHub,
	insertSystems,
	insertUser,
	linkStructure,
	loadSde,
	marketFor,
	putKv
} from '../../test/fixtures';
import type { PlannerData } from '$lib/planner/plan';
import { decodeShare, emptyState, encodeShare } from '$lib/planner/state';
import { clearDataMemo } from './data';
import { loadPlanner, parseInputsDaysAgo } from './planner';
import { isoDate } from './prices';

const DAY = 86_400_000;
const CRYSTALLINE_CARBONIDE = 16670;
const COBALT = 16640;
const owner = {
	userId: 'owner',
	characterId: 1,
	characters: [{ characterId: 1, name: 'Owner' }],
	isAdmin: false
};

beforeEach(() => clearDataMemo());

async function seeded() {
	const env = fakeEnv();
	const sde = await loadSde();
	const market = marketFor(sde);
	// Neither an untracked type nor a hub missing from market_hubs may reach the page.
	market.prices.jita[999_999] = [1, 2, 3, 4];
	market.prices.ghost = { [COBALT]: [1, 2, 3, 4] };
	await putKv(env, sde, market);
	insertSystems(env.DB);
	env.DB.sqlite.exec(`INSERT INTO regions VALUES (10000002, 'The Forge');`);
	return env;
}

async function load(env: FakeEnv, query = '', user: typeof owner | null = null) {
	return (await loadPlanner(
		asEnv(env),
		{ settings: defaults(), user },
		new URL(`https://reactions.coalition.space/planner${query}`),
		NOW
	)) as PlannerData;
}

describe('loadPlanner', () => {
	it('returns the dataset, lean current prices, resolved profiles, settings and accessible hubs', async () => {
		const data = await load(await seeded());
		expect(data.available).toBe(true);
		expect(data.dataset.reactions).toHaveLength(119);
		expect(Object.keys(data.prices.hubs)).toEqual(['jita']);
		expect(data.prices.hubs.jita[COBALT]).toEqual({
			buy: expect.any(Number),
			sell: expect.any(Number),
			buyVolume: expect.any(Number),
			sellVolume: expect.any(Number)
		});
		expect(data.prices.hubs.jita[999_999]).toBeUndefined();
		expect(data.prices.adjusted[999_999]).toBeUndefined();
		const tracked = new Set(Object.keys(data.prices.hubs.jita).map(Number));
		for (const r of data.dataset.reactions) expect(tracked.has(r.product.typeId)).toBe(true);
		expect(data.inputPrices).toBeNull();
		expect(data.inputsDaysAgo).toBe(0);
		expect(data.profiles.composite).toMatchObject({ systemName: 'Ignoitton', costIndex: 0.0412 });
		expect(data.settings.cycleDays).toBe(7);
		expect(data.hubs.map((h) => h.hubId)).toContain('jita');
		expect(data.hubs.every((h) => !h.private)).toBe(true);
		expect(data.hubs.find((h) => h.hubId === 'jita')).toMatchObject({
			regionId: 10000002,
			regionName: 'The Forge'
		});
		// Regions missing from the table have no name.
		expect(data.hubs.find((h) => h.hubId === 'amarr')).toMatchObject({ regionName: null });
		expect(data.settingsSummary).toMatchObject({ systemName: 'Ignoitton', outputHub: 'Jita 4-4' });
		expect(data.profileWarnings).toEqual([]);
	});

	it('adds only the visitor’s own private hub prices', async () => {
		const env = await seeded();
		insertUser(env.DB, { userId: 'owner' }, [{ characterId: 1, name: 'Owner' }]);
		insertUser(env.DB, { userId: 'other' }, [{ characterId: 2, name: 'Other' }]);
		insertStructureHub(env.DB, { structureId: 1001, name: 'Owner Market' });
		insertStructureHub(env.DB, { structureId: 1002, name: 'Other Market' });
		linkStructure(env.DB, 'owner', 1001, 1);
		linkStructure(env.DB, 'other', 1002, 2);
		insertLatestPrice(env.DB, 'structure-1001', COBALT, 10, 20);
		insertLatestPrice(env.DB, 'structure-1002', COBALT, 30, 40);

		const mine = await load(env, '', owner);
		expect(mine.prices.hubs['structure-1001'][COBALT]).toEqual({
			buy: 10,
			sell: 20,
			buyVolume: 1,
			sellVolume: 1
		});
		expect(mine.prices.hubs['structure-1002']).toBeUndefined();
		expect(mine.hubs.find((h) => h.hubId === 'structure-1001')).toMatchObject({
			private: true,
			structure: true
		});
		expect(mine.hubs.find((h) => h.hubId === 'jita')).toMatchObject({ structure: false });

		clearDataMemo();
		const anonymous = await load(env);
		expect(anonymous.prices.hubs['structure-1001']).toBeUndefined();
	});

	it('prices inputs N days ago from the historical book, clamped to 0–60', async () => {
		const env = await seeded();
		env.HISTORY_DB.sqlite.exec(
			`INSERT INTO esi_market_history VALUES (10000002, ${COBALT}, '${isoDate(NOW - 14 * DAY)}', 5, 6, 4, 1, 1);`
		);
		const then = await load(env, '?inputsDaysAgo=14');
		expect(then.inputsDaysAgo).toBe(14);
		expect(then.inputPrices).toMatchObject({ asOf: isoDate(NOW - 14 * DAY), approximate: true });
		expect(then.inputPrices!.hubs.jita[COBALT]).toEqual({ buy: 5, sell: 5 });
		// Outputs stay on current prices.
		expect(then.prices.approximate).toBe(false);
		expect(then.prices.hubs.jita[COBALT]).not.toEqual({ buy: 5, sell: 5 });

		expect((await load(env, '?inputsDaysAgo=500')).inputPrices?.asOf).toBe(isoDate(NOW - 60 * DAY));
		expect((await load(env, '?inputsDaysAgo=500')).inputsDaysAgo).toBe(60);
		expect((await load(env, '?inputsDaysAgo=-3')).inputPrices).toBeNull();
		expect((await load(env, '?inputsDaysAgo=abc')).inputsDaysAgo).toBe(0);
	});

	it('returns 30-day average daily volumes of reaction products and inputs per accessible hub region', async () => {
		const env = await seeded();
		const cols =
			'(region_id, type_id, avg_daily_volume_30d, avg_price_5d, avg_price_30d, last_date, updated_at)';
		env.DB.sqlite.exec(`
			INSERT INTO market_stats ${cols} VALUES (10000002, ${CRYSTALLINE_CARBONIDE}, 900000, 250, 240, '2026-10-05', ${NOW});
			INSERT INTO market_stats ${cols} VALUES (10000043, ${CRYSTALLINE_CARBONIDE}, 1234, 250, 240, '2026-10-05', ${NOW});
			INSERT INTO market_stats ${cols} VALUES (10000002, ${COBALT}, 5, 1, 1, '2026-10-05', ${NOW});
			INSERT INTO market_stats ${cols} VALUES (10000002, 999999, 42, 1, 1, '2026-10-05', ${NOW});
			INSERT INTO market_stats ${cols} VALUES (10000999, ${CRYSTALLINE_CARBONIDE}, 77, 1, 1, '2026-10-05', ${NOW});
		`);
		const data = await load(env);
		expect(data.volumes[10000002]).toEqual({ [CRYSTALLINE_CARBONIDE]: 900000, [COBALT]: 5 });
		expect(data.volumes[10000043]).toEqual({ [CRYSTALLINE_CARBONIDE]: 1234 });
		expect(data.volumes[10000999]).toBeUndefined();
	});

	it('reports missing reference data', async () => {
		expect(
			await loadPlanner(asEnv(fakeEnv()), { settings: defaults(), user: null }, new URL('https://x/planner'))
		).toEqual({
			available: false
		});
		expect(
			await loadPlanner(undefined, { settings: defaults(), user: null }, new URL('https://x/planner'))
		).toEqual({
			available: false
		});
	});

	describe('shared plans (?s=)', () => {
		const plan = { ...emptyState(), slots: 40 };
		const sharer = Settings.parse({ cycleDays: 3, shared: { structure: 'athanor' } });

		it('computes with the shared settings and links the plan without them and the import preview', async () => {
			const data = await load(await seeded(), `?s=${await encodeShare(plan, sharer)}`);
			expect(data.settings).toEqual(sharer);
			expect(data.profiles.composite).toMatchObject({ structure: 'athanor', systemName: 'Ignoitton' });
			expect(data.settingsSummary).toMatchObject({ systemName: 'Ignoitton' });
			expect(data.sharedSettings).not.toBeNull();
			expect(await decodeShare(data.sharedSettings!.planCode)).toEqual({ state: plan, settings: null });
			expect(await decodeSettings(data.sharedSettings!.importCode)).toEqual(sharer);
		});

		it('replaces shared hubs the visitor cannot use with Jita and warns', async () => {
			const env = await seeded();
			insertStructureHub(env.DB, { structureId: 1001, name: 'Owner Market' });
			const settings = Settings.parse({ shared: { market: { outputHub: 'structure-1001' } } });
			const data = await load(env, `?s=${await encodeShare(plan, settings)}`);
			expect(data.profiles.composite.market.outputHub).toBe('jita');
			expect(data.profileWarnings).toEqual(['HUB_UNAVAILABLE']);
			expect(data.sharedSettings).not.toBeNull();
		});

		it('uses the visitor’s settings without a notice when the shared ones match, are missing or invalid', async () => {
			const env = await seeded();
			// Shared mode ignores per-reactor values, so stale ones do not count as a difference.
			const stale = Settings.parse({ reactors: { hybrid: { meRig: 'none' } } });
			for (const code of [
				await encodeShare(plan, defaults()),
				await encodeShare(plan, stale),
				await encodeShare(plan),
				'garbage'
			]) {
				const data = await load(env, `?s=${code}`);
				expect(data.settings).toEqual(defaults());
				expect(data.sharedSettings).toBeNull();
			}
			expect((await load(env)).sharedSettings).toBeNull();
		});
	});
});

describe('parseInputsDaysAgo', () => {
	it('rounds and clamps to whole days 0–60', () => {
		const days = (q: string) => parseInputsDaysAgo(new URL(`https://x/planner${q}`));
		expect([
			days(''),
			days('?inputsDaysAgo=7'),
			days('?inputsDaysAgo=2.6'),
			days('?inputsDaysAgo=61')
		]).toEqual([0, 7, 3, 60]);
		expect([days('?inputsDaysAgo=-1'), days('?inputsDaysAgo=x'), days('?inputsDaysAgo=')]).toEqual([0, 0, 0]);
	});
});
