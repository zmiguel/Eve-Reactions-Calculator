import { DATASET_KV_KEY, MARKET_KV_KEY, type MarketSnapshot } from '@reactions/db';
import type { Dataset } from '@reactions/engine';

export const MEMO_TTL_MS = 60_000;

const memo = new Map<string, { value: unknown; at: number }>();

/** KV JSON read with edge `cacheTtl: 60` plus a 60 s per-isolate memo. */
async function cachedJson<T>(kv: KVNamespace, key: string, now: number): Promise<T | null> {
	const hit = memo.get(key);
	if (hit && now - hit.at < MEMO_TTL_MS) return hit.value as T;
	const value = await kv.get<T>(key, { type: 'json', cacheTtl: 60 });
	if (value !== null) memo.set(key, { value, at: now });
	return value;
}

export function getDataset(env: Pick<Env, 'CACHE'>, now = Date.now()): Promise<Dataset | null> {
	return cachedJson<Dataset>(env.CACHE, DATASET_KV_KEY, now);
}

export function getMarket(env: Pick<Env, 'CACHE'>, now = Date.now()): Promise<MarketSnapshot | null> {
	return cachedJson<MarketSnapshot>(env.CACHE, MARKET_KV_KEY, now);
}

/** Test seam: forget memoised KV values. */
export function clearDataMemo() {
	memo.clear();
}
