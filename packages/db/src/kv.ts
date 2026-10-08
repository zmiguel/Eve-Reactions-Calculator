export const DATASET_KV_KEY = 'dataset:v1';
export const MARKET_KV_KEY = 'market:v1';

/** `[buy, sell, buyVolume, sellVolume]` */
export type MarketPriceTuple = [number | null, number | null, number, number];

export interface MarketSnapshot {
	snapshotAt: number;
	hubs: { hubId: string; name: string; kind: string; regionId: number }[];
	prices: Record<string, Record<number, MarketPriceTuple>>;
	adjusted: Record<number, number>;
	costIndicesUpdatedAt: number;
	adjustedUpdatedAt: number;
}
