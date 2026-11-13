import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/dates.ts';
import { writePrices } from '../src/prices.ts';
import type { PriceRow } from '../src/prices.ts';
import {
	applyRetention,
	pruneCoreTables,
	recomputeMarketStats,
	refreshRegionHistory,
	rollupIndices,
	rollupPrices
} from '../src/workflows/daily.ts';
import type { DailyResult } from '../src/workflows/daily.ts';
import { installFetch, json, meteredEnv, resetState, rowCounts, seedTrackedReaction } from './helpers.ts';

const HOUR = 3_600_000;

/** ESI history days `2026-10-01` … `2026-10-05` (average = 10 × day of month, volume = day of month). */
function historyDays() {
	return [1, 2, 3, 4, 5].map((d) => ({
		date: `2026-10-0${d}`,
		average: 10 * d,
		highest: 10 * d + 1,
		lowest: 10 * d - 1,
		volume: d,
		order_count: 7
	}));
}

async function insertSnapshot(snapshotAt: number, hubId: string, typeId: number, buy: number, sell: number) {
	await env.HISTORY_DB.prepare(
		`INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, source)
		VALUES (?, ?, ?, ?, ?, 1, 1, 'esi')`
	)
		.bind(snapshotAt, hubId, typeId, buy, sell)
		.run();
}

/** Deterministic pseudo-random numbers in (0, 1) (Park–Miller). */
function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 48271) % 2147483647;
		return state / 2147483647;
	};
}

describe('DailyWorkflow steps', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('history inserts only days newer than the stored ones and recomputes market_stats', async () => {
		await seedTrackedReaction();
		await env.HISTORY_DB.prepare(
			`INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
			VALUES (10000002, 16663, '2026-09-20', 10, 10, 10, 700, 1), (10000002, 16663, '2026-10-03', 999, 999, 999, 100, 1)`
		).run();
		const calls = installFetch((url) =>
			url.pathname === '/markets/10000002/history' ? json(historyDays()) : json([], {}, 404)
		);

		const counts = await refreshRegionHistory(env, 10000002, 7777);

		expect(counts).toEqual({
			regionId: 10000002,
			types: 4,
			inserted: 17,
			failed: 0,
			failedTypeIds: [],
			stats: 4
		});
		// Formula (blueprint) types have no market history worth storing.
		expect(
			calls.map((c) => Number(new URL(c.url).searchParams.get('type_id'))).sort((a, b) => a - b)
		).toEqual([4312, 16643, 16647, 16663]);
		const { results } = await env.HISTORY_DB.prepare(
			'SELECT date, average, volume FROM esi_market_history WHERE region_id = 10000002 AND type_id = 16663 ORDER BY date'
		).all();
		expect(results).toEqual([
			{ date: '2026-09-20', average: 10, volume: 700 },
			{ date: '2026-10-03', average: 999, volume: 100 },
			{ date: '2026-10-04', average: 40, volume: 4 },
			{ date: '2026-10-05', average: 50, volume: 5 }
		]);
		const stats = await env.DB.prepare(
			`SELECT type_id, avg_daily_volume_30d, avg_daily_volume_7d, avg_price_5d, avg_price_30d, last_date, updated_at
			FROM market_stats WHERE region_id = 10000002 ORDER BY type_id`
		).all();
		expect(stats.results[0]).toEqual({
			type_id: 4312,
			avg_daily_volume_30d: 15 / 30,
			avg_daily_volume_7d: 15 / 7,
			avg_price_5d: 30,
			avg_price_30d: 30,
			last_date: '2026-10-05',
			updated_at: 7777
		});
		// 2026-09-20 is inside the 30-day window but not the 7-day one.
		expect(stats.results[3]).toMatchObject({
			type_id: 16663,
			avg_daily_volume_30d: 809 / 30,
			avg_daily_volume_7d: 109 / 7,
			avg_price_5d: (999 + 40 + 50) / 3
		});

		// A second run finds nothing new.
		expect(await refreshRegionHistory(env, 10000002, 8888)).toMatchObject({ inserted: 0, stats: 4 });
	});

	it('lists the types ESI failed for, and a retry fetches only those', async () => {
		await seedTrackedReaction();
		let down = true;
		const calls = installFetch((url) =>
			down && url.searchParams.get('type_id') === '16663'
				? json({ error: 'Service Unavailable' }, { 'Retry-After': '0' }, 503)
				: json(historyDays())
		);

		const first = await refreshRegionHistory(env, 10000002, 1);
		expect(first).toMatchObject({ types: 4, inserted: 15, failed: 1, failedTypeIds: [16663] });

		down = false;
		calls.length = 0;
		const retry = await refreshRegionHistory(env, 10000002, 2, first.failedTypeIds);
		expect(retry).toMatchObject({ types: 1, inserted: 5, failed: 0, failedTypeIds: [] });
		expect(calls.map((c) => new URL(c.url).searchParams.get('type_id'))).toEqual(['16663']);
	});

	it('rolls up a 3-sample day into avg, close, low and high', async () => {
		const day = Date.UTC(2026, 9, 5);
		await insertSnapshot(day - HOUR, 'jita', 16663, 1, 1); // previous day
		await insertSnapshot(day, 'jita', 16663, 10, 30);
		await insertSnapshot(day + 8 * HOUR, 'jita', 16663, 20, 25);
		await insertSnapshot(day + 16 * HOUR, 'jita', 16663, 15, 40);
		await insertSnapshot(day + 24 * HOUR, 'jita', 16663, 99, 99); // next day
		await insertSnapshot(day + 8 * HOUR, 'amarr', 16663, 5, 6);

		expect(await rollupPrices(env, '2026-10-05')).toBe(2);

		const jita = await env.HISTORY_DB.prepare(
			"SELECT * FROM price_daily WHERE hub_id = 'jita' AND type_id = 16663"
		).first();
		expect(jita).toEqual({
			date: '2026-10-05',
			hub_id: 'jita',
			type_id: 16663,
			buy_avg: 15,
			sell_avg: 95 / 3,
			buy_close: 15,
			sell_close: 40,
			buy_low: 10,
			buy_high: 20,
			sell_low: 25,
			sell_high: 40,
			samples: 3
		});
		// Re-running replaces instead of duplicating.
		expect(await rollupPrices(env, '2026-10-05')).toBe(2);
		const count = await env.HISTORY_DB.prepare('SELECT COUNT(*) AS n FROM price_daily').first();
		expect(count).toEqual({ n: 2 });
	});

	it('rolls up change-only snapshots to what one row per pair and refresh gave', async () => {
		// 48 refreshes of 3 hubs × 4 types; about 30 % of the pairs change per refresh, buy prices are
		// sometimes missing, and amarr/36 is first refreshed at the 10th refresh (a hub enabled later).
		const day = Date.UTC(2026, 9, 5);
		const times = [
			day - HOUR / 2,
			...Array.from({ length: 48 }, (_, i) => day + i * (HOUR / 2) + 60_000),
			day + 24 * HOUR
		];
		const next = random(42);
		const current = new Map<string, { buy: number | null; sell: number }>();
		const refreshes = times.map((at, i): { at: number; rows: PriceRow[] } => {
			const rows: PriceRow[] = [];
			for (const hubId of ['jita', 'amarr', 'rens'])
				for (const typeId of [34, 35, 36, 37]) {
					// times[0] is the previous day, so the 10th refresh of the day is times[10].
					if (hubId === 'amarr' && typeId === 36 && i < 10) continue;
					const key = `${hubId}/${typeId}`;
					let value = current.get(key);
					// rens/37 changes every time: every refresh stores some rows (production: 156 or more).
					if (!value || next() < 0.3 || key === 'rens/37') {
						value = {
							buy: next() < 0.2 ? null : Math.round(next() * 1000) / 10,
							sell: Math.round(next() * 1000) / 10 + 100
						};
						current.set(key, value);
					}
					rows.push({
						hubId,
						typeId,
						source: 'esi',
						aggregate: {
							buyMax: value.buy,
							sellMin: value.sell,
							buyP5: null,
							sellP5: null,
							buyVolume: 1,
							sellVolume: 1,
							buyOrders: 1,
							sellOrders: 1
						}
					});
				}
			return { at, rows };
		});
		const rollup = async () => {
			const metas: D1Meta[] = [];
			await rollupPrices(meteredEnv(metas), '2026-10-05');
			const { results } = await env.HISTORY_DB.prepare(
				'SELECT * FROM price_daily ORDER BY hub_id, type_id'
			).all<Record<string, number | string | null>>();
			const stored = await env.HISTORY_DB.prepare('SELECT COUNT(*) AS n FROM price_snapshots').first<{
				n: number;
			}>();
			return { results, read: rowCounts(metas).read, stored: stored!.n };
		};

		// One row per pair and refresh, as stored before change-only snapshots.
		for (const { at, rows } of refreshes)
			await env.HISTORY_DB.batch(
				rows.map((r) =>
					env.HISTORY_DB.prepare(
						`INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, source)
						VALUES (?, ?, ?, ?, ?, 1, 1, 'esi')`
					).bind(at, r.hubId, r.typeId, r.aggregate.buyMax, r.aggregate.sellMin)
				)
			);
		const dense = await rollup();

		await resetState();
		for (const { at, rows } of refreshes) await writePrices(env, rows, at);
		const changeOnly = await rollup();

		const exact = ({ buy_avg: _b, sell_avg: _s, ...rest }: Record<string, unknown>) => rest;
		expect(dense.results).toHaveLength(12);
		expect(changeOnly.results.map(exact)).toEqual(dense.results.map(exact));
		for (const [i, row] of dense.results.entries()) {
			const { buy_avg, sell_avg } = changeOnly.results[i]!;
			if (row.buy_avg === null) expect(buy_avg).toBeNull();
			else expect(buy_avg).toBeCloseTo(row.buy_avg as number, 9);
			expect(sell_avg).toBeCloseTo(row.sell_avg as number, 9);
		}
		expect(dense.results.find((r) => r.hub_id === 'amarr' && r.type_id === 36)).toMatchObject({
			samples: 39
		});
		// About one row read per stored row of the day, so change-only storage cuts the rollup's reads too.
		expect(changeOnly.stored).toBeLessThan(dense.stored / 2);
		expect(changeOnly.read).toBeLessThan(dense.read / 2);
		expect(changeOnly.read).toBeLessThanOrEqual(changeOnly.stored);
		// A re-run writes nothing.
		const metas: D1Meta[] = [];
		expect(await rollupPrices(meteredEnv(metas), '2026-10-05')).toBe(12);
		expect(rowCounts(metas).written).toBe(0);
	});

	it('computes market_stats from each type’s last 30 days without scanning the region', async () => {
		// 12 types with 400 days each (every 3rd day missing) in two regions.
		const rows: [number, number, string, number, number, number, number, number][] = [];
		for (const regionId of [10000002, 10000043])
			for (let typeId = 100; typeId < 112; typeId++)
				for (let d = 0; d < 400; d++) {
					if ((d + typeId) % 3 === 0) continue;
					const date = addDays('2026-01-01', d + (typeId % 4));
					rows.push([regionId, typeId, date, typeId + d / 7, 1, 1, typeId * 10 + d, 1]);
				}
		for (let i = 0; i < rows.length; i += 500)
			await env.HISTORY_DB.batch(
				rows
					.slice(i, i + 500)
					.map((r) =>
						env.HISTORY_DB.prepare('INSERT INTO esi_market_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
							...r
						)
					)
			);
		const region = rows.filter((r) => r[0] === 10000002);
		const expected = [...new Set(region.map((r) => r[1]))].map((typeId) => {
			const own = region.filter((r) => r[1] === typeId);
			const last = own.reduce((max, r) => (r[2] > max ? r[2] : max), '');
			const window = (days: number) => own.filter((r) => r[2] > addDays(last, -days));
			const mean = (list: typeof own) => list.reduce((sum, r) => sum + r[3], 0) / list.length;
			return {
				type_id: typeId,
				avg_daily_volume_30d: window(30).reduce((sum, r) => sum + r[6], 0) / 30,
				avg_daily_volume_7d: window(7).reduce((sum, r) => sum + r[6], 0) / 7,
				avg_price_5d: mean(window(5)),
				avg_price_30d: mean(window(30)),
				last_date: last
			};
		});

		const metas: D1Meta[] = [];
		expect(await recomputeMarketStats(meteredEnv(metas), 10000002, 1)).toBe(12);
		const { results } = await env.DB.prepare(
			`SELECT type_id, avg_daily_volume_30d, avg_daily_volume_7d, avg_price_5d, avg_price_30d, last_date
			FROM market_stats WHERE region_id = 10000002 ORDER BY type_id`
		).all<Record<string, number | string>>();
		expect(results).toHaveLength(12);
		for (const [i, row] of results.entries())
			for (const [key, value] of Object.entries(expected[i]!))
				if (typeof value === 'number') expect(row[key]).toBeCloseTo(value, 9);
				else expect(row[key]).toBe(value);
		// metas[0] is the stats query: each type's last 30 days and a few probes, however long the
		// history (the region scan read every row of the region and more).
		expect(metas[0]!.rows_read).toBeLessThan(region.length / 5);
	});

	it('stores a cost index only when it differs from the system’s latest stored value', async () => {
		const indices = (a: number, b: number) =>
			env.DB.batch([
				env.DB.prepare('DELETE FROM cost_indices'),
				env.DB.prepare(
					'INSERT INTO cost_indices (system_id, reaction, manufacturing, updated_at) VALUES (1, ?, 0, 1), (2, ?, 0, 1)'
				).bind(a, b)
			]);
		const rollup = async (date: string) => {
			const metas: D1Meta[] = [];
			expect(await rollupIndices(meteredEnv(metas), date)).toEqual({ adjusted: 0, costIndices: 2 });
			return rowCounts(metas).written;
		};

		await indices(0.1, 0.2);
		expect(await rollup('2026-10-01')).toBe(2 * 2);
		expect(await rollup('2026-10-02')).toBe(0);
		await indices(0.1, 0.3);
		expect(await rollup('2026-10-03')).toBe(2);
		// A re-run of the same date writes nothing.
		expect(await rollup('2026-10-03')).toBe(0);
		// Back to an older value: a change from the latest row, so stored.
		await indices(0.1, 0.2);
		expect(await rollup('2026-10-04')).toBe(2);
		const { results } = await env.HISTORY_DB.prepare(
			'SELECT date, system_id AS id, reaction FROM cost_index_daily ORDER BY date, id'
		).all();
		expect(results).toEqual([
			{ date: '2026-10-01', id: 1, reaction: 0.1 },
			{ date: '2026-10-01', id: 2, reaction: 0.2 },
			{ date: '2026-10-03', id: 2, reaction: 0.3 },
			{ date: '2026-10-04', id: 2, reaction: 0.2 }
		]);
	});

	it('retention deletes only fully archived and rolled-up days older than 90 days', async () => {
		// Run date 2026-10-06: 2026-07-07 is exactly 91 days back, 2026-07-08 is 90 days back.
		const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-07', '2026-07-08'];
		for (const day of days)
			for (const hour of [0, 6, 12, 23])
				await insertSnapshot(Date.parse(`${day}T00:00:00Z`) + hour * HOUR, 'jita', 1, 1, 1);
		// 2026-07-04 has 4 refreshes but only 3 archives (one refresh failed before its archive step).
		const archived: [string, number][] = [
			['2026-07-01', 4],
			['2026-07-02', 4],
			['2026-07-04', 3],
			['2026-07-07', 48],
			['2026-07-08', 4]
		];
		const rolledUp = ['2026-07-01', '2026-07-03', '2026-07-04', '2026-07-07', '2026-07-08'];
		for (const [day, objects] of archived)
			await env.HISTORY_DB.prepare(
				'INSERT INTO archive_manifest (date, object_count, bytes, verified_at) VALUES (?, ?, 1000, 1)'
			)
				.bind(day, objects)
				.run();
		for (const day of rolledUp)
			await env.HISTORY_DB.prepare(
				"INSERT INTO price_daily (date, hub_id, type_id, samples) VALUES (?, 'jita', 1, 4)"
			)
				.bind(day)
				.run();

		expect(await applyRetention(env, '2026-10-06')).toEqual({ dates: 2, deleted: 8 });

		const { results } = await env.HISTORY_DB.prepare(
			"SELECT date(snapshot_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM price_snapshots GROUP BY day ORDER BY day"
		).all();
		expect(results).toEqual([
			{ day: '2026-07-02', n: 4 },
			{ day: '2026-07-03', n: 4 },
			{ day: '2026-07-04', n: 4 },
			{ day: '2026-07-08', n: 4 }
		]);
	});

	it('prune removes expired sessions and finished job runs older than 90 days', async () => {
		const now = Date.UTC(2026, 9, 6, 12);
		const DAY = 24 * HOUR;
		await env.DB.batch([
			env.DB.prepare("INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('u1', 1, 1)"),
			env.DB.prepare(
				"INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at) VALUES ('old', 'u1', 1, ?), ('live', 'u1', 1, ?)"
			).bind(now - 1, now + DAY),
			env.DB.prepare(
				`INSERT INTO job_runs (run_id, kind, started_at, status) VALUES
				('ancient', 'prices', ?, 'ok'), ('stuck', 'prices', ?, 'running'), ('recent', 'prices', ?, 'failed')`
			).bind(now - 91 * DAY, now - 91 * DAY, now - 89 * DAY)
		]);

		expect(await pruneCoreTables(env, now)).toEqual({ sessions: 1, jobRuns: 1 });
		const sessions = await env.DB.prepare('SELECT session_hash FROM user_sessions').all();
		expect(sessions.results).toEqual([{ session_hash: 'live' }]);
		const runs = await env.DB.prepare('SELECT run_id FROM job_runs ORDER BY run_id').all();
		expect(runs.results).toEqual([{ run_id: 'recent' }, { run_id: 'stuck' }]);
	});
});

describe('DailyWorkflow', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('runs history per hub region, index rollups and the archive check for daily-<date>', async () => {
		await seedTrackedReaction();
		await env.DB.batch([
			env.DB.prepare(
				'INSERT INTO adjusted_prices (type_id, adjusted_price, updated_at) VALUES (4312, 1200, 1)'
			),
			env.DB.prepare(
				'INSERT INTO cost_indices (system_id, reaction, manufacturing, updated_at) VALUES (30002647, 0.04, 0.01, 1), (30000142, 0.02, 0.03, 1)'
			)
		]);
		await env.ARCHIVE.put('prices/raw/2026/10/05/1.json.gz', new Uint8Array(10));
		await env.ARCHIVE.put('prices/raw/2026/10/05/2.json.gz', new Uint8Array(15));
		await env.ARCHIVE.put('prices/raw/2026/10/06/3.json.gz', new Uint8Array(20));
		await insertSnapshot(Date.UTC(2026, 9, 5, 6), 'jita', 16663, 10, 20);
		const calls = installFetch((url) =>
			url.pathname.endsWith('/history') ? json(historyDays()) : json([], {}, 404)
		);

		const id = 'daily-2026-10-06';
		await using instance = await introspectWorkflowInstance(env.DAILY, id);
		await instance.modify(async (m) => m.disableRetryDelays());
		await env.DAILY.create({ id, params: { date: '2026-10-06' } });
		await instance.waitForStatus('complete');
		const output = (await instance.getOutput()) as DailyResult;

		expect(output).toMatchObject({
			date: '2026-10-06',
			status: 'ok',
			priceDaily: 1,
			adjusted: 1,
			costIndices: 2,
			archive: { objects: 2, bytes: 25 },
			retention: { dates: 0, deleted: 0 }
		});
		expect(output.history.map((h) => h.regionId)).toEqual([10000002, 10000030, 10000032, 10000042, 10000043]);
		expect(calls).toHaveLength(5 * 4);
		const regions = await env.HISTORY_DB.prepare(
			'SELECT COUNT(DISTINCT region_id) AS n, COUNT(*) AS rows FROM esi_market_history'
		).first();
		expect(regions).toEqual({ n: 5, rows: 5 * 4 * 5 });
		expect(await env.HISTORY_DB.prepare('SELECT * FROM adjusted_price_daily').all()).toMatchObject({
			results: [{ date: '2026-10-06', type_id: 4312, adjusted_price: 1200 }]
		});
		const costs = await env.HISTORY_DB.prepare(
			'SELECT date, system_id, reaction FROM cost_index_daily ORDER BY system_id'
		).all();
		expect(costs.results).toEqual([
			{ date: '2026-10-06', system_id: 30000142, reaction: 0.02 },
			{ date: '2026-10-06', system_id: 30002647, reaction: 0.04 }
		]);
		const manifest = await env.HISTORY_DB.prepare(
			'SELECT date, object_count, bytes FROM archive_manifest'
		).all();
		expect(manifest.results).toEqual([{ date: '2026-10-05', object_count: 2, bytes: 25 }]);
		expect(
			await env.HISTORY_DB.prepare("SELECT samples FROM price_daily WHERE date = '2026-10-05'").first()
		).toEqual({ samples: 1 });
		const job = await env.DB.prepare('SELECT kind, status FROM job_runs WHERE run_id = ?').bind(id).first();
		expect(job).toEqual({ kind: 'daily', status: 'ok' });
	});

	describe('market history ESI could not answer', () => {
		const VALE = '/markets/10000030/history';
		/** Type 16663 in one region answers 503 for its first `failures` requests (2 per attempt). */
		async function run(id: string, failures: number) {
			await seedTrackedReaction();
			let left = failures;
			const calls = installFetch((url) => {
				if (url.pathname === VALE && url.searchParams.get('type_id') === '16663' && left > 0) {
					left--;
					return json({ error: 'Service Unavailable' }, { 'Retry-After': '0' }, 503);
				}
				return url.pathname.endsWith('/history') ? json(historyDays()) : json([], {}, 404);
			});
			await using instance = await introspectWorkflowInstance(env.DAILY, id);
			await instance.modify(async (m) => {
				m.disableSleeps();
				m.disableRetryDelays();
			});
			await env.DAILY.create({ id, params: { date: '2026-10-06' } });
			await instance.waitForStatus('complete');
			const output = (await instance.getOutput()) as DailyResult;
			const job = await env.DB.prepare('SELECT status FROM job_runs WHERE run_id = ?').bind(id).first();
			const valeCalls = calls.filter(
				(c) => new URL(c.url).pathname === VALE && new URL(c.url).searchParams.get('type_id') === '16663'
			).length;
			return { output, job, valeCalls, region: output.history.find((h) => h.regionId === 10000030) };
		}

		it('retries them after a wait and ends ok when the retry gets them', async () => {
			// The first pass fails (2 attempts); the first retry round gets its 5 days.
			const { output, job, valeCalls, region } = await run('daily-2026-10-06', 2);
			expect(output).toMatchObject({ status: 'ok', historyRetried: 1, historyFailed: 0 });
			expect(job).toEqual({ status: 'ok' });
			expect(region).toMatchObject({ types: 4, inserted: 4 * 5, failed: 0, failedTypeIds: [] });
			expect(valeCalls).toBe(3);
		});

		it('is partial when every retry round fails too', async () => {
			const { output, job, valeCalls, region } = await run('daily-2026-10-06', Infinity);
			expect(output).toMatchObject({ status: 'partial', historyRetried: 1, historyFailed: 1 });
			expect(job).toEqual({ status: 'partial' });
			expect(region).toMatchObject({ types: 4, inserted: 3 * 5, failed: 1, failedTypeIds: [16663] });
			// First pass and 3 retry rounds, 2 attempts each.
			expect(valeCalls).toBe(4 * 2);
		});
	});
});
