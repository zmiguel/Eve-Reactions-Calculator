import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	characters,
	chunkRows,
	getCoreDb,
	getHistoryDb,
	inventoryItems,
	inventoryLocations,
	inventorySelection,
	inventorySourceReaders,
	inventorySources,
	jobResults,
	latestPrices,
	ledgerLots,
	ledgerPrices,
	ledgerState,
	ledgerUnallocatedFees,
	ledgerUses,
	manualEntries,
	materialBlueprintMaterials,
	marketHubs,
	priceCorrections,
	priceSnapshots,
	reactionMaterials,
	reactions,
	reprocessMaterials,
	structureLinks,
	trackedContractItems,
	trackedContracts,
	trackedJobs,
	trackedJournal,
	trackedOrders,
	trackedTransactions,
	trackedTypeIds,
	trackingStreams,
	upsertMany,
	userSessions,
	users
} from '../src/index.ts';
import type { NewLatestPriceRow } from '../src/index.ts';

const core = () => getCoreDb(env.DB);

describe('migrations', () => {
	it('create all core and history tables', async () => {
		const coreTables = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' AND name <> 'd1_migrations' ORDER BY name"
		).all<{ name: string }>();
		expect(coreTables.results.map((r) => r.name)).toEqual([
			'adjusted_prices',
			'characters',
			'cost_indices',
			'http_cache',
			'inventory_items',
			'inventory_locations',
			'inventory_selection',
			'inventory_source_readers',
			'inventory_sources',
			'job_results',
			'job_runs',
			'latest_prices',
			'ledger_lots',
			'ledger_prices',
			'ledger_state',
			'ledger_unallocated_fees',
			'ledger_uses',
			'manual_entries',
			'manufacturing_blueprint_materials',
			'manufacturing_blueprints',
			'market_hubs',
			'market_stats',
			'material_blueprint_materials',
			'price_corrections',
			'reaction_materials',
			'reactions',
			'regions',
			'reprocess_materials',
			'sde_state',
			'structure_links',
			'systems',
			'tracked_contract_items',
			'tracked_contracts',
			'tracked_facilities',
			'tracked_jobs',
			'tracked_journal',
			'tracked_orders',
			'tracked_transactions',
			'tracking_streams',
			'types',
			'user_sessions',
			'users'
		]);
		const histTables = await env.HISTORY_DB.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' AND name <> 'd1_migrations' ORDER BY name"
		).all<{ name: string }>();
		expect(histTables.results.map((r) => r.name)).toEqual([
			'adjusted_price_daily',
			'archive_manifest',
			'cost_index_daily',
			'esi_market_history',
			'price_daily',
			'price_snapshots'
		]);
	});

	it('seeds the six public NPC hubs', async () => {
		const hubs = await core().select().from(marketHubs).orderBy(asc(marketHubs.sortOrder));
		expect(
			hubs.map((h) => [h.hubId, h.kind, h.regionId, h.systemId, h.locationId, h.fuzzworkLocationId])
		).toEqual([
			['jita', 'station', 10000002, 30000142, 60003760, 60003760],
			['amarr', 'station', 10000043, 30002187, 60008494, 60008494],
			['perimeter', 'system', 10000002, 30000144, 30000144, 30000144],
			['dodixie', 'station', 10000032, 30002659, 60011866, 60011866],
			['rens', 'station', 10000030, 30002510, 60004588, 60004588],
			['hek', 'station', 10000042, 30002053, 60005686, 60005686]
		]);
		expect(hubs[0].name).toBe('Jita 4-4');
		for (const h of hubs) {
			expect(h.visibility).toBe('public');
			expect(h.shareStatus).toBe('none');
			expect(h.enabled).toBe(true);
		}
	});

	it('gives characters a nullable sso_client_id (NULL = the primary SSO app)', async () => {
		const { results } = await env.DB.prepare(
			"SELECT type, \"notnull\", dflt_value FROM pragma_table_info('characters') WHERE name = 'sso_client_id'"
		).all();
		expect(results).toEqual([{ type: 'TEXT', notnull: 0, dflt_value: null }]);
	});

	it('gives inventory_sources a nullable data_expires_at (0008)', async () => {
		const { results } = await env.DB.prepare(
			"SELECT type, \"notnull\", dflt_value FROM pragma_table_info('inventory_sources') WHERE name = 'data_expires_at'"
		).all();
		expect(results).toEqual([{ type: 'INTEGER', notnull: 0, dflt_value: null }]);
	});

	it('backfills each corporation source with its own reader when 0009 applies on 0008', async () => {
		const db = env.MIGRATION_DB;
		const before = env.CORE_MIGRATIONS.filter((m) => m.name < '0009');
		const after = env.CORE_MIGRATIONS.filter((m) => m.name.startsWith('0009'));
		expect(after.map((m) => m.name)).toEqual(['0009_inventory_source_readers.sql']);
		await applyD1Migrations(db, before);
		await db.batch([
			db.prepare("INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('a', 1, 1), ('b', 1, 1)"),
			db.prepare(
				"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (1, 'a', 'A1', 'x', 1), (2, 'a', 'A2', 'x', 1), (3, 'b', 'B1', 'x', 1)"
			),
			db.prepare(
				`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, created_at) VALUES
				(10, 'a', 1, 'character', 1, 'A1', 5),
				(11, 'a', 2, 'corporation', 98000001, 'Corp', 6),
				(12, 'b', 3, 'corporation', 98000001, 'Corp', 7)`
			)
		]);
		await applyD1Migrations(db, after);
		const { results } = await db
			.prepare('SELECT source_id, character_id, created_at FROM inventory_source_readers ORDER BY source_id')
			.all();
		expect(results).toEqual([
			{ source_id: 11, character_id: 2, created_at: 6 },
			{ source_id: 12, character_id: 3, created_at: 7 }
		]);
	});

	it('keeps every existing source as an inventory connection without tracking when 0010 applies on 0009', async () => {
		const db = env.MIGRATION_DB;
		const before = env.CORE_MIGRATIONS.filter((m) => m.name < '0010');
		const after = env.CORE_MIGRATIONS.filter((m) => m.name >= '0010');
		expect(after.map((m) => m.name)).toEqual([
			'0010_tracking.sql',
			'0011_tracking_manufacturing.sql',
			'0012_fuel_blocks.sql',
			'0013_manufacturing_materials.sql'
		]);
		await applyD1Migrations(db, before);
		await db.batch([
			db.prepare("INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('c', 1, 1)"),
			db.prepare(
				"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (4, 'c', 'C1', 'x', 1)"
			),
			db.prepare(
				`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, created_at) VALUES
				(20, 'c', 4, 'character', 4, 'C1', 5),
				(21, 'c', 4, 'corporation', 98000002, 'Corp', 6)`
			)
		]);
		await applyD1Migrations(db, after);
		const { results } = await db
			.prepare(
				"SELECT source_id, inventory_enabled, tracking_enabled, tracking_status, wallet_divisions_json FROM inventory_sources WHERE user_id = 'c' ORDER BY source_id"
			)
			.all();
		expect(results).toEqual([
			{
				source_id: 20,
				inventory_enabled: 1,
				tracking_enabled: 0,
				tracking_status: null,
				wallet_divisions_json: null
			},
			{
				source_id: 21,
				inventory_enabled: 1,
				tracking_enabled: 0,
				tracking_status: null,
				wallet_divisions_json: null
			}
		]);
		const [user] = await getCoreDb(db).select().from(users).where(eq(users.userId, 'c'));
		expect(user.trackingJson).toBeNull();
	});
});

describe('chunkRows', () => {
	it('sizes chunks by the 100 bound-parameter limit', () => {
		const rows = Array.from({ length: 25 }, (_, i) => i);
		expect(chunkRows(rows, 12).map((c) => c.length)).toEqual([8, 8, 8, 1]);
		expect(chunkRows(rows, 4).map((c) => c.length)).toEqual([25]);
		expect(chunkRows([], 3)).toEqual([]);
	});
});

describe('upsertMany', () => {
	const makeRows = (price: number): NewLatestPriceRow[] =>
		Array.from({ length: 1000 }, (_, i) => ({
			hubId: 'jita',
			typeId: i + 1,
			buyMax: price,
			sellMin: price + 1,
			buyP5: null,
			sellP5: null,
			buyVolume: 10,
			sellVolume: 20,
			buyOrders: 1,
			sellOrders: 2,
			source: 'esi',
			observedAt: 1
		}));

	it('inserts 1,000 rows then updates them', async () => {
		const db = core();
		const cols = [latestPrices.buyMax, latestPrices.sellMin, latestPrices.source, latestPrices.observedAt];
		await upsertMany(db, latestPrices, makeRows(5), [latestPrices.hubId, latestPrices.typeId], cols);
		const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(latestPrices);
		expect(n).toBe(1000);

		const updated = makeRows(7).map((r) => ({ ...r, source: 'fuzzwork', observedAt: 2, buyVolume: 999 }));
		await upsertMany(db, latestPrices, updated, [latestPrices.hubId, latestPrices.typeId], cols);
		const rows = await db.select().from(latestPrices);
		expect(rows).toHaveLength(1000);
		expect(new Set(rows.map((r) => r.buyMax))).toEqual(new Set([7]));
		expect(rows.find((r) => r.typeId === 500)).toMatchObject({
			buyMax: 7,
			sellMin: 8,
			source: 'fuzzwork',
			observedAt: 2,
			buyVolume: 10 // not in setColumns → unchanged
		});
	});

	it('works on the history database', async () => {
		const db = getHistoryDb(env.HISTORY_DB);
		const row = {
			snapshotAt: 1,
			hubId: 'jita',
			typeId: 34,
			buyMax: 1,
			sellMin: 2,
			buyVolume: 1,
			sellVolume: 1,
			source: 'esi'
		};
		await upsertMany(
			db,
			priceSnapshots,
			[row],
			[priceSnapshots.hubId, priceSnapshots.typeId, priceSnapshots.snapshotAt],
			[priceSnapshots.sellMin]
		);
		await upsertMany(
			db,
			priceSnapshots,
			[{ ...row, sellMin: 3 }],
			[priceSnapshots.hubId, priceSnapshots.typeId, priceSnapshots.snapshotAt],
			[priceSnapshots.sellMin]
		);
		const rows = await db.select().from(priceSnapshots);
		expect(rows.map((r) => r.sellMin)).toEqual([3]);
	});
});

describe('trackedTypeIds', () => {
	it('returns the union of blueprints, materials, products, reprocess outputs and fuel block ingredients', async () => {
		const db = core();
		await db.insert(reactions).values([
			{
				blueprintTypeId: 46166,
				slug: 'caesarium-cadmide',
				formulaName: 'Caesarium Cadmide Reaction Formula',
				name: 'Caesarium Cadmide',
				productTypeId: 16663,
				productQuantity: 200,
				reactor: 'composite',
				tier: 'intermediate',
				baseTimeSeconds: 10800,
				maxRuns: 1000,
				requiredSkillLevel: 1
			},
			{
				blueprintTypeId: 46191,
				slug: 'unrefined-hexite',
				formulaName: 'Unrefined Hexite Reaction Formula',
				name: 'Unrefined Hexite',
				productTypeId: 32821,
				productQuantity: 1,
				reactor: 'composite',
				tier: 'unrefined',
				baseTimeSeconds: 21600,
				maxRuns: 1000,
				requiredSkillLevel: 1
			}
		]);
		await db.insert(reactionMaterials).values([
			{ blueprintTypeId: 46166, typeId: 4246, quantity: 5 },
			{ blueprintTypeId: 46166, typeId: 16643, quantity: 100 },
			{ blueprintTypeId: 46191, typeId: 16643, quantity: 100 }
		]);
		await db.insert(reprocessMaterials).values([
			{ typeId: 32821, materialTypeId: 16642, quantity: 164, portionSize: 1 },
			{ typeId: 32821, materialTypeId: 16643, quantity: 10, portionSize: 1 }
		]);
		// Two of the Hydrogen Fuel Block Blueprint's materials.
		await db.insert(materialBlueprintMaterials).values([
			{ blueprintTypeId: 4316, typeId: 9832, quantity: 9 },
			{ blueprintTypeId: 4316, typeId: 17889, quantity: 450 }
		]);
		expect(await trackedTypeIds(db)).toEqual([
			4246, 4316, 9832, 16642, 16643, 16663, 17889, 32821, 46166, 46191
		]);
	});
});

describe('accounts', () => {
	beforeEach(async () => {
		const db = core();
		await db.insert(users).values({ userId: 'u1', createdAt: 1, lastSeenAt: 1 });
		await db.insert(userSessions).values({ sessionHash: 'h1', userId: 'u1', createdAt: 1, expiresAt: 2 });
		await db
			.insert(characters)
			.values({ characterId: 90000001, userId: 'u1', name: 'Pilot', ownerHash: 'x', createdAt: 1 });
		await db
			.insert(structureLinks)
			.values({ userId: 'u1', structureId: 1044752365771, characterId: 90000001, createdAt: 1 });
	});

	it('cascades user deletion to sessions, characters and structure links', async () => {
		const db = core();
		await db.delete(users).where(eq(users.userId, 'u1'));
		expect(await db.select().from(userSessions)).toEqual([]);
		expect(await db.select().from(characters)).toEqual([]);
		expect(await db.select().from(structureLinks)).toEqual([]);
	});

	it('defaults link fields and rejects a duplicate link', async () => {
		const db = core();
		const [link] = await db.select().from(structureLinks);
		expect(link).toMatchObject({ shareRequested: false, accessStatus: 'ok' });
		await expect(
			db
				.insert(structureLinks)
				.values({ userId: 'u1', structureId: 1044752365771, characterId: 90000001, createdAt: 2 })
		).rejects.toThrow();
		expect(await db.select().from(structureLinks)).toHaveLength(1);
	});
});

describe('inventory', () => {
	beforeEach(async () => {
		const db = core();
		await db.delete(users).where(eq(users.userId, 'u1'));
		await db.insert(users).values({ userId: 'u1', createdAt: 1, lastSeenAt: 1 });
		await db
			.insert(characters)
			.values({ characterId: 90000001, userId: 'u1', name: 'Pilot', ownerHash: 'x', createdAt: 1 });
		const [source] = await db
			.insert(inventorySources)
			.values({
				userId: 'u1',
				characterId: 90000001,
				kind: 'character',
				ownerId: 90000001,
				ownerName: 'Pilot',
				createdAt: 1
			})
			.returning();
		await db
			.insert(inventoryLocations)
			.values({ sourceId: source.sourceId, locationId: 60003760, kind: 'station' });
		await db.insert(inventoryItems).values({
			sourceId: source.sourceId,
			locationId: 60003760,
			bucket: 'hangar',
			typeId: 4246,
			quantity: 5
		});
		await db
			.insert(inventorySelection)
			.values({ sourceId: source.sourceId, locationId: 60003760, bucket: 'hangar' });
	});

	const expectEmpty = async () => {
		const db = core();
		expect(await db.select().from(inventorySources)).toEqual([]);
		expect(await db.select().from(inventoryLocations)).toEqual([]);
		expect(await db.select().from(inventoryItems)).toEqual([]);
		expect(await db.select().from(inventorySelection)).toEqual([]);
	};

	it('defaults a new source to pending with no items', async () => {
		const [source] = await core().select().from(inventorySources);
		expect(source).toMatchObject({ status: 'pending', itemCount: 0, lastSyncedAt: null });
	});

	it('cascades user deletion to sources, locations, items and selections', async () => {
		await core().delete(users).where(eq(users.userId, 'u1'));
		await expectEmpty();
	});

	it('cascades deletion of the reading character', async () => {
		await core().delete(characters).where(eq(characters.characterId, 90000001));
		await expectEmpty();
	});

	it('removes the pool rows of a deleted character and of a deleted source', async () => {
		const db = core();
		await db
			.insert(characters)
			.values({ characterId: 90000002, userId: 'u1', name: 'Alt', ownerHash: 'y', createdAt: 1 });
		const [corp] = await db
			.insert(inventorySources)
			.values({
				userId: 'u1',
				characterId: 90000001,
				kind: 'corporation',
				ownerId: 98000001,
				ownerName: 'Corp',
				createdAt: 2
			})
			.returning();
		await db.insert(inventorySourceReaders).values([
			{ sourceId: corp.sourceId, characterId: 90000001, createdAt: 2 },
			{ sourceId: corp.sourceId, characterId: 90000002, createdAt: 3 }
		]);
		await db.delete(characters).where(eq(characters.characterId, 90000002));
		expect(await db.select().from(inventorySourceReaders)).toEqual([
			{ sourceId: corp.sourceId, characterId: 90000001, createdAt: 2 }
		]);
		await db.delete(inventorySources).where(eq(inventorySources.sourceId, corp.sourceId));
		expect(await db.select().from(inventorySourceReaders)).toEqual([]);
	});

	it('rejects a duplicate source for the same account, kind and owner', async () => {
		const db = core();
		await expect(
			db.insert(inventorySources).values({
				userId: 'u1',
				characterId: 90000001,
				kind: 'character',
				ownerId: 90000001,
				ownerName: 'Pilot',
				createdAt: 2
			})
		).rejects.toThrow();
		await db.insert(inventorySources).values({
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 90000001,
			ownerName: 'Corp',
			createdAt: 2
		});
		expect(await db.select().from(inventorySources)).toHaveLength(2);
	});
});

describe('tracking', () => {
	/** Tables whose rows belong to one connection. */
	const CONNECTION_TABLES = [
		'tracked_jobs',
		'tracked_transactions',
		'tracked_journal',
		'tracked_orders',
		'tracked_contracts',
		'tracking_streams'
	];
	const USER_TABLES = [
		...CONNECTION_TABLES,
		'tracked_contract_items',
		'price_corrections',
		'ledger_lots',
		'ledger_uses',
		'ledger_prices',
		'ledger_unallocated_fees',
		'job_results',
		'ledger_state'
	];
	const sources = { pilot: 0, corp: 0, other: 0 };

	const addSource = async (userId: string, characterId: number, kind: string, ownerId: number) => {
		const [source] = await core()
			.insert(inventorySources)
			.values({ userId, characterId, kind, ownerId, ownerName: 'Owner', createdAt: 1, trackingEnabled: true })
			.returning();
		return source.sourceId;
	};

	/** One row of each raw feed; `id` is used for every ESI id (job, transaction, contract, …). */
	const seedConnection = async (userId: string, sourceId: number, id: number) => {
		const db = core();
		await db.insert(trackedJobs).values({
			userId,
			jobId: id,
			sourceId,
			installerId: 90000001,
			blueprintTypeId: 46166,
			productTypeId: 16670,
			runs: 10,
			status: 'delivered',
			cost: 1_234_567.5,
			facilityId: 1035466617946,
			outputLocationId: 1035466617946,
			startDate: 1_790_000_000_000,
			endDate: 1_790_010_000_000,
			completedDate: 1_790_020_000_000
		});
		await db.insert(trackedTransactions).values({
			userId,
			transactionId: id,
			sourceId,
			date: 1_790_000_000_000,
			typeId: 16634,
			quantity: 1000,
			unitPrice: 1234.56,
			isBuy: true,
			clientId: 90000099,
			locationId: 60003760,
			journalRefId: id
		});
		await db.insert(trackedJournal).values({
			userId,
			refId: id,
			sourceId,
			date: 1_790_000_000_000,
			refType: 'market_transaction',
			amount: -1_234_560,
			contextId: id,
			contextIdType: 'market_transaction_id'
		});
		await db.insert(trackedOrders).values({
			userId,
			orderId: id,
			sourceId,
			typeId: 16670,
			isBuy: false,
			price: 5000,
			volumeTotal: 100,
			volumeRemain: 40,
			issued: 1_790_000_000_000,
			locationId: 60003760,
			state: 'open'
		});
		await db.insert(trackedContracts).values({
			userId,
			contractId: id,
			sourceId,
			type: 'item_exchange',
			status: 'finished',
			issuerId: 90000099,
			issuerCorporationId: 98000099,
			acceptorId: 90000001,
			assigneeId: 90000001,
			forCorporation: false,
			price: 10_000_000,
			reward: 0,
			title: 'Moon goo',
			dateIssued: 1_790_000_000_000,
			dateCompleted: 1_790_000_100_000
		});
		await db.insert(trackedContractItems).values([
			{ userId, contractId: id, recordId: 1, typeId: 16634, quantity: 500, isIncluded: true },
			{ userId, contractId: id, recordId: 2, typeId: 16635, quantity: 500, isIncluded: true }
		]);
		await db.insert(trackingStreams).values({ userId, sourceId, stream: 'jobs' });
	};

	/** The ledger rows of a user (written by the rebuild, not tied to a connection). */
	const seedLedger = async (userId: string) => {
		const db = core();
		await db
			.insert(priceCorrections)
			.values({ userId, targetKind: 'transaction', targetRef: '1', unitPrice: 1200, createdAt: 1 });
		await db.insert(ledgerLots).values({
			userId,
			lotId: 1,
			typeId: 16634,
			acquiredAt: 1_790_000_000_000,
			quantity: 1000,
			remaining: 0,
			unitCost: 1234.56,
			origin: 'transaction',
			originRef: '1',
			priceSource: 'Market purchase'
		});
		await db
			.insert(ledgerUses)
			.values({ userId, lotId: 1, useKind: 'job', useRef: '1', quantity: 1000, unitCost: 1234.56 });
		await db.insert(jobResults).values({
			userId,
			jobId: 1,
			inputCost: 1_234_560,
			jobCost: 1_234_567.5,
			outputTypeId: 16670,
			outputQty: 2000,
			soldQty: 0,
			salesNet: 0,
			usedQty: 0,
			unsoldQty: 2000,
			unitCost: 1234.56,
			realizedProfit: 0
		});
		await db.insert(ledgerPrices).values({
			userId,
			ref: 'transaction:1',
			typeId: 16670,
			incoming: true,
			at: 1,
			quantity: 1000,
			unitPrice: 1234.56,
			sourceKind: 'market',
			sourceText: 'Market purchase',
			needsReview: false,
			transfer: false
		});
		await db.insert(ledgerUnallocatedFees).values({ userId, refId: 1, date: 1, amount: 100 });
		await db.insert(ledgerState).values({ userId, rebuiltAt: 1 });
	};

	const distinct = async (table: string, column: string) =>
		(
			await env.DB.prepare(`SELECT DISTINCT ${column} AS v FROM ${table} ORDER BY v`).all<{
				v: string | number;
			}>()
		).results.map((r) => r.v);

	beforeEach(async () => {
		const db = core();
		await db.delete(users).where(inArray(users.userId, ['u1', 'u2']));
		await db.insert(users).values([
			{ userId: 'u1', createdAt: 1, lastSeenAt: 1 },
			{ userId: 'u2', createdAt: 1, lastSeenAt: 1 }
		]);
		await db.insert(characters).values([
			{ characterId: 90000001, userId: 'u1', name: 'Pilot', ownerHash: 'x', createdAt: 1 },
			{ characterId: 90000002, userId: 'u2', name: 'Other', ownerHash: 'y', createdAt: 1 }
		]);
		sources.pilot = await addSource('u1', 90000001, 'character', 90000001);
		sources.corp = await addSource('u1', 90000001, 'corporation', 98000001);
		sources.other = await addSource('u2', 90000002, 'corporation', 98000001);
		// ESI ids are unique per user: the other account sees the same ids as the pilot.
		await seedConnection('u1', sources.pilot, 1);
		await seedConnection('u1', sources.corp, 2);
		await seedConnection('u2', sources.other, 1);
		await seedLedger('u1');
		await seedLedger('u2');
	});

	it('removes every tracking row of a deleted user and keeps the other account', async () => {
		await core().delete(users).where(eq(users.userId, 'u1'));
		for (const table of USER_TABLES) {
			expect(await distinct(table, 'user_id'), table).toEqual(['u2']);
		}
	});

	it("removes a deleted user's manual entries and keeps the other account's", async () => {
		const db = core();
		await db.insert(manualEntries).values([
			{
				userId: 'u1',
				date: 1,
				typeId: 16671,
				quantity: 100,
				unitPrice: 950,
				note: 'Station trade',
				createdAt: 1
			},
			{ userId: 'u2', date: 2, typeId: 16671, quantity: 50, unitPrice: 900, note: null, createdAt: 2 }
		]);
		await db.delete(users).where(eq(users.userId, 'u1'));
		expect(
			await db.select({ userId: manualEntries.userId, quantity: manualEntries.quantity }).from(manualEntries)
		).toEqual([{ userId: 'u2', quantity: 50 }]);
	});

	it("removes a deleted connection's raw rows and keeps the other connections'", async () => {
		await core().delete(inventorySources).where(eq(inventorySources.sourceId, sources.pilot));
		for (const table of CONNECTION_TABLES) {
			expect(await distinct(table, 'source_id'), table).toEqual([sources.corp, sources.other]);
		}
		const items = await core()
			.select({ userId: trackedContractItems.userId, contractId: trackedContractItems.contractId })
			.from(trackedContractItems)
			.orderBy(asc(trackedContractItems.userId), asc(trackedContractItems.contractId));
		expect(items).toEqual([
			{ userId: 'u1', contractId: 2 },
			{ userId: 'u1', contractId: 2 },
			{ userId: 'u2', contractId: 1 },
			{ userId: 'u2', contractId: 1 }
		]);
	});

	it('removes the items of a deleted contract only', async () => {
		const db = core();
		await db
			.delete(trackedContracts)
			.where(and(eq(trackedContracts.userId, 'u1'), eq(trackedContracts.contractId, 1)));
		const items = await db
			.select({
				userId: trackedContractItems.userId,
				contractId: trackedContractItems.contractId,
				recordId: trackedContractItems.recordId
			})
			.from(trackedContractItems)
			.orderBy(
				asc(trackedContractItems.userId),
				asc(trackedContractItems.contractId),
				asc(trackedContractItems.recordId)
			);
		expect(items).toEqual([
			{ userId: 'u1', contractId: 2, recordId: 1 },
			{ userId: 'u1', contractId: 2, recordId: 2 },
			{ userId: 'u2', contractId: 1, recordId: 1 },
			{ userId: 'u2', contractId: 1, recordId: 2 }
		]);
	});

	it('keeps one row per job id and user, whichever connection reports it', async () => {
		const db = core();
		const [job] = await db.select().from(trackedJobs).where(eq(trackedJobs.sourceId, sources.pilot));
		await db.insert(trackedJobs).values({ ...job, jobId: 7 });
		// The corporation connection reports the same job the pilot installed.
		await expect(
			db.insert(trackedJobs).values({ ...job, jobId: 7, sourceId: sources.corp })
		).rejects.toThrow();
		await db.insert(trackedJobs).values({ ...job, userId: 'u2', jobId: 7, sourceId: sources.other });
		expect(
			await db
				.select({ userId: trackedJobs.userId, sourceId: trackedJobs.sourceId })
				.from(trackedJobs)
				.where(eq(trackedJobs.jobId, 7))
				.orderBy(asc(trackedJobs.userId))
		).toEqual([
			{ userId: 'u1', sourceId: sources.pilot },
			{ userId: 'u2', sourceId: sources.other }
		]);
	});
});
