import { chunkRows } from '@reactions/db';
import type { ReferencePriceFn, TrackingSettings } from '@reactions/engine';
import { referenceDays, referenceKey, referencePriceFn, type SidePrices } from './ledger-rows.ts';

const DAILY_SQL = `
	SELECT type_id, date, buy_avg, sell_avg FROM price_daily
	WHERE hub_id = ?1 AND type_id IN (SELECT value FROM json_each(?2)) AND date IN (SELECT value FROM json_each(?3))`;
const REGIONAL_SQL = `
	SELECT type_id, date, average FROM esi_market_history
	WHERE region_id = ?1 AND type_id IN (SELECT value FROM json_each(?2)) AND date IN (SELECT value FROM json_each(?3))`;
const LATEST_SQL = `
	SELECT type_id, buy_max, sell_min FROM latest_prices
	WHERE hub_id = ?1 AND type_id IN (SELECT value FROM json_each(?2))`;

/** Hub of a rule whose own hub the user can no longer use (the web's `FALLBACK_HUB`). */
const FALLBACK_HUB = 'jita';

/**
 * The hub the ledger prices at (`?1` = the rule's hub, `?2` = user): the rule's hub while the user can
 * use it (enabled, and public or a private structure hub the user has linked, as the web's
 * `getAccessibleHubs`), else `jita`.
 */
const HUB_SQL = `
	SELECT hub_id, name, region_id FROM market_hubs h
	WHERE h.hub_id = '${FALLBACK_HUB}' OR (h.hub_id = ?1 AND h.enabled = 1 AND (h.visibility = 'public'
		OR (h.visibility = 'private' AND EXISTS (
			SELECT 1 FROM structure_links l WHERE l.user_id = ?2 AND l.structure_id = h.location_id))))
	ORDER BY h.hub_id = ?1 DESC LIMIT 1`;

/** The two price lookups of a ledger rebuild, both at the contract rule's hub. */
export interface LedgerPriceFns {
	/** The rule's basis (contract pricing). */
	referencePrice: ReferencePriceFn;
	/** Buy side (job inputs without a purchase, reaction output taken by manufacturing). */
	buyPrice: ReferencePriceFn;
}

/**
 * Reference prices of the contract rule's hub for the ledger of `userId` (`jita` when the user can no
 * longer use that hub, see `HUB_SQL`): prefetches, for every type and UTC day in `requests` (and the
 * lookback days before each), the hub's `price_daily` averages, the hub region's `esi_market_history`
 * averages and the hub's `latest_prices`, then answers synchronously (`referencePriceFn`) with the
 * rule's basis and with the buy side. Type ids travel as one JSON parameter per query, 100 types per
 * query. Without either hub nothing is priced.
 */
export async function loadReferencePrices(
	env: Env,
	userId: string,
	rule: TrackingSettings['contractRule'],
	requests: ReadonlyMap<number, ReadonlySet<string>>
): Promise<LedgerPriceFns> {
	const hub = await env.DB.prepare(HUB_SQL)
		.bind(rule.hubId, userId)
		.first<{ hub_id: string; name: string; region_id: number }>();
	if (!hub) return { referencePrice: () => null, buyPrice: () => null };
	const days = new Set<string>();
	for (const requested of requests.values()) {
		for (const day of requested) for (const d of referenceDays(day)) days.add(d);
	}
	const daysJson = JSON.stringify([...days]);
	const daily = new Map<string, SidePrices>();
	const regional = new Map<string, number>();
	const latest = new Map<number, SidePrices>();
	for (const chunk of chunkRows([...requests.keys()], 1)) {
		const typesJson = JSON.stringify(chunk);
		const [[dailyRows, regionalRows], latestRows] = await Promise.all([
			env.HISTORY_DB.batch([
				env.HISTORY_DB.prepare(DAILY_SQL).bind(hub.hub_id, typesJson, daysJson),
				env.HISTORY_DB.prepare(REGIONAL_SQL).bind(hub.region_id, typesJson, daysJson)
			]),
			env.DB.prepare(LATEST_SQL).bind(hub.hub_id, typesJson).all()
		]);
		for (const r of dailyRows!.results as {
			type_id: number;
			date: string;
			buy_avg: number | null;
			sell_avg: number | null;
		}[])
			daily.set(referenceKey(r.type_id, r.date), { buy: r.buy_avg, sell: r.sell_avg });
		for (const r of regionalRows!.results as { type_id: number; date: string; average: number }[])
			regional.set(referenceKey(r.type_id, r.date), r.average);
		for (const r of latestRows.results as {
			type_id: number;
			buy_max: number | null;
			sell_min: number | null;
		}[])
			latest.set(r.type_id, { buy: r.buy_max, sell: r.sell_min });
	}
	const sources = { daily, regional, latest };
	return {
		referencePrice: referencePriceFn({ name: hub.name, basis: rule.basis }, sources),
		buyPrice: referencePriceFn({ name: hub.name, basis: 'buy' }, sources)
	};
}
