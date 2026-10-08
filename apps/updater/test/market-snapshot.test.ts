import { env } from 'cloudflare:workers';
import { MARKET_KV_KEY } from '@reactions/db';
import type { MarketSnapshot } from '@reactions/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { publishMarketSnapshot } from '../src/market-snapshot.ts';
import { resetState } from './helpers.ts';

const T0 = Date.UTC(2026, 9, 6, 12, 0);

function price(hubId: string, typeId: number, buy: number | null, sell: number | null, observedAt: number) {
	return env.DB.prepare(
		`INSERT INTO latest_prices (hub_id, type_id, buy_max, sell_min, buy_p5, sell_p5, buy_volume, sell_volume,
			buy_orders, sell_orders, source, observed_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 1, 1, 'esi', ?)`
	).bind(hubId, typeId, buy, sell, typeId * 10, typeId * 20, observedAt);
}

function structureHub(hubId: string, visibility: 'public' | 'private', enabled: number) {
	return env.DB.prepare(
		`INSERT INTO market_hubs (hub_id, name, kind, region_id, system_id, location_id, fuzzwork_location_id,
			visibility, share_status, enabled, sort_order, created_at)
		VALUES (?, ?, 'structure', 10000002, 30000144, 1, 1, ?, 'none', ?, 100, 0)`
	).bind(hubId, hubId, visibility, enabled);
}

describe('publishMarketSnapshot', () => {
	beforeEach(resetState);

	it('includes only enabled public hubs with [buy, sell, buyVolume, sellVolume] tuples', async () => {
		await env.DB.batch([
			structureHub('structure-1', 'private', 1),
			structureHub('structure-2', 'public', 1),
			env.DB.prepare("UPDATE market_hubs SET enabled = 0 WHERE hub_id = 'hek'"),
			price('jita', 34, 5, 6, T0 - 1000),
			price('jita', 35, null, 9, T0 - 500),
			price('amarr', 34, 4.5, 6.5, T0 - 2000),
			price('hek', 34, 1, 2, T0),
			price('structure-1', 34, 3, 4, T0 + 5000),
			price('structure-2', 34, 3.5, 4.5, T0 - 3000),
			env.DB.prepare('INSERT INTO adjusted_prices VALUES (34, 5.5, 5.6, ?), (35, 10, NULL, ?)').bind(
				T0 - 100,
				T0 - 50
			),
			env.DB.prepare('INSERT INTO cost_indices VALUES (30002647, 0.04, 0.02, ?)').bind(T0 - 7)
		]);

		const snapshot = await publishMarketSnapshot(env, T0 + 99_999);
		const stored = await env.CACHE.get<MarketSnapshot>(MARKET_KV_KEY, 'json');

		expect(stored).toEqual(snapshot);
		expect(snapshot.hubs.map((h) => h.hubId)).toEqual([
			'jita',
			'amarr',
			'perimeter',
			'dodixie',
			'rens',
			'structure-2'
		]);
		expect(snapshot.hubs[0]).toEqual({
			hubId: 'jita',
			name: 'Jita 4-4',
			kind: 'station',
			regionId: 10000002
		});
		expect(Object.keys(snapshot.prices).sort()).toEqual(
			['amarr', 'dodixie', 'jita', 'perimeter', 'rens', 'structure-2'].sort()
		);
		expect(stored?.prices.jita).toEqual({ 34: [5, 6, 340, 680], 35: [null, 9, 350, 700] });
		expect(stored?.prices['structure-2']).toEqual({ 34: [3.5, 4.5, 340, 680] });
		expect(stored?.prices.perimeter).toEqual({});
		expect(JSON.stringify(stored)).not.toContain('structure-1');
		// Max observed_at among included prices (private structure-1 and disabled hek are newer but excluded).
		expect(snapshot.snapshotAt).toBe(T0 - 500);
		expect(snapshot.adjusted).toEqual({ 34: 5.5, 35: 10 });
		expect(snapshot.adjustedUpdatedAt).toBe(T0 - 50);
		expect(snapshot.costIndicesUpdatedAt).toBe(T0 - 7);
	});

	it('uses now as snapshotAt and 0 update times when nothing is stored yet', async () => {
		const snapshot = await publishMarketSnapshot(env, T0);

		expect(snapshot.snapshotAt).toBe(T0);
		expect(snapshot.adjusted).toEqual({});
		expect(snapshot.costIndicesUpdatedAt).toBe(0);
		expect(snapshot.adjustedUpdatedAt).toBe(0);
		expect(snapshot.hubs).toHaveLength(6);
	});
});
