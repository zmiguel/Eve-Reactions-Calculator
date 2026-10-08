import { describe, expect, it } from 'vitest';
import { fetchFuzzworkAggregates } from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

const side = (max: string, min: string, percentile: string, volume: string, orderCount: string) => ({
	weightedAverage: '0',
	max,
	min,
	stddev: '0',
	median: '0',
	volume,
	orderCount,
	percentile
});

describe('fetchFuzzworkAggregates', () => {
	it('parses strings to numbers and nulls prices of empty sides', async () => {
		const { fetch, calls } = fakeFetch(() =>
			json({
				'34': {
					buy: side('5.11', '0.01', '5.05', '1234567.0', '120'),
					sell: side('900', '5.2', '5.25', '7654321', '80')
				},
				'16663': { buy: side('0', '0', '0', '0', '0'), sell: side('1500.5', '1400', '1410.25', '42', '3') }
			})
		);
		const res = await fetchFuzzworkAggregates(fetch, TEST_UA, 60003760, [34, 16663]);
		expect(res).toEqual({
			34: {
				buyMax: 5.11,
				sellMin: 5.2,
				buyP5: 5.05,
				sellP5: 5.25,
				buyVolume: 1234567,
				sellVolume: 7654321,
				buyOrders: 120,
				sellOrders: 80
			},
			16663: {
				buyMax: null,
				sellMin: 1400,
				buyP5: null,
				sellP5: 1410.25,
				buyVolume: 0,
				sellVolume: 42,
				buyOrders: 0,
				sellOrders: 3
			}
		});
		expect(calls[0].url).toBe('https://market.fuzzwork.co.uk/aggregates/?region=60003760&types=34,16663');
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
	});

	it('splits more than 200 type ids into batches of 200', async () => {
		const { fetch, calls } = fakeFetch((call) => {
			const types = new URL(call.url).searchParams.get('types')!.split(',');
			return json(
				Object.fromEntries(
					types.map((t) => [t, { buy: side('1', '1', '1', '1', '1'), sell: side('2', '2', '2', '1', '1') }])
				)
			);
		});
		const ids = Array.from({ length: 250 }, (_, i) => i + 1);
		const res = await fetchFuzzworkAggregates(fetch, TEST_UA, 30000144, ids);
		expect(calls).toHaveLength(2);
		expect(new URL(calls[0].url).searchParams.get('types')!.split(',')).toHaveLength(200);
		expect(new URL(calls[1].url).searchParams.get('types')!.split(',')).toEqual(ids.slice(200).map(String));
		expect(Object.keys(res)).toHaveLength(250);
		expect(res[250].sellMin).toBe(2);
	});

	it('throws on a non-200 answer', async () => {
		const { fetch } = fakeFetch(() => new Response('down', { status: 502 }));
		await expect(fetchFuzzworkAggregates(fetch, TEST_UA, 60003760, [34])).rejects.toMatchObject({
			status: 502
		});
	});
});
