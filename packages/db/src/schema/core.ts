import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sdeState = sqliteTable('sde_state', {
	id: integer('id').primaryKey(),
	buildNumber: integer('build_number').notNull(),
	releaseDate: text('release_date').notNull(),
	importedAt: integer('imported_at').notNull(),
	constantsJson: text('constants_json').notNull(),
	warningsJson: text('warnings_json').notNull()
});

export const types = sqliteTable('types', {
	typeId: integer('type_id').primaryKey(),
	name: text('name').notNull(),
	groupId: integer('group_id').notNull(),
	categoryId: integer('category_id').notNull(),
	volume: real('volume').notNull(),
	portionSize: integer('portion_size').notNull(),
	published: integer('published', { mode: 'boolean' }).notNull(),
	basePrice: real('base_price')
});

export const reactions = sqliteTable('reactions', {
	blueprintTypeId: integer('blueprint_type_id').primaryKey(),
	slug: text('slug').notNull().unique(),
	formulaName: text('formula_name').notNull(),
	name: text('name').notNull(),
	productTypeId: integer('product_type_id').notNull().unique(),
	productQuantity: integer('product_quantity').notNull(),
	reactor: text('reactor').notNull(),
	tier: text('tier').notNull(),
	baseTimeSeconds: integer('base_time_seconds').notNull(),
	maxRuns: integer('max_runs').notNull(),
	requiredSkillLevel: integer('required_skill_level').notNull()
});

export const reactionMaterials = sqliteTable(
	'reaction_materials',
	{
		blueprintTypeId: integer('blueprint_type_id').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull()
	},
	(t) => [primaryKey({ columns: [t.blueprintTypeId, t.typeId] })]
);

export const reprocessMaterials = sqliteTable(
	'reprocess_materials',
	{
		typeId: integer('type_id').notNull(),
		materialTypeId: integer('material_type_id').notNull(),
		quantity: integer('quantity'),
		quantityMin: integer('quantity_min'),
		quantityMax: integer('quantity_max'),
		portionSize: integer('portion_size').notNull()
	},
	(t) => [primaryKey({ columns: [t.typeId, t.materialTypeId] })]
);

export const regions = sqliteTable('regions', {
	regionId: integer('region_id').primaryKey(),
	name: text('name').notNull()
});

export const systems = sqliteTable(
	'systems',
	{
		systemId: integer('system_id').primaryKey(),
		name: text('name').notNull(),
		regionId: integer('region_id').notNull(),
		securityStatus: real('security_status').notNull(),
		securityBand: text('security_band').notNull()
	},
	(t) => [index('systems_name_lower_idx').on(sql`lower(${t.name})`)]
);

export const marketHubs = sqliteTable('market_hubs', {
	hubId: text('hub_id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind').notNull(),
	regionId: integer('region_id').notNull(),
	systemId: integer('system_id').notNull(),
	locationId: integer('location_id').notNull(),
	fuzzworkLocationId: integer('fuzzwork_location_id'),
	visibility: text('visibility').notNull(),
	shareStatus: text('share_status').notNull().default('none'),
	shareReviewedBy: integer('share_reviewed_by'),
	shareReviewedAt: integer('share_reviewed_at'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	sortOrder: integer('sort_order').notNull(),
	lastSuccessAt: integer('last_success_at'),
	lastError: text('last_error'),
	createdAt: integer('created_at').notNull()
});

export const latestPrices = sqliteTable(
	'latest_prices',
	{
		hubId: text('hub_id').notNull(),
		typeId: integer('type_id').notNull(),
		buyMax: real('buy_max'),
		sellMin: real('sell_min'),
		buyP5: real('buy_p5'),
		sellP5: real('sell_p5'),
		buyVolume: integer('buy_volume').notNull(),
		sellVolume: integer('sell_volume').notNull(),
		buyOrders: integer('buy_orders').notNull(),
		sellOrders: integer('sell_orders').notNull(),
		source: text('source').notNull(),
		observedAt: integer('observed_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.hubId, t.typeId] })]
);

export const adjustedPrices = sqliteTable('adjusted_prices', {
	typeId: integer('type_id').primaryKey(),
	adjustedPrice: real('adjusted_price').notNull(),
	averagePrice: real('average_price'),
	updatedAt: integer('updated_at').notNull()
});

export const costIndices = sqliteTable('cost_indices', {
	systemId: integer('system_id').primaryKey(),
	reaction: real('reaction').notNull(),
	manufacturing: real('manufacturing').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const marketStats = sqliteTable(
	'market_stats',
	{
		regionId: integer('region_id').notNull(),
		typeId: integer('type_id').notNull(),
		avgDailyVolume30d: real('avg_daily_volume_30d').notNull(),
		/** Average units traded per day over the last 7 days; `null` until the next daily run computes it. */
		avgDailyVolume7d: real('avg_daily_volume_7d'),
		avgPrice5d: real('avg_price_5d').notNull(),
		avgPrice30d: real('avg_price_30d').notNull(),
		lastDate: text('last_date').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.regionId, t.typeId] })]
);

export const users = sqliteTable('users', {
	userId: text('user_id').primaryKey(),
	createdAt: integer('created_at').notNull(),
	lastSeenAt: integer('last_seen_at').notNull(),
	settingsJson: text('settings_json'),
	settingsUpdatedAt: integer('settings_updated_at')
});

export const userSessions = sqliteTable(
	'user_sessions',
	{
		sessionHash: text('session_hash').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull(),
		/** Character the session logged in with (shown in the navbar); null once that character is removed. */
		characterId: integer('character_id').references(() => characters.characterId, { onDelete: 'set null' })
	},
	(t) => [index('user_sessions_user_id_idx').on(t.userId)]
);

export const characters = sqliteTable('characters', {
	characterId: integer('character_id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.userId, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	ownerHash: text('owner_hash').notNull(),
	scopes: text('scopes').notNull().default(''),
	refreshTokenEnc: text('refresh_token_enc'),
	/** Client id of the EVE SSO app that issued `refresh_token_enc`; NULL = the deployment's primary app. */
	ssoClientId: text('sso_client_id'),
	tokenStatus: text('token_status').notNull().default('none'),
	lastRefreshedAt: integer('last_refreshed_at'),
	lastError: text('last_error'),
	createdAt: integer('created_at').notNull(),
	/** Corporation and alliance from ESI `/characters/affiliation` + `/universe/names` (updater, daily). */
	corporationId: integer('corporation_id'),
	corporationName: text('corporation_name'),
	allianceId: integer('alliance_id'),
	allianceName: text('alliance_name'),
	affiliationUpdatedAt: integer('affiliation_updated_at')
});

export const structureLinks = sqliteTable(
	'structure_links',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		structureId: integer('structure_id').notNull(),
		characterId: integer('character_id')
			.notNull()
			.references(() => characters.characterId, { onDelete: 'cascade' }),
		shareRequested: integer('share_requested', { mode: 'boolean' }).notNull().default(false),
		accessStatus: text('access_status').notNull().default('ok'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.structureId] }),
		index('structure_links_structure_id_idx').on(t.structureId)
	]
);

export const jobRuns = sqliteTable(
	'job_runs',
	{
		runId: text('run_id').primaryKey(),
		kind: text('kind').notNull(),
		startedAt: integer('started_at').notNull(),
		finishedAt: integer('finished_at'),
		status: text('status').notNull(),
		detailJson: text('detail_json'),
		/** While a workflow runs: `{ step, done, total }` of the step in progress (kept after it ends). */
		progressJson: text('progress_json'),
		/** When the step in `progress_json` started (unix ms): the run's last sign of life. */
		progressAt: integer('progress_at')
	},
	(t) => [index('job_runs_kind_started_idx').on(t.kind, t.startedAt)]
);

export const httpCache = sqliteTable('http_cache', {
	url: text('url').primaryKey(),
	etag: text('etag'),
	lastModified: text('last_modified'),
	expiresAt: integer('expires_at'),
	updatedAt: integer('updated_at').notNull()
});

export type SdeStateRow = typeof sdeState.$inferSelect;
export type TypeRow = typeof types.$inferSelect;
export type NewTypeRow = typeof types.$inferInsert;
export type ReactionRow = typeof reactions.$inferSelect;
export type NewReactionRow = typeof reactions.$inferInsert;
export type ReactionMaterialRow = typeof reactionMaterials.$inferSelect;
export type ReprocessMaterialRow = typeof reprocessMaterials.$inferSelect;
export type RegionRow = typeof regions.$inferSelect;
export type SystemRow = typeof systems.$inferSelect;
export type MarketHubRow = typeof marketHubs.$inferSelect;
export type NewMarketHubRow = typeof marketHubs.$inferInsert;
export type LatestPriceRow = typeof latestPrices.$inferSelect;
export type NewLatestPriceRow = typeof latestPrices.$inferInsert;
export type AdjustedPriceRow = typeof adjustedPrices.$inferSelect;
export type CostIndexRow = typeof costIndices.$inferSelect;
export type MarketStatsRow = typeof marketStats.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type StructureLinkRow = typeof structureLinks.$inferSelect;
export type JobRunRow = typeof jobRuns.$inferSelect;
export type HttpCacheRow = typeof httpCache.$inferSelect;
