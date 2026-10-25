import { sql } from 'drizzle-orm';
import {
	foreignKey,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

/** `inventory_sources.tracking_status`. */
export const TRACKING_SYNC_STATUSES = ['pending', 'running', 'ok', 'error', 'denied'] as const;
/** `tracking_streams.status`. */
export const TRACKING_STREAM_STATUSES = ['pending', 'ok', 'error', 'denied'] as const;
/** `price_corrections.target_kind`. */
export const PRICE_CORRECTION_TARGETS = ['transaction', 'contract_item', 'job_input'] as const;
/** `ledger_lots.origin`. `manual`: a purchase the user entered on the Ledger tab. */
export const LEDGER_LOT_ORIGINS = [
	'transaction',
	'contract',
	'job',
	'market',
	'correction',
	'manual'
] as const;
/**
 * `ledger_uses.use_kind`. `manufacturing`: reaction output taken by one of the user's manufacturing
 * jobs (valued); `consumed`: another tracked material taken by one (a quantity only, no value).
 */
export const LEDGER_USE_KINDS = ['job', 'sale', 'transfer_out', 'manufacturing', 'consumed'] as const;

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

/**
 * Every material of the manufacturing blueprints that make a reaction material (`Dataset.manufacturing`
 * entries with `makes: 'material'`: the fuel blocks), replaced with the reactions at each SDE import.
 */
export const materialBlueprintMaterials = sqliteTable(
	'material_blueprint_materials',
	{
		blueprintTypeId: integer('blueprint_type_id').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull()
	},
	(t) => [primaryKey({ columns: [t.blueprintTypeId, t.typeId] })]
);

/**
 * The published manufacturing blueprints, other than the fuel block blueprints, that take a tracked
 * material other than a reaction product (`SdeManufacturingBlueprint`: ships, modules, ammunition, …),
 * with their product and its industry target filters (`product_filters_json`, a JSON array of filter
 * ids: which rig bonuses apply). Replaced with the reactions at each SDE import; kept out of KV
 * `dataset:v1` (thousands of rows). Read by the ledger rebuild, the tracking sync and the tracking pages.
 */
export const manufacturingBlueprints = sqliteTable('manufacturing_blueprints', {
	blueprintTypeId: integer('blueprint_type_id').primaryKey(),
	name: text('name').notNull(),
	productTypeId: integer('product_type_id').notNull(),
	productName: text('product_name').notNull(),
	productFiltersJson: text('product_filters_json').notNull()
});

/** Those tracked materials of each `manufacturing_blueprints` row, per run at base (ME 0, no bonus). */
export const manufacturingBlueprintMaterials = sqliteTable(
	'manufacturing_blueprint_materials',
	{
		blueprintTypeId: integer('blueprint_type_id').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull()
	},
	(t) => [primaryKey({ columns: [t.blueprintTypeId, t.typeId] })]
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
	settingsUpdatedAt: integer('settings_updated_at'),
	/** Profit tracking settings (engine `TrackingSettings`): contract price rule and per-facility ME. */
	trackingJson: text('tracking_json')
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

export const inventorySources = sqliteTable(
	'inventory_sources',
	{
		sourceId: integer('source_id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		/**
		 * The preferred reading character: the one whose token last read the assets. Corporation sources
		 * also list it in `inventory_source_readers`, the readers the user added (updater `prepare`).
		 */
		characterId: integer('character_id')
			.notNull()
			.references(() => characters.characterId, { onDelete: 'cascade' }),
		/** 'character' | 'corporation' */
		kind: text('kind').notNull(),
		/** Character or corporation id. */
		ownerId: integer('owner_id').notNull(),
		ownerName: text('owner_name').notNull(),
		/** `{"1":"Moon goo",...}`: corporation hangar divisions with a non-default name. */
		divisionNamesJson: text('division_names_json'),
		/** 'pending' | 'running' | 'ok' | 'error' | 'denied' */
		status: text('status').notNull().default('pending'),
		runId: text('run_id'),
		syncStartedAt: integer('sync_started_at'),
		lastAttemptAt: integer('last_attempt_at'),
		lastSyncedAt: integer('last_synced_at'),
		/** ESI `Last-Modified` of the assets (unix ms). */
		dataAsOf: integer('data_as_of'),
		/** ESI `Expires` of asset page 1 (unix ms): no sync starts before it (ESI caching rules). */
		dataExpiresAt: integer('data_expires_at'),
		lastError: text('last_error'),
		itemCount: integer('item_count').notNull().default(0),
		createdAt: integer('created_at').notNull(),
		/** The connection's Inventory switch: asset sync, the planner and "What you have" read only these. */
		inventoryEnabled: integer('inventory_enabled', { mode: 'boolean' }).notNull().default(true),
		/** The connection's Profit tracking switch. */
		trackingEnabled: integer('tracking_enabled', { mode: 'boolean' }).notNull().default(false),
		/** Last tracking sync (`TrackingSyncWorkflow`); null until tracking first runs. */
		trackingStatus: text('tracking_status', { enum: TRACKING_SYNC_STATUSES }),
		trackingRunId: text('tracking_run_id'),
		trackingStartedAt: integer('tracking_started_at'),
		trackingLastAttemptAt: integer('tracking_last_attempt_at'),
		trackingSyncedAt: integer('tracking_synced_at'),
		trackingLastError: text('tracking_last_error'),
		/** Corporation wallet divisions counted, `[1,3]`; null = every division the reader can read. */
		walletDivisionsJson: text('wallet_divisions_json'),
		/** `{"2":"Industry",...}`: corporation wallet divisions with a non-default name. */
		walletNamesJson: text('wallet_names_json')
	},
	(t) => [uniqueIndex('inventory_sources_user_kind_owner_idx').on(t.userId, t.kind, t.ownerId)]
);

/** Corporation sources: the characters the user added as readers ("<Corporation> via <Character>"). */
export const inventorySourceReaders = sqliteTable(
	'inventory_source_readers',
	{
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		characterId: integer('character_id')
			.notNull()
			.references(() => characters.characterId, { onDelete: 'cascade' }),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.characterId] })]
);

export const inventoryLocations = sqliteTable(
	'inventory_locations',
	{
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		locationId: integer('location_id').notNull(),
		/** 'station' | 'structure' | 'unknown' */
		kind: text('kind').notNull(),
		name: text('name'),
		systemId: integer('system_id')
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.locationId] })]
);

export const inventoryItems = sqliteTable(
	'inventory_items',
	{
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		locationId: integer('location_id').notNull(),
		/** 'hangar' | 'deliveries' | 'div1'..'div7' */
		bucket: text('bucket').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull()
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.locationId, t.bucket, t.typeId] })]
);

export const inventorySelection = sqliteTable(
	'inventory_selection',
	{
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		locationId: integer('location_id').notNull(),
		bucket: text('bucket').notNull()
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.locationId, t.bucket] })]
);

/**
 * One ESI feed of a tracking connection: `jobs`, `contracts`, `orders`, `transactions`/`journal`
 * (character) or `transactions:<n>`/`journal:<n>` (corporation wallet division n), `blueprints`; plus
 * the rows `divisions` and `affiliations` that only keep the `Expires` of those lookups of the sync.
 */
export const trackingStreams = sqliteTable(
	'tracking_streams',
	{
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		stream: text('stream').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		/** `denied` = the reader lacks the corporation role (403); other streams continue. */
		status: text('status', { enum: TRACKING_STREAM_STATUSES }).notNull().default('pending'),
		/** Newest id (transactions, journal) or date (unix ms) already stored; the walk stops there. */
		cursor: integer('cursor'),
		etag: text('etag'),
		/** ESI `Expires` (unix ms): the stream is not requested again before it. */
		expiresAt: integer('expires_at'),
		lastSyncedAt: integer('last_synced_at'),
		lastError: text('last_error')
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.stream] })]
);

/**
 * Industry jobs from ESI (completed for 90 days): reaction jobs, and manufacturing jobs (`activity_id` 1)
 * whose blueprint uses a reaction product (they only consume reaction output in the ledger) or makes a
 * reaction material (fuel blocks: they produce like reactions). ESI ids are unique per user: a job seen
 * by a character and its corporation is one row.
 */
export const trackedJobs = sqliteTable(
	'tracked_jobs',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		jobId: integer('job_id').notNull(),
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		installerId: integer('installer_id').notNull(),
		/** ESI `activity_id`: 9 (or 11) = reaction, 1 = manufacturing. Rows before migration 0011 are reactions. */
		activityId: integer('activity_id').notNull().default(9),
		blueprintTypeId: integer('blueprint_type_id').notNull(),
		/** The blueprint item (ESI `blueprint_id`), to read its ME; null on rows before migration 0011. */
		blueprintId: integer('blueprint_id'),
		/**
		 * Material efficiency of the manufacturing job's blueprint, read from the owner's blueprints while the
		 * blueprint exists; null = not read (the ledger then assumes `TrackingSettings.blueprintMe` or 10).
		 */
		blueprintMe: integer('blueprint_me'),
		productTypeId: integer('product_type_id'),
		runs: integer('runs').notNull(),
		/** ESI status: 'active' | 'paused' | 'ready' | 'delivered' | 'cancelled' | 'reverted' */
		status: text('status').notNull(),
		cost: real('cost'),
		facilityId: integer('facility_id').notNull(),
		outputLocationId: integer('output_location_id').notNull(),
		startDate: integer('start_date').notNull(),
		endDate: integer('end_date').notNull(),
		completedDate: integer('completed_date')
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.jobId] }),
		index('tracked_jobs_user_start_idx').on(t.userId, t.startDate)
	]
);

/**
 * Facilities of the user's tracked jobs, as EVE describes them: looked up with
 * `/universe/structures/{id}` (or `/universe/stations/{id}`) by the tracking sync, and the installed rigs
 * read from corporation assets (`RigSlot*` items) by the inventory sync. The user's
 * `TrackingSettings.facilities` fill in only what is null here.
 */
export const trackedFacilities = sqliteTable(
	'tracked_facilities',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		facilityId: integer('facility_id').notNull(),
		/** 'structure' | 'station' | 'unknown' (the lookup was refused or failed). */
		kind: text('kind').notNull(),
		name: text('name'),
		systemId: integer('system_id'),
		/** Structure or station type id; null when unknown. */
		typeId: integer('type_id'),
		/** Installed rig type ids (JSON array) read from corporation assets; null = not read. */
		rigsJson: text('rigs_json'),
		/** When `rigs_json` was read; rigs not seen again in a later assets read are dropped. */
		rigsReadAt: integer('rigs_read_at'),
		/** Last lookup (unix ms) and when the next one may run (ESI `Expires`, or later). */
		checkedAt: integer('checked_at'),
		nextCheckAt: integer('next_check_at')
	},
	(t) => [primaryKey({ columns: [t.userId, t.facilityId] })]
);

/** Market transactions of tracked types (`trackedTypeIds` of the dataset). */
export const trackedTransactions = sqliteTable(
	'tracked_transactions',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		transactionId: integer('transaction_id').notNull(),
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		/** Corporation wallet division; null for a character wallet. */
		division: integer('division'),
		date: integer('date').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull(),
		unitPrice: real('unit_price').notNull(),
		isBuy: integer('is_buy', { mode: 'boolean' }).notNull(),
		clientId: integer('client_id').notNull(),
		locationId: integer('location_id').notNull(),
		journalRefId: integer('journal_ref_id').notNull(),
		/** Character wallets only. */
		isPersonal: integer('is_personal', { mode: 'boolean' })
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.transactionId] }),
		index('tracked_transactions_user_type_date_idx').on(t.userId, t.typeId, t.date)
	]
);

/** Wallet journal rows of the relevant `ref_type`s (fees, taxes, contract and job payments). */
export const trackedJournal = sqliteTable(
	'tracked_journal',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		refId: integer('ref_id').notNull(),
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		/** Corporation wallet division; null for a character wallet. */
		division: integer('division'),
		date: integer('date').notNull(),
		refType: text('ref_type').notNull(),
		amount: real('amount'),
		contextId: integer('context_id'),
		/** ESI `context_id_type`: 'market_transaction_id' | 'contract_id' | 'industry_job_id' | … */
		contextIdType: text('context_id_type')
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.refId] }),
		index('tracked_journal_user_context_idx').on(t.userId, t.contextIdType, t.contextId)
	]
);

/** Open and historical market orders (broker fee attribution, output listed for sale). */
export const trackedOrders = sqliteTable(
	'tracked_orders',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		orderId: integer('order_id').notNull(),
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		typeId: integer('type_id').notNull(),
		isBuy: integer('is_buy', { mode: 'boolean' }).notNull(),
		price: real('price').notNull(),
		volumeTotal: integer('volume_total').notNull(),
		volumeRemain: integer('volume_remain').notNull(),
		issued: integer('issued').notNull(),
		locationId: integer('location_id').notNull(),
		/** Corporation wallet division the order uses (fees are charged there); null for personal orders. */
		division: integer('division'),
		/** 'open' | 'closed' | 'expired' | 'cancelled' */
		state: text('state').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.orderId] }),
		index('tracked_orders_user_type_idx').on(t.userId, t.typeId)
	]
);

/** Finished `item_exchange` contracts with at least one relevant item. */
export const trackedContracts = sqliteTable(
	'tracked_contracts',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		contractId: integer('contract_id').notNull(),
		sourceId: integer('source_id')
			.notNull()
			.references(() => inventorySources.sourceId, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		status: text('status').notNull(),
		issuerId: integer('issuer_id').notNull(),
		issuerCorporationId: integer('issuer_corporation_id').notNull(),
		acceptorId: integer('acceptor_id').notNull(),
		assigneeId: integer('assignee_id').notNull(),
		forCorporation: integer('for_corporation', { mode: 'boolean' }).notNull(),
		price: real('price'),
		reward: real('reward'),
		/** The only free text ESI exposes (Janice links are read from it). */
		title: text('title'),
		dateIssued: integer('date_issued').notNull(),
		dateCompleted: integer('date_completed'),
		startLocationId: integer('start_location_id'),
		janiceCode: text('janice_code'),
		/**
		 * The Janice appraisal of `janice_code`, fetched once; after a failed fetch `{"failures":n,"retryAt":ms}`
		 * instead (an appraisal has `code`, never `retryAt`).
		 */
		janiceJson: text('janice_json')
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.contractId] }),
		index('tracked_contracts_user_issued_idx').on(t.userId, t.dateIssued)
	]
);

/** Every item of a tracked contract (irrelevant ones share the price); removed with their contract. */
export const trackedContractItems = sqliteTable(
	'tracked_contract_items',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		contractId: integer('contract_id').notNull(),
		recordId: integer('record_id').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull(),
		/** false = an item the issuer asks for. */
		isIncluded: integer('is_included', { mode: 'boolean' }).notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.contractId, t.recordId] }),
		foreignKey({
			columns: [t.userId, t.contractId],
			foreignColumns: [trackedContracts.userId, trackedContracts.contractId]
		}).onDelete('cascade')
	]
);

/** A unit price set by the user; survives ledger rebuilds and re-syncs. */
export const priceCorrections = sqliteTable(
	'price_corrections',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		targetKind: text('target_kind', { enum: PRICE_CORRECTION_TARGETS }).notNull(),
		/** Id of the corrected row within `target_kind`. */
		targetRef: text('target_ref').notNull(),
		unitPrice: real('unit_price').notNull(),
		note: text('note'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.targetKind, t.targetRef] })]
);

/**
 * Purchases the user entered on the Ledger tab (typed or imported): they become batches like market
 * purchases, so jobs started after `date` take from them instead of a market estimate.
 */
export const manualEntries = sqliteTable(
	'manual_entries',
	{
		entryId: integer('entry_id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		/** When the items were acquired (unix ms). */
		date: integer('date').notNull(),
		typeId: integer('type_id').notNull(),
		quantity: integer('quantity').notNull(),
		unitPrice: real('unit_price').notNull(),
		note: text('note'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('manual_entries_user_date_idx').on(t.userId, t.date)]
);

/** FIFO lots written by the ledger rebuild (whole history of one user each time). */
export const ledgerLots = sqliteTable(
	'ledger_lots',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		lotId: integer('lot_id').notNull(),
		typeId: integer('type_id').notNull(),
		acquiredAt: integer('acquired_at').notNull(),
		quantity: integer('quantity').notNull(),
		remaining: integer('remaining').notNull(),
		unitCost: real('unit_cost').notNull(),
		origin: text('origin', { enum: LEDGER_LOT_ORIGINS }).notNull(),
		originRef: text('origin_ref').notNull(),
		/** Where the unit cost comes from, shown verbatim. */
		priceSource: text('price_source').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.lotId] }),
		index('ledger_lots_user_type_acquired_idx').on(t.userId, t.typeId, t.acquiredAt)
	]
);

/** Quantities taken from a lot by a job, a sale or a transfer out. */
export const ledgerUses = sqliteTable(
	'ledger_uses',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		lotId: integer('lot_id').notNull(),
		useKind: text('use_kind', { enum: LEDGER_USE_KINDS }).notNull(),
		useRef: text('use_ref').notNull(),
		quantity: integer('quantity').notNull(),
		unitCost: real('unit_cost').notNull(),
		/**
		 * What one unit counted for in a `manufacturing` use (buy value at the job's start, or the unit cost
		 * with `manufacturingUse: 'zero'`); null for job and sale uses.
		 */
		unitValue: real('unit_value')
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.lotId, t.useKind, t.useRef] }),
		index('ledger_uses_user_kind_ref_idx').on(t.userId, t.useKind, t.useRef)
	]
);

/** Per tracked job, written by the ledger rebuild. Expected profit is computed when the page loads. */
export const jobResults = sqliteTable(
	'job_results',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		jobId: integer('job_id').notNull(),
		inputCost: real('input_cost').notNull(),
		jobCost: real('job_cost').notNull(),
		outputTypeId: integer('output_type_id'),
		outputQty: integer('output_qty').notNull(),
		soldQty: integer('sold_qty').notNull(),
		salesNet: real('sales_net').notNull(),
		/** Output consumed by later own jobs. */
		usedQty: integer('used_qty').notNull(),
		unsoldQty: integer('unsold_qty').notNull(),
		/** (input cost + job cost) ÷ output quantity; null without output. */
		unitCost: real('unit_cost'),
		/** Sales net − sold × unit cost; a cancelled job: −(input cost + job cost). */
		realizedProfit: real('realized_profit').notNull(),
		/** Output taken by the user's manufacturing jobs, and what it counted for (buy value or unit cost). */
		manufacturedQty: integer('manufactured_qty').notNull().default(0),
		manufacturedValue: real('manufactured_value').notNull().default(0),
		flagsJson: text('flags_json')
	},
	(t) => [primaryKey({ columns: [t.userId, t.jobId] })]
);

/**
 * Price of every tracked trade and contract item as the ledger rebuild computed it (the `/ledger` page):
 * one row per trade (`ref` `transaction:<id>`) or per contract type and direction (`contract:<id>`).
 */
export const ledgerPrices = sqliteTable(
	'ledger_prices',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		ref: text('ref').notNull(),
		typeId: integer('type_id').notNull(),
		/** true: came to the user (purchase); false: left the user (sale). */
		incoming: integer('incoming', { mode: 'boolean' }).notNull(),
		at: integer('at').notNull(),
		quantity: integer('quantity').notNull(),
		/** Net unit value: purchases include fees, sales are net of tax and fees. */
		unitPrice: real('unit_price').notNull(),
		/** `PriceSourceKind` of the engine. */
		sourceKind: text('source_kind').notNull(),
		sourceText: text('source_text').notNull(),
		needsReview: integer('needs_review', { mode: 'boolean' }).notNull(),
		/** Market trades: tax and broker fee of the whole transaction, with where each came from. */
		tax: real('tax'),
		taxSource: text('tax_source'),
		brokerFee: real('broker_fee'),
		brokerFeeSource: text('broker_fee_source'),
		/** Own-party trade or contract: no purchase or sale. */
		transfer: integer('transfer', { mode: 'boolean' }).notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.ref, t.typeId, t.incoming] }),
		index('ledger_prices_user_at_idx').on(t.userId, t.at),
		index('ledger_prices_user_type_idx').on(t.userId, t.typeId)
	]
);

/** Broker fee and SCC surcharge rows no order matched ("Other market fees" per period). */
export const ledgerUnallocatedFees = sqliteTable(
	'ledger_unallocated_fees',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.userId, { onDelete: 'cascade' }),
		refId: integer('ref_id').notNull(),
		date: integer('date').notNull(),
		amount: real('amount').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.refId] })]
);

export const ledgerState = sqliteTable('ledger_state', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.userId, { onDelete: 'cascade' }),
	rebuiltAt: integer('rebuilt_at'),
	/**
	 * 0 = results current, 1 = a change waits for a rebuild (set before the rebuild RPC and by the
	 * syncs), 2 = a rebuild loaded that change and has not stored its results yet (the cron retries any
	 * non-zero value). Read it as a number: drizzle's boolean mode reads 2 as false.
	 */
	dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false)
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
export type InventorySourceRow = typeof inventorySources.$inferSelect;
export type NewInventorySourceRow = typeof inventorySources.$inferInsert;
export type InventorySourceReaderRow = typeof inventorySourceReaders.$inferSelect;
export type InventoryLocationRow = typeof inventoryLocations.$inferSelect;
export type InventoryItemRow = typeof inventoryItems.$inferSelect;
export type InventorySelectionRow = typeof inventorySelection.$inferSelect;
export type TrackingStreamRow = typeof trackingStreams.$inferSelect;
export type TrackedJobRow = typeof trackedJobs.$inferSelect;
export type TrackedTransactionRow = typeof trackedTransactions.$inferSelect;
export type TrackedJournalRow = typeof trackedJournal.$inferSelect;
export type TrackedOrderRow = typeof trackedOrders.$inferSelect;
export type TrackedContractRow = typeof trackedContracts.$inferSelect;
export type TrackedContractItemRow = typeof trackedContractItems.$inferSelect;
export type PriceCorrectionRow = typeof priceCorrections.$inferSelect;
export type LedgerLotRow = typeof ledgerLots.$inferSelect;
export type LedgerUseRow = typeof ledgerUses.$inferSelect;
export type JobResultRow = typeof jobResults.$inferSelect;
export type LedgerPriceRow = typeof ledgerPrices.$inferSelect;
export type LedgerUnallocatedFeeRow = typeof ledgerUnallocatedFees.$inferSelect;
export type LedgerStateRow = typeof ledgerState.$inferSelect;
export type ManualEntryRow = typeof manualEntries.$inferSelect;
