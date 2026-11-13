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
import { changeOnly, insertSnapshots, type SnapshotRow } from '../../test/snapshots';
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

	it('getDailyPriceBook carries a regional average over up to 7 days without trades', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		const hubs = (await getAccessibleHubs(asEnv(env), null)).filter((h) => h.hubId === 'jita');
		env.HISTORY_DB.sqlite.exec(`
			INSERT INTO esi_market_history VALUES (10000002, 16643, '2026-09-24', 70, 70, 70, 10, 1);
			INSERT INTO esi_market_history VALUES (10000002, 16663, '2026-09-23', 50, 50, 50, 10, 1);
			INSERT INTO esi_market_history VALUES (10000002, 16647, '2026-10-01', 9, 9, 9, 10, 1);
		`);
		const book = await getDailyPriceBook(asEnv(env), '2026-10-01', hubs, sde.dataset, { 1: 1 });
		// 16643 last traded 7 days before: carried; 16663 8 days before: too old.
		expect(book.hubs.jita[16643]).toEqual({ buy: 70, sell: 70 });
		expect(book.hubs.jita[16663]).toBeUndefined();
		expect(book.hubs.jita[16647]).toEqual({ buy: 9, sell: 9 });
		expect(book.approximate).toBe(true);
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

	describe('getPriceBookNear', () => {
		const DAY_START = Date.UTC(2026, 9, 6);
		const STEP = 1_800_000;
		/** Refreshes from 1 h before the UTC day starts to 90 min into it. */
		const times = [-2, -1, 0, 1, 2, 3].map((i) => DAY_START + i * STEP);
		/** 16663 changes every refresh, 16643 every third one, 16647 never; amarr has no 16647. */
		const dense: SnapshotRow[] = times.flatMap((at, i) =>
			(['jita', 'amarr'] as const).flatMap((hubId, h) =>
				[16663, 16643, 16647]
					.filter((typeId) => hubId === 'jita' || typeId !== 16647)
					.map((typeId) => {
						const step = typeId === 16663 ? i : typeId === 16643 ? Math.floor(i / 3) : 0;
						return { at, hubId, typeId, buy: 100 * (h + 1) + step, sell: 200 * (h + 1) + step };
					})
			)
		);
		const types = [16663, 16643, 16647];

		async function bookAt(rows: SnapshotRow[], ts: number, hubIds = ['jita', 'amarr'], typeIds = types) {
			const env = fakeEnv();
			insertSnapshots(env.HISTORY_DB, rows);
			const hubs = (await getAccessibleHubs(asEnv(env), null)).filter((h) => hubIds.includes(h.hubId));
			return getPriceBookNear(asEnv(env), ts, hubs, typeIds, (await loadSde()).dataset, { 1: 1 });
		}

		it('prices dense refreshes with the latest refresh at or before the time', async () => {
			const book = await bookAt(dense, DAY_START + 2 * STEP - 1);
			expect(book.asOf).toBe(new Date(DAY_START + STEP).toISOString());
			expect(book.approximate).toBe(false);
			expect(book.hubs).toEqual({
				jita: {
					16663: { buy: 103, sell: 203 },
					16643: { buy: 101, sell: 201 },
					16647: { buy: 100, sell: 200 }
				},
				amarr: { 16663: { buy: 203, sell: 403 }, 16643: { buy: 201, sell: 401 } }
			});
		});

		it('gives change-only rows the same books as dense rows', async () => {
			const stored = changeOnly(dense);
			expect(stored.length).toBeLessThan(dense.length);
			for (const ts of [...times, ...times.map((t) => t + STEP / 2), DAY_START - 1, NOW])
				expect(await bookAt(stored, ts), new Date(ts).toISOString()).toEqual(await bookAt(dense, ts));
		});

		it('looks up only the given hubs and types, adjusted prices included', async () => {
			const env = fakeEnv();
			insertSnapshots(env.HISTORY_DB, changeOnly(dense));
			env.HISTORY_DB.sqlite.exec(`
				INSERT INTO adjusted_price_daily VALUES ('2026-10-06', 16663, 42);
				INSERT INTO adjusted_price_daily VALUES ('2026-10-06', 16643, 43);
			`);
			const hubs = (await getAccessibleHubs(asEnv(env), null)).filter((h) => h.hubId === 'jita');
			const book = await getPriceBookNear(asEnv(env), NOW, hubs, [16663], (await loadSde()).dataset, {});
			expect(book.hubs).toEqual({ jita: { 16663: { buy: 105, sell: 205 } } });
			expect(book.adjusted).toEqual({ 16663: 42 });
		});

		it('ignores rows older than 36 h and falls back to the daily book without any', async () => {
			const ts = DAY_START + 3 * STEP + 36 * 3_600_000;
			const late = await bookAt(changeOnly(dense), ts);
			// Only the rows of the last refresh (16663 changed there) are recent enough.
			expect(late.hubs).toEqual({
				jita: { 16663: { buy: 105, sell: 205 } },
				amarr: { 16663: { buy: 205, sell: 405 } }
			});
			const old = await bookAt(changeOnly(dense), ts + 1);
			expect(old.asOf).toBe('2026-10-07');
			expect(old.hubs).toEqual({ jita: {}, amarr: {} });
		});
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
