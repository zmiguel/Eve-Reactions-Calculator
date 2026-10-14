import { describe, expect, it } from 'vitest';
import { fetchJaniceAppraisal, parseJaniceCodes } from '../src/index.ts';
import { TEST_UA, fakeFetch, json } from './fake-fetch.ts';

describe('parseJaniceCodes', () => {
	it('finds every linked code once, in order', () => {
		expect(
			parseJaniceCodes(
				'Moon goo https://janice.e-351.com/a/AbC123 + http://www.janice.e-351.com/a/x9Y, again janice.e-351.com/a/AbC123'
			)
		).toEqual(['AbC123', 'x9Y']);
	});

	it('ignores trailing punctuation', () => {
		expect(parseJaniceCodes('(see janice.e-351.com/a/Qw3rty).')).toEqual(['Qw3rty']);
		expect(parseJaniceCodes('JANICE.E-351.COM/a/abc!')).toEqual(['abc']);
	});

	it('ignores other hosts, other paths and empty titles', () => {
		expect(parseJaniceCodes('https://notjanice.e-351.com/a/AbC123')).toEqual([]);
		expect(parseJaniceCodes('https://evil.example/janice.e-351.com/a/AbC123')).toEqual([]);
		expect(parseJaniceCodes('https://janice.e-351.com.evil.example/a/AbC123')).toEqual([]);
		expect(parseJaniceCodes('https://janice.e-351.com/appraisal/AbC123')).toEqual([]);
		expect(parseJaniceCodes('https://janice.e-351.com/a/')).toEqual([]);
		expect(parseJaniceCodes('')).toEqual([]);
		expect(parseJaniceCodes(null)).toEqual([]);
		expect(parseJaniceCodes(undefined)).toEqual([]);
	});
});

const APPRAISAL = {
	id: 123456,
	code: 'AbC123',
	created: '2026-10-10T07:59:00Z',
	expiresAt: '2026-11-10T07:59:00Z',
	datasetTime: '2026-10-10T07:55:00Z',
	designation: 'appraisal',
	pricing: 'split',
	pricingVariant: 'immediate',
	pricePercentage: 0.95,
	market: { id: 2, name: 'Jita 4-4' },
	effectivePrices: { totalBuyPrice: 1, totalSplitPrice: 2, totalSellPrice: 3 },
	items: [
		{
			id: 1,
			amount: 2000,
			itemType: { eid: 16663, name: 'Caesarium Cadmide', volume: 1, packagedVolume: 1 },
			effectivePrices: {
				buyPrice: 1400,
				buyPriceTotal: 2800000,
				splitPrice: 1500,
				splitPriceTotal: 3000000,
				sellPrice: 1600,
				sellPriceTotal: 3200000
			},
			immediatePrices: { buyPrice: 1, splitPrice: 1, sellPrice: 1 }
		}
	]
};

describe('fetchJaniceAppraisal', () => {
	it('fetches an appraisal with the key and maps the effective prices', async () => {
		const { fetch, calls } = fakeFetch(() => json(APPRAISAL));
		expect(await fetchJaniceAppraisal(fetch, { apiKey: 'key-1', userAgent: TEST_UA }, 'AbC123')).toEqual({
			ok: true,
			appraisal: {
				code: 'AbC123',
				created: Date.UTC(2026, 9, 10, 7, 59),
				datasetTime: Date.UTC(2026, 9, 10, 7, 55),
				marketId: 2,
				marketName: 'Jita 4-4',
				pricing: 'split',
				pricingVariant: 'immediate',
				pricePercentage: 0.95,
				items: [
					{
						typeId: 16663,
						name: 'Caesarium Cadmide',
						amount: 2000,
						buyPrice: 1400,
						splitPrice: 1500,
						sellPrice: 1600
					}
				]
			}
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe('https://janice.e-351.com/api/rest/v2/appraisal/AbC123');
		expect(calls[0]!.headers.get('X-ApiKey')).toBe('key-1');
		expect(calls[0]!.headers.get('User-Agent')).toBe(TEST_UA);
		expect(calls[0]!.headers.get('Accept')).toBe('application/json');
	});

	it('maps an absent price percentage to null', async () => {
		const { pricePercentage: _, ...withoutPercentage } = APPRAISAL;
		const { fetch } = fakeFetch(() => json(withoutPercentage));
		const result = await fetchJaniceAppraisal(fetch, { apiKey: 'key-1', userAgent: TEST_UA }, 'AbC123');
		expect(result.ok && result.appraisal.pricePercentage).toBeNull();
	});

	it('returns an unknown code as 404', async () => {
		const { fetch } = fakeFetch(() => json({ error: 'not found' }, { status: 404 }));
		expect(await fetchJaniceAppraisal(fetch, { apiKey: 'key-1', userAgent: TEST_UA }, 'nope')).toEqual({
			ok: false,
			status: 404
		});
	});

	it.each([
		['a missing price', { buyPrice: 1400, sellPrice: 1600 }],
		['a negative price', { buyPrice: -1, splitPrice: 1500, sellPrice: 1600 }],
		['a non-numeric price', { buyPrice: '1400', splitPrice: 1500, sellPrice: 1600 }]
	])('treats a body with %s as failed', async (_case, effectivePrices) => {
		const item = { ...APPRAISAL.items[0]!, effectivePrices };
		const { fetch } = fakeFetch(() => json({ ...APPRAISAL, items: [item] }));
		expect(await fetchJaniceAppraisal(fetch, { apiKey: 'key-1', userAgent: TEST_UA }, 'AbC123')).toEqual({
			ok: false,
			status: 0
		});
	});

	it('treats a body that is not an appraisal, or a fractional type id, as failed', async () => {
		const item = { ...APPRAISAL.items[0]!, itemType: { eid: 16663.5, name: 'x' } };
		for (const body of [{ error: 'x' }, null, [APPRAISAL], { ...APPRAISAL, items: [item] }]) {
			const { fetch } = fakeFetch(() => json(body));
			expect(await fetchJaniceAppraisal(fetch, { apiKey: 'key-1', userAgent: TEST_UA }, 'AbC123')).toEqual({
				ok: false,
				status: 0
			});
		}
	});

	it('gives the request a timeout and answers a failed request as status 0', async () => {
		const { fetch, calls } = fakeFetch(() => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const signals: (AbortSignal | null | undefined)[] = [];
		const watched: typeof fetch = (input, init) => {
			signals.push(init?.signal);
			return fetch(input, init);
		};
		expect(await fetchJaniceAppraisal(watched, { apiKey: 'key-1', userAgent: TEST_UA }, 'AbC123')).toEqual({
			ok: false,
			status: 0
		});
		expect(calls).toHaveLength(1);
		expect(signals[0]).toBeInstanceOf(AbortSignal);
	});

	it('makes no request without an API key', async () => {
		const { fetch, calls } = fakeFetch(() => json(APPRAISAL));
		for (const apiKey of ['', null, undefined])
			expect(await fetchJaniceAppraisal(fetch, { apiKey, userAgent: TEST_UA }, 'AbC123')).toEqual({
				ok: false,
				status: 0
			});
		expect(calls).toHaveLength(0);
	});
});
