import type { MarketSnapshot } from '@reactions/db';
import { DEFAULT_SETTINGS, type Settings } from '@reactions/engine';
import { parseSdeZip, type SdeDataset } from '@reactions/sde';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FakeD1, FakeEnv } from './fakes.ts';

const zipPath = fileURLToPath(
	new URL('../../../../packages/sde/test/fixtures/sde-mini.zip', import.meta.url)
);
let sdePromise: Promise<SdeDataset> | null = null;

/** The committed SDE fixture (119 reactions), parsed once per test file. */
export function loadSde(): Promise<SdeDataset> {
	sdePromise ??= parseSdeZip(new Blob([readFileSync(zipPath)]).stream());
	return sdePromise;
}

export const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

export function insertUser(
	db: FakeD1,
	user: { userId: string; settings?: Settings | null; lastSeenAt?: number },
	characters: { characterId: number; name: string }[] = []
) {
	db.sqlite
		.prepare('INSERT INTO users (user_id, created_at, last_seen_at, settings_json) VALUES (?, ?, ?, ?)')
		.run(user.userId, NOW, user.lastSeenAt ?? NOW, user.settings ? JSON.stringify(user.settings) : null);
	for (const c of characters) {
		db.sqlite
			.prepare(
				'INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (?, ?, ?, ?, ?)'
			)
			.run(c.characterId, user.userId, c.name, `hash-${c.characterId}`, NOW);
	}
}

export function insertStructureHub(
	db: FakeD1,
	hub: {
		structureId: number;
		name: string;
		visibility?: 'public' | 'private';
		shareStatus?: 'none' | 'pending' | 'approved' | 'rejected';
		enabled?: boolean;
		regionId?: number;
	}
) {
	db.sqlite
		.prepare(
			`INSERT INTO market_hubs (hub_id, name, kind, region_id, system_id, location_id, fuzzwork_location_id,
			visibility, share_status, enabled, sort_order, created_at)
			VALUES (?, ?, 'structure', ?, 30000144, ?, ?, ?, ?, ?, 100, ?)`
		)
		.run(
			`structure-${hub.structureId}`,
			hub.name,
			hub.regionId ?? 10000002,
			hub.structureId,
			hub.structureId,
			hub.visibility ?? 'private',
			hub.shareStatus ?? 'none',
			hub.enabled === false ? 0 : 1,
			NOW
		);
}

export function linkStructure(
	db: FakeD1,
	userId: string,
	structureId: number,
	characterId: number,
	shareRequested = false
) {
	db.sqlite
		.prepare(
			'INSERT INTO structure_links (user_id, structure_id, character_id, share_requested, created_at) VALUES (?, ?, ?, ?, ?)'
		)
		.run(userId, structureId, characterId, shareRequested ? 1 : 0, NOW);
}

export function insertLatestPrice(
	db: FakeD1,
	hubId: string,
	typeId: number,
	buy: number | null,
	sell: number | null,
	volumes: { buy: number; sell: number } = { buy: 1, sell: 1 }
) {
	db.sqlite
		.prepare(
			`INSERT INTO latest_prices (hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, buy_orders, sell_orders, source, observed_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'esi', ?)`
		)
		.run(hubId, typeId, buy, sell, volumes.buy, volumes.sell, NOW);
}

/** Inserts systems/cost indices used by the default settings (Ignoitton) and 671-ST. */
export function insertSystems(db: FakeD1) {
	db.sqlite.exec(`
		INSERT INTO systems VALUES (30002647, 'Ignoitton', 10000032, 0.4388, 'lowsec');
		INSERT INTO systems VALUES (30004604, '671-ST', 10000058, -0.2, 'nullsec');
		INSERT INTO systems VALUES (31000007, 'J105443', 11000001, -1, 'wormhole');
		INSERT INTO systems VALUES (30000142, 'Jita', 10000002, 0.95, 'highsec');
		INSERT INTO cost_indices VALUES (30002647, 0.0412, 0.02, ${NOW});
	`);
}

/** The unsuffixed cookies the v2 site wrote on every visit, holding its defaults. */
export const V2_DEFAULT_COOKIES: Record<string, string> = {
	settingsMode: 'single',
	partner: 'true',
	input: 'buy',
	inMarket: 'Jita',
	output: 'sell',
	outMarket: 'Jita',
	brokers: '3',
	sales: '3.6',
	skill: '5',
	facility: 'large',
	rigs: '2',
	space: 'nullsec',
	system: 'Ignoitton',
	indyTax: '1',
	sccTax: '4',
	duration: '10080',
	cycles: '50',
	costIndex: '0',
	prismaticite: '50',
	submit: ''
};

/** A market snapshot covering every type of `sde` at Jita (sell = 100 × typeId mod 997 + 1). */
export function marketFor(sde: SdeDataset, snapshotAt = NOW): MarketSnapshot {
	const prices: MarketSnapshot['prices'] = { jita: {} };
	const adjusted: Record<number, number> = {};
	for (const t of sde.types) {
		const sell = ((t.typeId * 100) % 997) + 1;
		prices.jita[t.typeId] = [sell * 0.9, sell, 1000, 1000];
		adjusted[t.typeId] = sell;
	}
	return {
		snapshotAt,
		hubs: [{ hubId: 'jita', name: 'Jita 4-4', kind: 'station', regionId: 10000002 }],
		prices,
		adjusted,
		costIndicesUpdatedAt: snapshotAt,
		adjustedUpdatedAt: snapshotAt
	};
}

/**
 * Fixture prices (deterministic, log-uniform 10 to 100,000 at Jita) at which Fermionic Condensates'
 * best chain uses unrefined routes, so its Full chain and Using unrefined numbers differ.
 */
export function routeMarket(sde: SdeDataset): MarketSnapshot {
	let state = 1;
	const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
	const market = marketFor(sde);
	for (const id of Object.keys(market.prices.jita)) {
		const price = 10 ** (1 + random() * 4);
		market.prices.jita[Number(id)] = [price * 0.9, price, 1e9, 1e9];
	}
	return market;
}

export async function putKv(env: FakeEnv, sde: SdeDataset, market: MarketSnapshot = marketFor(sde)) {
	await env.CACHE.put('dataset:v1', JSON.stringify(sde.dataset));
	await env.CACHE.put('market:v1', JSON.stringify(market));
}

export const defaults = (): Settings => structuredClone(DEFAULT_SETTINGS);
