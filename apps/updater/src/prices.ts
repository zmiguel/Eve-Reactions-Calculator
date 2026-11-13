import { fetchFuzzworkAggregates } from '@reactions/eve';
import type { HubAggregate } from '@reactions/eve';
import { DAY_MS } from './dates.ts';
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

/**
 * `ON CONFLICT (<keys>) DO UPDATE SET` every column that is not a key, only when one of them other than
 * `untracked` changed: D1 bills an unchanged row rewritten by a plain upsert as written. `untracked`
 * columns (refresh times) are still set whenever the row is rewritten.
 */
export function upsertClause(
	table: string,
	columns: readonly string[],
	keys: readonly string[],
	untracked: readonly string[] = []
): string {
	const updated = columns.filter((c) => !keys.includes(c));
	const set = updated.map((c) => `${c} = excluded.${c}`);
	const changed = updated
		.filter((c) => !untracked.includes(c))
		.map((c) => `${table}.${c} IS NOT excluded.${c}`);
	const where = changed.length > 0 ? ` WHERE ${changed.join(' OR ')}` : '';
	return `ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${set.join(', ')}${where}`;
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
/** Value columns of `price_snapshots` (besides the key `hub_id, type_id, snapshot_at`). */
const SNAPSHOT_VALUES = ['buy_max', 'sell_min', 'buy_p5', 'sell_p5', 'buy_volume', 'sell_volume', 'source'];
const SNAPSHOT_COLUMNS = ['hub_id', 'type_id', ...SNAPSHOT_VALUES];
const LATEST_SQL = jsonInsertSql(
	'latest_prices',
	LATEST_COLUMNS,
	upsertClause('latest_prices', LATEST_COLUMNS, ['hub_id', 'type_id'], ['observed_at'])
);

/**
 * Change-only snapshot insert of the rows in `?1` (arrays in `SNAPSHOT_COLUMNS` order) at `?2`
 * (`snapshot_at`); `?3` is the start of `?2`'s UTC day. A pair is skipped when its latest stored row
 * at or before `?2` is older than `?2`, from the same UTC day and equal in every value column: the
 * first refresh of a day stores every pair, later ones only changed pairs. A row already stored at `?2`
 * (a retried step) is upserted only when its values changed, so a retry writes nothing or the new
 * values. Both lookups use the primary key (`MAX(snapshot_at)` is one index probe).
 */
const SNAPSHOT_SQL = `WITH j AS (
		SELECT ${SNAPSHOT_COLUMNS.map((c, i) => `json_extract(value, '$[${i}]') AS ${c}`).join(', ')}
		FROM json_each(?1)
	)
	INSERT INTO price_snapshots (snapshot_at, ${SNAPSHOT_COLUMNS.join(', ')})
	SELECT ?2, ${SNAPSHOT_COLUMNS.map((c) => `j.${c}`).join(', ')} FROM j
	WHERE NOT EXISTS (
		SELECT 1 FROM price_snapshots p
		WHERE p.hub_id = j.hub_id AND p.type_id = j.type_id
			AND p.snapshot_at = (
				SELECT MAX(q.snapshot_at) FROM price_snapshots q
				WHERE q.hub_id = j.hub_id AND q.type_id = j.type_id AND q.snapshot_at <= ?2
			)
			AND p.snapshot_at < ?2 AND p.snapshot_at >= ?3
			AND ${SNAPSHOT_VALUES.map((c) => `p.${c} IS j.${c}`).join(' AND ')}
	)
	${upsertClause('price_snapshots', ['snapshot_at', ...SNAPSHOT_COLUMNS], ['hub_id', 'type_id', 'snapshot_at'])}`;

/**
 * Upserts `latest_prices` and inserts the change-only `price_snapshots` rows (`SNAPSHOT_SQL`); a
 * retried step with the same rows writes nothing.
 */
export async function writePrices(env: Env, rows: readonly PriceRow[], snapshotAt: number): Promise<void> {
	if (rows.length === 0) return;
	const snapshots = rows.map(({ hubId, typeId, source, aggregate: a }) => [
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
	const dayStartAt = Math.floor(snapshotAt / DAY_MS) * DAY_MS;
	await env.HISTORY_DB.prepare(SNAPSHOT_SQL).bind(JSON.stringify(snapshots), snapshotAt, dayStartAt).run();
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
