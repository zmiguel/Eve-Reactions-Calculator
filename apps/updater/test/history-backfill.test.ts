import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backfillTypes } from '../src/workflows/history-backfill.ts';
import type { BackfillResult } from '../src/workflows/history-backfill.ts';
import { installFetch, json, resetState, seedTrackedReaction } from './helpers.ts';

const FORGE = 10000002;
const DOMAIN = 10000043;

const day = (date: string, volume: number) => ({
	date,
	average: 100,
	highest: 110,
	lowest: 90,
	order_count: 5,
	volume
});

async function insertHistory(regionId: number, typeId: number, date: string, volume: number) {
	await env.HISTORY_DB.prepare(
		`INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
		VALUES (?, ?, ?, 1, 1, 1, ?, 1)`
	)
		.bind(regionId, typeId, date, volume)
		.run();
}

async function stored(regionId: number, typeId: number) {
	const { results } = await env.HISTORY_DB.prepare(
		'SELECT date, volume FROM esi_market_history WHERE region_id = ? AND type_id = ? ORDER BY date'
	)
		.bind(regionId, typeId)
		.all();
	return results;
}

/** Mirror answer for 16663: The Forge plus a region without a hub; 4312 is unknown (404). */
function mirror() {
	return installFetch((url) =>
		url.pathname === '/api/v1/history-aggregate/16663'
			? json([
					{
						region_id: FORGE,
						history: [day('2025-02-01', 10), day('2025-03-01', 20), day('2026-10-05', 30)]
					},
					{ region_id: 10000099, history: [day('2026-10-05', 99)] }
				])
			: json({ error: 'not found' }, {}, 404)
	);
}

describe('history backfill', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it("replaces the mirror's date range per region and type and keeps everything else", async () => {
		// Wrong (e.g. seeded) rows inside the mirror's range, a newer ESI day and another region's history.
		await insertHistory(FORGE, 16663, '2025-02-15', 999);
		await insertHistory(FORGE, 16663, '2025-03-01', 999);
		await insertHistory(FORGE, 16663, '2026-10-06', 40);
		await insertHistory(DOMAIN, 16663, '2025-03-01', 7);
		const calls = mirror();

		expect(await backfillTypes(env, [FORGE, DOMAIN], [16663, 4312], '2026-10-07')).toEqual({
			types: 2,
			series: 1,
			rows: 3,
			failed: 1
		});
		expect(calls.map((c) => c.url).sort()).toEqual([
			'https://market.coalition.space/api/v1/history-aggregate/16663?after=2025-02-01&before=2026-10-07',
			'https://market.coalition.space/api/v1/history-aggregate/4312?after=2025-02-01&before=2026-10-07'
		]);
		expect(await stored(FORGE, 16663)).toEqual([
			{ date: '2025-02-01', volume: 10 },
			{ date: '2025-03-01', volume: 20 },
			{ date: '2026-10-05', volume: 30 },
			{ date: '2026-10-06', volume: 40 }
		]);
		expect(await stored(DOMAIN, 16663)).toEqual([{ date: '2025-03-01', volume: 7 }]);
		expect(await stored(10000099, 16663)).toEqual([]);
	});

	it('the workflow imports every tracked type, recomputes market_stats and records the job', async () => {
		await seedTrackedReaction();
		mirror();
		const id = 'history-backfill-manual-1';
		await using instance = await introspectWorkflowInstance(env.HISTORY_BACKFILL, id);
		await instance.modify(async (m) => m.disableRetryDelays());
		await env.HISTORY_BACKFILL.create({ id, params: {} });
		await instance.waitForStatus('complete');

		const output = (await instance.getOutput()) as BackfillResult;
		// Every tracked non-formula type but 16663 is unknown to the mirror.
		expect(output).toMatchObject({ status: 'partial', series: 1, rows: 3, failed: output.types - 1 });
		const stats = await env.DB.prepare(
			'SELECT avg_daily_volume_30d AS volume FROM market_stats WHERE region_id = ? AND type_id = 16663'
		)
			.bind(FORGE)
			.first();
		expect(stats).toEqual({ volume: 30 / 30 });
		const job = await env.DB.prepare('SELECT kind, status FROM job_runs WHERE run_id = ?').bind(id).first();
		expect(job).toEqual({ kind: 'history', status: 'partial' });
	});
});
