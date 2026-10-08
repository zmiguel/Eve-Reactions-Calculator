import { getTableColumns, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as coreSchema from './schema/core.ts';
import * as historySchema from './schema/history.ts';

export type CoreDb = DrizzleD1Database<typeof coreSchema>;
export type HistoryDb = DrizzleD1Database<typeof historySchema>;
type AnyD1Db = DrizzleD1Database<Record<string, unknown>>;

export function getCoreDb(d1: D1Database): CoreDb {
	return drizzle(d1, { schema: coreSchema });
}

export function getHistoryDb(d1: D1Database): HistoryDb {
	return drizzle(d1, { schema: historySchema });
}

/** D1 allows at most 100 bound parameters per statement. */
export function chunkRows<T>(rows: readonly T[], columnsPerRow: number): T[][] {
	const size = Math.max(1, Math.floor(100 / columnsPerRow));
	const chunks: T[][] = [];
	for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
	return chunks;
}

/** Batched, chunked INSERT … ON CONFLICT DO UPDATE SET col = excluded.col. */
export async function upsertMany<TTable extends SQLiteTable>(
	db: AnyD1Db | CoreDb | HistoryDb,
	table: TTable,
	rows: TTable['$inferInsert'][],
	conflictTarget: SQLiteColumn[],
	setColumns: SQLiteColumn[]
): Promise<void> {
	if (rows.length === 0) return;
	const columnCount = Object.keys(getTableColumns(table)).length;
	const set: Record<string, SQL> = {};
	const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
	for (const col of setColumns) {
		const key = Object.keys(columns).find((k) => columns[k] === col);
		if (!key) throw new Error(`Column ${col.name} is not part of the table`);
		set[key] = sql.raw(`excluded."${col.name}"`);
	}
	const statements = chunkRows(rows, columnCount).map((chunk) =>
		db
			.insert(table)
			.values(chunk)
			.onConflictDoUpdate({ target: conflictTarget, set: set as never })
	);
	const [first, ...rest] = statements;
	await db.batch([first!, ...rest]);
}

const TRACKED_TYPE_IDS_SQL = sql`
	SELECT blueprint_type_id AS type_id FROM reactions
	UNION SELECT type_id FROM reaction_materials
	UNION SELECT product_type_id FROM reactions
	UNION SELECT material_type_id FROM reprocess_materials
	ORDER BY type_id`;

/** Union of reaction blueprint ids, material ids, product ids and reprocess output ids. */
export const trackedTypeIdsQuery = TRACKED_TYPE_IDS_SQL;

export async function trackedTypeIds(db: AnyD1Db | CoreDb): Promise<number[]> {
	const rows = await db.all<{ type_id: number }>(TRACKED_TYPE_IDS_SQL);
	return rows.map((r) => r.type_id);
}
