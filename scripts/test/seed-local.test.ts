import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { STRUCTURE_SCOPES, decryptToken, encryptToken, hasFeature, parseJaniceCodes } from '@reactions/eve';
import type { SdeDataset } from '@reactions/sde';
import {
	DEV_STATE,
	DEV_TOKEN_ENCRYPTION_KEY,
	ESI_HISTORY_DAYS,
	SEED_HUBS,
	SEED_FACILITIES,
	SEED_REFRESH_TOKEN,
	SEED_INVENTORY,
	SEED_STRUCTURE_HUBS,
	SEED_TRACKING,
	SNAPSHOTS_PER_DAY,
	SNAPSHOT_DAYS,
	buildMarketFixture,
	buildSeedSql,
	seedLocal,
	loadFixtureSde,
	mulberry32,
	seedDailyPrice
} from '../seed-local.ts';
import { runLedger } from '@reactions/engine';
import {
	JOB_RESULT_COLUMNS,
	LEDGER_LOT_COLUMNS,
	LEDGER_PRICE_COLUMNS,
	LEDGER_USE_COLUMNS,
	facilitiesFromEve,
	ledgerResultRows,
	parseAccountSettings,
	parseTrackingSettings,
	referenceKey,
	referencePriceFn,
	toRunLedgerInput,
	type TrackedFacilityRow,
	type TrackedRows
} from '../../apps/updater/src/ledger-rows.ts';

const NOW = Date.UTC(2026, 9, 6, 12, 7);
const TOKEN = 'encrypted-dummy-token';

const migrations = fileURLToPath(new URL('../../packages/db/migrations/', import.meta.url));

function database(kind: 'core' | 'history', seedSql: string) {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync(migrations + kind)
		.filter((f) => f.endsWith('.sql'))
		.sort()) {
		for (const stmt of readFileSync(`${migrations}${kind}/${file}`, 'utf8').split(
			'--> statement-breakpoint'
		)) {
			if (stmt.trim()) db.exec(stmt);
		}
	}
	db.exec(seedSql);
	return db;
}

const count = (db: DatabaseSync, table: string) =>
	(db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

let sde: SdeDataset;
beforeAll(async () => {
	sde = await loadFixtureSde();
});

describe('seedLocal', () => {
	it('refuses the developer’s own state before writing anything', async () => {
		// Same folder written differently (Windows paths are case-insensitive): still refused, and no
		// wrangler command runs (it would take seconds; the rejection is immediate).
		await expect(seedLocal(DEV_STATE)).rejects.toThrow(/Refusing to seed/);
		await expect(seedLocal(`${DEV_STATE.toUpperCase()}/`)).rejects.toThrow(/Refusing to seed/);
	});
});

describe('mulberry32', () => {
	it('is deterministic per seed', () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		const values = [a(), a(), a()];
		expect([b(), b(), b()]).toEqual(values);
		expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
		expect(mulberry32(43)()).not.toBe(values[0]);
	});
});

describe('buildSeedSql', () => {
	it('produces identical output for the same seed and time', () => {
		const a = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		const b = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		expect(a).toEqual(b);
	});

	it('core SQL loads every reference table and price for every tracked type at every hub', () => {
		const market = buildMarketFixture(sde);
		const db = database('core', buildSeedSql(sde, market, NOW, TOKEN).core);
		expect(count(db, 'reactions')).toBe(119);
		expect(count(db, 'types')).toBe(307);
		expect(count(db, 'systems')).toBe(sde.systems.length);
		expect(count(db, 'regions')).toBe(sde.regions.length);
		expect(count(db, 'reaction_materials')).toBe(
			sde.dataset.reactions.reduce((a, r) => a + r.materials.length, 0)
		);
		expect(count(db, 'reprocess_materials')).toBe(
			Object.values(sde.dataset.reprocess).reduce((a, e) => a + e.materials.length, 0)
		);
		const priced = [...Object.values(market.prices), ...Object.values(market.structurePrices)].reduce(
			(a, book) => a + Object.keys(book).length,
			0
		);
		expect(count(db, 'latest_prices')).toBe(priced);
		expect(Object.keys(market.prices.jita)).toHaveLength(307);
		expect(count(db, 'adjusted_prices')).toBe(307);
		expect(db.prepare('SELECT system_id, reaction FROM cost_indices ORDER BY system_id').all()).toEqual([
			{ system_id: 30002647, reaction: 0.0412 },
			{ system_id: 30004604, reaction: 0.05 }
		]);
		expect(count(db, 'market_hubs')).toBe(SEED_HUBS.length + SEED_STRUCTURE_HUBS.length);
		expect(count(db, 'sde_state')).toBe(1);
	});

	it('history SQL generates snapshots, daily rows and 400 days of ESI history', () => {
		const market = buildMarketFixture(sde);
		const db = database('history', buildSeedSql(sde, market, NOW, TOKEN).history);
		const nonFormulaTypes = 307 - 119;
		const regions = new Set(SEED_HUBS.map((h) => h.regionId)).size;
		expect(count(db, 'price_snapshots')).toBe(
			SNAPSHOT_DAYS * SNAPSHOTS_PER_DAY * SEED_HUBS.length * nonFormulaTypes
		);
		expect(count(db, 'price_daily')).toBe(SNAPSHOT_DAYS * SEED_HUBS.length * nonFormulaTypes);
		expect(count(db, 'esi_market_history')).toBe(ESI_HISTORY_DAYS * regions * nonFormulaTypes);
		expect(count(db, 'adjusted_price_daily')).toBe(SNAPSHOT_DAYS * 307);
		const dates = db.prepare('SELECT min(date) AS lo, max(date) AS hi FROM price_daily').get() as Record<
			string,
			string
		>;
		expect(dates).toEqual({ lo: '2026-09-26', hi: '2026-10-05' });
		const esi = db.prepare('SELECT min(date) AS lo FROM esi_market_history').get() as { lo: string };
		expect(esi.lo).toBe('2025-09-01');
	});

	it('KV values hold the dataset and a market snapshot of public hubs', () => {
		const { kv } = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		expect(JSON.parse(kv['dataset:v1']).reactions).toHaveLength(119);
		const market = JSON.parse(kv['market:v1']);
		expect(market.snapshotAt).toBe(Date.UTC(2026, 9, 6, 12, 0));
		expect(market.hubs.map((h: { hubId: string }) => h.hubId)).toEqual(SEED_HUBS.map((h) => h.hubId));
		const [buy, sell] = market.prices.jita[16663];
		expect(buy).toBeLessThan(sell);
	});

	it('seeds two accounts with structure-market pilots, a private and a pending shared hub', () => {
		const db = database('core', buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN).core);
		const pilots = db
			.prepare('SELECT character_id, user_id, name, scopes, refresh_token_enc, token_status FROM characters')
			.all() as { scopes: string; character_id: number }[];
		expect(pilots.map((c) => ({ ...c, scopes: hasFeature(c.scopes, 'structures') }))).toEqual([
			{
				character_id: 90000001,
				user_id: 'seed-user',
				name: 'Seed Pilot',
				scopes: true,
				refresh_token_enc: TOKEN,
				token_status: 'ok'
			},
			{
				character_id: 90000002,
				user_id: 'seed-user-2',
				name: 'Seed Pilot Two',
				scopes: true,
				refresh_token_enc: TOKEN,
				token_status: 'ok'
			}
		]);
		const features = (scopes: string) =>
			(['structures', 'assets', 'corp_assets'] as const).map((f) => hasFeature(scopes, f));
		expect(features(pilots[0]!.scopes)).toEqual([true, true, true]);
		expect(features(pilots[1]!.scopes)).toEqual([true, false, false]);
		expect(pilots[1]!.scopes.split(' ').sort()).toEqual([...STRUCTURE_SCOPES].sort());
		expect(
			db
				.prepare(
					`SELECT h.hub_id, h.name, h.system_id, h.region_id, h.visibility, h.share_status, h.enabled,
						l.user_id, l.share_requested, (SELECT count(*) FROM latest_prices p WHERE p.hub_id = h.hub_id) AS prices
					FROM market_hubs h JOIN structure_links l ON l.structure_id = h.location_id ORDER BY h.name`
				)
				.all()
		).toEqual([
			{
				hub_id: 'structure-1044752365771',
				name: 'Seed Market',
				system_id: 30000144,
				region_id: 10000002,
				visibility: 'private',
				share_status: 'none',
				enabled: 1,
				user_id: 'seed-user',
				share_requested: 0,
				prices: 307
			},
			{
				hub_id: 'structure-1042508032148',
				name: 'Seed Shared Market',
				system_id: 30002187,
				region_id: 10000043,
				visibility: 'private',
				share_status: 'pending',
				enabled: 1,
				user_id: 'seed-user-2',
				share_requested: 1,
				prices: 307
			}
		]);
		const { kv } = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		expect(kv['market:v1']).not.toContain('structure-');
	});

	it('replaces the seed accounts on every run, including a dev login that took a seed character', () => {
		const { core } = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		const db = database('core', core);
		db.exec(`
			DELETE FROM characters WHERE character_id = 90000001;
			INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('dev-user', 1, 1);
			INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (90000001, 'dev-user', 'Dev', 'dev', 1);
			INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at) VALUES ('s', 'dev-user', 1, 9e12);
			INSERT INTO users (user_id, created_at, last_seen_at) VALUES ('other', 1, 1);
			INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (5, 'other', 'Other', 'o', 1);
			UPDATE market_hubs SET enabled = 0, sort_order = 9 WHERE hub_id = 'jita';
			UPDATE market_hubs SET visibility = 'public', share_status = 'approved' WHERE hub_id = 'structure-1042508032148';
		`);
		db.exec(core);
		const users = db.prepare('SELECT user_id FROM users ORDER BY user_id').all();
		expect(users).toEqual([{ user_id: 'other' }, { user_id: 'seed-user' }, { user_id: 'seed-user-2' }]);
		expect(count(db, 'characters')).toBe(3);
		expect(count(db, 'user_sessions')).toBe(0);
		expect(count(db, 'structure_links')).toBe(2);
		expect(count(db, 'market_hubs')).toBe(8);
		expect(count(db, 'inventory_sources')).toBe(2);
		expect(db.prepare("SELECT enabled, sort_order FROM market_hubs WHERE hub_id = 'jita'").get()).toEqual({
			enabled: 1,
			sort_order: 1
		});
		expect(
			db
				.prepare("SELECT visibility, share_status FROM market_hubs WHERE hub_id = 'structure-1042508032148'")
				.get()
		).toEqual({ visibility: 'private', share_status: 'pending' });
	});

	it('seeds a personal and a corporation inventory with selected places, idempotently', () => {
		const { core } = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		const db = database('core', core);
		const snapshot = () => ({
			sources: db
				.prepare(
					'SELECT user_id, character_id, kind, owner_id, owner_name, division_names_json, status FROM inventory_sources ORDER BY kind'
				)
				.all(),
			locations: db
				.prepare(
					'SELECT s.kind AS source, l.location_id, l.kind, l.name, l.system_id FROM inventory_locations l JOIN inventory_sources s USING (source_id) ORDER BY s.kind, l.location_id'
				)
				.all(),
			selected: db
				.prepare(
					'SELECT s.kind AS source, x.location_id, x.bucket FROM inventory_selection x JOIN inventory_sources s USING (source_id) ORDER BY s.kind, x.location_id, x.bucket'
				)
				.all(),
			items: db
				.prepare(
					`SELECT s.kind AS source, i.location_id, i.bucket, t.name, i.quantity FROM inventory_items i
					JOIN inventory_sources s USING (source_id) JOIN types t USING (type_id) ORDER BY s.kind, i.location_id, i.bucket, t.name`
				)
				.all() as { source: string; bucket: string; name: string; quantity: number }[],
			readers: db
				.prepare(
					'SELECT s.kind AS source, r.character_id FROM inventory_source_readers r JOIN inventory_sources s USING (source_id)'
				)
				.all()
		});
		const first = snapshot();
		const structureId = SEED_STRUCTURE_HUBS[0].structureId;
		expect(first.sources).toEqual([
			{
				user_id: 'seed-user',
				character_id: 90000001,
				kind: 'character',
				owner_id: 90000001,
				owner_name: 'Seed Pilot',
				division_names_json: null,
				status: 'ok'
			},
			{
				user_id: 'seed-user',
				character_id: 90000001,
				kind: 'corporation',
				owner_id: SEED_INVENTORY.corporation.corporationId,
				owner_name: 'Seed Corp',
				division_names_json: '{"1":"Moon goo","2":"Fuel"}',
				status: 'ok'
			}
		]);
		expect(first.readers).toEqual([{ source: 'corporation', character_id: 90000001 }]);
		expect(first.locations).toEqual([
			{
				source: 'character',
				location_id: 60003760,
				kind: 'station',
				name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
				system_id: 30000142
			},
			{
				source: 'character',
				location_id: structureId,
				kind: 'structure',
				name: 'Seed Market',
				system_id: 30000144
			},
			{
				source: 'corporation',
				location_id: 60003760,
				kind: 'station',
				name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
				system_id: 30000142
			}
		]);
		expect(first.selected).toEqual([
			{ source: 'character', location_id: 60003760, bucket: 'hangar' },
			{ source: 'character', location_id: structureId, bucket: 'hangar' },
			{ source: 'corporation', location_id: 60003760, bucket: 'div1' }
		]);
		const personal = first.items.filter((i) => i.source === 'character').map((i) => i.name);
		expect(personal).toEqual(
			expect.arrayContaining([
				'Titanium Chromide',
				'Silicon Diborite',
				'Oxygen Fuel Block',
				'Titanium',
				'Titanium Carbide Reaction Formula'
			])
		);
		const formula = 'Titanium Carbide Reaction Formula';
		expect(first.items.filter((i) => i.name === formula)).toEqual([
			{ source: 'character', location_id: structureId, bucket: 'hangar', name: formula, quantity: 2 },
			{ source: 'character', location_id: structureId, bucket: 'jobs', name: formula, quantity: 1 }
		]);
		expect(new Set(first.items.filter((i) => i.source === 'corporation').map((i) => i.bucket))).toEqual(
			new Set(['div1', 'div2'])
		);
		db.exec(core);
		expect(snapshot()).toEqual(first);
	});

	it('the dev key encrypts and decrypts the dummy refresh token', async () => {
		const encrypted = await encryptToken(SEED_REFRESH_TOKEN, DEV_TOKEN_ENCRYPTION_KEY);
		expect(await decryptToken(encrypted, DEV_TOKEN_ENCRYPTION_KEY)).toBe(SEED_REFRESH_TOKEN);
		expect(atob(DEV_TOKEN_ENCRYPTION_KEY)).toHaveLength(32);
	});

	it('seeds profit tracking for the pilot and the ledger of its Titanium Carbide chain, idempotently', () => {
		const { core } = buildSeedSql(sde, buildMarketFixture(sde), NOW, TOKEN);
		const db = database('core', core);
		const all = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
		const snapshot = () => ({
			connections: all(
				'SELECT kind, tracking_enabled, tracking_status, tracking_synced_at FROM inventory_sources ORDER BY kind'
			),
			streams: all('SELECT stream, status FROM tracking_streams ORDER BY stream'),
			counts: [
				'tracked_transactions',
				'tracked_journal',
				'tracked_orders',
				'tracked_contracts',
				'tracked_contract_items',
				'tracked_jobs',
				'manual_entries'
			].map((table) => count(db, table)),
			jobs: all(
				`SELECT r.job_id, t.name, j.runs, r.output_qty, r.used_qty, r.sold_qty, r.manufactured_qty, r.manufactured_value,
					r.unsold_qty, r.input_cost, r.job_cost, r.unit_cost, r.sales_net, r.realized_profit, r.flags_json
				FROM job_results r JOIN tracked_jobs j USING (user_id, job_id) JOIN types t ON t.type_id = r.output_type_id
				ORDER BY r.job_id`
			),
			manufacturing: all(
				`SELECT j.job_id, j.activity_id, j.blueprint_me, u.use_kind, u.quantity, u.unit_value
				FROM tracked_jobs j JOIN ledger_uses u ON u.user_id = j.user_id AND u.use_ref = 'job:' || j.job_id
				WHERE j.activity_id = 1`
			),
			manual: all(
				"SELECT type_id, quantity, remaining, unit_cost, origin_ref FROM ledger_lots WHERE origin = 'manual'"
			),
			prices: all(
				'SELECT ref, type_id, source_kind, needs_review, tax_source, broker_fee_source FROM ledger_prices ORDER BY ref, type_id'
			),
			state: all('SELECT user_id, rebuilt_at, dirty FROM ledger_state'),
			facilities: all(
				`SELECT f.facility_id, f.kind, f.type_id, f.rigs_json, COUNT(j.job_id) AS jobs FROM tracked_facilities f
				LEFT JOIN tracked_jobs j ON j.user_id = f.user_id AND j.facility_id = f.facility_id
				GROUP BY f.facility_id ORDER BY f.facility_id`
			)
		});
		const first = snapshot();
		expect(first.connections).toEqual([
			{ kind: 'character', tracking_enabled: 1, tracking_status: 'ok', tracking_synced_at: NOW },
			{ kind: 'corporation', tracking_enabled: 0, tracking_status: null, tracking_synced_at: null }
		]);
		expect(first.streams).toEqual(
			[...SEED_TRACKING.streams].sort().map((stream) => ({ stream, status: 'ok' }))
		);
		// The day-1 mixed contract adds a contract, two items and its contract_price journal row.
		expect(first.counts).toEqual([3, 10, 3, 3, 8, 4, 1]);
		// The refinery with its rig read from assets, the Raitaru without rigs read, a refused lookup.
		const { refinery, factory, unknown } = SEED_FACILITIES;
		expect(first.facilities).toEqual([
			{ facility_id: refinery.facilityId, kind: 'structure', type_id: 35836, rigs_json: '[46497]', jobs: 2 },
			{ facility_id: factory.facilityId, kind: 'structure', type_id: 35825, rigs_json: null, jobs: 1 },
			{ facility_id: unknown.facilityId, kind: 'unknown', type_id: null, rigs_json: null, jobs: 1 }
		]);
		const janice = db
			.prepare('SELECT title, janice_code, janice_json FROM tracked_contracts WHERE contract_id = ?')
			.get(SEED_TRACKING.contracts.janice) as { title: string; janice_code: string; janice_json: string };
		expect(parseJaniceCodes(janice.title)).toEqual([SEED_TRACKING.janiceCode]);
		expect(janice.janice_code).toBe(SEED_TRACKING.janiceCode);
		expect(JSON.parse(janice.janice_json).items).toHaveLength(3);

		const [chromide, diborite, carbide] = first.jobs as Record<string, number | string>[];
		const made = SEED_TRACKING.runs * 200;
		const used = 2928 - SEED_TRACKING.boughtUnits;
		expect(chromide).toMatchObject({
			name: 'Titanium Chromide',
			output_qty: made,
			used_qty: used,
			sold_qty: 0
		});
		expect(diborite).toMatchObject({
			name: 'Silicon Diborite',
			output_qty: made,
			used_qty: used,
			sold_qty: 0
		});
		// Spike S in the seed Raitaru: ME 10 and the Raitaru's 1 % role bonus (its rigs not read).
		const manufactured = 5346;
		expect(carbide).toMatchObject({
			name: 'Titanium Carbide',
			output_qty: SEED_TRACKING.runs * 10000,
			sold_qty: SEED_TRACKING.sale.sold,
			manufactured_qty: manufactured,
			unsold_qty: SEED_TRACKING.runs * 10000 - SEED_TRACKING.sale.sold - manufactured,
			used_qty: 0,
			flags_json: '[]'
		});
		const c = carbide as Record<string, number>;
		expect(c.realized_profit).toBeCloseTo(
			c.sales_net + c.manufactured_value - (c.sold_qty + c.manufactured_qty) * c.unit_cost,
			4
		);
		expect(c.unit_cost).toBeCloseTo((c.input_cost + c.job_cost) / c.output_qty, 9);
		// The manufacturing job took its Titanium Carbide at the day's Jita buy value.
		expect(first.manufacturing).toEqual([
			{
				job_id: SEED_TRACKING.manufacturing.jobId,
				activity_id: 1,
				blueprint_me: 10,
				use_kind: 'manufacturing',
				quantity: manufactured,
				unit_value: expect.any(Number)
			}
		]);
		const unitValue = Number(first.manufacturing[0]!.unit_value);
		expect(c.manufactured_value).toBeCloseTo(manufactured * unitValue, 4);
		expect(first.manual).toEqual([
			{
				type_id: 16671,
				quantity: SEED_TRACKING.manual.quantity,
				remaining: SEED_TRACKING.manual.quantity,
				unit_cost: SEED_TRACKING.manual.unitPrice,
				origin_ref: `manual:${SEED_TRACKING.manual.entryId}`
			}
		]);
		expect(first.prices).toEqual([
			...[4312, 16638, 16641].map((typeId) => ({
				ref: `contract:${SEED_TRACKING.contracts.janice}`,
				type_id: typeId,
				source_kind: 'janice',
				needs_review: 0,
				tax_source: null,
				broker_fee_source: null
			})),
			...[4312, 16635, 16636].map((typeId) => ({
				ref: `contract:${SEED_TRACKING.contracts.rule}`,
				type_id: typeId,
				source_kind: 'rule_match',
				needs_review: 0,
				tax_source: null,
				broker_fee_source: null
			})),
			// Platinum and the module of the mixed contract: the module is not tracked, nothing needs review.
			...[
				[SEED_TRACKING.mixed.moduleTypeId, 'untracked'],
				[16644, 'contract_mixed']
			].map(([typeId, kind]) => ({
				ref: `contract:${SEED_TRACKING.contracts.mixed}`,
				type_id: typeId,
				source_kind: kind,
				needs_review: 0,
				tax_source: null,
				broker_fee_source: null
			})),
			...[
				[16654, 'none'],
				[16658, 'none'],
				[16671, 'journal']
			].map(([typeId, tax], i) => ({
				ref: `transaction:${6100000001 + i}`,
				type_id: typeId,
				source_kind: 'market',
				needs_review: 0,
				tax_source: tax,
				broker_fee_source: 'journal'
			}))
		]);
		expect(first.state).toEqual([{ user_id: 'seed-user', rebuilt_at: NOW, dirty: 0 }]);
		expect(count(db, 'ledger_unallocated_fees')).toBe(0);

		db.exec(core);
		expect(snapshot()).toEqual(first);
	});

	it('the seeded ledger is what an updater rebuild computes from the seeded rows and history', () => {
		const market = buildMarketFixture(sde);
		const seed = buildSeedSql(sde, market, NOW, TOKEN);
		const core = database('core', seed.core);
		const history = database('history', seed.history);
		const all = <T>(db: DatabaseSync, sql: string) => db.prepare(sql).all() as T[];

		// The seed's copy of the price_daily arithmetic matches the rows its SQL wrote.
		const daily = all<{ type_id: number; date: string; buy_avg: number; sell_avg: number }>(
			history,
			"SELECT type_id, date, buy_avg, sell_avg FROM price_daily WHERE hub_id = 'jita'"
		);
		const today = Date.UTC(2026, 9, 6);
		for (const r of daily) {
			const k = (today - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000;
			expect(seedDailyPrice(market, 1, r.type_id, k)).toEqual({ buy: r.buy_avg, sell: r.sell_avg });
		}

		const rows: TrackedRows = {
			transactions: all(core, 'SELECT * FROM tracked_transactions ORDER BY transaction_id'),
			journal: all(core, 'SELECT * FROM tracked_journal ORDER BY ref_id'),
			orders: all(core, 'SELECT * FROM tracked_orders ORDER BY order_id'),
			contracts: all(core, 'SELECT * FROM tracked_contracts ORDER BY contract_id'),
			contractItems: all(core, 'SELECT * FROM tracked_contract_items ORDER BY contract_id, record_id'),
			jobs: all(core, 'SELECT * FROM tracked_jobs ORDER BY job_id'),
			corrections: [],
			manualEntries: all(core, 'SELECT * FROM manual_entries ORDER BY entry_id')
		};
		const prices = {
			daily: new Map(
				daily.map((r) => [referenceKey(r.type_id, r.date), { buy: r.buy_avg, sell: r.sell_avg }])
			),
			regional: new Map(),
			latest: new Map(
				all<{ type_id: number; buy_max: number; sell_min: number }>(
					core,
					"SELECT type_id, buy_max, sell_min FROM latest_prices WHERE hub_id = 'jita'"
				).map((p) => [p.type_id, { buy: p.buy_max, sell: p.sell_min }])
			)
		};

		const result = runLedger(
			toRunLedgerInput(rows, {
				dataset: sde.dataset,
				settings: parseAccountSettings(null),
				tracking: parseTrackingSettings(null),
				systemBands: new Map(
					all<{ system_id: number; security_band: string }>(
						core,
						'SELECT system_id, security_band FROM systems'
					).map((s) => [s.system_id, s.security_band])
				),
				facilities: facilitiesFromEve(
					all<TrackedFacilityRow>(core, 'SELECT * FROM tracked_facilities'),
					new Map(
						all<{ location_id: number; system_id: number }>(
							core,
							'SELECT location_id, system_id FROM inventory_locations'
						).map((l) => [l.location_id, l.system_id])
					),
					new Map(
						all<{ system_id: number; security_band: string }>(
							core,
							'SELECT system_id, security_band FROM systems'
						).map((s) => [s.system_id, s.security_band])
					)
				),
				characterIds: [SEED_INVENTORY.characterId],
				corporationIds: [SEED_INVENTORY.corporation.corporationId],
				ordersAvailable: all<{ source_id: number }>(
					core,
					"SELECT source_id FROM tracking_streams WHERE stream = 'orders' AND status = 'ok'"
				).map((s) => s.source_id),
				referencePrice: referencePriceFn({ name: 'Jita 4-4', basis: 'buy' }, prices),
				buyPrice: referencePriceFn({ name: 'Jita 4-4', basis: 'buy' }, prices),
				now: NOW
			})
		);
		const expected = ledgerResultRows(result);
		const values = (sql: string) => all<Record<string, unknown>>(core, sql).map((r) => Object.values(r));
		const columns = (list: readonly string[]) => list.join(', ');
		expect(values(`SELECT ${columns(LEDGER_LOT_COLUMNS)} FROM ledger_lots ORDER BY lot_id`)).toEqual(
			expected.lots
		);
		expect(values(`SELECT ${columns(LEDGER_USE_COLUMNS)} FROM ledger_uses ORDER BY rowid`)).toEqual(
			expected.uses
		);
		expect(values(`SELECT ${columns(JOB_RESULT_COLUMNS)} FROM job_results ORDER BY job_id`)).toEqual(
			expected.jobs
		);
		expect(values(`SELECT ${columns(LEDGER_PRICE_COLUMNS)} FROM ledger_prices ORDER BY rowid`)).toEqual(
			expected.prices
		);
		expect(expected.jobs).toHaveLength(3);
	});
});
