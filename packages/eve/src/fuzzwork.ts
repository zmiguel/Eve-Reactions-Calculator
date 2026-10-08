import type { FetchFn } from './esi.ts';
import type { HubAggregate } from './market.ts';

export const FUZZWORK_AGGREGATES_URL = 'https://market.fuzzwork.co.uk/aggregates/';
export const FUZZWORK_MAX_TYPES = 200;

interface FuzzworkSide {
	max: string;
	min: string;
	percentile: string;
	volume: string;
	orderCount: string;
}

export class FuzzworkError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'FuzzworkError';
		this.status = status;
	}
}

function num(value: string | undefined): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Fuzzwork aggregates for a station/system/region/structure id, requested in batches of ≤ 200 type ids.
 * A side with zero volume has `null` prices; `buyP5`/`sellP5` come from Fuzzwork's `percentile`.
 */
export async function fetchFuzzworkAggregates(
	fetchFn: FetchFn,
	userAgent: string,
	locationId: number,
	typeIds: number[]
): Promise<Record<number, HubAggregate>> {
	const result: Record<number, HubAggregate> = {};
	for (let i = 0; i < typeIds.length; i += FUZZWORK_MAX_TYPES) {
		const chunk = typeIds.slice(i, i + FUZZWORK_MAX_TYPES);
		const url = `${FUZZWORK_AGGREGATES_URL}?region=${locationId}&types=${chunk.join(',')}`;
		const res = await fetchFn(url, { method: 'GET', headers: { 'User-Agent': userAgent } });
		if (res.status !== 200)
			throw new FuzzworkError(res.status, `Fuzzwork ${res.status} for location ${locationId}`);
		const body = (await res.json()) as Record<string, { buy: FuzzworkSide; sell: FuzzworkSide }>;
		for (const [key, entry] of Object.entries(body)) {
			const buyVolume = Math.round(num(entry.buy?.volume));
			const sellVolume = Math.round(num(entry.sell?.volume));
			result[Number(key)] = {
				buyMax: buyVolume > 0 ? num(entry.buy.max) : null,
				sellMin: sellVolume > 0 ? num(entry.sell.min) : null,
				buyP5: buyVolume > 0 ? num(entry.buy.percentile) : null,
				sellP5: sellVolume > 0 ? num(entry.sell.percentile) : null,
				buyVolume,
				sellVolume,
				buyOrders: Math.round(num(entry.buy?.orderCount)),
				sellOrders: Math.round(num(entry.sell?.orderCount))
			};
		}
	}
	return result;
}
