import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { DATASET_KV_KEY } from '@reactions/db';
import { ESI_FEATURES, encryptToken } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackingJanice } from '../src/workflows/tracking-sync.ts';
import { installFetch, json, resetState } from './helpers.ts';
import type { RecordedCall } from './helpers.ts';

const CORP = 98000001;
const HOUR = 3_600_000;

/**
 * Relevant types: formula 46166, product 16663, materials 4312, 16643, 16647 (34 is not). Manufacturing
 * blueprint 12619 uses the product 16663; blueprint 4313 makes the material 4312 (Oxygen Fuel Block) from
 * 17887 and 9832, which are tracked too.
 */
const DATASET = {
	sdeBuild: 1,
	reactions: [
		{
			blueprintTypeId: 46166,
			product: { typeId: 16663, quantity: 200 },
			materials: [
				{ typeId: 4312, quantity: 5 },
				{ typeId: 16643, quantity: 100 },
				{ typeId: 16647, quantity: 100 }
			],
			tier: 'intermediate'
		}
	],
	manufacturing: [
		{
			blueprintTypeId: 4313,
			productTypeId: 4312,
			productQuantity: 40,
			makes: 'material',
			materials: [
				{ typeId: 17887, quantity: 450 },
				{ typeId: 9832, quantity: 9 }
			]
		},
		{
			blueprintTypeId: 12619,
			productTypeId: 12618,
			productQuantity: 5000,
			materials: [{ typeId: 16663, quantity: 150 }]
		}
	],
	types: {},
	reprocess: {}
};
const MFG_BLUEPRINT = 12619;
const FUEL_BLUEPRINT = 4313;

/** Raw ESI wallet transaction. */
function tx(id: number, typeId: number, isPersonal?: boolean) {
	return {
		transaction_id: id,
		date: '2026-10-12T10:00:00Z',
		type_id: typeId,
		quantity: 10,
		unit_price: 100,
		is_buy: true,
		client_id: 5000,
		location_id: 60003760,
		journal_ref_id: id + 1000,
		...(isPersonal === undefined ? {} : { is_personal: isPersonal })
	};
}

function journal(id: number, refType: string) {
	return { id, date: '2026-10-12T10:00:00Z', ref_type: refType, amount: -5, description: 'x' };
}

const STRUCTURE = 1035000000000;
const STATION = 60003760;

function job(
	jobId: number,
	activityId: number,
	status = 'delivered',
	blueprintTypeId = 46166,
	facilityId = STRUCTURE
) {
	return {
		job_id: jobId,
		installer_id: 1001,
		facility_id: facilityId,
		station_id: facilityId,
		location_id: facilityId,
		activity_id: activityId,
		blueprint_id: 9000 + jobId,
		blueprint_type_id: blueprintTypeId,
		product_type_id:
			blueprintTypeId === MFG_BLUEPRINT ? 12618 : blueprintTypeId === FUEL_BLUEPRINT ? 4312 : 16663,
		output_location_id: 1035000000000,
		runs: 10,
		cost: 1234.5,
		status,
		duration: 3600,
		start_date: '2026-10-12T08:00:00Z',
		end_date: '2026-10-12T09:00:00Z'
	};
}

function marketOrder(orderId: number, typeId: number, extra: Record<string, unknown> = {}) {
	return {
		order_id: orderId,
		type_id: typeId,
		is_buy_order: false,
		price: 200,
		volume_total: 10,
		volume_remain: 5,
		issued: '2026-10-12T07:00:00Z',
		location_id: 60003760,
		region_id: 10000002,
		duration: 90,
		range: 'region',
		...extra
	};
}

function contract(contractId: number, type: string, status: string, title = '') {
	return {
		contract_id: contractId,
		type,
		status,
		issuer_id: 1001,
		issuer_corporation_id: CORP,
		acceptor_id: 7777,
		assignee_id: 7777,
		for_corporation: false,
		availability: 'personal',
		price: 1000,
		reward: 0,
		title,
		date_issued: '2026-10-11T07:00:00Z',
		date_completed: '2026-10-11T09:00:00Z',
		date_expired: '2026-10-25T07:00:00Z'
	};
}

/** Raw ESI blueprint row. */
function blueprint(itemId: number, me: number) {
	return {
		item_id: itemId,
		type_id: MFG_BLUEPRINT,
		location_id: 1035000000000,
		location_flag: 'Hangar',
		material_efficiency: me,
		time_efficiency: 20,
		runs: -1,
		quantity: -1
	};
}

interface EveState {
	/** Wallet transactions newest first; served two per call below `from_id`. */
	transactions: Record<string, unknown>[];
	journal: Record<string, unknown>[];
	jobs: Record<string, unknown>[];
	orders: Record<string, unknown>[];
	history: Record<string, unknown>[];
	contracts: Record<string, unknown>[];
	items: Record<number, Record<string, unknown>[]>;
	/** Blueprint pages (`X-Pages` = their count). */
	blueprints: Record<string, unknown>[][];
	/** `/universe/structures/{id}` answers; any other structure is 404. */
	structures: Record<number, Record<string, unknown>>;
	/** Paths (regex source) answering 403. */
	forbidden: RegExp[];
	expires: number;
	/** `Expires` of the paths matching a pattern instead of `expires`. */
	expiresByPath?: [RegExp, number][];
	/** `X-Pages` of the wallet journal (every page answers `journal`); 1 when absent. */
	journalPages?: number;
}

function emptyState(): EveState {
	return {
		transactions: [],
		journal: [],
		jobs: [],
		orders: [],
		history: [],
		contracts: [],
		items: {},
		blueprints: [[]],
		structures: {},
		forbidden: [],
		expires: Date.now() + HOUR
	};
}

/** Fake SSO (access token `at-<characterId>`) + ESI answering from `state`. */
function installEve(state: EveState): RecordedCall[] {
	return installFetch((url, call) => {
		if (url.hostname === 'login.eveonline.com') {
			const refresh = new URLSearchParams(call.body ?? '').get('refresh_token') ?? '';
			return json({ access_token: `at-${refresh.slice(3)}`, refresh_token: refresh, expires_in: 1199 });
		}
		const path = url.pathname;
		const expires = state.expiresByPath?.find(([pattern]) => pattern.test(path))?.[1] ?? state.expires;
		const headers = { Expires: new Date(expires).toUTCString(), 'X-Pages': '1' };
		const structure = /^\/universe\/structures\/(\d+)$/.exec(path);
		if (structure) {
			if (state.forbidden.some((r) => r.test(path))) return json({ error: 'Forbidden' }, headers, 403);
			const found = state.structures[Number(structure[1])];
			return found ? json(found, headers) : json({ error: 'not found' }, headers, 404);
		}
		const station = /^\/universe\/stations\/(\d+)$/.exec(path);
		if (station) return json({ name: `Station ${station[1]}`, system_id: 30000142, type_id: 1529 }, headers);
		if (state.forbidden.some((r) => r.test(path))) return json({ error: 'Forbidden' }, {}, 403);
		if (path === '/characters/affiliation')
			return json(
				(JSON.parse(call.body!) as number[]).map((id) => ({ character_id: id, corporation_id: CORP })),
				headers
			);
		if (/\/wallets?(\/\d+)?\/transactions$/.test(path)) {
			const from = url.searchParams.get('from_id');
			const rows = state.transactions.filter(
				(t) => from === null || (t.transaction_id as number) <= Number(from)
			);
			return json(rows.slice(0, 2), headers);
		}
		if (/\/wallets?(\/\d+)?\/journal$/.test(path))
			return json(state.journal, { ...headers, 'X-Pages': String(state.journalPages ?? 1) });
		if (/\/industry\/jobs$/.test(path)) return json(state.jobs, headers);
		if (/\/orders\/history$/.test(path)) return json(state.history, headers);
		if (/\/orders$/.test(path)) return json(state.orders, headers);
		const items = /\/contracts\/(\d+)\/items$/.exec(path);
		if (items) return json(state.items[Number(items[1])] ?? [], headers);
		if (/\/contracts$/.test(path)) return json(state.contracts, headers);
		if (/\/blueprints$/.test(path)) {
			const page = Number(url.searchParams.get('page') ?? '1');
			return json(state.blueprints[page - 1] ?? [], {
				...headers,
				'X-Pages': String(state.blueprints.length)
			});
		}
		if (path === `/corporations/${CORP}/divisions`)
			return json({ hangar: [], wallet: [{ division: 1 }, { division: 2, name: 'Industry' }] }, headers);
		return json({ error: 'unexpected' }, {}, 500);
	});
}

const esiCalls = (calls: RecordedCall[], pattern = /./) =>
	calls
		.filter((c) => c.url.startsWith('https://esi.evetech.net/'))
		.map((c) => new URL(c.url))
		.filter((u) => pattern.test(u.pathname))
		.map((u) => u.pathname + u.search);

async function seedConnection(
	sourceId: number,
	userId: string,
	kind: 'character' | 'corporation',
	values: { walletDivisions?: number[] } = {}
) {
	const characterId = 1000 + sourceId;
	const scopes = (kind === 'corporation' ? ESI_FEATURES.corp_tracking : ESI_FEATURES.tracking).join(' ');
	const encrypted = await encryptToken(`rt-${characterId}`, env.TOKEN_ENCRYPTION_KEY);
	await env.DB.batch([
		env.DB.prepare('INSERT OR IGNORE INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, ?)').bind(
			userId,
			Date.now()
		),
		env.DB.prepare(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, scopes, refresh_token_enc, token_status, created_at)
			VALUES (?, ?, 'Pilot', 'hash', ?, ?, 'ok', 1)`
		).bind(characterId, userId, scopes, encrypted),
		env.DB.prepare(
			`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, status,
				tracking_enabled, wallet_divisions_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 'ok', 1, ?, 1)`
		).bind(
			sourceId,
			userId,
			characterId,
			kind,
			kind === 'corporation' ? CORP : characterId,
			kind === 'corporation' ? 'Reaction Corp' : 'Pilot',
			values.walletDivisions ? JSON.stringify(values.walletDivisions) : null
		)
	]);
	if (kind === 'corporation')
		await env.DB.prepare(
			'INSERT INTO inventory_source_readers (source_id, character_id, created_at) VALUES (?, ?, 1)'
		)
			.bind(sourceId, characterId)
			.run();
}

async function runSync(id: string, sourceId: number): Promise<unknown> {
	await using instance = await introspectWorkflowInstance(env.TRACKING_SYNC, id);
	await instance.modify(async (m) => m.disableRetryDelays());
	await env.TRACKING_SYNC.create({ id, params: { sourceId, trigger: 'manual' } });
	await instance.waitForStatus('complete');
	return await instance.getOutput();
}

async function rows(sql: string, ...binds: unknown[]) {
	const { results } = await env.DB.prepare(sql)
		.bind(...binds)
		.all();
	return results;
}

const connection = (sourceId: number) =>
	env.DB.prepare(
		'SELECT tracking_status, tracking_last_error, tracking_synced_at, wallet_names_json FROM inventory_sources WHERE source_id = ?'
	)
		.bind(sourceId)
		.first();

/** The connection's stream rows, without the rows that only keep a lookup's `Expires`. */
const streams = (sourceId: number) =>
	rows(
		`SELECT stream, status, cursor, last_error FROM tracking_streams
		WHERE source_id = ? AND stream NOT IN ('divisions', 'affiliations') ORDER BY stream`,
		sourceId
	);

function personalState(): EveState {
	return {
		...emptyState(),
		transactions: [tx(105, 4312, true), tx(104, 34, true), tx(103, 16643, false), tx(102, 16647, true)],
		journal: [journal(9, 'market_transaction'), journal(8, 'player_donation'), journal(7, 'brokers_fee')],
		jobs: [job(1, 9), job(2, 1)],
		orders: [marketOrder(501, 4312, { is_corporation: false })],
		history: [
			marketOrder(502, 16643, { is_corporation: true, state: 'expired' }),
			marketOrder(503, 16647, { is_corporation: false, state: 'expired' })
		],
		contracts: [
			contract(701, 'item_exchange', 'finished', 'see https://janice.e-351.com/a/AbC123'),
			contract(702, 'courier', 'finished'),
			contract(703, 'item_exchange', 'outstanding')
		],
		items: { 701: [{ record_id: 1, type_id: 4312, quantity: 10, is_included: true, is_singleton: false }] }
	};
}

describe('TrackingSyncWorkflow', () => {
	beforeEach(async () => {
		await resetState();
		await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(DATASET));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('first personal sync stores relevant personal rows only, then rebuilds the ledger', async () => {
		await seedConnection(1, 'u1', 'character');
		const calls = installEve(personalState());

		const output = await runSync('tracking-1-1', 1);

		expect(output).toMatchObject({ ok: true, status: 'ok', ledgerRebuilt: true });
		expect(
			await rows(
				'SELECT transaction_id, division, is_personal FROM tracked_transactions ORDER BY transaction_id'
			)
		).toEqual([
			{ transaction_id: 102, division: null, is_personal: 1 },
			{ transaction_id: 105, division: null, is_personal: 1 }
		]);
		expect(await rows('SELECT ref_id, ref_type FROM tracked_journal ORDER BY ref_id')).toEqual([
			{ ref_id: 7, ref_type: 'brokers_fee' },
			{ ref_id: 9, ref_type: 'market_transaction' }
		]);
		expect(await rows('SELECT job_id, status, cost, user_id FROM tracked_jobs')).toEqual([
			{ job_id: 1, status: 'delivered', cost: 1234.5, user_id: 'u1' }
		]);
		expect(await rows('SELECT order_id, state, division FROM tracked_orders ORDER BY order_id')).toEqual([
			{ order_id: 501, state: 'open', division: null },
			{ order_id: 503, state: 'expired', division: null }
		]);
		expect(await rows('SELECT contract_id, janice_code, janice_json FROM tracked_contracts')).toEqual([
			{ contract_id: 701, janice_code: 'AbC123', janice_json: null }
		]);
		expect(
			await rows('SELECT contract_id, record_id, type_id, is_included FROM tracked_contract_items')
		).toEqual([{ contract_id: 701, record_id: 1, type_id: 4312, is_included: 1 }]);
		expect(await streams(1)).toEqual([
			{ stream: 'contracts', status: 'ok', cursor: null, last_error: null },
			{ stream: 'jobs', status: 'ok', cursor: null, last_error: null },
			{ stream: 'journal', status: 'ok', cursor: 9, last_error: null },
			{ stream: 'orders', status: 'ok', cursor: null, last_error: null },
			{ stream: 'transactions', status: 'ok', cursor: 105, last_error: null }
		]);
		// The transaction walk went to the end: 105/104, 103/102, then nothing.
		expect(esiCalls(calls, /transactions$/)).toEqual([
			'/characters/1001/wallet/transactions',
			'/characters/1001/wallet/transactions?from_id=103',
			'/characters/1001/wallet/transactions?from_id=101'
		]);
		expect(calls.some((c) => c.url.includes('janice.e-351.com'))).toBe(false);
		// No manufacturing job waits for its blueprint: blueprints are not requested, no stream row.
		expect(esiCalls(calls, /blueprints$/)).toEqual([]);
		const state = await connection(1);
		expect(state).toMatchObject({ tracking_status: 'ok', tracking_last_error: null });
		expect(state!.tracking_synced_at).toBeTypeOf('number');
		const ledger = await env.DB.prepare('SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?')
			.bind('u1')
			.first<{ rebuilt_at: number | null; dirty: number }>();
		expect(ledger?.rebuilt_at).toBeTypeOf('number');
		expect(ledger?.dirty).toBe(0);
	});

	it('makes no ESI request while every stream is fresh; after Expires the walk stops at the cursor', async () => {
		await seedConnection(1, 'u1', 'character');
		const state = personalState();
		installEve(state);
		await runSync('tracking-1-1', 1);

		const second = installEve(state);
		expect(await runSync('tracking-1-2', 1)).toMatchObject({ ok: false, status: 'fresh' });
		expect(second).toEqual([]);
		expect(await connection(1)).toMatchObject({ tracking_status: 'ok' });

		await env.DB.prepare('UPDATE tracking_streams SET expires_at = ? WHERE source_id = 1')
			.bind(Date.now() - 1)
			.run();
		state.transactions = [tx(107, 4312, true), tx(106, 16663, true), ...state.transactions];
		const third = installEve(state);
		await runSync('tracking-1-3', 1);

		expect(esiCalls(third, /transactions$/)).toEqual([
			'/characters/1001/wallet/transactions',
			'/characters/1001/wallet/transactions?from_id=105'
		]);
		expect(await rows('SELECT transaction_id FROM tracked_transactions ORDER BY transaction_id')).toEqual([
			{ transaction_id: 102 },
			{ transaction_id: 105 },
			{ transaction_id: 106 },
			{ transaction_id: 107 }
		]);
		expect(
			await rows("SELECT cursor FROM tracking_streams WHERE source_id = 1 AND stream = 'transactions'")
		).toEqual([{ cursor: 107 }]);
		// Contract items were fetched once across the syncs.
		expect(esiCalls(third, /items$/)).toEqual([]);
	});

	/** `Expires` as stored (the header has whole seconds). */
	const storedExpiry = (ms: number) => Math.floor(ms / 1000) * 1000;
	const expiryOf = async (sourceId: number, stream: string) =>
		(
			await env.DB.prepare('SELECT expires_at FROM tracking_streams WHERE source_id = ? AND stream = ?')
				.bind(sourceId, stream)
				.first<{ expires_at: number | null }>()
		)?.expires_at;

	it('streams cut short keep their cursor and Expires: nothing is asked again before it', async () => {
		await seedConnection(1, 'u1', 'character');
		const state = personalState();
		// 120 rows at two per call: the 50-call cap stops the walk before the end.
		state.transactions = Array.from({ length: 120 }, (_, i) => tx(1000 - i, 4312, true));
		// 60 journal pages: the 50-page cap stops the walk.
		state.journalPages = 60;
		// 51 finished item exchanges: 50 get their items, the last one waits.
		state.contracts = Array.from({ length: 51 }, (_, i) => contract(800 + i, 'item_exchange', 'finished'));
		const calls = installEve(state);

		expect(await runSync('tracking-1-1', 1)).toMatchObject({ ok: true, status: 'ok' });

		expect(esiCalls(calls, /transactions$/)).toHaveLength(50);
		expect(esiCalls(calls, /journal$/)).toHaveLength(50);
		expect(esiCalls(calls, /items$/)).toHaveLength(50);
		expect(
			await rows(
				"SELECT stream, cursor, expires_at, status FROM tracking_streams WHERE source_id = 1 AND stream IN ('transactions', 'journal', 'contracts') ORDER BY stream"
			)
		).toEqual([
			{ stream: 'contracts', cursor: null, expires_at: storedExpiry(state.expires), status: 'ok' },
			{ stream: 'journal', cursor: null, expires_at: storedExpiry(state.expires), status: 'ok' },
			{ stream: 'transactions', cursor: null, expires_at: storedExpiry(state.expires), status: 'ok' }
		]);
		expect(await rows('SELECT COUNT(*) AS n FROM tracked_transactions')).toEqual([{ n: 100 }]);

		const fresh = installEve(state);
		expect(await runSync('tracking-1-2', 1)).toMatchObject({ ok: false, status: 'fresh' });
		expect(fresh).toEqual([]);

		await env.DB.prepare('UPDATE tracking_streams SET expires_at = 0 WHERE source_id = 1').run();
		const later = installEve(state);
		await runSync('tracking-1-3', 1);
		expect(esiCalls(later, /items$/)).toEqual(['/characters/1001/contracts/850/items']);
		expect(esiCalls(later, /transactions$/)[0]).toBe('/characters/1001/wallet/transactions');
	});

	it('orders keep the later Expires of open orders and order history', async () => {
		await seedConnection(1, 'u1', 'character');
		const state = personalState();
		const history = state.expires + HOUR;
		state.expiresByPath = [[/\/orders\/history$/, history]];
		installEve(state);

		await runSync('tracking-1-1', 1);

		expect(await expiryOf(1, 'orders')).toBe(storedExpiry(history));
		expect(await expiryOf(1, 'jobs')).toBe(storedExpiry(state.expires));
	});

	it('corporation: wallet division names and reader affiliations are not asked again before their Expires', async () => {
		await seedConnection(2, 'u1', 'corporation', { walletDivisions: [1] });
		const state: EveState = { ...emptyState(), transactions: [tx(301, 4312)] };
		const once = /^\/(characters\/affiliation|corporations\/\d+\/divisions)$/;
		const first = installEve(state);
		expect(await runSync('tracking-2-1', 2)).toMatchObject({ ok: true, status: 'ok' });
		expect(esiCalls(first, once)).toEqual(['/characters/affiliation', `/corporations/${CORP}/divisions`]);
		expect(await expiryOf(2, 'divisions')).toBe(storedExpiry(state.expires));
		expect(await expiryOf(2, 'affiliations')).toBe(storedExpiry(state.expires));

		// The streams expired, the two lookups did not: the stored corporation still picks the reader.
		await env.DB.prepare(
			"UPDATE tracking_streams SET expires_at = 0 WHERE source_id = 2 AND stream NOT IN ('divisions', 'affiliations')"
		).run();
		const second = installEve(state);
		expect(await runSync('tracking-2-2', 2)).toMatchObject({ ok: true, status: 'ok' });
		expect(esiCalls(second, once)).toEqual([]);
		expect(esiCalls(second, /transactions$/)).toEqual([`/corporations/${CORP}/wallets/1/transactions`]);
		expect(await connection(2)).toMatchObject({ wallet_names_json: '{"2":"Industry"}' });

		await env.DB.prepare('UPDATE tracking_streams SET expires_at = 0 WHERE source_id = 2').run();
		const third = installEve(state);
		await runSync('tracking-2-3', 2);
		expect(esiCalls(third, once)).toEqual(['/characters/affiliation', `/corporations/${CORP}/divisions`]);
	});

	it('fetches contract items once across two syncs', async () => {
		await seedConnection(1, 'u1', 'character');
		const state = personalState();
		const first = installEve(state);
		await runSync('tracking-1-1', 1);
		await env.DB.prepare('UPDATE tracking_streams SET expires_at = 0 WHERE source_id = 1').run();
		const second = installEve(state);
		await runSync('tracking-1-2', 1);

		expect(esiCalls(first, /items$/)).toEqual(['/characters/1001/contracts/701/items']);
		expect(esiCalls(second, /contracts/)).toEqual(['/characters/1001/contracts?page=1']);
	});

	it('corporation: a wallet division 403 denies that stream only; jobs 403 names Factory Manager', async () => {
		await seedConnection(2, 'u1', 'corporation', { walletDivisions: [1, 2] });
		const state: EveState = {
			...emptyState(),
			transactions: [tx(301, 4312)],
			journal: [journal(31, 'brokers_fee')],
			orders: [marketOrder(601, 4312, { wallet_division: 2 })],
			forbidden: [/\/wallets\/2\//, /\/industry\/jobs$/]
		};
		installEve(state);

		expect(await runSync('tracking-2-1', 2)).toMatchObject({ ok: true, status: 'ok' });

		expect(await streams(2)).toEqual([
			{ stream: 'contracts', status: 'ok', cursor: null, last_error: null },
			{ stream: 'jobs', status: 'denied', cursor: null, last_error: 'Pilot needs the Factory Manager role' },
			{ stream: 'journal:1', status: 'ok', cursor: 31, last_error: null },
			{
				stream: 'journal:2',
				status: 'denied',
				cursor: null,
				last_error: 'Pilot needs the Accountant or Junior Accountant role'
			},
			{ stream: 'orders', status: 'ok', cursor: null, last_error: null },
			{ stream: 'transactions:1', status: 'ok', cursor: 301, last_error: null },
			{
				stream: 'transactions:2',
				status: 'denied',
				cursor: null,
				last_error: 'Pilot needs the Accountant or Junior Accountant role'
			}
		]);
		expect(await rows('SELECT transaction_id, division FROM tracked_transactions')).toEqual([
			{ transaction_id: 301, division: 1 }
		]);
		expect(await rows('SELECT order_id, division FROM tracked_orders')).toEqual([
			{ order_id: 601, division: 2 }
		]);
		expect(await connection(2)).toMatchObject({
			tracking_status: 'ok',
			wallet_names_json: '{"2":"Industry"}'
		});
	});

	it("leaves another user's connection and rows untouched", async () => {
		await seedConnection(1, 'u1', 'character');
		await seedConnection(9, 'u2', 'character');
		await env.DB.prepare(
			`INSERT INTO tracked_transactions (user_id, transaction_id, source_id, division, date, type_id, quantity,
				unit_price, is_buy, client_id, location_id, journal_ref_id, is_personal)
			VALUES ('u2', 105, 9, NULL, 1, 4312, 1, 5, 0, 1, 1, 1, 1)`
		).run();
		installEve(personalState());

		await runSync('tracking-1-1', 1);

		expect(
			await rows(
				"SELECT transaction_id, unit_price, source_id FROM tracked_transactions WHERE user_id = 'u2'"
			)
		).toEqual([{ transaction_id: 105, unit_price: 5, source_id: 9 }]);
		expect(
			await rows("SELECT transaction_id FROM tracked_transactions WHERE user_id = 'u1' ORDER BY 1")
		).toEqual([{ transaction_id: 102 }, { transaction_id: 105 }]);
		expect(await streams(9)).toEqual([]);
		expect(await connection(9)).toMatchObject({ tracking_status: null, tracking_synced_at: null });
	});

	describe('job facilities', () => {
		const facilities = () =>
			rows(
				'SELECT facility_id, kind, name, system_id, type_id, next_check_at FROM tracked_facilities ORDER BY facility_id'
			);
		const lookups = (calls: RecordedCall[]) => esiCalls(calls, /^\/universe\/(structures|stations)\//);
		const expire = () =>
			env.DB.prepare('UPDATE tracking_streams SET expires_at = ? WHERE source_id = 1')
				.bind(Date.now() - 1)
				.run();

		it('stores structures and stations of the jobs and does not look them up again before next_check_at', async () => {
			await seedConnection(1, 'u1', 'character');
			const state: EveState = {
				...emptyState(),
				jobs: [job(1, 9), job(2, 9, 'delivered', 46166, STATION)],
				structures: {
					[STRUCTURE]: { name: 'Refinery', solar_system_id: 30004604, owner_id: 98000002, type_id: 35836 }
				}
			};
			const first = installEve(state);
			const before = Date.now();
			await runSync('tracking-1-1', 1);

			expect(lookups(first).sort()).toEqual([
				`/universe/stations/${STATION}`,
				`/universe/structures/${STRUCTURE}`
			]);
			const stored = await facilities();
			expect(stored).toEqual([
				expect.objectContaining({
					facility_id: STATION,
					kind: 'station',
					name: `Station ${STATION}`,
					system_id: 30000142,
					type_id: 1529
				}),
				expect.objectContaining({
					facility_id: STRUCTURE,
					kind: 'structure',
					name: 'Refinery',
					system_id: 30004604,
					type_id: 35836
				})
			]);
			for (const row of stored) expect(row.next_check_at).toBeGreaterThanOrEqual(before + 30 * 24 * HOUR);

			await expire();
			const second = installEve(state);
			await runSync('tracking-1-2', 1);
			expect(lookups(second)).toEqual([]);
		});

		it('a refused lookup is unknown, keeps what was found before and waits for Expires', async () => {
			await seedConnection(1, 'u1', 'character');
			await env.DB.prepare(
				`INSERT INTO tracked_facilities (user_id, facility_id, kind, name, system_id, type_id, rigs_json, next_check_at)
				VALUES ('u1', ?, 'structure', 'Refinery', 30004604, 35836, '[46497]', 1)`
			)
				.bind(STRUCTURE)
				.run();
			const state: EveState = {
				...emptyState(),
				jobs: [job(1, 9)],
				forbidden: [/^\/universe\/structures\//],
				expires: Date.now() + 3 * 24 * HOUR
			};
			const first = installEve(state);
			await runSync('tracking-1-1', 1);

			expect(lookups(first)).toEqual([`/universe/structures/${STRUCTURE}`]);
			const [row] = await rows('SELECT * FROM tracked_facilities');
			expect(row).toMatchObject({
				kind: 'unknown',
				name: 'Refinery',
				system_id: 30004604,
				type_id: 35836,
				rigs_json: '[46497]'
			});
			expect(row!.next_check_at).toBeGreaterThanOrEqual(Math.floor(state.expires / 1000) * 1000);

			// Due again (as if Expires passed): one more refusal doubles the wait.
			await env.DB.prepare('UPDATE tracked_facilities SET checked_at = ?, next_check_at = ?')
				.bind(Date.now() - 24 * HOUR, Date.now() - 1)
				.run();
			await expire();
			state.expires = Date.now();
			const before = Date.now();
			const second = installEve(state);
			await runSync('tracking-1-2', 1);
			expect(lookups(second)).toHaveLength(1);
			const [again] = await rows('SELECT next_check_at FROM tracked_facilities');
			expect(again!.next_check_at).toBeGreaterThanOrEqual(before + 48 * HOUR);
		});

		it('looks up at most 20 facilities per sync, the rest on later syncs', async () => {
			await seedConnection(1, 'u1', 'character');
			const state: EveState = {
				...emptyState(),
				jobs: Array.from({ length: 25 }, (_, i) => job(i + 1, 9, 'delivered', 46166, STRUCTURE + i))
			};
			const first = installEve(state);
			await runSync('tracking-1-1', 1);
			expect(lookups(first)).toHaveLength(20);

			await expire();
			const second = installEve(state);
			await runSync('tracking-1-2', 1);
			expect(lookups(second)).toHaveLength(5);
			expect(await rows("SELECT COUNT(*) AS n FROM tracked_facilities WHERE kind = 'unknown'")).toEqual([
				{ n: 25 }
			]);
		});
	});

	describe('manufacturing jobs and blueprints', () => {
		const jobsOf = () =>
			rows(
				'SELECT job_id, activity_id, blueprint_id, blueprint_me, status FROM tracked_jobs ORDER BY job_id'
			);

		it('stores manufacturing jobs of relevant blueprints with activity 1 and reads their ME', async () => {
			await seedConnection(1, 'u1', 'character');
			const state: EveState = {
				...emptyState(),
				jobs: [
					job(1, 9),
					// Manufacturing with a reaction formula's type: not a relevant blueprint.
					job(2, 1),
					job(3, 1, 'active', MFG_BLUEPRINT),
					job(4, 1, 'delivered', MFG_BLUEPRINT),
					// Another activity (research) of a relevant blueprint.
					job(5, 4, 'active', MFG_BLUEPRINT)
				],
				blueprints: [[blueprint(1, 0), blueprint(9003, 7), blueprint(9004, 3)]]
			};
			const calls = installEve(state);

			expect(await runSync('tracking-1-1', 1)).toMatchObject({ ok: true, status: 'ok', ledgerRebuilt: true });

			// The delivered job's blueprint is not wanted (only installed blueprints are read).
			expect(await jobsOf()).toEqual([
				{ job_id: 1, activity_id: 9, blueprint_id: 9001, blueprint_me: null, status: 'delivered' },
				{ job_id: 3, activity_id: 1, blueprint_id: 9003, blueprint_me: 7, status: 'active' },
				{ job_id: 4, activity_id: 1, blueprint_id: 9004, blueprint_me: null, status: 'delivered' }
			]);
			expect(esiCalls(calls, /blueprints$/)).toEqual(['/characters/1001/blueprints?page=1']);
			expect(await streams(1)).toContainEqual({
				stream: 'blueprints',
				status: 'ok',
				cursor: null,
				last_error: null
			});

			// Next sync (every stream expired): the job keeps its ME and blueprints are not asked again.
			await env.DB.prepare('UPDATE tracking_streams SET expires_at = 0 WHERE source_id = 1').run();
			const second = installEve(state);
			await runSync('tracking-1-2', 1);
			expect(esiCalls(second, /industry\/jobs$/)).toHaveLength(1);
			expect(esiCalls(second, /blueprints$/)).toEqual([]);
			expect((await jobsOf())[1]).toMatchObject({ job_id: 3, blueprint_me: 7 });
		});

		it('stores fuel block jobs and transactions of their materials, and reads the blueprint ME', async () => {
			await seedConnection(1, 'u1', 'character');
			const state: EveState = {
				...emptyState(),
				// Two fuel block materials and a type nothing uses.
				transactions: [tx(203, 17887, true), tx(202, 34, true), tx(201, 9832, true)],
				jobs: [job(6, 1, 'active', FUEL_BLUEPRINT), job(7, 1, 'delivered', FUEL_BLUEPRINT)],
				blueprints: [[blueprint(9006, 9)]]
			};
			installEve(state);

			expect(await runSync('tracking-1-1', 1)).toMatchObject({ ok: true, status: 'ok', ledgerRebuilt: true });

			expect(await jobsOf()).toEqual([
				{ job_id: 6, activity_id: 1, blueprint_id: 9006, blueprint_me: 9, status: 'active' },
				{ job_id: 7, activity_id: 1, blueprint_id: 9007, blueprint_me: null, status: 'delivered' }
			]);
			expect(
				await rows('SELECT transaction_id, type_id FROM tracked_transactions ORDER BY transaction_id')
			).toEqual([
				{ transaction_id: 201, type_id: 9832 },
				{ transaction_id: 203, type_id: 17887 }
			]);
		});

		it('fetches material transactions and fuel block jobs again after the 3.2.2 stream reset', async () => {
			await seedConnection(1, 'u1', 'character');
			const withoutFuel = {
				...DATASET,
				manufacturing: DATASET.manufacturing.filter((b) => b.blueprintTypeId !== FUEL_BLUEPRINT)
			};
			await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(withoutFuel));
			const state: EveState = {
				...emptyState(),
				transactions: [tx(203, 17887, true), tx(202, 4312, true), tx(201, 9832, true)],
				jobs: [job(7, 1, 'delivered', FUEL_BLUEPRINT)]
			};
			installEve(state);
			await runSync('tracking-1-1', 1);
			// Before the release: only the reaction material is kept, the fuel block job is not.
			expect(await rows('SELECT transaction_id FROM tracked_transactions')).toEqual([
				{ transaction_id: 202 }
			]);
			expect(await jobsOf()).toEqual([]);

			// The release: the new dataset, then the stream reset of docs/deploy.md.
			await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(DATASET));
			await env.DB.batch([
				env.DB.prepare(
					"UPDATE tracking_streams SET cursor = NULL, expires_at = NULL WHERE stream = 'transactions' OR stream LIKE 'transactions:%'"
				),
				env.DB.prepare("UPDATE tracking_streams SET expires_at = NULL WHERE stream = 'jobs'")
			]);
			installEve(state);
			await runSync('tracking-1-2', 1);
			expect(await rows('SELECT transaction_id FROM tracked_transactions ORDER BY transaction_id')).toEqual([
				{ transaction_id: 201 },
				{ transaction_id: 202 },
				{ transaction_id: 203 }
			]);
			expect(await jobsOf()).toMatchObject([{ job_id: 7, activity_id: 1 }]);
			expect(await streams(1)).toContainEqual({
				stream: 'transactions',
				status: 'ok',
				cursor: 203,
				last_error: null
			});
		});

		it('walks blueprint pages until every wanted blueprint is found', async () => {
			await seedConnection(1, 'u1', 'character');
			const state: EveState = {
				...emptyState(),
				jobs: [job(3, 1, 'active', MFG_BLUEPRINT), job(6, 1, 'paused', MFG_BLUEPRINT)],
				blueprints: [[blueprint(9003, 10)], [blueprint(9006, 5)], [blueprint(77, 1)]]
			};
			const calls = installEve(state);
			await runSync('tracking-1-1', 1);
			expect(esiCalls(calls, /blueprints$/)).toEqual([
				'/characters/1001/blueprints?page=1',
				'/characters/1001/blueprints?page=2'
			]);
			expect((await jobsOf()).map((j) => j.blueprint_me)).toEqual([10, 5]);
		});

		it('reads a waiting blueprint while the other streams are fresh, and not before its Expires', async () => {
			await seedConnection(1, 'u1', 'character');
			const state: EveState = { ...emptyState(), jobs: [job(3, 1, 'active', MFG_BLUEPRINT)] };
			installEve(state);
			await runSync('tracking-1-1', 1);
			expect((await jobsOf())[0]).toMatchObject({ blueprint_me: null });

			// Fresh blueprints stream: nothing to ask.
			const fresh = installEve(state);
			expect(await runSync('tracking-1-2', 1)).toMatchObject({ ok: false, status: 'fresh' });
			expect(fresh).toEqual([]);

			await env.DB.prepare(
				"UPDATE tracking_streams SET expires_at = 0 WHERE source_id = 1 AND stream = 'blueprints'"
			).run();
			state.blueprints = [[blueprint(9003, 9)]];
			const third = installEve(state);
			expect(await runSync('tracking-1-3', 1)).toMatchObject({ ok: true, status: 'ok' });
			expect(esiCalls(third)).toEqual(['/characters/1001/blueprints?page=1']);
			expect((await jobsOf())[0]).toMatchObject({ blueprint_me: 9 });
		});

		it('corporation: blueprints 403 names the Director role; the other streams stay ok', async () => {
			await seedConnection(2, 'u1', 'corporation', { walletDivisions: [1] });
			const state: EveState = {
				...emptyState(),
				jobs: [job(3, 1, 'active', MFG_BLUEPRINT)],
				forbidden: [/\/blueprints$/]
			};
			installEve(state);

			expect(await runSync('tracking-2-1', 2)).toMatchObject({ ok: true, status: 'ok' });
			expect(await streams(2)).toEqual([
				{ stream: 'blueprints', status: 'denied', cursor: null, last_error: 'Pilot needs the Director role' },
				{ stream: 'contracts', status: 'ok', cursor: null, last_error: null },
				{ stream: 'jobs', status: 'ok', cursor: null, last_error: null },
				{ stream: 'journal:1', status: 'ok', cursor: null, last_error: null },
				{ stream: 'orders', status: 'ok', cursor: null, last_error: null },
				{ stream: 'transactions:1', status: 'ok', cursor: null, last_error: null }
			]);
			expect(await jobsOf()).toEqual([
				{ job_id: 3, activity_id: 1, blueprint_id: 9003, blueprint_me: null, status: 'active' }
			]);
		});

		it('personal: blueprints 403 is ESI denied access', async () => {
			await seedConnection(1, 'u1', 'character');
			installEve({
				...emptyState(),
				jobs: [job(3, 1, 'active', MFG_BLUEPRINT)],
				forbidden: [/\/blueprints$/]
			});
			await runSync('tracking-1-1', 1);
			expect(await streams(1)).toContainEqual({
				stream: 'blueprints',
				status: 'denied',
				cursor: null,
				last_error: 'ESI denied access'
			});
		});
	});
});

describe('fetchTrackingJanice', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	async function seedContracts(codes = ['AAA', 'AAA', 'BBB']) {
		await seedConnection(1, 'u1', 'character');
		await env.DB.prepare(
			"UPDATE inventory_sources SET tracking_status = 'running', tracking_run_id = 'run-1'"
		).run();
		const insert = (id: number, code: string) =>
			env.DB.prepare(
				`INSERT INTO tracked_contracts (user_id, contract_id, source_id, type, status, issuer_id, issuer_corporation_id,
					acceptor_id, assignee_id, for_corporation, date_issued, janice_code)
				VALUES ('u1', ?, 1, 'item_exchange', 'finished', 1, 1, 2, 2, 0, 1, ?)`
			).bind(id, code);
		await env.DB.batch(codes.map((code, i) => insert(i + 1, code)));
	}

	/** Janice answering every code, except `failing` ones (404) and `invalid` ones (a non-numeric price). */
	function installJanice(failing: readonly string[] = [], invalid: readonly string[] = []) {
		return installFetch((url) => {
			const code = url.pathname.split('/').at(-1)!;
			if (failing.includes(code)) return json({ error: 'not found' }, {}, 404);
			return json({
				code,
				created: '2026-10-11T00:00:00Z',
				datasetTime: '2026-10-11T00:00:00Z',
				market: { id: 2, name: 'Jita 4-4' },
				pricing: 'split',
				pricingVariant: 'immediate',
				items: [
					{
						amount: 10,
						itemType: { eid: 4312, name: 'Oxygen Fuel Block' },
						effectivePrices: { buyPrice: invalid.includes(code) ? 'n/a' : 1, splitPrice: 2, sellPrice: 3 }
					}
				]
			});
		});
	}

	const keyed = () => Object.create(env, { JANICE_API_KEY: { value: 'key-1' } }) as Env;
	const requested = (calls: RecordedCall[]) => calls.map((c) => new URL(c.url).pathname.split('/').at(-1));
	const T0 = Date.UTC(2026, 9, 12, 8);

	it('fetches each code once and stores it on every contract with that code', async () => {
		await seedContracts();
		const calls = installJanice();

		expect(await fetchTrackingJanice(keyed(), 1, 'run-1', T0)).toEqual({ fetched: 2, failed: 0 });
		expect(await fetchTrackingJanice(keyed(), 1, 'run-1', T0)).toEqual({ fetched: 0, failed: 0 });

		expect(calls.map((c) => new URL(c.url).pathname).sort()).toEqual([
			'/api/rest/v2/appraisal/AAA',
			'/api/rest/v2/appraisal/BBB'
		]);
		expect(calls[0]!.headers.get('X-ApiKey')).toBe('key-1');
		const stored = await rows('SELECT janice_json FROM tracked_contracts ORDER BY contract_id');
		const appraisals: unknown[] = stored.map((r) => JSON.parse(String(r.janice_json)));
		expect(appraisals).toMatchObject([{ code: 'AAA' }, { code: 'AAA' }, { code: 'BBB' }]);
		expect(appraisals[0]).toMatchObject({
			marketName: 'Jita 4-4',
			pricing: 'split',
			items: [{ typeId: 4312, buyPrice: 1, splitPrice: 2, sellPrice: 3 }]
		});
	});

	it('requests nothing without an API key', async () => {
		await seedContracts();
		const calls = installJanice();

		expect(await fetchTrackingJanice(env, 1, 'run-1', T0)).toEqual({ fetched: 0, failed: 0 });
		expect(calls).toEqual([]);
	});

	it('waits longer after each failure of a code, never logging it', async () => {
		await seedContracts(['AAA', 'BAD', 'NAN']);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		let calls = installJanice(['BAD'], ['NAN']);
		expect(await fetchTrackingJanice(keyed(), 1, 'run-1', T0)).toEqual({ fetched: 1, failed: 2 });
		expect(requested(calls)).toEqual(['AAA', 'BAD', 'NAN']);
		// Failed codes keep no appraisal: their contracts are priced by the rule.
		expect(
			await rows(
				"SELECT janice_code FROM tracked_contracts WHERE json_extract(janice_json, '$.code') IS NOT NULL"
			)
		).toEqual([{ janice_code: 'AAA' }]);

		calls = installJanice(['BAD'], ['NAN']);
		await fetchTrackingJanice(keyed(), 1, 'run-1', T0 + 6 * HOUR - 1);
		expect(calls).toEqual([]);
		await fetchTrackingJanice(keyed(), 1, 'run-1', T0 + 6 * HOUR);
		expect(requested(calls)).toEqual(['BAD', 'NAN']);

		// The second failure in a row waits twice as long; then NAN answers properly.
		calls = installJanice(['BAD']);
		await fetchTrackingJanice(keyed(), 1, 'run-1', T0 + 18 * HOUR - 1);
		expect(calls).toEqual([]);
		expect(await fetchTrackingJanice(keyed(), 1, 'run-1', T0 + 18 * HOUR)).toEqual({ fetched: 1, failed: 1 });
		expect(requested(calls)).toEqual(['BAD', 'NAN']);

		const messages = logged.mock.calls.map((c) => String(c[0]));
		expect(messages.length).toBeGreaterThan(0);
		expect(messages.some((m) => /BAD|NAN/.test(m))).toBe(false);
	});

	it('codes that keep failing cannot hold back a valid one', async () => {
		const failing = Array.from({ length: 20 }, (_, i) => `F${String(i).padStart(2, '0')}`);
		await seedContracts([...failing, 'ZZZ']);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let calls = installJanice(failing);
		expect(await fetchTrackingJanice(keyed(), 1, 'run-1', T0)).toEqual({ fetched: 0, failed: 20 });
		expect(requested(calls)).toEqual(failing);

		calls = installJanice(failing);
		expect(await fetchTrackingJanice(keyed(), 1, 'run-1', T0 + HOUR)).toEqual({ fetched: 1, failed: 0 });
		expect(requested(calls)).toEqual(['ZZZ']);
	});
});
