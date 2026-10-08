import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const priceSnapshots = sqliteTable(
	'price_snapshots',
	{
		snapshotAt: integer('snapshot_at').notNull(),
		hubId: text('hub_id').notNull(),
		typeId: integer('type_id').notNull(),
		buyMax: real('buy_max'),
		sellMin: real('sell_min'),
		buyP5: real('buy_p5'),
		sellP5: real('sell_p5'),
		buyVolume: integer('buy_volume').notNull(),
		sellVolume: integer('sell_volume').notNull(),
		source: text('source').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.hubId, t.typeId, t.snapshotAt] }),
		index('price_snapshots_snapshot_at_idx').on(t.snapshotAt)
	]
);

export const priceDaily = sqliteTable(
	'price_daily',
	{
		date: text('date').notNull(),
		hubId: text('hub_id').notNull(),
		typeId: integer('type_id').notNull(),
		buyAvg: real('buy_avg'),
		sellAvg: real('sell_avg'),
		buyClose: real('buy_close'),
		sellClose: real('sell_close'),
		buyLow: real('buy_low'),
		buyHigh: real('buy_high'),
		sellLow: real('sell_low'),
		sellHigh: real('sell_high'),
		samples: integer('samples').notNull()
	},
	(t) => [primaryKey({ columns: [t.hubId, t.typeId, t.date] }), index('price_daily_date_idx').on(t.date)]
);

export const esiMarketHistory = sqliteTable(
	'esi_market_history',
	{
		regionId: integer('region_id').notNull(),
		typeId: integer('type_id').notNull(),
		date: text('date').notNull(),
		average: real('average').notNull(),
		highest: real('highest').notNull(),
		lowest: real('lowest').notNull(),
		volume: integer('volume').notNull(),
		orderCount: integer('order_count').notNull()
	},
	(t) => [primaryKey({ columns: [t.regionId, t.typeId, t.date] })]
);

export const adjustedPriceDaily = sqliteTable(
	'adjusted_price_daily',
	{
		date: text('date').notNull(),
		typeId: integer('type_id').notNull(),
		adjustedPrice: real('adjusted_price').notNull()
	},
	(t) => [primaryKey({ columns: [t.typeId, t.date] })]
);

export const costIndexDaily = sqliteTable(
	'cost_index_daily',
	{
		date: text('date').notNull(),
		systemId: integer('system_id').notNull(),
		reaction: real('reaction').notNull()
	},
	(t) => [primaryKey({ columns: [t.systemId, t.date] })]
);

export const archiveManifest = sqliteTable('archive_manifest', {
	date: text('date').primaryKey(),
	objectCount: integer('object_count').notNull(),
	bytes: integer('bytes').notNull(),
	verifiedAt: integer('verified_at').notNull()
});

export type PriceSnapshotRow = typeof priceSnapshots.$inferSelect;
export type NewPriceSnapshotRow = typeof priceSnapshots.$inferInsert;
export type PriceDailyRow = typeof priceDaily.$inferSelect;
export type EsiMarketHistoryRow = typeof esiMarketHistory.$inferSelect;
export type AdjustedPriceDailyRow = typeof adjustedPriceDaily.$inferSelect;
export type CostIndexDailyRow = typeof costIndexDaily.$inferSelect;
export type ArchiveManifestRow = typeof archiveManifest.$inferSelect;
