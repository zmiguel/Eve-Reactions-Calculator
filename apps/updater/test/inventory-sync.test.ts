import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { DATASET_KV_KEY } from '@reactions/db';
import { ESI_FEATURES, TOKEN_ERROR_REVOKED, decryptToken, encryptToken } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetch, json, resetState } from './helpers.ts';
import type { RecordedCall } from './helpers.ts';

const JITA = 60003760;
const AMARR = 60008494;
const DODIXIE = 60011866;
const STRUCTURE = 1035000000000;
const HIDDEN_STRUCTURE = 1035000000001;
const CORP = 98000001;
const LAST_MODIFIED = Date.UTC(2026, 9, 12, 10, 30);
const EXPIRES = Date.UTC(2026, 9, 12, 11, 30);

const PERSONAL_SCOPES = ESI_FEATURES.assets.join(' ');
const CORP_SCOPES = ESI_FEATURES.corp_assets.join(' ');

/** Relevant types: formula 46166, product 16663, materials 4312, 16643, 16647 (34 and 17366 are not). */
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
	types: {},
	reprocess: {},
	industry: {
		filters: [],
		rigs: [
			{
				typeId: 37174,
				name: 'Component ME rig',
				rigSize: 3,
				groupId: 1860,
				fitsGroupIds: [1404],
				bonuses: [{ activity: 'manufacturing', material: 0.024, filterId: 14 }],
				security: { highsec: 1, lowsec: 1.9, nullsec: 2.1, wormhole: 2.1 }
			}
		],
		structures: [
			{
				typeId: 35825,
				name: 'Raitaru',
				groupId: 1404,
				rigSize: 2,
				rigSlots: 3,
				material: { manufacturing: 0.01 }
			}
		],
		productFilters: {}
	}
};

const STATIONS: Record<number, { name: string; system_id: number }> = {
	[JITA]: { name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', system_id: 30000142 },
	[AMARR]: { name: 'Amarr VIII (Oris) - Emperor Family Academy', system_id: 30002187 },
	[DODIXIE]: { name: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant', system_id: 30002659 }
};

/** Raw ESI asset row. */
function asset(
	itemId: number,
	typeId: number,
	quantity: number,
	locationId: number,
	locationFlag: string,
	locationType = 'item'
) {
	return {
		item_id: itemId,
		type_id: typeId,
		quantity,
		location_id: locationId,
		location_type: locationType,
		location_flag: locationFlag,
		is_singleton: false
	};
}

/** Raw ESI industry job row (`station_id` for characters, `location_id` for corporations). */
function job(jobId: number, activityId: number, status: string, stationId: number, blueprintTypeId = 46166) {
	return {
		job_id: jobId,
		installer_id: 1001,
		facility_id: stationId,
		station_id: stationId,
		location_id: stationId,
		activity_id: activityId,
		blueprint_id: 9000 + jobId,
		blueprint_type_id: blueprintTypeId,
		blueprint_location_id: stationId,
		output_location_id: stationId,
		runs: 10,
		status,
		duration: 3600,
		start_date: '2026-10-12T10:00:00Z',
		end_date: '2026-10-12T11:00:00Z'
	};
}

interface SourceSeed {
	sourceId: number;
	kind: 'character' | 'corporation';
	characterId: number;
	characterName: string;
	ownerId: number;
	ownerName: string;
	scopes: string;
	refreshToken?: string;
}

const personal = (sourceId: number): SourceSeed => ({
	sourceId,
	kind: 'character',
	characterId: 1000 + sourceId,
	characterName: 'Pilot',
	ownerId: 1000 + sourceId,
	ownerName: 'Pilot',
	scopes: PERSONAL_SCOPES
});

const corporation = (sourceId: number): SourceSeed => ({
	sourceId,
	kind: 'corporation',
	characterId: 2000 + sourceId,
	characterName: 'Corp Pilot',
	ownerId: CORP,
	ownerName: 'Reaction Corp',
	scopes: CORP_SCOPES
});

async function seedSource(seed: SourceSeed) {
	const encrypted = await encryptToken(seed.refreshToken ?? 'rt-1', env.TOKEN_ENCRYPTION_KEY);
	await env.DB.batch([
		env.DB.prepare('INSERT OR IGNORE INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, ?)').bind(
			'u1',
			Date.now()
		),
		env.DB.prepare(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, scopes, refresh_token_enc, token_status, created_at)
			VALUES (?, 'u1', ?, 'hash', ?, ?, 'ok', 1)`
		).bind(seed.characterId, seed.characterName, seed.scopes, encrypted),
		env.DB.prepare(
			`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, status, created_at)
			VALUES (?, 'u1', ?, ?, ?, ?, 'ok', 1)`
		).bind(seed.sourceId, seed.characterId, seed.kind, seed.ownerId, seed.ownerName)
	]);
	if (seed.kind === 'corporation') await addReader(seed.sourceId, seed.characterId, 1);
}

/** A character of account `userId` (refresh token `rt-<characterId>`, access token `at-<characterId>`). */
async function seedCharacter(
	characterId: number,
	name: string,
	createdAt: number,
	scopes = CORP_SCOPES,
	userId = 'u1'
) {
	const encrypted = await encryptToken(`rt-${characterId}`, env.TOKEN_ENCRYPTION_KEY);
	await env.DB.batch([
		env.DB.prepare('INSERT OR IGNORE INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, 1)').bind(
			userId
		),
		env.DB.prepare(
			`INSERT INTO characters (character_id, user_id, name, owner_hash, scopes, refresh_token_enc, token_status, created_at)
			VALUES (?, ?, ?, 'hash', ?, ?, 'ok', ?)`
		).bind(characterId, userId, name, scopes, encrypted, createdAt)
	]);
}

/** Adds `characterId` to the reader pool of corporation source `sourceId`. */
async function addReader(sourceId: number, characterId: number, createdAt: number) {
	await env.DB.prepare(
		'INSERT INTO inventory_source_readers (source_id, character_id, created_at) VALUES (?, ?, ?)'
	)
		.bind(sourceId, characterId, createdAt)
		.run();
}

async function seedItems(
	sourceId: number,
	rows: [locationId: number, bucket: string, typeId: number, quantity: number][]
) {
	await env.DB.batch(
		rows.map((r) => env.DB.prepare('INSERT INTO inventory_items VALUES (?, ?, ?, ?, ?)').bind(sourceId, ...r))
	);
	await env.DB.prepare('UPDATE inventory_sources SET item_count = ? WHERE source_id = ?')
		.bind(rows.length, sourceId)
		.run();
}

interface EveOptions {
	/** Asset rows per page number. */
	pages?: Record<number, unknown[]>;
	/** `X-Pages`; defaults to the number of `pages`. */
	totalPages?: number;
	/** Status of every assets request instead of the pages. */
	assetsStatus?: number;
	/** Corporation of the reading character (`/characters/affiliation`). */
	corporationOf?: number;
	/** Corporation per character id, before `corporationOf`. */
	corporations?: Record<number, number>;
	/** Access tokens whose asset requests answer 403 (no Director role). */
	forbiddenTokens?: string[];
	/** Refresh tokens SSO answers with `invalid_grant`. */
	revoked?: string[];
	/** Industry job rows (one page); default none. */
	jobs?: unknown[];
	/** Status of every industry jobs request instead of `jobs`. */
	jobsStatus?: number;
}

/**
 * Fake SSO + ESI. SSO rotates `rt-1` to `rt-next` (access token `at-1`) and answers any other `rt-<x>`
 * with access token `at-<x>`, keeping the refresh token; stations and
 * `STRUCTURE` resolve, `HIDDEN_STRUCTURE` answers 403. `stagedDuringNames` lists the R2 staging keys
 * present when the first station or structure was looked up (the `names` step).
 */
function installEve(options: EveOptions) {
	const stagedDuringNames: string[][] = [];
	const pages = options.pages ?? {};
	const calls = installFetch(async (url, call) => {
		if (url.hostname === 'login.eveonline.com') {
			const refresh = new URLSearchParams(call.body ?? '').get('refresh_token') ?? '';
			if (options.revoked?.includes(refresh))
				return json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, {}, 400);
			const next = refresh === 'rt-1' ? 'rt-next' : refresh;
			const access = next === 'rt-next' ? 'at-1' : `at-${refresh.slice(3)}`;
			return json({ access_token: access, refresh_token: next, expires_in: 1199 });
		}
		const path = url.pathname;
		if (/^\/(characters|corporations)\/\d+\/assets$/.test(path)) {
			if (options.assetsStatus) return json({ error: 'Forbidden' }, {}, options.assetsStatus);
			const token = call.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
			if (options.forbiddenTokens?.includes(token)) return json({ error: 'Forbidden' }, {}, 403);
			const page = Number(url.searchParams.get('page'));
			return json(pages[page] ?? [], {
				'X-Pages': String(options.totalPages ?? Object.keys(pages).length),
				'Last-Modified': new Date(LAST_MODIFIED).toUTCString(),
				Expires: new Date(EXPIRES).toUTCString()
			});
		}
		if (/^\/(characters|corporations)\/\d+\/industry\/jobs$/.test(path)) {
			if (options.jobsStatus) return json({ error: 'Forbidden' }, {}, options.jobsStatus);
			return json(options.jobs ?? [], { 'X-Pages': '1' });
		}
		if (path === '/characters/affiliation')
			return json(
				(JSON.parse(call.body!) as number[]).map((id) => ({
					character_id: id,
					corporation_id: options.corporations?.[id] ?? options.corporationOf ?? CORP
				}))
			);
		if (path === `/corporations/${CORP}/divisions`)
			return json({ hangar: [{ division: 1, name: 'Moon goo' }, { division: 2 }], wallet: [] });
		if (path.startsWith('/universe/')) {
			if (stagedDuringNames.length === 0)
				stagedDuringNames.push(
					(await env.ARCHIVE.list({ prefix: 'inventory-staging/' })).objects.map((o) => o.key)
				);
			const id = Number(path.split('/')[3]);
			if (path.startsWith('/universe/stations/')) return json(STATIONS[id]);
			if (id === STRUCTURE)
				return json({
					name: 'Perimeter - Tranquility Trading Tower',
					solar_system_id: 30000144,
					owner_id: CORP,
					type_id: 35833
				});
			return json({ error: 'Forbidden' }, {}, 403);
		}
		return json({ error: 'unexpected' }, {}, 500);
	});
	return { calls, stagedDuringNames };
}

const pathsOf = (calls: { url: string }[], pattern: RegExp) =>
	calls
		.map((c) => new URL(c.url))
		.filter((u) => pattern.test(u.pathname))
		.map((u) => u.pathname + u.search);

/** `Authorization` of every assets request, in order. */
const assetTokens = (calls: RecordedCall[]) =>
	calls.filter((c) => /\/assets\?/.test(c.url)).map((c) => c.headers.get('Authorization'));

/** Refresh tokens sent to SSO, in order. */
const refreshed = (calls: RecordedCall[]) =>
	calls
		.filter((c) => c.url.startsWith('https://login.eveonline.com/'))
		.map((c) => new URLSearchParams(c.body ?? '').get('refresh_token'));

async function runSync(id: string, sourceId: number): Promise<unknown> {
	await using instance = await introspectWorkflowInstance(env.INVENTORY_SYNC, id);
	await instance.modify(async (m) => m.disableRetryDelays());
	await env.INVENTORY_SYNC.create({ id, params: { sourceId, trigger: 'manual' } });
	await instance.waitForStatus('complete');
	return await instance.getOutput();
}

async function failSync(id: string, sourceId: number): Promise<{ name: string; message: string }> {
	await using instance = await introspectWorkflowInstance(env.INVENTORY_SYNC, id);
	await instance.modify(async (m) => m.disableRetryDelays());
	await env.INVENTORY_SYNC.create({ id, params: { sourceId, trigger: 'manual' } });
	await instance.waitForStatus('errored');
	return await instance.getError();
}

async function source(sourceId: number) {
	return env.DB.prepare(
		`SELECT status, run_id, last_error, item_count, data_as_of, data_expires_at, last_synced_at, last_attempt_at,
			division_names_json, character_id
		FROM inventory_sources WHERE source_id = ?`
	)
		.bind(sourceId)
		.first<{
			status: string;
			run_id: string | null;
			last_error: string | null;
			item_count: number;
			data_as_of: number | null;
			data_expires_at: number | null;
			last_synced_at: number | null;
			last_attempt_at: number | null;
			division_names_json: string | null;
			character_id: number;
		}>();
}

async function items(sourceId: number) {
	const { results } = await env.DB.prepare(
		`SELECT location_id, bucket, type_id, quantity FROM inventory_items WHERE source_id = ?
		ORDER BY location_id, bucket, type_id`
	)
		.bind(sourceId)
		.all();
	return results;
}

async function locations(sourceId: number) {
	const { results } = await env.DB.prepare(
		'SELECT location_id, kind, name, system_id FROM inventory_locations WHERE source_id = ? ORDER BY location_id'
	)
		.bind(sourceId)
		.all();
	return results;
}

async function staged(): Promise<string[]> {
	return (await env.ARCHIVE.list({ prefix: 'inventory-staging/' })).objects.map((o) => o.key);
}

describe('InventorySyncWorkflow', () => {
	beforeEach(async () => {
		await resetState();
		await env.CACHE.put(DATASET_KV_KEY, JSON.stringify(DATASET));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('syncs personal assets over 2 pages: staged in R2, summed per bucket, source ok, staging deleted', async () => {
		await seedSource(personal(1));
		const { calls, stagedDuringNames } = installEve({
			pages: {
				1: [
					asset(1, 16663, 100, JITA, 'Hangar', 'station'),
					asset(2, 17366, 1, JITA, 'Hangar', 'station'),
					asset(3, 4312, 50, 2, 'Unlocked'),
					asset(4, 34, 999, JITA, 'Hangar', 'station')
				],
				2: [asset(5, 16663, 25, JITA, 'Hangar', 'station'), asset(6, 46166, 2, JITA, 'Deliveries', 'station')]
			}
		});
		const id = 'inventory-1-two-pages';
		const before = Date.now();

		const output = await runSync(id, 1);

		expect(output).toEqual({ ok: true, locations: 1, items: 3, removedLocations: 0 });
		expect(pathsOf(calls, /\/assets$/)).toEqual([
			'/characters/1001/assets?page=1',
			'/characters/1001/assets?page=2'
		]);
		expect(stagedDuringNames).toEqual([
			[
				`inventory-staging/${id}/1.json`,
				`inventory-staging/${id}/2.json`,
				`inventory-staging/${id}/jobs-1.json`
			]
		]);
		expect(await staged()).toEqual([]);
		expect(await items(1)).toEqual([
			{ location_id: JITA, bucket: 'deliveries', type_id: 46166, quantity: 2 },
			{ location_id: JITA, bucket: 'hangar', type_id: 4312, quantity: 50 },
			{ location_id: JITA, bucket: 'hangar', type_id: 16663, quantity: 125 }
		]);
		expect(await locations(1)).toEqual([
			{ location_id: JITA, kind: 'station', name: STATIONS[JITA]!.name, system_id: 30000142 }
		]);
		const row = await source(1);
		expect(row).toMatchObject({
			status: 'ok',
			run_id: id,
			last_error: null,
			item_count: 3,
			data_as_of: LAST_MODIFIED,
			data_expires_at: EXPIRES,
			character_id: 1001,
			division_names_json: null
		});
		expect(row!.last_synced_at).toBeGreaterThanOrEqual(before);
		expect(row!.last_attempt_at).toBeGreaterThanOrEqual(before);
		// A fresh access token for each step that reads with it: prepare and pages-1 (stations are public).
		expect(calls.filter((c) => c.url.startsWith('https://login.eveonline.com/'))).toHaveLength(2);
		const character = await env.DB.prepare(
			'SELECT token_status, refresh_token_enc FROM characters WHERE character_id = 1001'
		).first<{ token_status: string; refresh_token_enc: string }>();
		expect(character?.token_status).toBe('ok');
		expect(await decryptToken(character!.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY)).toBe('rt-next');
	});

	it('syncs a corporation: office hangars resolved to divisions, divisions and locations named', async () => {
		await seedSource(corporation(2));
		const { calls } = installEve({
			pages: {
				1: [
					asset(100, 27, 1, STRUCTURE, 'OfficeFolder'),
					asset(101, 16643, 1000, 100, 'CorpSAG1'),
					asset(102, 16647, 10, 100, 'CorpSAG3'),
					asset(103, 4312, 5, AMARR, 'CorpDeliveries', 'station'),
					asset(104, 27, 1, HIDDEN_STRUCTURE, 'OfficeFolder'),
					asset(105, 16663, 3, 104, 'CorpSAG2')
				]
			}
		});

		const output = await runSync('inventory-2-corp', 2);

		expect(output).toEqual({ ok: true, locations: 3, items: 4, removedLocations: 0 });
		expect(pathsOf(calls, /^\/(characters\/affiliation|corporations\/)/)).toEqual([
			'/characters/affiliation',
			`/corporations/${CORP}/assets?page=1`,
			`/corporations/${CORP}/industry/jobs?page=1`,
			`/corporations/${CORP}/divisions`
		]);
		expect(await items(2)).toEqual([
			{ location_id: AMARR, bucket: 'deliveries', type_id: 4312, quantity: 5 },
			{ location_id: STRUCTURE, bucket: 'div1', type_id: 16643, quantity: 1000 },
			{ location_id: STRUCTURE, bucket: 'div3', type_id: 16647, quantity: 10 },
			{ location_id: HIDDEN_STRUCTURE, bucket: 'div2', type_id: 16663, quantity: 3 }
		]);
		expect(await locations(2)).toEqual([
			{ location_id: AMARR, kind: 'station', name: STATIONS[AMARR]!.name, system_id: 30002187 },
			{
				location_id: STRUCTURE,
				kind: 'structure',
				name: 'Perimeter - Tranquility Trading Tower',
				system_id: 30000144
			},
			{ location_id: HIDDEN_STRUCTURE, kind: 'unknown', name: null, system_id: null }
		]);
		expect(await source(2)).toMatchObject({
			status: 'ok',
			item_count: 4,
			last_error: null,
			character_id: 2002,
			data_expires_at: EXPIRES,
			division_names_json: JSON.stringify({ 1: 'Moon goo' })
		});
	});

	it('adds formulas held in active reaction jobs in the jobs bucket at the job station; others ignored', async () => {
		await seedSource(personal(10));
		const { calls } = installEve({
			pages: { 1: [asset(1, 46166, 1, JITA, 'Hangar', 'station')] },
			jobs: [
				job(1, 9, 'active', AMARR),
				job(2, 9, 'delivered', DODIXIE),
				job(3, 1, 'active', DODIXIE),
				job(4, 9, 'ready', AMARR, 17366)
			]
		});

		const output = await runSync('inventory-10-jobs', 10);

		expect(output).toEqual({ ok: true, locations: 2, items: 2, removedLocations: 0 });
		expect(pathsOf(calls, /\/industry\/jobs$/)).toEqual(['/characters/1010/industry/jobs']);
		expect(await items(10)).toEqual([
			{ location_id: JITA, bucket: 'hangar', type_id: 46166, quantity: 1 },
			{ location_id: AMARR, bucket: 'jobs', type_id: 46166, quantity: 1 }
		]);
		expect(await locations(10)).toEqual([
			{ location_id: JITA, kind: 'station', name: STATIONS[JITA]!.name, system_id: 30000142 },
			{ location_id: AMARR, kind: 'station', name: STATIONS[AMARR]!.name, system_id: 30002187 }
		]);
		expect(await source(10)).toMatchObject({ status: 'ok', last_error: null, item_count: 2 });
		expect(await staged()).toEqual([]);
	});

	it('keeps a corporation sync ok when its industry jobs answer 403, with a note', async () => {
		await seedSource(corporation(11));
		installEve({ pages: { 1: [asset(103, 4312, 5, AMARR, 'CorpDeliveries', 'station')] }, jobsStatus: 403 });

		const output = await runSync('inventory-11-no-jobs', 11);

		expect(output).toEqual({ ok: true, locations: 1, items: 1, removedLocations: 0 });
		expect(await items(11)).toEqual([
			{ location_id: AMARR, bucket: 'deliveries', type_id: 4312, quantity: 5 }
		]);
		expect(await source(11)).toMatchObject({
			status: 'ok',
			item_count: 1,
			last_error: 'Industry jobs not readable: Corp Pilot needs the Factory Manager role'
		});
		expect(await staged()).toEqual([]);
	});

	it('keeps selections and the selected locations on a re-sync; gone unselected locations are deleted', async () => {
		await seedSource(personal(3));
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO inventory_locations VALUES (3, ?, 'station', 'Old Jita name', 30000142),
					(3, ?, 'station', 'Amarr', 30002187), (3, ?, 'station', 'Dodixie', 30002659)`
			).bind(JITA, AMARR, DODIXIE),
			env.DB.prepare(
				"INSERT INTO inventory_selection VALUES (3, ?, 'hangar'), (3, ?, 'hangar'), (3, ?, 'deliveries')"
			).bind(JITA, AMARR, AMARR)
		]);
		await seedItems(3, [
			[AMARR, 'hangar', 4312, 7],
			[DODIXIE, 'hangar', 4312, 1]
		]);
		const { calls } = installEve({ pages: { 1: [asset(1, 16663, 10, JITA, 'Hangar', 'station')] } });

		const output = await runSync('inventory-3-resync', 3);

		expect(output).toEqual({ ok: true, locations: 1, items: 1, removedLocations: 1 });
		expect(await locations(3)).toEqual([
			{ location_id: JITA, kind: 'station', name: 'Old Jita name', system_id: 30000142 },
			{ location_id: AMARR, kind: 'station', name: 'Amarr', system_id: 30002187 }
		]);
		const { results: selection } = await env.DB.prepare(
			'SELECT location_id, bucket FROM inventory_selection WHERE source_id = 3 ORDER BY location_id, bucket'
		).all();
		expect(selection).toEqual([
			{ location_id: JITA, bucket: 'hangar' },
			{ location_id: AMARR, bucket: 'deliveries' },
			{ location_id: AMARR, bucket: 'hangar' }
		]);
		expect(await items(3)).toEqual([{ location_id: JITA, bucket: 'hangar', type_id: 16663, quantity: 10 }]);
		// Named locations are not looked up again.
		expect(pathsOf(calls, /^\/universe\//)).toEqual([]);
	});

	describe('rigs of corporation structures', () => {
		const OWNED = 1035000000002;
		const NULLSEC = 30004604;
		/** The Raitaru in space with a component ME rig, a rig without a material bonus and a service module. */
		const fitted = (rigs: boolean) => [
			asset(OWNED, 35825, 1, NULLSEC, 'AutoFit', 'solar_system'),
			...(rigs ? [asset(501, 37174, 1, OWNED, 'RigSlot0')] : []),
			asset(502, 43920, 1, OWNED, 'RigSlot1'),
			asset(503, 35881, 1, OWNED, 'ServiceSlot0'),
			asset(103, 4312, 5, AMARR, 'CorpDeliveries', 'station')
		];
		const facility = () =>
			env.DB.prepare(
				"SELECT kind, type_id, system_id, rigs_json, rigs_read_at FROM tracked_facilities WHERE user_id = 'u1' AND facility_id = ?"
			)
				.bind(OWNED)
				.first<{
					kind: string;
					type_id: number;
					system_id: number;
					rigs_json: string;
					rigs_read_at: number;
				}>();
		const dirty = async () =>
			(await env.DB.prepare("SELECT dirty FROM ledger_state WHERE user_id = 'u1'").first<{ dirty: number }>())
				?.dirty ?? 0;

		it('stores the material rigs of the structures, [] once they are gone, and flags the ledger', async () => {
			await seedSource(corporation(2));
			await env.DB.prepare(
				`INSERT INTO tracked_jobs (user_id, job_id, source_id, installer_id, activity_id, blueprint_type_id, runs,
					status, facility_id, output_location_id, start_date, end_date)
				VALUES ('u1', 1, 2, 1001, 1, 12619, 1, 'delivered', ?, ?, 1, 2)`
			)
				.bind(OWNED, OWNED)
				.run();
			installEve({ pages: { 1: fitted(true) } });
			await runSync('inventory-2-rigs-1', 2);

			expect(await facility()).toMatchObject({
				kind: 'structure',
				type_id: 35825,
				system_id: NULLSEC,
				rigs_json: '[37174]',
				rigs_read_at: expect.any(Number)
			});
			expect(await dirty()).toBe(1);
			// The inventory itself is unchanged by the structure and its fittings.
			expect(await items(2)).toEqual([
				{ location_id: AMARR, bucket: 'deliveries', type_id: 4312, quantity: 5 }
			]);

			await env.DB.prepare("UPDATE ledger_state SET dirty = 0 WHERE user_id = 'u1'").run();
			installEve({ pages: { 1: fitted(true) } });
			await runSync('inventory-2-rigs-2', 2);
			expect(await dirty()).toBe(0);

			installEve({ pages: { 1: fitted(false) } });
			await runSync('inventory-2-rigs-3', 2);
			expect(await facility()).toMatchObject({ rigs_json: '[]' });
			expect(await dirty()).toBe(1);
		});

		it('reads no rigs from personal assets', async () => {
			await seedSource(personal(1));
			installEve({ pages: { 1: fitted(true) } });
			await runSync('inventory-1-rigs', 1);
			expect(await facility()).toBeNull();
		});
	});

	it('ends a corporation sync as denied on 403 and deletes its items', async () => {
		await seedSource(corporation(4));
		await seedItems(4, [[AMARR, 'div1', 4312, 7]]);
		installEve({ assetsStatus: 403 });

		const output = await runSync('inventory-4-forbidden', 4);

		expect(output).toEqual({
			ok: false,
			status: 'denied',
			message: 'No character can read Reaction Corp: Corp Pilot needs the Director role'
		});
		expect(await source(4)).toMatchObject({
			status: 'denied',
			last_error: 'No character can read Reaction Corp: Corp Pilot needs the Director role',
			item_count: 0
		});
		expect(await items(4)).toEqual([]);
		expect(await staged()).toEqual([]);
	});

	it('ends a corporation sync as denied when the character is in another corporation now', async () => {
		await seedSource(corporation(5));
		await seedItems(5, [[AMARR, 'div1', 4312, 7]]);
		const { calls } = installEve({ corporationOf: 98000002, pages: { 1: [] } });

		const output = await runSync('inventory-5-left', 5);

		expect(output).toMatchObject({ ok: false, status: 'denied' });
		expect(await source(5)).toMatchObject({
			status: 'denied',
			last_error: 'No character can read Reaction Corp: Corp Pilot is not in the corporation',
			item_count: 0
		});
		expect(await items(5)).toEqual([]);
		expect(pathsOf(calls, /\/assets$/)).toEqual([]);
	});

	it('falls back to the next reader when the preferred token is invalid and makes it the preferred one', async () => {
		await seedSource({ ...corporation(20), refreshToken: 'rt-revoked' });
		await seedCharacter(3001, 'Alt Pilot', 2);
		await addReader(20, 3001, 2);
		const { calls } = installEve({
			revoked: ['rt-revoked'],
			pages: { 1: [asset(103, 4312, 5, AMARR, 'CorpDeliveries', 'station')] }
		});

		const output = await runSync('inventory-20-invalid', 20);

		expect(output).toEqual({ ok: true, locations: 1, items: 1, removedLocations: 0 });
		expect(await source(20)).toMatchObject({
			status: 'ok',
			item_count: 1,
			character_id: 3001,
			data_expires_at: EXPIRES,
			last_error: 'Corp Pilot has an invalid token'
		});
		expect(assetTokens(calls)).toEqual(['Bearer at-3001']);
		const preferred = await env.DB.prepare(
			'SELECT token_status FROM characters WHERE character_id = 2020'
		).first();
		expect(preferred).toEqual({ token_status: 'invalid' });
	});

	it('falls back to the next reader when the preferred one lacks the Director role', async () => {
		await seedSource(corporation(21));
		await seedCharacter(3001, 'Alt Pilot', 2);
		await addReader(21, 3001, 2);
		const { calls } = installEve({
			forbiddenTokens: ['at-1'],
			pages: { 1: [asset(103, 4312, 5, AMARR, 'CorpDeliveries', 'station')] },
			jobsStatus: 403
		});

		const output = await runSync('inventory-21-director', 21);

		expect(output).toEqual({ ok: true, locations: 1, items: 1, removedLocations: 0 });
		expect(assetTokens(calls)).toEqual(['Bearer at-1', 'Bearer at-3001']);
		// Jobs and divisions are read with the reader that read the assets.
		expect(
			calls
				.filter((c) => /\/(industry\/jobs|divisions)/.test(c.url))
				.map((c) => c.headers.get('Authorization'))
		).toEqual(['Bearer at-3001', 'Bearer at-3001']);
		expect(await source(21)).toMatchObject({
			status: 'ok',
			character_id: 3001,
			last_error:
				'Corp Pilot needs the Director role; Industry jobs not readable: Alt Pilot needs the Factory Manager role'
		});
	});

	it('tries only the pool: one affiliation call for its members, a member that left skipped', async () => {
		await seedSource(corporation(22));
		await seedCharacter(3002, 'Outsider', 2);
		await seedCharacter(3001, 'Alt Pilot', 3);
		await seedCharacter(3003, 'Trader', 4, PERSONAL_SCOPES);
		await seedCharacter(3004, 'Not Added', 5);
		await addReader(22, 3002, 2);
		await addReader(22, 3001, 3);
		const { calls } = installEve({
			corporations: { 3002: 98000002 },
			forbiddenTokens: ['at-1'],
			pages: { 1: [asset(103, 4312, 5, AMARR, 'CorpDeliveries', 'station')] }
		});

		const output = await runSync('inventory-22-members', 22);

		expect(output).toMatchObject({ ok: true });
		const affiliation = calls.filter((c) => c.url.endsWith('/characters/affiliation'));
		expect(affiliation.map((c) => JSON.parse(c.body!) as number[])).toEqual([[2022, 3002, 3001]]);
		expect(assetTokens(calls)).toEqual(['Bearer at-1', 'Bearer at-3001']);
		expect(refreshed(calls)).not.toContain('rt-3002');
		expect(refreshed(calls)).not.toContain('rt-3004');
		expect(await source(22)).toMatchObject({
			character_id: 3001,
			last_error: 'Corp Pilot needs the Director role; Outsider is not in the corporation'
		});
		const { results } = await env.DB.prepare(
			`SELECT character_id, corporation_id, corporation_name, affiliation_updated_at IS NOT NULL AS updated
			FROM characters ORDER BY character_id`
		).all();
		expect(results).toEqual([
			{ character_id: 2022, corporation_id: CORP, corporation_name: 'Reaction Corp', updated: 1 },
			{ character_id: 3001, corporation_id: CORP, corporation_name: 'Reaction Corp', updated: 1 },
			{ character_id: 3002, corporation_id: 98000002, corporation_name: null, updated: 1 },
			{ character_id: 3003, corporation_id: null, corporation_name: null, updated: 0 },
			{ character_id: 3004, corporation_id: null, corporation_name: null, updated: 0 }
		]);
	});

	it("never reads with another account's character, even with a pool row pointing at it", async () => {
		await seedSource(corporation(24));
		await seedCharacter(4001, 'Other Account', 2, CORP_SCOPES, 'u2');
		await env.DB.prepare(
			`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, status, created_at)
			VALUES (25, 'u2', 4001, 'corporation', ?, 'Reaction Corp', 'ok', 2)`
		)
			.bind(CORP)
			.run();
		await addReader(25, 4001, 2);
		await addReader(24, 4001, 3);
		const { calls } = installEve({ forbiddenTokens: ['at-1'], pages: { 1: [] } });

		const output = await runSync('inventory-24-other-account', 24);

		expect(output).toEqual({
			ok: false,
			status: 'denied',
			message: 'No character can read Reaction Corp: Corp Pilot needs the Director role'
		});
		const affiliation = calls.filter((c) => c.url.endsWith('/characters/affiliation'));
		expect(affiliation.map((c) => JSON.parse(c.body!) as number[])).toEqual([[2024]]);
		expect(refreshed(calls)).toEqual(['rt-1']);
		expect(assetTokens(calls)).toEqual(['Bearer at-1']);
		expect(await source(25)).toMatchObject({ status: 'ok', character_id: 4001 });
	});

	it('ends as denied naming every reader when none can read, deleting the items', async () => {
		await seedSource(corporation(23));
		await seedItems(23, [[AMARR, 'div1', 4312, 7]]);
		await seedCharacter(3002, 'Outsider', 2);
		await seedCharacter(3001, 'Alt Pilot', 3);
		await addReader(23, 3002, 2);
		await addReader(23, 3001, 3);
		const { calls } = installEve({
			corporations: { 3002: 98000002 },
			forbiddenTokens: ['at-1'],
			revoked: ['rt-3001'],
			pages: { 1: [] }
		});

		const output = await runSync('inventory-23-nobody', 23);

		const message =
			'No character can read Reaction Corp: Corp Pilot needs the Director role; ' +
			'Outsider is not in the corporation; Alt Pilot has an invalid token';
		expect(output).toEqual({ ok: false, status: 'denied', message });
		expect(await source(23)).toMatchObject({
			status: 'denied',
			last_error: message,
			item_count: 0,
			character_id: 2023,
			data_expires_at: null
		});
		expect(await items(23)).toEqual([]);
		expect(assetTokens(calls)).toEqual(['Bearer at-1']);
		expect(await staged()).toEqual([]);
	});

	it('ends as denied when the character has not granted the feature, without a token refresh', async () => {
		await seedSource({ ...personal(6), scopes: 'esi-assets.read_assets.v1' });
		const { calls } = installEve({ pages: { 1: [] } });

		const output = await runSync('inventory-6-scopes', 6);

		expect(output).toEqual({ ok: false, status: 'denied', message: 'Pilot has not allowed Personal assets' });
		expect(await source(6)).toMatchObject({ status: 'denied' });
		expect(calls).toEqual([]);
	});

	it('marks a revoked token invalid and the source error, keeping the previous items', async () => {
		await seedSource({ ...personal(7), refreshToken: 'rt-revoked' });
		await seedItems(7, [[JITA, 'hangar', 4312, 7]]);
		const { calls } = installEve({ revoked: ['rt-revoked'], pages: { 1: [] } });

		const error = await failSync('inventory-7-revoked', 7);

		// A NonRetryableError fails the instance at once.
		expect(error.message).toContain('NonRetryableError');
		const row = await source(7);
		expect(row).toMatchObject({ status: 'error', item_count: 1 });
		expect(row!.last_error).toBe(`Pilot: ${TOKEN_ERROR_REVOKED}`);
		expect(await items(7)).toEqual([{ location_id: JITA, bucket: 'hangar', type_id: 4312, quantity: 7 }]);
		const character = await env.DB.prepare(
			'SELECT token_status FROM characters WHERE character_id = 1007'
		).first();
		expect(character).toEqual({ token_status: 'invalid' });
		expect(pathsOf(calls, /\/assets$/)).toEqual([]);
	});

	it('ends as error with more than 500 pages, keeping the previous items', async () => {
		await seedSource(personal(8));
		await seedItems(8, [[JITA, 'hangar', 4312, 7]]);
		const { calls } = installEve({
			totalPages: 501,
			pages: { 1: [asset(1, 4312, 1, JITA, 'Hangar', 'station')] }
		});

		const output = await runSync('inventory-8-huge', 8);

		expect(output).toEqual({
			ok: false,
			status: 'error',
			message: 'too many assets (501 pages, the limit is 500)'
		});
		expect(await source(8)).toMatchObject({ status: 'error', item_count: 1 });
		expect(await items(8)).toEqual([{ location_id: JITA, bucket: 'hangar', type_id: 4312, quantity: 7 }]);
		expect(pathsOf(calls, /\/assets$/)).toEqual(['/characters/1008/assets?page=1']);
		expect(await staged()).toEqual([]);
	});

	it('ends as error when a page keeps failing, keeping the previous items and deleting the staging', async () => {
		await seedSource(personal(9));
		await seedItems(9, [[JITA, 'hangar', 4312, 7]]);
		installFetch((url) => {
			if (url.hostname === 'login.eveonline.com')
				return json({ access_token: 'at-1', refresh_token: 'rt-next', expires_in: 1199 });
			if (url.pathname.endsWith('/industry/jobs')) return json([]);
			if (url.searchParams.get('page') === '1')
				return json([asset(1, 4312, 1, JITA, 'Hangar', 'station')], { 'X-Pages': '2' });
			return json({ error: 'unavailable' }, { 'Retry-After': '0' }, 503);
		});

		const error = await failSync('inventory-9-broken-page', 9);

		expect(error.message).toContain('ESI answered HTTP 503 for assets page 2');
		const row = await source(9);
		expect(row).toMatchObject({ status: 'error', item_count: 1 });
		expect(row!.last_error).toBe('ESI answered HTTP 503 for assets page 2; the next sync tries again.');
		expect(await items(9)).toEqual([{ location_id: JITA, bucket: 'hangar', type_id: 4312, quantity: 7 }]);
		expect(await staged()).toEqual([]);
	});
});
