import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyRetention,
	pruneCoreTables,
	refreshRegionHistory,
	rollupPrices
} from '../src/workflows/daily.ts';
import type { DailyResult } from '../src/workflows/daily.ts';
import { installFetch, json, resetState, seedTrackedReaction } from './helpers.ts';

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

		expect(counts).toEqual({ regionId: 10000002, types: 4, inserted: 17, failed: 0, stats: 4 });
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
});
