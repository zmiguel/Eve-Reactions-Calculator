import { describe, expect, it, vi } from 'vitest';
import { EsiError, fetchMirrorTypeHistory } from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

const day = {
	date: '2025-02-01',
	average: 607.6,
	highest: 607.9,
	lowest: 606,
	order_count: 122,
	volume: 6061706
};

describe('fetchMirrorTypeHistory', () => {
	it('requests one type for all regions in the date window and maps ESI days', async () => {
		const { fetch, calls } = fakeFetch(() =>
			json([
				{ region_id: 10000002, history: [day] },
				{ region_id: 10000043, history: [] }
			])
		);
		expect(await fetchMirrorTypeHistory(fetch, TEST_UA, 16679, '2025-02-01', '2026-10-07')).toEqual([
			{
				regionId: 10000002,
				days: [
					{
						date: '2025-02-01',
						average: 607.6,
						highest: 607.9,
						lowest: 606,
						volume: 6061706,
						orderCount: 122
					}
				]
			},
			{ regionId: 10000043, days: [] }
		]);
		expect(calls[0].url).toBe(
			'https://market.coalition.space/api/v1/history-aggregate/16679?after=2025-02-01&before=2026-10-07'
		);
		expect(calls[0].headers.get('User-Agent')).toBe(TEST_UA);
	});

	it('waits for the rate-limit reset on 429 and retries 5xx', async () => {
		const responses = [
			new Response('slow down', { status: 429, headers: { 'x-rate-limit-reset': '2' } }),
			new Response('oops', { status: 502 }),
			json([{ region_id: 10000002, history: [day] }])
		];
		const { fetch, calls } = fakeFetch(() => responses.shift()!);
		const sleep = vi.fn(async () => {});
		const result = await fetchMirrorTypeHistory(fetch, TEST_UA, 16679, '2025-02-01', '2026-10-07', { sleep });
		expect(result[0].days).toHaveLength(1);
		expect(calls).toHaveLength(3);
		expect(sleep.mock.calls).toEqual([[2000], [2000]]);
	});

	it('fails on client errors and after the last attempt', async () => {
		const notFound = fakeFetch(() => new Response('no', { status: 404 }));
		await expect(
			fetchMirrorTypeHistory(notFound.fetch, TEST_UA, 1, '2025-02-01', '2026-10-07')
		).rejects.toBeInstanceOf(EsiError);
		expect(notFound.calls).toHaveLength(1);

		const down = fakeFetch(() => new Response('down', { status: 503 }));
		await expect(
			fetchMirrorTypeHistory(down.fetch, TEST_UA, 1, '2025-02-01', '2026-10-07', {
				sleep: async () => {},
				attempts: 2
			})
		).rejects.toMatchObject({ status: 503 });
		expect(down.calls).toHaveLength(2);
	});
});
