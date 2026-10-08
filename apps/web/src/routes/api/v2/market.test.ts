import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CostIndicesResponse,
	ErrorResponse,
	PriceHistoryResponse,
	PricesResponse
} from '$lib/server/api/schemas';
import { clearDataMemo } from '$lib/server/data';
import { trackedTypes } from '$lib/server/planner';
import { apiEvent, callApi, invalidParams, seededEnv } from '../../../test/api';
import type { FakeD1 } from '../../../test/fakes';
import { NOW, insertStructureHub } from '../../../test/fixtures';
import { GET as costIndices } from './cost-indices/+server';
import { GET as history } from './prices/history/+server';
import { GET as prices } from './prices/+server';

const DAY = 86_400_000;
/** Jita sell price of the test market snapshot (`marketFor`). */
const sellOf = (typeId: number) => ((typeId * 100) % 997) + 1;

beforeEach(() => {
	clearDataMemo();
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

function insertDaily(db: FakeD1, date: string, hubId: string, typeId: number, buy: number, sell: number) {
	db.sqlite
		.prepare(
			`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, buy_close, sell_close, buy_low, buy_high, sell_low, sell_high, samples)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4)`
		)
		.run(date, hubId, typeId, buy, sell, buy, sell, buy, buy, sell, sell);
}

function insertEsiHistory(db: FakeD1, regionId: number, typeId: number, date: string, average: number) {
	db.sqlite
		.prepare(
			`INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
			VALUES (?, ?, ?, ?, ?, ?, 100, 10)`
		)
		.run(regionId, typeId, date, average, average, average);
}

describe('GET /api/v2/prices', () => {
	it('returns current prices and order volumes of the requested types', async () => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(prices, apiEvent(env, '/api/v2/prices?hub=jita&types=34,16663'));
		const parsed = PricesResponse.parse(body);
		expect(parsed).toMatchObject({ hub: 'jita', asOf: new Date(NOW).toISOString(), approximate: false });
		expect(parsed.prices).toEqual([
			{
				typeId: 34,
				name: 'Tritanium',
				buy: sellOf(34) * 0.9,
				sell: sellOf(34),
				buyVolume: 1000,
				sellVolume: 1000
			},
			{
				typeId: 16663,
				name: 'Caesarium Cadmide',
				buy: sellOf(16663) * 0.9,
				sell: sellOf(16663),
				buyVolume: 1000,
				sellVolume: 1000
			}
		]);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
	});

	it('defaults to Jita and every tracked type; hubs without prices give null rows', async () => {
		const { env, sde } = await seededEnv();
		const all = PricesResponse.parse((await callApi(prices, apiEvent(env, '/api/v2/prices'))).body);
		expect(all.hub).toBe('jita');
		expect(all.prices.map((p) => p.typeId)).toEqual([...trackedTypes(sde.dataset)].sort((a, b) => a - b));
		const amarr = PricesResponse.parse(
			(await callApi(prices, apiEvent(env, '/api/v2/prices?hub=amarr&types=34'))).body
		);
		expect(amarr.prices[0]).toMatchObject({ typeId: 34, buy: null, sell: null });
	});

	it('serves CSV rows with a header', async () => {
		const { env } = await seededEnv();
		const { response, text } = await callApi(prices, apiEvent(env, '/api/v2/prices?types=34&format=csv'));
		expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
		expect(text).toBe(
			`typeId,name,buy,sell,buyVolume,sellVolume\r\n34,Tritanium,${sellOf(34) * 0.9},${sellOf(34)},1000,1000\r\n`
		);
	});

	it('uses daily averages for date= and marks regional ESI fill-ins approximate', async () => {
		const { env } = await seededEnv();
		insertDaily(env.HISTORY_DB, '2026-10-01', 'jita', 34, 4, 5);
		insertEsiHistory(env.HISTORY_DB, 10000002, 16663, '2026-10-01', 777);
		const { body } = await callApi(prices, apiEvent(env, '/api/v2/prices?types=34,16663&date=2026-10-01'));
		const parsed = PricesResponse.parse(body);
		expect(parsed).toMatchObject({ asOf: '2026-10-01', approximate: true });
		expect(parsed.prices).toEqual([
			{ typeId: 34, name: 'Tritanium', buy: 4, sell: 5, buyVolume: null, sellVolume: null },
			{ typeId: 16663, name: 'Caesarium Cadmide', buy: 777, sell: 777, buyVolume: null, sellVolume: null }
		]);
		insertDaily(env.HISTORY_DB, '2026-10-02', 'jita', 34, 4, 5);
		const exact = await callApi(prices, apiEvent(env, '/api/v2/prices?types=34&date=2026-10-02'));
		expect(exact.body.approximate).toBe(false);
	});

	it.each([
		['/api/v2/prices?types=abc', 'types'],
		[`/api/v2/prices?types=${Array.from({ length: 201 }, (_, i) => i + 1).join(',')}`, 'types'],
		['/api/v2/prices?date=2026-13-01', 'date'],
		['/api/v2/prices?date=2026-10-06', 'date'],
		['/api/v2/prices?date=2024-01-01', 'date'],
		['/api/v2/prices?format=xml', 'format']
	])('%s → 400 INVALID_PARAM naming %s', async (path, param) => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(prices, apiEvent(env, path));
		expect(response.status).toBe(400);
		expect(ErrorResponse.parse(body).error.code).toBe('INVALID_PARAM');
		expect(invalidParams(body)).toEqual([param]);
	});

	it('treats private, disabled and unknown hubs alike: 404 NOT_FOUND', async () => {
		const { env } = await seededEnv();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		env.DB.sqlite.exec("UPDATE market_hubs SET enabled = 0 WHERE hub_id = 'hek'");
		for (const hub of ['structure-1044752365771', 'hek', 'nowhere']) {
			const { response, body } = await callApi(prices, apiEvent(env, `/api/v2/prices?hub=${hub}`));
			expect(response.status).toBe(404);
			expect(ErrorResponse.parse(body).error).toEqual({
				code: 'NOT_FOUND',
				message: `Unknown hub "${hub}".`
			});
		}
	});
});

describe('GET /api/v2/prices/history', () => {
	it('returns daily averages, filling missing days from the region', async () => {
		const { env } = await seededEnv();
		insertDaily(env.HISTORY_DB, '2026-10-02', 'jita', 16663, 90, 100);
		insertEsiHistory(env.HISTORY_DB, 10000002, 16663, '2026-10-01', 95);
		insertEsiHistory(env.HISTORY_DB, 10000002, 16663, '2026-10-02', 96);
		insertEsiHistory(env.HISTORY_DB, 10000043, 16663, '2026-10-03', 1);
		const { response, body } = await callApi(
			history,
			apiEvent(env, '/api/v2/prices/history?type=16663&from=2026-09-30&to=2026-10-04')
		);
		const parsed = PriceHistoryResponse.parse(body);
		expect(parsed).toMatchObject({
			hub: 'jita',
			typeId: 16663,
			name: 'Caesarium Cadmide',
			resolution: 'daily'
		});
		expect(parsed.points).toEqual([
			{ at: '2026-10-01', buy: 95, sell: 95, buyVolume: null, sellVolume: null, approximate: true },
			{ at: '2026-10-02', buy: 90, sell: 100, buyVolume: null, sellVolume: null, approximate: false }
		]);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
	});

	it('defaults to the 30 days up to today', async () => {
		const { env } = await seededEnv();
		const { body } = await callApi(history, apiEvent(env, '/api/v2/prices/history?type=16663'));
		expect(body).toMatchObject({ from: '2026-09-07', to: '2026-10-06', points: [] });
	});

	it('returns refresh snapshots within 90 days, also as CSV', async () => {
		const { env } = await seededEnv();
		const insert = env.HISTORY_DB.sqlite.prepare(
			`INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_p5, sell_p5, buy_volume, sell_volume, source)
			VALUES (?, 'jita', 16663, ?, ?, NULL, NULL, 10, 20, 'esi')`
		);
		insert.run(NOW - DAY, 80, 90);
		insert.run(NOW - 2 * DAY, 81, 91);
		insert.run(NOW - 40 * DAY, 1, 1);
		const path = '/api/v2/prices/history?type=16663&resolution=snapshot&from=2026-10-01';
		const parsed = PriceHistoryResponse.parse((await callApi(history, apiEvent(env, path))).body);
		expect(parsed.points).toEqual([
			{
				at: new Date(NOW - 2 * DAY).toISOString(),
				buy: 81,
				sell: 91,
				buyVolume: 10,
				sellVolume: 20,
				approximate: false
			},
			{
				at: new Date(NOW - DAY).toISOString(),
				buy: 80,
				sell: 90,
				buyVolume: 10,
				sellVolume: 20,
				approximate: false
			}
		]);
		const { text } = await callApi(history, apiEvent(env, `${path}&format=csv`));
		expect(text.split('\r\n')[0]).toBe('at,buy,sell,buyVolume,sellVolume,approximate');
		expect(text.split('\r\n')[1]).toBe(`${new Date(NOW - 2 * DAY).toISOString()},81,91,10,20,false`);
	});

	it.each([
		['/api/v2/prices/history', 'type'],
		['/api/v2/prices/history?type=0', 'type'],
		['/api/v2/prices/history?type=16663&resolution=hourly', 'resolution'],
		['/api/v2/prices/history?type=16663&from=2026-10-05&to=2026-10-01', 'from'],
		['/api/v2/prices/history?type=16663&to=2026-10-07', 'to'],
		['/api/v2/prices/history?type=16663&from=2025-01-01&to=2026-10-01', 'from'],
		['/api/v2/prices/history?type=16663&resolution=snapshot&from=2026-06-01', 'from']
	])('%s → 400 naming %s', async (path, param) => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(history, apiEvent(env, path));
		expect(response.status).toBe(400);
		expect(invalidParams(body)).toEqual([param]);
	});

	it('404s for unknown types and private hubs', async () => {
		const { env } = await seededEnv();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		for (const path of [
			'/api/v2/prices/history?type=999999999',
			'/api/v2/prices/history?type=16663&hub=structure-1044752365771'
		]) {
			const { response, body } = await callApi(history, apiEvent(env, path));
			expect(response.status).toBe(404);
			expect(ErrorResponse.parse(body).error.code).toBe('NOT_FOUND');
		}
	});
});

describe('GET /api/v2/cost-indices', () => {
	it('returns the reaction index of known systems', async () => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(
			costIndices,
			apiEvent(env, '/api/v2/cost-indices?systems=30002647,30004604')
		);
		expect(CostIndicesResponse.parse(body)).toEqual([
			{ systemId: 30002647, name: 'Ignoitton', reaction: 0.0412, updatedAt: new Date(NOW).toISOString() }
		]);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
		const csv = await callApi(costIndices, apiEvent(env, '/api/v2/cost-indices?systems=30002647&format=csv'));
		expect(csv.text).toBe(
			`systemId,name,reaction,updatedAt\r\n30002647,Ignoitton,0.0412,${new Date(NOW).toISOString()}\r\n`
		);
	});

	it.each([
		['/api/v2/cost-indices', 'systems'],
		['/api/v2/cost-indices?systems=1,x', 'systems'],
		[`/api/v2/cost-indices?systems=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`, 'systems']
	])('%s → 400 naming %s', async (path, param) => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(costIndices, apiEvent(env, path));
		expect(response.status).toBe(400);
		expect(invalidParams(body)).toEqual([param]);
	});
});
