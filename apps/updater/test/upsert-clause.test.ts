import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { jsonInsertSql, upsertClause } from '../src/prices.ts';
import { resetState } from './helpers.ts';

const COLUMNS = [
	'region_id',
	'type_id',
	'avg_daily_volume_30d',
	'avg_daily_volume_7d',
	'avg_price_5d',
	'avg_price_30d',
	'last_date',
	'updated_at'
];
const SQL = jsonInsertSql(
	'market_stats',
	COLUMNS,
	upsertClause('market_stats', COLUMNS, ['region_id', 'type_id'], ['updated_at'])
);

/** Rows of `[typeId, avg_daily_volume_7d, updated_at]` in region 1. */
async function upsert(rows: [number, number | null, number][]) {
	const values = rows.map(([typeId, volume7d, at]) => [1, typeId, 10, volume7d, 5, 5, '2026-11-12', at]);
	return env.DB.prepare(SQL).bind(JSON.stringify(values)).run();
}

async function stored() {
	const { results } = await env.DB.prepare(
		'SELECT type_id, avg_daily_volume_7d AS volume, updated_at FROM market_stats ORDER BY type_id'
	).all();
	return results;
}

describe('upsertClause', () => {
	beforeEach(resetState);

	it('leaves unchanged rows and their untracked columns alone, rewrites changed rows', async () => {
		await upsert([
			[34, 3, 100],
			[35, null, 100]
		]);
		const unchanged = await upsert([
			[34, 3, 200],
			[35, null, 200]
		]);
		expect(unchanged.meta.changes).toBe(0);
		expect(await stored()).toEqual([
			{ type_id: 34, volume: 3, updated_at: 100 },
			{ type_id: 35, volume: null, updated_at: 100 }
		]);

		const changed = await upsert([
			[34, 3, 300],
			[35, 7, 300]
		]);
		expect(changed.meta.changes).toBe(1);
		expect(await stored()).toEqual([
			{ type_id: 34, volume: 3, updated_at: 100 },
			{ type_id: 35, volume: 7, updated_at: 300 }
		]);
	});
});
