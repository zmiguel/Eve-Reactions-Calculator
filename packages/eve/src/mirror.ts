import { EsiError } from './esi.ts';
import type { FetchFn } from './esi.ts';
import type { MarketHistoryDay } from './market.ts';

/** Public market history API mirroring ESI `/markets/{region}/history` (data from 2025-02-01). */
export const MIRROR_BASE_URL = 'https://market.coalition.space';
export const MIRROR_HISTORY_START = '2025-02-01';

export interface RegionHistory {
	regionId: number;
	days: MarketHistoryDay[];
}

interface MirrorOptions {
	/** Waits between retries (tests pass a no-op). */
	sleep?: (ms: number) => Promise<void>;
	/** Attempts on 429 / 5xx before giving up. */
	attempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Daily history of `typeId` in every region it traded in, for `after <= date < before`
 * (`GET /api/v1/history-aggregate/{type_id}`, ESI day format). Retries 429 (after the
 * `x-rate-limit-reset` seconds) and 5xx responses.
 */
export async function fetchMirrorTypeHistory(
	fetchFn: FetchFn,
	userAgent: string,
	typeId: number,
	after: string,
	before: string,
	options: MirrorOptions = {}
): Promise<RegionHistory[]> {
	const sleep = options.sleep ?? defaultSleep;
	const attempts = options.attempts ?? 3;
	const url = `${MIRROR_BASE_URL}/api/v1/history-aggregate/${typeId}?${new URLSearchParams({ after, before })}`;
	for (let attempt = 1; ; attempt++) {
		const res = await fetchFn(url, { method: 'GET', headers: { 'User-Agent': userAgent } });
		if (res.status === 200) {
			const body = (await res.json()) as {
				region_id: number;
				history: {
					date: string;
					average: number;
					highest: number;
					lowest: number;
					volume: number;
					order_count: number;
				}[];
			}[];
			return body.map((r) => ({
				regionId: r.region_id,
				days: r.history.map((d) => ({
					date: d.date,
					average: d.average,
					highest: d.highest,
					lowest: d.lowest,
					volume: d.volume,
					orderCount: d.order_count
				}))
			}));
		}
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt >= attempts)
			throw new EsiError(res.status, url, `market history mirror returned ${res.status}`);
		const reset = Number(res.headers.get('x-rate-limit-reset'));
		await sleep(Number.isFinite(reset) && reset > 0 ? reset * 1000 : 1000 * attempt);
	}
}
