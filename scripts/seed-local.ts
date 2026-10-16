/**
 * Seeds the local (miniflare) D1 databases and KV namespace shared by both workers with the SDE fixture,
 * a deterministic market (mulberry32(42)), two seed accounts with structure markets, and the seed pilot's
 * profit tracking (trades, contracts, a fuel block job, a Titanium Carbide job chain and the ledger
 * computed from them).
 * Usage: `npm run seed:local` (= `node scripts/seed-local.ts`) seeds `.wrangler/seeded`, served by
 * `npm run dev:seeded`; the e2e server seeds its own directory through `seedLocal(E2E_PERSIST_TO, …)`,
 * adding running jobs of its own.
 * The developer's own state (`.wrangler/state`, real ESI data) is never written: `seedLocal` refuses it.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryTypeIds, runLedger, type Dataset, type Reaction } from '@reactions/engine';
import {
	ESI_FEATURES,
	STRUCTURE_SCOPES,
	encryptToken,
	formatScopes,
	type JaniceAppraisal
} from '@reactions/eve';
import { parseSdeZip, readIndustrySources, type SdeDataset } from '@reactions/sde';
import {
	JOB_RESULT_COLUMNS,
	LEDGER_LOT_COLUMNS,
	LEDGER_PRICE_COLUMNS,
	LEDGER_USE_COLUMNS,
	UNALLOCATED_FEE_COLUMNS,
	ledgerResultRows,
	facilitiesFromEve,
	parseAccountSettings,
	parseTrackingSettings,
	referenceKey,
	referencePriceFn,
	toRunLedgerInput,
	type SidePrices,
	type TrackedFacilityRow,
	type TrackedRows
} from '../apps/updater/src/ledger-rows.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE_ZIP = join(ROOT, 'packages/sde/test/fixtures/sde-mini.zip');
/** Game client industry data (Hoboleaks) matching the SDE fixture: rig bonuses and their product filters. */
const INDUSTRY_FIXTURES = join(ROOT, 'packages/sde/test/fixtures/hoboleaks');
/** Local state of `npm run dev` (both workers): the developer's real data, never seeded. */
export const DEV_STATE = join(ROOT, '.wrangler/state');
/** Seeded state of `npm run seed:local` and `npm run dev:seeded`. */
export const PERSIST_TO = join(ROOT, '.wrangler/seeded');
const WEB_CONFIG = join(ROOT, 'apps/web/wrangler.jsonc');
const OUT_DIR = join(ROOT, '.wrangler/seed');

const DAY_MS = 86_400_000;
export const SNAPSHOT_DAYS = 10;
export const SNAPSHOTS_PER_DAY = 4;
export const ESI_HISTORY_DAYS = 400;

export const SEED_HUBS = [
	{ hubId: 'jita', name: 'Jita 4-4', kind: 'station', regionId: 10000002, factor: 1 },
	{ hubId: 'amarr', name: 'Amarr', kind: 'station', regionId: 10000043, factor: 1.03 },
	{ hubId: 'perimeter', name: 'Perimeter', kind: 'system', regionId: 10000002, factor: 0.99 },
	{ hubId: 'dodixie', name: 'Dodixie', kind: 'station', regionId: 10000032, factor: 1.06 },
	{ hubId: 'rens', name: 'Rens', kind: 'station', regionId: 10000030, factor: 1.08 },
	{ hubId: 'hek', name: 'Hek', kind: 'station', regionId: 10000042, factor: 1.07 }
] as const;

export const SEED_COST_INDICES = [
	{ systemId: 30002647, reaction: 0.0412 },
	{ systemId: 30004604, reaction: 0.05 }
];

/**
 * Fixed development key (base64 of 32 ASCII bytes) the seed encrypts its dummy refresh token with; the
 * `.dev.vars.example` files of both apps document it as `TOKEN_ENCRYPTION_KEY`. Local dev only.
 */
export const DEV_TOKEN_ENCRYPTION_KEY = 'cmVhY3Rpb25zLWRldi10b2tlbi1rZXktMzItYnl0ZXM=';
/** Not a real EVE SSO token: a price refresh with it fails and marks the pilot's token invalid. */
export const SEED_REFRESH_TOKEN = 'seed-dummy-refresh-token';

/** Seed accounts (one character each); `npm run seed:local` replaces them on every run. */
export const SEED_USERS = [
	{ userId: 'seed-user', characterId: 90000001, name: 'Seed Pilot' },
	{ userId: 'seed-user-2', characterId: 90000002, name: 'Seed Pilot Two' }
] as const;

/** Structure hubs of the seed accounts: one private, one shared and waiting for review. */
export const SEED_STRUCTURE_HUBS = [
	{
		structureId: 1044752365771,
		name: 'Seed Market',
		systemId: 30000144,
		factor: 0.98,
		shareStatus: 'none',
		userId: 'seed-user',
		characterId: 90000001
	},
	{
		structureId: 1042508032148,
		name: 'Seed Shared Market',
		systemId: 30002187,
		factor: 1.02,
		shareStatus: 'pending',
		userId: 'seed-user-2',
		characterId: 90000002
	}
] as const;

const JITA_STATION = {
	locationId: 60003760,
	name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
	systemId: 30000142
};

/**
 * Inventory of the seed pilot: a personal source (Jita 4-4 hangar and the Seed Market hangar, both
 * selected, plus a formula in an industry job at Seed Market, unselected) and a corporation source
 * with two named divisions, one selected. Items by type name.
 */
export const SEED_INVENTORY = {
	userId: 'seed-user',
	characterId: 90000001,
	corporation: { corporationId: 98000001, name: 'Seed Corp', divisions: { 1: 'Moon goo', 2: 'Fuel' } },
	personal: [
		{
			...JITA_STATION,
			kind: 'station',
			// One steady cycle of 2 Titanium Carbide lines (23,816 of each intermediate), so the planner's
			// "My inventory" starts the final jobs in cycle 1; Silicon Diborite is at Seed Market. The raw
			// materials cover two cycles of Titanium Chromide and Silicon Diborite, so "Use what I have" with
			// "Allow formulas I don't own" can buy those formulas and use them.
			items: { 'Titanium Chromide': 24000, 'Oxygen Fuel Block': 2000, Titanium: 80000, Chromium: 80000 }
		},
		{
			locationId: SEED_STRUCTURE_HUBS[0].structureId,
			name: SEED_STRUCTURE_HUBS[0].name,
			systemId: SEED_STRUCTURE_HUBS[0].systemId,
			kind: 'structure',
			items: {
				'Silicon Diborite': 24000,
				Silicates: 80000,
				'Evaporite Deposits': 80000,
				'Titanium Carbide Reaction Formula': 2
			}
		}
	],
	/** Formulas installed in reaction jobs (bucket `jobs`) at Seed Market; not selected. */
	personalJobs: {
		locationId: SEED_STRUCTURE_HUBS[0].structureId,
		items: { 'Titanium Carbide Reaction Formula': 1 }
	},
	corpDivisions: [
		{ bucket: 'div1', selected: true, items: { Cobalt: 20000, Cadmium: 15000 } },
		{ bucket: 'div2', selected: false, items: { 'Oxygen Fuel Block': 1000 } }
	]
} as const;

/**
 * Job facilities of the seed pilot as the updater detects them (`tracked_facilities`): the refinery of
 * the Titanium Chromide and Titanium Carbide jobs, a lowsec Tatara whose L-Set Reactor Efficiency II the
 * corporation assets showed (2.4 %, as the default reactor profile); the factory of the manufacturing
 * job, a Raitaru found by the lookup whose rigs were not read (the site asks for them); and the
 * structure of the Silicon Diborite job, whose lookup was refused (the site asks for type and rigs; the
 * reactor profile applies meanwhile).
 */
export const SEED_FACILITIES = {
	refinery: {
		facilityId: 1045000000001,
		name: 'Ignoitton - Seed Refinery',
		systemId: 30002647,
		typeId: 35836,
		rigs: [46497]
	},
	factory: { facilityId: 1045000000002, name: 'Perimeter - Seed Factory', systemId: 30000144, typeId: 35825 },
	unknown: { facilityId: 1045000000003 }
} as const;

/** Hub whose prices omit ~5 % of types so "n/a" rows can be exercised locally. */
const SPARSE_HUB = 'rens';

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface SeedPrice {
	buy: number;
	sell: number;
	buyVolume: number;
	sellVolume: number;
}

export interface MarketFixture {
	/** Jita sell price per type id (history baseline). */
	base: Record<number, number>;
	/** Public hubs (published in KV). */
	prices: Record<string, Record<number, SeedPrice>>;
	/** Private structure hubs of the seed accounts (D1 only). */
	structurePrices: Record<string, Record<number, SeedPrice>>;
	adjusted: Record<number, number>;
	dailyVolume: Record<number, number>;
}

const RAW_PRICE_RANGE: Record<number, [number, number]> = {
	18: [4, 900], // minerals
	423: [80, 700], // ice products (fuel block materials)
	427: [400, 6000], // moon materials
	711: [800, 6000], // gases
	1042: [300, 900], // planetary materials
	1136: [16000, 24000] // fuel blocks
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic market: raw prices from ranges, products priced from inputs × a 0.95–1.30 margin. Types
 * only fuel block jobs use (the fuel block blueprints and their materials) draw from a second generator,
 * so the prices of the reaction types stay what they were before those types were tracked.
 */
export function buildMarketFixture(sde: SdeDataset, seed = 42): MarketFixture {
	const reactionRng = mulberry32(seed);
	const fuelRng = mulberry32(seed + 1);
	const { dataset } = sde;
	const reactionTypes = inventoryTypeIds(dataset);
	const rngOf = (typeId: number) => (reactionTypes.has(typeId) ? reactionRng : fuelRng);
	const formulaIds = new Set(dataset.reactions.map((r) => r.blueprintTypeId));
	const producer = new Map<number, Reaction>(dataset.reactions.map((r) => [r.product.typeId, r]));
	const base: Record<number, number> = {};
	const typeIds = sde.types.map((t) => t.typeId).sort((a, b) => a - b);
	for (const t of [...sde.types].sort((a, b) => a.typeId - b.typeId)) {
		const rng = rngOf(t.typeId);
		if (formulaIds.has(t.typeId)) base[t.typeId] = round2(10_000_000 + rng() * 30_000_000);
		else if (!producer.has(t.typeId)) {
			const [lo, hi] = RAW_PRICE_RANGE[t.groupId] ?? [500, 5000];
			base[t.typeId] = round2(lo + rng() * (hi - lo));
		}
	}
	const priceOf = (typeId: number, seen: Set<number>): number => {
		if (base[typeId] !== undefined) return base[typeId];
		const r = producer.get(typeId)!;
		if (seen.has(r.blueprintTypeId)) return 1000;
		const cost = r.materials.reduce(
			(acc, m) => acc + m.quantity * priceOf(m.typeId, new Set(seen).add(r.blueprintTypeId)),
			0
		);
		base[typeId] = round2((cost / r.product.quantity) * (0.95 + reactionRng() * 0.35));
		return base[typeId];
	};
	for (const r of [...dataset.reactions].sort((a, b) => a.blueprintTypeId - b.blueprintTypeId)) {
		priceOf(r.product.typeId, new Set());
	}

	const prices: MarketFixture['prices'] = {};
	const dailyVolume: Record<number, number> = {};
	for (const hub of SEED_HUBS) {
		const book: Record<number, SeedPrice> = {};
		for (const typeId of typeIds) {
			const rng = rngOf(typeId);
			const skip = hub.hubId === SPARSE_HUB && rng() < 0.05;
			const sell = round2(base[typeId] * hub.factor * (0.97 + rng() * 0.06));
			const buy = round2(sell * (0.86 + rng() * 0.1));
			const volume = Math.round(1000 + rng() * 2_000_000);
			if (!skip) book[typeId] = { buy, sell, buyVolume: volume, sellVolume: Math.round(volume * 1.3) };
		}
		prices[hub.hubId] = book;
	}
	const adjusted: Record<number, number> = {};
	for (const typeId of typeIds) {
		adjusted[typeId] = round2(base[typeId] * 0.95);
		if (!formulaIds.has(typeId)) dailyVolume[typeId] = Math.round(5_000 + rngOf(typeId)() * 5_000_000);
	}
	const structurePrices: MarketFixture['structurePrices'] = {};
	for (const hub of SEED_STRUCTURE_HUBS) {
		const book: Record<number, SeedPrice> = {};
		for (const typeId of typeIds) {
			const rng = rngOf(typeId);
			const sell = round2(base[typeId] * hub.factor * (0.97 + rng() * 0.06));
			const volume = Math.round(100 + rng() * 200_000);
			book[typeId] = { buy: round2(sell * 0.9), sell, buyVolume: volume, sellVolume: volume };
		}
		structurePrices[`structure-${hub.structureId}`] = book;
	}
	return { base, prices, structurePrices, adjusted, dailyVolume };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const n = (v: number | null) => (v === null ? 'NULL' : String(v));
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A raw SQL expression in an {@link insert} row (e.g. a subquery). */
type RawSql = { sql: string };
type SqlCell = string | number | null | RawSql;

function insert(table: string, columns: readonly string[], rows: SqlCell[][], chunk = 200): string[] {
	const cell = (v: SqlCell) =>
		typeof v === 'string' ? q(v) : v !== null && typeof v === 'object' ? v.sql : n(v);
	const out: string[] = [];
	for (let i = 0; i < rows.length; i += chunk) {
		const values = rows
			.slice(i, i + chunk)
			.map((r) => `(${r.map(cell).join(', ')})`)
			.join(',\n');
		out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`);
	}
	return out;
}

/** Source id of a seed connection of {@link SEED_INVENTORY} (ids autoincrement). */
export const seedSource = (kind: 'character' | 'corporation', ownerId: number) =>
	`(SELECT source_id FROM inventory_sources WHERE user_id = ${q(SEED_INVENTORY.userId)} AND kind = ${q(kind)} AND owner_id = ${ownerId})`;

export interface SeedOutput {
	core: string;
	history: string;
	kv: { 'dataset:v1': string; 'market:v1': string };
}

/** Accounts the seed replaces: the seed users and whoever holds a seed character (e.g. a dev login). */
const SEED_ACCOUNT_IDS = `SELECT user_id FROM users WHERE user_id IN (${SEED_USERS.map((u) => q(u.userId)).join(', ')})
	UNION SELECT user_id FROM characters WHERE character_id IN (${SEED_USERS.map((u) => u.characterId).join(', ')})`;

function seedTypeId(sde: SdeDataset, name: string): number {
	const t = sde.types.find((x) => x.name === name);
	if (!t) throw new Error(`seed: no type named ${name}`);
	return t.typeId;
}

/** SQL inserting {@link SEED_INVENTORY}; source ids come from subqueries (they autoincrement). */
function inventorySql(sde: SdeDataset, now: number): string[] {
	const inv = SEED_INVENTORY;
	const typeId = (name: string) => seedTypeId(sde, name);
	const personal = seedSource('character', inv.characterId);
	const corp = seedSource('corporation', inv.corporation.corporationId);
	const pilot = SEED_USERS.find((u) => u.characterId === inv.characterId)!;
	const items = (src: string, locationId: number, bucket: string, list: Record<string, number>) =>
		Object.entries(list).map(
			([name, qty]) =>
				`INSERT INTO inventory_items (source_id, location_id, bucket, type_id, quantity) VALUES (${src}, ${locationId}, ${q(bucket)}, ${typeId(name)}, ${qty});`
		);
	const location = (src: string, l: { locationId: number; kind: string; name: string; systemId: number }) =>
		`INSERT INTO inventory_locations (source_id, location_id, kind, name, system_id) VALUES (${src}, ${l.locationId}, ${q(l.kind)}, ${q(l.name)}, ${l.systemId});`;
	const select = (src: string, locationId: number, bucket: string) =>
		`INSERT INTO inventory_selection (source_id, location_id, bucket) VALUES (${src}, ${locationId}, ${q(bucket)});`;
	const sourceRow = (
		kind: string,
		ownerId: number,
		ownerName: string,
		divisions: string | null,
		lists: Record<string, number>[],
		tracking: boolean
	) => [
		inv.userId,
		inv.characterId,
		kind,
		ownerId,
		ownerName,
		divisions,
		'ok',
		now,
		now,
		now,
		lists.reduce((a, l) => a + Object.keys(l).length, 0),
		now,
		tracking ? 1 : 0,
		tracking ? 'ok' : null,
		tracking ? now : null,
		tracking ? now : null
	];
	return [
		...insert(
			'inventory_sources',
			[
				'user_id',
				'character_id',
				'kind',
				'owner_id',
				'owner_name',
				'division_names_json',
				'status',
				'last_attempt_at',
				'last_synced_at',
				'data_as_of',
				'item_count',
				'created_at',
				'tracking_enabled',
				'tracking_status',
				'tracking_last_attempt_at',
				'tracking_synced_at'
			],
			[
				sourceRow(
					'character',
					inv.characterId,
					pilot.name,
					null,
					[...inv.personal.map((l) => l.items), inv.personalJobs.items],
					true
				),
				sourceRow(
					'corporation',
					inv.corporation.corporationId,
					inv.corporation.name,
					JSON.stringify(inv.corporation.divisions),
					inv.corpDivisions.map((d) => d.items),
					false
				)
			]
		),
		`INSERT INTO inventory_source_readers (source_id, character_id, created_at) VALUES (${corp}, ${inv.characterId}, ${now});`,
		...inv.personal.flatMap((l) => [
			location(personal, l),
			...items(personal, l.locationId, 'hangar', l.items),
			select(personal, l.locationId, 'hangar')
		]),
		...items(personal, inv.personalJobs.locationId, 'jobs', inv.personalJobs.items),
		location(corp, { ...JITA_STATION, kind: 'station' }),
		...inv.corpDivisions.flatMap((d) => [
			...items(corp, JITA_STATION.locationId, d.bucket, d.items),
			...(d.selected ? [select(corp, JITA_STATION.locationId, d.bucket)] : [])
		])
	];
}

/**
 * `price_daily` buy/sell averages the history SQL of {@link buildSeedSql} writes for `typeId` at a hub
 * with price factor `factor`, `k` days before the seed day: the same arithmetic in the same order as
 * the SQL, rounded like SQLite's `round(x, 2)` (the decimal value of the double, which `toFixed` uses;
 * `round2` scales first and can differ by a cent). The seed test checks that both agree.
 */
export function seedDailyPrice(market: MarketFixture, factor: number, typeId: number, k: number): SidePrices {
	const jitter = 0.95 + ((k * 7919 + typeId * 104729) % 1000) / 10000;
	const price = market.base[typeId]!;
	return {
		buy: Number((price * factor * jitter * 0.9).toFixed(2)),
		sell: Number((price * factor * jitter).toFixed(2))
	};
}

/**
 * Profit tracking of the seed pilot's personal connection (Profit tracking on, every stream `ok`), on
 * UTC days before the seed day: day 9 two contract purchases of the intermediates' raw inputs and 300
 * Oxygen Fuel Blocks (one split by a stored Janice appraisal linked in its title, one by the contract
 * rule); day 8 market buys of Titanium Chromide, Silicon Diborite and Oxygen Isotopes through buy orders
 * (broker fee rows) and the two intermediate jobs (they use 294 of the 300 blocks); day 7 a fuel block
 * job; day 6 a Titanium Carbide job that uses the bought and the made intermediates and the last 6
 * bought blocks plus 141 made ones; days 4–3 a partial sale of Titanium Carbide through a sell order
 * (journal sales tax and broker fee); day 2 a manufacturing job (blueprint ME 10 read from EVE) that
 * takes part of the Titanium Carbide; day 1 a contract purchase of Platinum with an untracked module,
 * and a purchase the pilot entered by hand.
 */
export const SEED_TRACKING = {
	streams: ['jobs', 'contracts', 'orders', 'transactions', 'journal', 'blueprints'],
	/** Market counterparty and contract issuer: not own parties. */
	traderId: 95000101,
	sellerId: 95000102,
	sellerCorporationId: 98000102,
	janiceCode: 'SeedJanice1',
	runs: 30,
	/**
	 * Raw input per intermediate job: 30 runs × 100 × 0.976 (the refinery's L-Set Reactor Efficiency II in
	 * lowsec, or the default reactor profile's T2 ME rig in lowsec where the structure is unknown).
	 */
	rawUnits: 2928,
	/** Units of each intermediate bought on the market (the rest of the final job's need is made). */
	boughtUnits: 1000,
	jobs: [
		{ jobId: 610000001, name: 'Titanium Chromide', cost: 1_480_000, startDay: 8, facility: 'refinery' },
		{ jobId: 610000002, name: 'Silicon Diborite', cost: 1_520_000, startDay: 8, facility: 'unknown' },
		{ jobId: 610000003, name: 'Titanium Carbide', cost: 3_150_000, startDay: 6, facility: 'refinery' }
	],
	/**
	 * Spike S Blueprint (Titanium Carbide 150 and Fernite Carbide 75 per run): 40 runs at ME 10 in the
	 * Raitaru (role bonus 1 %, rigs not read) take 40 × 150 × 0.9 × 0.99 = 5,346 Titanium Carbide (Fernite
	 * Carbide is not tracked).
	 */
	manufacturing: {
		jobId: 610000004,
		blueprintTypeId: 12619,
		blueprintId: 1060000000001,
		runs: 40,
		me: 10,
		cost: 420_000,
		startDay: 2
	},
	/**
	 * Oxygen Fuel Block Blueprint at ME 10 (read from EVE) in the Raitaru (role bonus 1 %): 4 runs make
	 * 160 blocks from 4 × 450 × 0.891 = 1,603.8 → 1,604 Oxygen Isotopes (bought on day 8) and its other
	 * materials (no purchase: valued at the buy value at the job start).
	 */
	fuel: {
		jobId: 610000005,
		blueprintTypeId: 4313,
		blueprintId: 1060000000002,
		runs: 4,
		me: 10,
		cost: 95_000,
		startDay: 7,
		isotopes: 1_604
	},
	/** Entered on the Ledger tab: Titanium Carbide bought outside the tracked wallets. */
	manual: {
		entryId: 1,
		name: 'Titanium Carbide',
		quantity: 2_000,
		unitPrice: 950,
		day: 1,
		note: 'Station trade'
	},
	contracts: { janice: 220000001, rule: 220000002, mixed: 220000003 },
	/**
	 * Day 1 contract purchase of Platinum (valued at its reference price) together with a module no
	 * reaction uses and without a reference price (recorded as "Not tracked", gets the rest of the price).
	 */
	mixed: { name: 'Platinum', quantity: 1_000, moduleTypeId: 4405, moduleQuantity: 2, modulePrice: 250_000 },
	sale: { listed: 200_000, sold: 120_000 },
	brokerFeePct: 1.5,
	salesTaxPct: 3.6
} as const;

/** Run time of one reaction run at the seed facility (Tatara, T2 TE rig, lowsec, skill 5), ms. */
const SEED_RUN_MS = 4_924_800;
/** `source_id` of the seed pilot's personal connection in the engine input; the SQL uses its subquery. */
const SEED_TRACKING_SOURCE = 1;

/**
 * SQL of {@link SEED_TRACKING}: the tracked rows as the tracking sync stores them, and the ledger the
 * updater's rebuild computes from them (same `ledger-rows.ts` mapping and `runLedger`; reference prices
 * from the seeded `price_daily`, else the fixture's latest prices), so the seeded site shows results
 * without an updater.
 */
function trackingSql(sde: SdeDataset, market: MarketFixture, now: number): string[] {
	const t = SEED_TRACKING;
	const userId = SEED_INVENTORY.userId;
	const pilot = SEED_INVENTORY.characterId;
	const today = Math.floor(now / DAY_MS) * DAY_MS;
	const at = (daysAgo: number, hour: number, minute = 0) =>
		today - daysAgo * DAY_MS + (hour * 60 + minute) * 60_000;
	const typeId = (name: string) => seedTypeId(sde, name);
	const jita = market.prices.jita!;
	const settings = parseAccountSettings(null);
	const tracking = parseTrackingSettings(null);

	// Reference prices of the contract rule's hub: what the updater reads from the seeded history.
	const hub = SEED_HUBS.find((h) => h.hubId === tracking.contractRule.hubId)!;
	const formulaIds = new Set(sde.dataset.reactions.map((r) => r.blueprintTypeId));
	const daily = new Map<string, SidePrices>();
	for (const id of Object.keys(market.base).map(Number)) {
		if (formulaIds.has(id)) continue;
		for (let k = 1; k <= SNAPSHOT_DAYS; k++)
			daily.set(referenceKey(id, isoDate(today - k * DAY_MS)), seedDailyPrice(market, hub.factor, id, k));
	}
	const latest = new Map(
		Object.entries(market.prices[hub.hubId]!).map(([id, p]) => [Number(id), { buy: p.buy, sell: p.sell }])
	);
	const sources = { daily, regional: new Map(), latest };
	const referencePrice = referencePriceFn({ name: hub.name, basis: tracking.contractRule.basis }, sources);
	const buyPrice = referencePriceFn({ name: hub.name, basis: 'buy' }, sources);

	const transactions: Record<string, number | null>[] = [];
	const journal: Record<string, string | number | null>[] = [];
	const orders: Record<string, string | number | null>[] = [];
	let nextRef = 21000000001;
	const journalRow = (
		date: number,
		refType: string,
		amount: number,
		contextId: number | null,
		contextIdType: string | null
	) => {
		journal.push({
			ref_id: nextRef,
			source_id: SEED_TRACKING_SOURCE,
			division: null,
			date,
			ref_type: refType,
			amount,
			context_id: contextId,
			context_id_type: contextIdType
		});
		return nextRef++;
	};
	/** A filled part of an own order: the order (fee row at `issued`), the transaction and its journal rows. */
	const trade = (
		id: number,
		name: string,
		isBuy: boolean,
		price: number,
		order: { issued: number; total: number; remain: number; state: string },
		date: number,
		quantity: number
	) => {
		orders.push({
			order_id: id + 700000000,
			source_id: SEED_TRACKING_SOURCE,
			division: null,
			type_id: typeId(name),
			is_buy: isBuy ? 1 : 0,
			price,
			volume_total: order.total,
			volume_remain: order.remain,
			issued: order.issued,
			location_id: JITA_STATION.locationId,
			state: order.state
		});
		journalRow(
			order.issued,
			'brokers_fee',
			-round2((price * order.total * t.brokerFeePct) / 100),
			null,
			null
		);
		const gross = round2(price * quantity);
		const journalRefId = journalRow(
			date,
			'market_transaction',
			isBuy ? -gross : gross,
			id,
			'market_transaction_id'
		);
		if (!isBuy) journalRow(date, 'transaction_tax', -round2((gross * t.salesTaxPct) / 100), null, null);
		transactions.push({
			transaction_id: id,
			source_id: SEED_TRACKING_SOURCE,
			division: null,
			date,
			type_id: typeId(name),
			quantity,
			unit_price: price,
			is_buy: isBuy ? 1 : 0,
			client_id: t.traderId,
			location_id: JITA_STATION.locationId,
			journal_ref_id: journalRefId,
			is_personal: 1
		});
	};
	for (const [i, name] of ['Titanium Chromide', 'Silicon Diborite'].entries()) {
		const price = jita[typeId(name)]!.buy;
		const order = { issued: at(8, 8), total: t.boughtUnits, remain: 0, state: 'expired' };
		trade(6100000001 + i, name, true, price, order, at(8, 9, i), t.boughtUnits);
	}
	const carbidePrice = jita[typeId('Titanium Carbide')]!.sell;
	trade(
		6100000003,
		'Titanium Carbide',
		false,
		carbidePrice,
		{ issued: at(4, 10), total: t.sale.listed, remain: t.sale.listed - t.sale.sold, state: 'open' },
		at(3, 15),
		t.sale.sold
	);
	const isotopes = 'Oxygen Isotopes';
	trade(
		6100000004,
		isotopes,
		true,
		jita[typeId(isotopes)]!.buy,
		{ issued: at(8, 8), total: t.fuel.isotopes, remain: 0, state: 'expired' },
		at(8, 10),
		t.fuel.isotopes
	);

	// Contracts: issued day 9 10:00 by a seller, accepted by the pilot at 11:00.
	const issued = at(9, 10);
	const completed = at(9, 11);
	const janiceLines: [string, number][] = [
		['Titanium', t.rawUnits],
		['Chromium', t.rawUnits],
		['Oxygen Fuel Block', 150]
	];
	const ruleLines: [string, number][] = [
		['Silicates', t.rawUnits],
		['Evaporite Deposits', t.rawUnits],
		['Oxygen Fuel Block', 150]
	];
	const appraisal: JaniceAppraisal = {
		code: t.janiceCode,
		created: at(9, 9, 30),
		datasetTime: at(9, 9),
		marketId: 2,
		marketName: 'Jita 4-4',
		pricing: 'buy',
		pricingVariant: 'immediate',
		pricePercentage: null,
		items: janiceLines.map(([name, amount]) => {
			const p = jita[typeId(name)]!;
			return {
				typeId: typeId(name),
				name,
				amount,
				buyPrice: p.buy,
				splitPrice: round2((p.buy + p.sell) / 2),
				sellPrice: p.sell
			};
		})
	};
	const janicePrice = Math.round(appraisal.items.reduce((sum, i) => sum + i.amount * i.buyPrice, 0) * 0.95);
	const rulePrice = Math.round(
		ruleLines.reduce((sum, [name, qty]) => sum + qty * referencePrice(typeId(name), issued)!.unitPrice, 0)
	);
	const contract = (
		contractId: number,
		price: number,
		title: string,
		janice: JaniceAppraisal | null,
		dates = { issued, completed }
	) => ({
		contract_id: contractId,
		source_id: SEED_TRACKING_SOURCE,
		type: 'item_exchange',
		status: 'finished',
		issuer_id: t.sellerId,
		issuer_corporation_id: t.sellerCorporationId,
		acceptor_id: pilot,
		assignee_id: pilot,
		for_corporation: 0,
		price,
		reward: 0,
		title,
		date_issued: dates.issued,
		date_completed: dates.completed,
		start_location_id: JITA_STATION.locationId,
		janice_code: janice?.code ?? null,
		janice_json: janice ? JSON.stringify(janice) : null
	});
	// Day 1: the Platinum at its reference price, the module takes the rest.
	const mixedDates = { issued: at(1, 10), completed: at(1, 11) };
	const mixedPrice =
		Math.round(t.mixed.quantity * referencePrice(typeId(t.mixed.name), mixedDates.issued)!.unitPrice) +
		t.mixed.modulePrice;
	const contracts = [
		contract(
			t.contracts.janice,
			janicePrice,
			`Titanium Chromide inputs https://janice.e-351.com/a/${t.janiceCode}`,
			appraisal
		),
		contract(t.contracts.rule, rulePrice, 'Silicon Diborite inputs', null),
		contract(t.contracts.mixed, mixedPrice, 'Platinum and a module', null, mixedDates)
	];
	for (const c of contracts)
		journalRow(c.date_completed, 'contract_price', -c.price, c.contract_id, 'contract_id');
	const contractItems = [
		...janiceLines.map(([name, quantity], i) => [t.contracts.janice, i + 1, typeId(name), quantity] as const),
		...ruleLines.map(([name, quantity], i) => [t.contracts.rule, i + 1, typeId(name), quantity] as const),
		[t.contracts.mixed, 1, typeId(t.mixed.name), t.mixed.quantity] as const,
		[t.contracts.mixed, 2, t.mixed.moduleTypeId, t.mixed.moduleQuantity] as const
	].map(([contractId, recordId, type, quantity]) => ({
		contract_id: contractId,
		record_id: recordId,
		type_id: type,
		quantity,
		is_included: 1
	}));

	let blueprintId = 1060000000100;
	const jobs = t.jobs.map((j): Record<string, string | number | null> => {
		const reaction = sde.dataset.reactions.find((r) => r.name === j.name)!;
		const start = at(j.startDay, 12);
		const end = start + t.runs * SEED_RUN_MS;
		return {
			job_id: j.jobId,
			source_id: SEED_TRACKING_SOURCE,
			installer_id: pilot,
			activity_id: 9,
			blueprint_id: blueprintId++,
			blueprint_me: null,
			blueprint_type_id: reaction.blueprintTypeId,
			product_type_id: reaction.product.typeId,
			runs: t.runs,
			status: 'delivered',
			cost: j.cost,
			facility_id: SEED_FACILITIES[j.facility].facilityId,
			output_location_id: SEED_FACILITIES[j.facility].facilityId,
			start_date: start,
			end_date: end,
			completed_date: end + 3_600_000
		};
	});
	const m = t.manufacturing;
	const blueprint = sde.dataset.manufacturing?.find((b) => b.blueprintTypeId === m.blueprintTypeId);
	if (!blueprint) throw new Error(`the SDE fixture has no manufacturing blueprint ${m.blueprintTypeId}`);
	const manufacturingStart = at(m.startDay, 9);
	jobs.push({
		job_id: m.jobId,
		source_id: SEED_TRACKING_SOURCE,
		installer_id: pilot,
		activity_id: 1,
		blueprint_id: m.blueprintId,
		blueprint_me: m.me,
		blueprint_type_id: blueprint.blueprintTypeId,
		product_type_id: blueprint.productTypeId,
		runs: m.runs,
		status: 'delivered',
		cost: m.cost,
		facility_id: SEED_FACILITIES.factory.facilityId,
		output_location_id: SEED_FACILITIES.factory.facilityId,
		start_date: manufacturingStart,
		end_date: manufacturingStart + 6 * 3_600_000,
		completed_date: manufacturingStart + 7 * 3_600_000
	});
	const f = t.fuel;
	const fuelBlueprint = sde.dataset.manufacturing?.find((b) => b.blueprintTypeId === f.blueprintTypeId);
	if (!fuelBlueprint) throw new Error(`the SDE fixture has no fuel block blueprint ${f.blueprintTypeId}`);
	const fuelStart = at(f.startDay, 8);
	jobs.push({
		job_id: f.jobId,
		source_id: SEED_TRACKING_SOURCE,
		installer_id: pilot,
		activity_id: 1,
		blueprint_id: f.blueprintId,
		blueprint_me: f.me,
		blueprint_type_id: fuelBlueprint.blueprintTypeId,
		product_type_id: fuelBlueprint.productTypeId,
		runs: f.runs,
		status: 'delivered',
		cost: f.cost,
		facility_id: SEED_FACILITIES.factory.facilityId,
		output_location_id: SEED_FACILITIES.factory.facilityId,
		start_date: fuelStart,
		end_date: fuelStart + 3_600_000,
		completed_date: fuelStart + 2 * 3_600_000
	});
	const manualEntries = [
		{
			entry_id: t.manual.entryId,
			date: at(t.manual.day, 14),
			type_id: typeId(t.manual.name),
			quantity: t.manual.quantity,
			unit_price: t.manual.unitPrice,
			note: t.manual.note,
			created_at: at(t.manual.day, 15)
		}
	];

	const rows = {
		transactions,
		journal,
		orders,
		contracts,
		contractItems,
		jobs,
		corrections: [],
		manualEntries
	};
	const { refinery, factory, unknown } = SEED_FACILITIES;
	const facilityRows: (TrackedFacilityRow & Record<string, SqlCell>)[] = [
		{
			facility_id: refinery.facilityId,
			kind: 'structure',
			name: refinery.name,
			system_id: refinery.systemId,
			type_id: refinery.typeId,
			rigs_json: JSON.stringify(refinery.rigs),
			rigs_read_at: now,
			checked_at: now,
			next_check_at: now + 30 * DAY_MS
		},
		{
			facility_id: factory.facilityId,
			kind: 'structure',
			name: factory.name,
			system_id: factory.systemId,
			type_id: factory.typeId,
			rigs_json: null,
			rigs_read_at: null,
			checked_at: now,
			next_check_at: now + 30 * DAY_MS
		},
		{
			facility_id: unknown.facilityId,
			kind: 'unknown',
			name: null,
			system_id: null,
			type_id: null,
			rigs_json: null,
			rigs_read_at: null,
			checked_at: now,
			next_check_at: now + DAY_MS
		}
	];
	const systemBands = new Map(sde.systems.map((s) => [s.systemId, s.securityBand]));
	const result = runLedger(
		toRunLedgerInput(rows as unknown as TrackedRows, {
			dataset: sde.dataset,
			settings,
			tracking,
			systemBands,
			facilities: facilitiesFromEve(
				facilityRows,
				new Map([...SEED_INVENTORY.personal, JITA_STATION].map((l) => [l.locationId, l.systemId])),
				systemBands
			),
			characterIds: [pilot],
			corporationIds: [SEED_INVENTORY.corporation.corporationId],
			ordersAvailable: [SEED_TRACKING_SOURCE],
			referencePrice,
			buyPrice,
			now
		})
	);
	const out = ledgerResultRows(result);

	const source: RawSql = { sql: seedSource('character', pilot) };
	const owned = (table: string, columns: readonly string[], list: SqlCell[][]) =>
		list.length === 0
			? []
			: insert(
					table,
					['user_id', ...columns],
					list.map((row) => [userId, ...row])
				);
	const tracked = (table: string, list: Record<string, string | number | null>[]) =>
		owned(
			table,
			Object.keys(list[0]!),
			list.map((row) =>
				Object.entries(row).map(([column, value]) => (column === 'source_id' ? source : value))
			)
		);
	return [
		...insert(
			'tracking_streams',
			['source_id', 'stream', 'user_id', 'status', 'expires_at', 'last_synced_at'],
			t.streams.map((stream) => [source, stream, userId, 'ok', now + 3_600_000, now])
		),
		...tracked('tracked_transactions', transactions),
		...tracked('tracked_journal', journal),
		...tracked('tracked_orders', orders),
		...tracked('tracked_contracts', contracts),
		...tracked('tracked_contract_items', contractItems),
		...tracked('tracked_jobs', jobs),
		...owned(
			'tracked_facilities',
			Object.keys(facilityRows[0]!),
			facilityRows.map((row) => Object.values(row))
		),
		...owned(
			'manual_entries',
			Object.keys(manualEntries[0]!),
			manualEntries.map((row) => Object.values(row))
		),
		...owned('ledger_lots', LEDGER_LOT_COLUMNS, out.lots),
		...owned('ledger_uses', LEDGER_USE_COLUMNS, out.uses),
		...owned('job_results', JOB_RESULT_COLUMNS, out.jobs),
		...owned('ledger_prices', LEDGER_PRICE_COLUMNS, out.prices),
		...owned('ledger_unallocated_fees', UNALLOCATED_FEE_COLUMNS, out.unallocatedFees),
		...owned('ledger_state', ['rebuilt_at', 'dirty'], [[now, 0]])
	];
}

/**
 * Pure: SQL for both databases and the KV values. `now` fixes every timestamp and history date;
 * `refreshTokenEnc` is the seed pilots' encrypted dummy refresh token.
 */
export function buildSeedSql(
	sde: SdeDataset,
	market: MarketFixture,
	now: number,
	refreshTokenEnc: string
): SeedOutput {
	const dataset: Dataset = sde.dataset;
	const snapshotAt = Math.floor(now / 1_800_000) * 1_800_000;
	const today = Math.floor(now / DAY_MS) * DAY_MS;
	const formulaIds = new Set(dataset.reactions.map((r) => r.blueprintTypeId));
	const core: string[] = [
		'DELETE FROM reaction_materials;',
		'DELETE FROM reprocess_materials;',
		'DELETE FROM material_blueprint_materials;',
		'DELETE FROM reactions;',
		'DELETE FROM types;',
		'DELETE FROM systems;',
		'DELETE FROM regions;',
		'DELETE FROM latest_prices;',
		'DELETE FROM adjusted_prices;',
		'DELETE FROM cost_indices;',
		'DELETE FROM market_stats;',
		'DELETE FROM sde_state;',
		'DELETE FROM job_runs;',
		// Seed accounts are replaced on every run; orphans are removed explicitly in case cascades are off.
		`DELETE FROM users WHERE user_id IN (${SEED_ACCOUNT_IDS});`,
		'DELETE FROM inventory_sources WHERE user_id NOT IN (SELECT user_id FROM users);',
		'DELETE FROM inventory_locations WHERE source_id NOT IN (SELECT source_id FROM inventory_sources);',
		'DELETE FROM inventory_items WHERE source_id NOT IN (SELECT source_id FROM inventory_sources);',
		'DELETE FROM inventory_selection WHERE source_id NOT IN (SELECT source_id FROM inventory_sources);',
		'DELETE FROM structure_links WHERE user_id NOT IN (SELECT user_id FROM users);',
		'DELETE FROM user_sessions WHERE user_id NOT IN (SELECT user_id FROM users);',
		'DELETE FROM characters WHERE user_id NOT IN (SELECT user_id FROM users);',
		'DELETE FROM inventory_source_readers WHERE source_id NOT IN (SELECT source_id FROM inventory_sources) OR character_id NOT IN (SELECT character_id FROM characters);',
		...[
			'tracking_streams',
			'tracked_jobs',
			'tracked_facilities',
			'tracked_transactions',
			'tracked_journal',
			'tracked_orders',
			'tracked_contract_items',
			'tracked_contracts',
			'price_corrections',
			'manual_entries',
			'ledger_lots',
			'ledger_uses',
			'job_results',
			'ledger_prices',
			'ledger_unallocated_fees',
			'ledger_state'
		].map((table) => `DELETE FROM ${table} WHERE user_id NOT IN (SELECT user_id FROM users);`),
		// Seed structure hubs and hubs without links go; NPC hubs get their migration state back.
		`DELETE FROM market_hubs WHERE kind = 'structure' AND (hub_id IN (${SEED_STRUCTURE_HUBS.map((h) => q(`structure-${h.structureId}`)).join(', ')}) OR location_id NOT IN (SELECT structure_id FROM structure_links));`,
		`UPDATE market_hubs SET enabled = 1, visibility = 'public', share_status = 'none', last_error = NULL, sort_order = CASE hub_id ${SEED_HUBS.map((h, i) => `WHEN ${q(h.hubId)} THEN ${i + 1}`).join(' ')} END WHERE kind <> 'structure';`
	];
	core.push(
		...insert(
			'types',
			['type_id', 'name', 'group_id', 'category_id', 'volume', 'portion_size', 'published', 'base_price'],
			sde.types.map((t) => [
				t.typeId,
				t.name,
				t.groupId,
				t.categoryId,
				t.volume,
				t.portionSize,
				t.published ? 1 : 0,
				t.basePrice
			])
		),
		...insert(
			'regions',
			['region_id', 'name'],
			sde.regions.map((r) => [r.regionId, r.name])
		),
		...insert(
			'systems',
			['system_id', 'name', 'region_id', 'security_status', 'security_band'],
			sde.systems.map((s) => [s.systemId, s.name, s.regionId, s.securityStatus, s.securityBand])
		),
		...insert(
			'reactions',
			[
				'blueprint_type_id',
				'slug',
				'formula_name',
				'name',
				'product_type_id',
				'product_quantity',
				'reactor',
				'tier',
				'base_time_seconds',
				'max_runs',
				'required_skill_level'
			],
			dataset.reactions.map((r) => [
				r.blueprintTypeId,
				r.slug,
				r.formulaName,
				r.name,
				r.product.typeId,
				r.product.quantity,
				r.reactor,
				r.tier,
				r.baseTimeSeconds,
				r.maxRuns,
				r.requiredSkillLevel
			])
		),
		...insert(
			'reaction_materials',
			['blueprint_type_id', 'type_id', 'quantity'],
			dataset.reactions.flatMap((r) => r.materials.map((m) => [r.blueprintTypeId, m.typeId, m.quantity]))
		),
		...insert(
			'reprocess_materials',
			['type_id', 'material_type_id', 'quantity', 'quantity_min', 'quantity_max', 'portion_size'],
			Object.values(dataset.reprocess).flatMap((e) =>
				e.materials.map((m) => [e.typeId, m.typeId, m.quantity, m.quantityMin, m.quantityMax, e.portionSize])
			)
		),
		...insert(
			'material_blueprint_materials',
			['blueprint_type_id', 'type_id', 'quantity'],
			(dataset.manufacturing ?? [])
				.filter((b) => b.makes === 'material')
				.flatMap((b) => b.materials.map((m) => [b.blueprintTypeId, m.typeId, m.quantity]))
		),
		...insert(
			'sde_state',
			['id', 'build_number', 'release_date', 'imported_at', 'constants_json', 'warnings_json'],
			[[1, sde.build, sde.releaseDate, now, JSON.stringify(dataset.constants), JSON.stringify(sde.warnings)]]
		),
		...insert(
			'latest_prices',
			[
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
			],
			[
				...Object.entries(market.prices).map(([hubId, book]) => [hubId, book, 'esi'] as const),
				...Object.entries(market.structurePrices).map(
					([hubId, book]) => [hubId, book, 'esi_structure'] as const
				)
			].flatMap(([hubId, book, source]) =>
				Object.entries(book).map(([typeId, p]) => [
					hubId,
					Number(typeId),
					p.buy,
					p.sell,
					round2(p.buy * 0.99),
					round2(p.sell * 1.01),
					p.buyVolume,
					p.sellVolume,
					12,
					15,
					source,
					snapshotAt
				])
			)
		),
		...insert(
			'adjusted_prices',
			['type_id', 'adjusted_price', 'average_price', 'updated_at'],
			Object.entries(market.adjusted).map(([typeId, price]) => [Number(typeId), price, price, now])
		),
		...insert(
			'cost_indices',
			['system_id', 'reaction', 'manufacturing', 'updated_at'],
			SEED_COST_INDICES.map((c) => [c.systemId, c.reaction, c.reaction / 2, now])
		),
		...insert(
			'market_stats',
			[
				'region_id',
				'type_id',
				'avg_daily_volume_30d',
				'avg_daily_volume_7d',
				'avg_price_5d',
				'avg_price_30d',
				'last_date',
				'updated_at'
			],
			[...new Set(SEED_HUBS.map((h) => h.regionId))].flatMap((regionId) =>
				Object.entries(market.dailyVolume).map(([typeId, volume]) => [
					regionId,
					Number(typeId),
					volume,
					// The last week trades 80–120 % of the monthly average (deterministic per type).
					Math.round(volume * (0.8 + ((Number(typeId) * 37) % 41) / 100)),
					market.base[Number(typeId)],
					market.base[Number(typeId)],
					isoDate(today - DAY_MS),
					now
				])
			)
		),
		...insert(
			'job_runs',
			['run_id', 'kind', 'started_at', 'finished_at', 'status', 'detail_json'],
			[
				[`sde-${sde.build}`, 'sde', now, now, 'ok', '{"seed":true}'],
				[`prices-${snapshotAt}`, 'prices', snapshotAt, snapshotAt, 'ok', '{"seed":true}']
			]
		),
		...insert(
			'users',
			['user_id', 'created_at', 'last_seen_at'],
			SEED_USERS.map((u) => [u.userId, now, now])
		),
		...insert(
			'characters',
			[
				'character_id',
				'user_id',
				'name',
				'owner_hash',
				'scopes',
				'refresh_token_enc',
				'token_status',
				'last_refreshed_at',
				'corporation_id',
				'corporation_name',
				'created_at'
			],
			SEED_USERS.map((u) => [
				u.characterId,
				u.userId,
				u.name,
				`seed-${u.characterId}`,
				formatScopes(
					u.characterId === SEED_INVENTORY.characterId
						? [
								...STRUCTURE_SCOPES,
								...ESI_FEATURES.assets,
								...ESI_FEATURES.corp_assets,
								...ESI_FEATURES.tracking
							]
						: STRUCTURE_SCOPES
				),
				refreshTokenEnc,
				'ok',
				now,
				// The seed pilot is in Seed Corp (its corporation source), as the daily affiliations job would record.
				u.characterId === SEED_INVENTORY.characterId ? SEED_INVENTORY.corporation.corporationId : null,
				u.characterId === SEED_INVENTORY.characterId ? SEED_INVENTORY.corporation.name : null,
				now
			])
		),
		...insert(
			'market_hubs',
			[
				'hub_id',
				'name',
				'kind',
				'region_id',
				'system_id',
				'location_id',
				'fuzzwork_location_id',
				'visibility',
				'share_status',
				'enabled',
				'sort_order',
				'last_success_at',
				'created_at'
			],
			SEED_STRUCTURE_HUBS.map((h) => [
				`structure-${h.structureId}`,
				h.name,
				'structure',
				sde.systems.find((s) => s.systemId === h.systemId)!.regionId,
				h.systemId,
				h.structureId,
				h.structureId,
				'private',
				h.shareStatus,
				1,
				100,
				snapshotAt,
				now
			])
		),
		...insert(
			'structure_links',
			['user_id', 'structure_id', 'character_id', 'share_requested', 'access_status', 'created_at'],
			SEED_STRUCTURE_HUBS.map((h) => [
				h.userId,
				h.structureId,
				h.characterId,
				h.shareStatus === 'pending' ? 1 : 0,
				'ok',
				now
			])
		)
	);
	core.push(...inventorySql(sde, now), ...trackingSql(sde, market, now));

	// History rows are generated in SQL (recursive CTEs) to keep the seed file small. The jitter term is an
	// integer hash of (step, type) so every run produces the same values.
	const baseValues = Object.entries(market.base)
		.filter(([typeId]) => !formulaIds.has(Number(typeId)))
		.map(([typeId, price]) => `(${typeId}, ${price}, ${market.dailyVolume[Number(typeId)] ?? 1000})`)
		.join(', ');
	const hubValues = SEED_HUBS.map((h) => `(${q(h.hubId)}, ${h.factor})`).join(', ');
	const regionValues = [...new Map(SEED_HUBS.map((h) => [h.regionId, h.factor])).entries()]
		.map(([regionId, factor]) => `(${regionId}, ${factor})`)
		.join(', ');
	const jitter = (step: string) => `(0.95 + ((${step} * 7919 + b.type_id * 104729) % 1000) / 10000.0)`;
	const ctes = (steps: number) =>
		`WITH RECURSIVE steps(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM steps WHERE k < ${steps}),
	base(type_id, price, volume) AS (VALUES ${baseValues}),
	hubs(hub_id, f) AS (VALUES ${hubValues}),
	regions(region_id, f) AS (VALUES ${regionValues})`;
	const snapshots = SNAPSHOT_DAYS * SNAPSHOTS_PER_DAY;
	const history = [
		'DELETE FROM price_snapshots;',
		'DELETE FROM price_daily;',
		'DELETE FROM esi_market_history;',
		'DELETE FROM adjusted_price_daily;',
		'DELETE FROM cost_index_daily;',
		`${ctes(snapshots)}
INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_p5, sell_p5, buy_volume, sell_volume, source)
SELECT ${snapshotAt} - k * ${DAY_MS / SNAPSHOTS_PER_DAY}, h.hub_id, b.type_id,
	round(b.price * h.f * ${jitter('k')} * 0.9, 2), round(b.price * h.f * ${jitter('k')}, 2),
	round(b.price * h.f * ${jitter('k')} * 0.89, 2), round(b.price * h.f * ${jitter('k')} * 1.01, 2),
	b.volume, b.volume, 'esi'
FROM steps, base b, hubs h;`,
		`${ctes(SNAPSHOT_DAYS)}
INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, buy_close, sell_close, buy_low, buy_high, sell_low, sell_high, samples)
SELECT date(${q(isoDate(today))}, '-' || k || ' days'), h.hub_id, b.type_id,
	round(b.price * h.f * ${jitter('k')} * 0.9, 2), round(b.price * h.f * ${jitter('k')}, 2),
	round(b.price * h.f * ${jitter('k')} * 0.9, 2), round(b.price * h.f * ${jitter('k')}, 2),
	round(b.price * h.f * ${jitter('k')} * 0.88, 2), round(b.price * h.f * ${jitter('k')} * 0.92, 2),
	round(b.price * h.f * ${jitter('k')} * 0.98, 2), round(b.price * h.f * ${jitter('k')} * 1.02, 2),
	${SNAPSHOTS_PER_DAY}
FROM steps, base b, hubs h;`,
		`${ctes(ESI_HISTORY_DAYS)}
INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
SELECT r.region_id, b.type_id, date(${q(isoDate(today))}, '-' || k || ' days'),
	round(b.price * r.f * ${jitter('k')} * 0.95, 2), round(b.price * r.f * ${jitter('k')}, 2),
	round(b.price * r.f * ${jitter('k')} * 0.9, 2), b.volume, 100
FROM steps, base b, regions r;`,
		...insert(
			'adjusted_price_daily',
			['date', 'type_id', 'adjusted_price'],
			Array.from({ length: SNAPSHOT_DAYS }, (_, i) => isoDate(today - (i + 1) * DAY_MS)).flatMap((date) =>
				Object.entries(market.adjusted).map(([typeId, price]) => [date, Number(typeId), price])
			)
		),
		...insert(
			'cost_index_daily',
			['date', 'system_id', 'reaction'],
			Array.from({ length: SNAPSHOT_DAYS }, (_, i) => isoDate(today - (i + 1) * DAY_MS)).flatMap((date) =>
				SEED_COST_INDICES.map((c) => [date, c.systemId, c.reaction])
			)
		)
	];

	const snapshot = {
		snapshotAt,
		hubs: SEED_HUBS.map((h) => ({ hubId: h.hubId, name: h.name, kind: h.kind, regionId: h.regionId })),
		prices: Object.fromEntries(
			Object.entries(market.prices).map(([hubId, book]) => [
				hubId,
				Object.fromEntries(
					Object.entries(book).map(([typeId, p]) => [typeId, [p.buy, p.sell, p.buyVolume, p.sellVolume]])
				)
			])
		),
		adjusted: market.adjusted,
		costIndicesUpdatedAt: now,
		adjustedUpdatedAt: now
	};
	return {
		core: core.join('\n'),
		history: history.join('\n'),
		kv: { 'dataset:v1': JSON.stringify(dataset), 'market:v1': JSON.stringify(snapshot) }
	};
}

/** The SDE fixture with its industry data (`Dataset.industry`), as the SDE sync parses a build. */
export async function loadFixtureSde(path = FIXTURE_ZIP): Promise<SdeDataset> {
	const json = (name: string): unknown => JSON.parse(readFileSync(join(INDUSTRY_FIXTURES, name), 'utf8'));
	return parseSdeZip(new Blob([readFileSync(path)]).stream(), {
		industry: readIndustrySources(json('industrymodifiersources.json'), json('industrytargetfilters.json'))
	});
}

function wrangler(args: string[], persistTo: string) {
	const command = ['npx', 'wrangler', ...args, '-c', WEB_CONFIG, '--persist-to', persistTo]
		.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a))
		.join(' ');
	// Results of `d1 execute` are verbose JSON; only errors (stderr) are shown.
	execSync(command, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * Applies the migrations and replaces the seed rows and KV values in `persistTo`, then runs `extraCoreSql`
 * (statements a caller adds to the core database, e.g. the e2e server's own rows). Refuses the
 * developer's own state (`DEV_STATE`) before doing anything: the seed replaces reference tables,
 * prices and history there and breaks the real ESI data.
 */
export async function seedLocal(persistTo = PERSIST_TO, extraCoreSql: readonly string[] = []): Promise<void> {
	if (resolve(persistTo).toLowerCase() === resolve(DEV_STATE).toLowerCase()) {
		throw new Error(
			`Refusing to seed ${DEV_STATE}: it holds your real local data. Seed another directory (default ${PERSIST_TO}).`
		);
	}
	const sde = await loadFixtureSde();
	const refreshTokenEnc = await encryptToken(SEED_REFRESH_TOKEN, DEV_TOKEN_ENCRYPTION_KEY);
	const seed = buildSeedSql(sde, buildMarketFixture(sde), Date.now(), refreshTokenEnc);
	mkdirSync(OUT_DIR, { recursive: true });
	const files = {
		core: join(OUT_DIR, 'core.sql'),
		history: join(OUT_DIR, 'history.sql'),
		dataset: join(OUT_DIR, 'dataset.json'),
		market: join(OUT_DIR, 'market.json')
	};
	writeFileSync(files.core, [seed.core, ...extraCoreSql].join('\n'));
	writeFileSync(files.history, seed.history);
	writeFileSync(files.dataset, seed.kv['dataset:v1']);
	writeFileSync(files.market, seed.kv['market:v1']);
	wrangler(['d1', 'migrations', 'apply', 'DB', '--local'], persistTo);
	wrangler(['d1', 'migrations', 'apply', 'HISTORY_DB', '--local'], persistTo);
	wrangler(['d1', 'execute', 'DB', '--local', '--yes', '--file', files.core], persistTo);
	wrangler(['d1', 'execute', 'HISTORY_DB', '--local', '--yes', '--file', files.history], persistTo);
	wrangler(
		['kv', 'key', 'put', 'dataset:v1', '--binding', 'CACHE', '--local', '--path', files.dataset],
		persistTo
	);
	wrangler(
		['kv', 'key', 'put', 'market:v1', '--binding', 'CACHE', '--local', '--path', files.market],
		persistTo
	);
	console.log(
		`Seeded ${sde.dataset.reactions.length} reactions, ${sde.types.length} types into ${persistTo}, market at ${new Date().toISOString()}`
	);
}

if (import.meta.main) await seedLocal();
