import { Settings } from '@reactions/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import {
	NOW,
	insertLatestPrice,
	insertStructureHub,
	insertSystems,
	insertUser,
	linkStructure,
	loadSde,
	marketFor,
	putKv
} from '../../test/fixtures';
import { loadCalc } from './context';
import { MEMO_TTL_MS, clearDataMemo, getDataset, getMarket } from './data';
import { getAccessibleHubs, getHubPrices } from './hubs';
import { buildPriceBook, getDailyPriceBook, getPriceBookNear } from './prices';
import { resolveProfiles } from './profiles';
import type { SessionUser } from './session';

const user = (userId: string): SessionUser => ({ userId, characterId: null, characters: [], isAdmin: false });

function withPrivateHubs(env: FakeEnv) {
	insertUser(env.DB, { userId: 'owner' }, [{ characterId: 1, name: 'Owner' }]);
	insertUser(env.DB, { userId: 'other' }, [{ characterId: 2, name: 'Other' }]);
	insertStructureHub(env.DB, { structureId: 1001, name: 'Owner Market' });
	insertStructureHub(env.DB, { structureId: 1002, name: 'Other Market' });
	insertStructureHub(env.DB, { structureId: 1003, name: 'Disabled Market', enabled: false });
	linkStructure(env.DB, 'owner', 1001, 1);
	linkStructure(env.DB, 'owner', 1003, 1);
	linkStructure(env.DB, 'other', 1002, 2);
}

beforeEach(() => clearDataMemo());

describe('getDataset / getMarket memo', () => {
	it('reuses KV values within 60 s and refetches afterwards', async () => {
		const env = fakeEnv();
		await putKv(env, await loadSde());
		expect((await getDataset(asEnv(env), NOW))?.reactions).toHaveLength(119);
		await getDataset(asEnv(env), NOW + MEMO_TTL_MS - 1);
		expect(env.CACHE.gets).toBe(1);
		await getDataset(asEnv(env), NOW + MEMO_TTL_MS);
		expect(env.CACHE.gets).toBe(2);
		expect((await getMarket(asEnv(env), NOW))?.snapshotAt).toBe(NOW);
	});

	it('returns null when the key is missing (and does not memoise the miss)', async () => {
		const env = fakeEnv();
		expect(await getMarket(asEnv(env), NOW)).toBeNull();
		expect(await getMarket(asEnv(env), NOW)).toBeNull();
		expect(env.CACHE.gets).toBe(2);
	});
});

describe('getAccessibleHubs', () => {
	it('anonymous visitors get public hubs in sort order', async () => {
		const env = fakeEnv();
		withPrivateHubs(env);
		const hubs = await getAccessibleHubs(asEnv(env), null);
		expect(hubs.map((h) => h.hubId)).toEqual(['jita', 'amarr', 'perimeter', 'dodixie', 'rens', 'hek']);
		expect(hubs.every((h) => !h.private)).toBe(true);
	});

	it('users additionally get their own enabled private hubs, never other users’', async () => {
		const env = fakeEnv();
		withPrivateHubs(env);
		const owner = await getAccessibleHubs(asEnv(env), user('owner'));
		expect(owner.map((h) => h.hubId).slice(6)).toEqual(['structure-1001']);
		expect(owner.at(-1)).toMatchObject({ private: true, name: 'Owner Market' });
		const other = await getAccessibleHubs(asEnv(env), user('other'));
		expect(other.map((h) => h.hubId)).not.toContain('structure-1001');
		expect(other.map((h) => h.hubId)).toContain('structure-1002');
	});

	it('an approved (public) structure hub is listed for everyone as public', async () => {
		const env = fakeEnv();
		insertStructureHub(env.DB, { structureId: 2001, name: 'Shared Market', visibility: 'public' });
		const hubs = await getAccessibleHubs(asEnv(env), null);
		expect(hubs.find((h) => h.hubId === 'structure-2001')).toMatchObject({ private: false });
	});
});

describe('resolveProfiles', () => {
	it('resolves system band, name and cost index; override wins', async () => {
		const env = fakeEnv();
		insertSystems(env.DB);
		const settings = Settings.parse({
			mode: 'per_reactor',
			reactors: { composite: { systemId: 30004604 }, hybrid: { costIndexOverridePct: 7.5 } }
		});
		const { profiles, warnings } = await resolveProfiles(asEnv(env), settings, new Set(['jita']));
		expect(warnings).toEqual([]);
		expect(profiles.biochemical).toMatchObject({
			securityBand: 'lowsec',
			systemName: 'Ignoitton',
			costIndex: 0.0412,
			costIndexMissing: false
		});
		expect(profiles.composite).toMatchObject({
			securityBand: 'nullsec',
			costIndex: 0,
			costIndexMissing: true
		});
		expect(profiles.hybrid.costIndex).toBeCloseTo(0.075, 10);
		expect(profiles.hybrid.costIndexMissing).toBe(false);
	});

	it('replaces inaccessible hubs with jita and warns HUB_UNAVAILABLE', async () => {
		const env = fakeEnv();
		insertSystems(env.DB);
		const settings = Settings.parse({
			shared: { market: { inputHub: 'structure-1002', outputHub: 'amarr' } }
		});
		const { profiles, warnings } = await resolveProfiles(asEnv(env), settings, new Set(['jita', 'amarr']));
		expect(warnings).toEqual(['HUB_UNAVAILABLE']);
		expect(profiles.composite.market).toMatchObject({ inputHub: 'jita', outputHub: 'amarr' });
	});

	it('replaces an inaccessible input fallback hub with jita and warns HUB_UNAVAILABLE', async () => {
		const env = fakeEnv();
		insertSystems(env.DB);
		const settings = Settings.parse({
			shared: { market: { inputHub: 'amarr', inputFallbackHub: 'structure-1002' } }
		});
		const { profiles, warnings } = await resolveProfiles(asEnv(env), settings, new Set(['jita', 'amarr']));
		expect(warnings).toEqual(['HUB_UNAVAILABLE']);
		expect(profiles.hybrid.market).toMatchObject({ inputHub: 'amarr', inputFallbackHub: 'jita' });
	});
});

describe('price books', () => {
	it('buildPriceBook maps tuples (with listed volumes) and merges extra hubs', async () => {
		const market = marketFor(await loadSde());
		const book = buildPriceBook(market, { 'structure-1': { 34: { buy: 1, sell: 2 } } });
		expect(book.asOf).toBe(new Date(NOW).toISOString());
		expect(book.approximate).toBe(false);
		const [buy, sell, buyVolume, sellVolume] = market.prices.jita[16663];
		expect(book.hubs.jita[16663]).toEqual({ buy, sell, buyVolume, sellVolume });
		expect(sellVolume).toBeGreaterThan(0);
		expect(book.hubs['structure-1'][34]).toEqual({ buy: 1, sell: 2 });
		expect(book.adjusted).toBe(market.adjusted);
	});

	it('getDailyPriceBook uses price_daily and falls back to ESI history as approximate', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		const hubs = (await getAccessibleHubs(asEnv(env), null)).filter((h) =>
			['jita', 'amarr'].includes(h.hubId)
		);
		env.HISTORY_DB.sqlite.exec(`
			INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES ('2026-10-01', 'jita', 16663, 90, 100, 4);
			INSERT INTO esi_market_history VALUES (10000002, 16663, '2026-10-01', 555, 600, 500, 10, 1);
			INSERT INTO esi_market_history VALUES (10000002, 16643, '2026-10-01', 77, 80, 70, 10, 1);
			INSERT INTO adjusted_price_daily VALUES ('2026-10-01', 16663, 42);
		`);
		const book = await getDailyPriceBook(asEnv(env), '2026-10-01', hubs, sde.dataset, { 1: 1 });
		expect(book.asOf).toBe('2026-10-01');
		expect(book.hubs.jita[16663]).toEqual({ buy: 90, sell: 100 });
		expect(book.hubs.jita[16643]).toEqual({ buy: 77, sell: 77 });
		expect(book.hubs.amarr[16663]).toBeUndefined();
		expect(book.approximate).toBe(true);
		expect(book.adjusted).toEqual({ 16663: 42 });
	});

	it('getDailyPriceBook is exact when every row comes from price_daily; adjusted falls back', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		const hubs = (await getAccessibleHubs(asEnv(env), null)).filter((h) => h.hubId === 'jita');
		env.HISTORY_DB.sqlite.exec(
			`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES ('2026-10-01', 'jita', 16663, 90, 100, 4);`
		);
		const book = await getDailyPriceBook(asEnv(env), '2026-10-01', hubs, sde.dataset, { 1: 5 });
		expect(book.approximate).toBe(false);
		expect(book.adjusted).toEqual({ 1: 5 });
	});

	it('getPriceBookNear picks the latest snapshot at or before the timestamp, else the daily book', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		const hubs = (await getAccessibleHubs(asEnv(env), null)).filter((h) => h.hubId === 'jita');
		const t1 = NOW - 3_600_000;
		const t2 = NOW - 1_800_000;
		env.HISTORY_DB.sqlite.exec(`
			INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, source) VALUES
				(${t1}, 'jita', 16663, 1, 2, 1, 1, 'esi'), (${t2}, 'jita', 16663, 3, 4, 1, 1, 'esi'), (${NOW + 1}, 'jita', 16663, 5, 6, 1, 1, 'esi');
		`);
		const near = await getPriceBookNear(asEnv(env), NOW, hubs, sde.dataset, {});
		expect(near.asOf).toBe(new Date(t2).toISOString());
		expect(near.hubs.jita[16663]).toEqual({ buy: 3, sell: 4 });
		const old = await getPriceBookNear(asEnv(env), NOW - 30 * 86_400_000, hubs, sde.dataset, {});
		expect(old.asOf).toBe('2026-09-06');
	});
});

describe('loadCalc', () => {
	it('returns null until dataset and market are published', async () => {
		const env = fakeEnv();
		expect(await loadCalc(asEnv(env), { settings: Settings.parse({}), user: null })).toBeNull();
	});

	it('merges private hub prices only for the owning user', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		await putKv(env, sde);
		insertSystems(env.DB);
		withPrivateHubs(env);
		insertLatestPrice(env.DB, 'structure-1001', 16663, 10, 20);
		insertLatestPrice(env.DB, 'structure-1002', 16663, 30, 40);
		const settings = Settings.parse({ shared: { market: { outputHub: 'structure-1001' } } });

		const owner = await loadCalc(asEnv(env), { settings, user: user('owner') });
		expect(owner!.ctx.outputPrices.hubs['structure-1001'][16663]).toEqual({
			buy: 10,
			sell: 20,
			buyVolume: 1,
			sellVolume: 1
		});
		expect(owner!.ctx.outputPrices.hubs['structure-1002']).toBeUndefined();
		expect(owner!.ctx.profiles.composite.market.outputHub).toBe('structure-1001');
		expect(owner!.warnings).toEqual([]);

		clearDataMemo();
		const anonymous = await loadCalc(asEnv(env), { settings, user: null });
		expect(anonymous!.ctx.outputPrices.hubs['structure-1001']).toBeUndefined();
		expect(anonymous!.ctx.profiles.composite.market.outputHub).toBe('jita');
		expect(anonymous!.warnings).toEqual(['HUB_UNAVAILABLE']);
	});

	it('loads a historical book for ?date=', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		await putKv(env, sde);
		env.HISTORY_DB.sqlite.exec(
			`INSERT INTO esi_market_history VALUES (10000002, 16663, '2026-09-01', 5, 6, 4, 1, 1);`
		);
		const calc = await loadCalc(
			asEnv(env),
			{ settings: Settings.parse({}), user: null },
			{ date: '2026-09-01' }
		);
		expect(calc!.ctx.inputPrices.approximate).toBe(true);
		expect(calc!.ctx.inputPrices.hubs.jita[16663]).toEqual({ buy: 5, sell: 5 });
	});
});

describe('getHubPrices', () => {
	it('returns latest prices with listed volumes per hub and nothing for an empty id list', async () => {
		const env = fakeEnv();
		insertLatestPrice(env.DB, 'jita', 34, 4, 5, { buy: 1200, sell: 3400 });
		expect(await getHubPrices(asEnv(env), ['jita'])).toEqual({
			jita: { 34: { buy: 4, sell: 5, buyVolume: 1200, sellVolume: 3400 } }
		});
		expect(await getHubPrices(asEnv(env), [])).toEqual({});
	});
});
