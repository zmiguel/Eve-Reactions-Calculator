import { fetchFuzzworkAggregates } from '@reactions/eve';
import type { HubAggregate } from '@reactions/eve';
import { httpFetch } from './http.ts';
import { errorMessage } from './jobs.ts';

/**
 * `INSERT INTO <table> (<columns>) SELECT … FROM json_each(?1)`: every row travels as one JSON array
 * bound to a single parameter (D1 limits the number of bound parameters per statement, not their size),
 * so a whole hub × type set is one statement. Row `i` is an array in `columns` order.
 */
export function jsonInsertSql(table: string, columns: readonly string[], conflict = ''): string {
	const values = columns.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ');
	return `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${values} FROM json_each(?1) WHERE true ${conflict}`;
}

/** `ON CONFLICT (<keys>) DO UPDATE SET` every column that is not a key. */
export function upsertClause(columns: readonly string[], keys: readonly string[]): string {
	const set = columns.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
	return `ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${set.join(', ')}`;
}

export type PriceSource = 'esi' | 'esi_structure' | 'fuzzwork';

export interface PriceRow {
	hubId: string;
	typeId: number;
	source: PriceSource;
	aggregate: HubAggregate;
}

/** Hub × type row counts of one workflow step (step results stay this small). */
export interface PriceCounts {
	esi: number;
	fuzzwork: number;
	/** Hub × type pairs left without a new price (previous `latest_prices` row kept). */
	missing: number;
}

const LATEST_COLUMNS = [
	'hub_id',
	'type_id',
	'buy_max',
	'sell_min',
	'buy_p5',
	'sell_p5',
	'buy_volume',
	'sell_volume',
	'buy_orders',
	'sell_orders',
	'source',
	'observed_at'
];
const SNAPSHOT_COLUMNS = [
	'snapshot_at',
	'hub_id',
	'type_id',
	'buy_max',
	'sell_min',
	'buy_p5',
	'sell_p5',
	'buy_volume',
	'sell_volume',
	'source'
];
const LATEST_SQL = jsonInsertSql(
	'latest_prices',
	LATEST_COLUMNS,
	upsertClause(LATEST_COLUMNS, ['hub_id', 'type_id'])
);
const SNAPSHOT_SQL = jsonInsertSql(
	'price_snapshots',
	SNAPSHOT_COLUMNS,
	upsertClause(SNAPSHOT_COLUMNS, ['hub_id', 'type_id', 'snapshot_at'])
);

/** Upserts `latest_prices` and `price_snapshots` (idempotent, so a retried step rewrites the same rows). */
export async function writePrices(env: Env, rows: readonly PriceRow[], snapshotAt: number): Promise<void> {
	if (rows.length === 0) return;
	const snapshots = rows.map(({ hubId, typeId, source, aggregate: a }) => [
		snapshotAt,
		hubId,
		typeId,
		a.buyMax,
		a.sellMin,
		a.buyP5,
		a.sellP5,
		a.buyVolume,
		a.sellVolume,
		source
	]);
	const latest = rows.map(({ hubId, typeId, source, aggregate: a }) => [
		hubId,
		typeId,
		a.buyMax,
		a.sellMin,
		a.buyP5,
		a.sellP5,
		a.buyVolume,
		a.sellVolume,
		a.buyOrders,
		a.sellOrders,
		source,
		snapshotAt
	]);
	await env.HISTORY_DB.prepare(SNAPSHOT_SQL).bind(JSON.stringify(snapshots)).run();
	await env.DB.prepare(LATEST_SQL).bind(JSON.stringify(latest)).run();
}

/**
 * Fuzzwork aggregates for `typeIds` at a hub's `fuzzwork_location_id` as `source='fuzzwork'` rows.
 * No location or a Fuzzwork failure yields no rows (callers count those pairs as missing).
 */
export async function fuzzworkRows(
	hub: { hubId: string; fuzzworkLocationId: number | null },
	typeIds: readonly number[],
	userAgent: string
): Promise<PriceRow[]> {
	if (typeIds.length === 0 || hub.fuzzworkLocationId === null) return [];
	let aggregates: Record<number, HubAggregate>;
	try {
		aggregates = await fetchFuzzworkAggregates(httpFetch, userAgent, hub.fuzzworkLocationId, [...typeIds]);
	} catch (error) {
		console.error(`[prices] fuzzwork ${hub.hubId}: ${errorMessage(error)}`);
		return [];
	}
	return typeIds
		.filter((typeId) => aggregates[typeId] !== undefined)
		.map((typeId) => ({ hubId: hub.hubId, typeId, source: 'fuzzwork', aggregate: aggregates[typeId]! }));
}
