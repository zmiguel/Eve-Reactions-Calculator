/**
 * Seeds the local (miniflare) D1 databases and KV namespace shared by both workers with the SDE fixture,
 * a deterministic market (mulberry32(42)) and two seed accounts with structure markets.
 * Usage: `npm run seed:local` (= `node scripts/seed-local.ts`); the e2e server seeds its own
 * directory through `seedLocal(E2E_PERSIST_TO)`.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dataset, Reaction } from '@reactions/engine';
import { STRUCTURE_SCOPES, encryptToken, formatScopes } from '@reactions/eve';
import { parseSdeZip, type SdeDataset } from '@reactions/sde';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE_ZIP = join(ROOT, 'packages/sde/test/fixtures/sde-mini.zip');
/** Local state of `npm run dev` / `preview` (both workers). */
export const PERSIST_TO = join(ROOT, '.wrangler/state');
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
	427: [400, 6000], // moon materials
	711: [800, 6000], // gases
	1042: [300, 900], // planetary materials
	1136: [16000, 24000] // fuel blocks
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic market: raw prices from ranges, products priced from inputs × a 0.95–1.30 margin. */
export function buildMarketFixture(sde: SdeDataset, seed = 42): MarketFixture {
	const rng = mulberry32(seed);
	const { dataset } = sde;
	const formulaIds = new Set(dataset.reactions.map((r) => r.blueprintTypeId));
	const producer = new Map<number, Reaction>(dataset.reactions.map((r) => [r.product.typeId, r]));
	const base: Record<number, number> = {};
	const typeIds = sde.types.map((t) => t.typeId).sort((a, b) => a - b);
	for (const t of [...sde.types].sort((a, b) => a.typeId - b.typeId)) {
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
		base[typeId] = round2((cost / r.product.quantity) * (0.95 + rng() * 0.35));
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
		if (!formulaIds.has(typeId)) dailyVolume[typeId] = Math.round(5_000 + rng() * 5_000_000);
	}
	const structurePrices: MarketFixture['structurePrices'] = {};
	for (const hub of SEED_STRUCTURE_HUBS) {
		const book: Record<number, SeedPrice> = {};
		for (const typeId of typeIds) {
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

function insert(table: string, columns: string[], rows: (string | number | null)[][], chunk = 200): string[] {
	const out: string[] = [];
	for (let i = 0; i < rows.length; i += chunk) {
		const values = rows
			.slice(i, i + chunk)
			.map((r) => `(${r.map((v) => (typeof v === 'string' ? q(v) : n(v))).join(', ')})`)
			.join(',\n');
		out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`);
	}
	return out;
}

export interface SeedOutput {
	core: string;
	history: string;
	kv: { 'dataset:v1': string; 'market:v1': string };
}

/** Accounts the seed replaces: the seed users and whoever holds a seed character (e.g. a dev login). */
const SEED_ACCOUNT_IDS = `SELECT user_id FROM users WHERE user_id IN (${SEED_USERS.map((u) => q(u.userId)).join(', ')})
	UNION SELECT user_id FROM characters WHERE character_id IN (${SEED_USERS.map((u) => u.characterId).join(', ')})`;

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
		'DELETE FROM structure_links WHERE user_id NOT IN (SELECT user_id FROM users);',
		'DELETE FROM user_sessions WHERE user_id NOT IN (SELECT user_id FROM users);',
		'DELETE FROM characters WHERE user_id NOT IN (SELECT user_id FROM users);',
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
				'created_at'
			],
			SEED_USERS.map((u) => [
				u.characterId,
				u.userId,
				u.name,
				`seed-${u.characterId}`,
				formatScopes(STRUCTURE_SCOPES),
				refreshTokenEnc,
				'ok',
				now,
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

export async function loadFixtureSde(path = FIXTURE_ZIP): Promise<SdeDataset> {
	return parseSdeZip(new Blob([readFileSync(path)]).stream());
}

function wrangler(args: string[], persistTo: string) {
	const command = ['npx', 'wrangler', ...args, '-c', WEB_CONFIG, '--persist-to', persistTo]
		.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a))
		.join(' ');
	// Results of `d1 execute` are verbose JSON; only errors (stderr) are shown.
	execSync(command, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Applies the migrations and replaces the seed rows and KV values in `persistTo`. */
export async function seedLocal(persistTo = PERSIST_TO): Promise<void> {
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
	writeFileSync(files.core, seed.core);
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
