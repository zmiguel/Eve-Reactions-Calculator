import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { STRUCTURE_SCOPES, decryptToken, encryptToken, hasFeature } from '@reactions/eve';
import type { SdeDataset } from '@reactions/sde';
import {
	DEV_TOKEN_ENCRYPTION_KEY,
	ESI_HISTORY_DAYS,
	SEED_HUBS,
	SEED_REFRESH_TOKEN,
	SEED_STRUCTURE_HUBS,
	SNAPSHOTS_PER_DAY,
	SNAPSHOT_DAYS,
	buildMarketFixture,
	buildSeedSql,
	loadFixtureSde,
	mulberry32
} from '../seed-local.ts';

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
		expect(pilots[0]!.scopes.split(' ').sort()).toEqual([...STRUCTURE_SCOPES].sort());
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

	it('the dev key encrypts and decrypts the dummy refresh token', async () => {
		const encrypted = await encryptToken(SEED_REFRESH_TOKEN, DEV_TOKEN_ENCRYPTION_KEY);
		expect(await decryptToken(encrypted, DEV_TOKEN_ENCRYPTION_KEY)).toBe(SEED_REFRESH_TOKEN);
		expect(atob(DEV_TOKEN_ENCRYPTION_KEY)).toHaveLength(32);
	});
});
