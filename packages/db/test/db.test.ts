import { env } from 'cloudflare:workers';
import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	characters,
	chunkRows,
	getCoreDb,
	getHistoryDb,
	latestPrices,
	marketHubs,
	priceSnapshots,
	reactionMaterials,
	reactions,
	reprocessMaterials,
	structureLinks,
	trackedTypeIds,
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
			'job_runs',
			'latest_prices',
			'market_hubs',
			'market_stats',
			'reaction_materials',
			'reactions',
			'regions',
			'reprocess_materials',
			'sde_state',
			'structure_links',
			'systems',
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
	it('returns the union of blueprints, materials, products and reprocess outputs', async () => {
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
		expect(await trackedTypeIds(db)).toEqual([4246, 16642, 16643, 16663, 32821, 46166, 46191]);
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
