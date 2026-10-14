import { DEFAULT_CONSTANTS, DEFAULT_SETTINGS, type Dataset, type IndustryData } from '@reactions/engine';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import type { TrackingSettingsPageData } from '$lib/server/tracking-settings';
import {
	ATHANOR,
	L_COMPONENT_RIG,
	L_REACTOR_RIG,
	M_COMPOSITE_RIG,
	M_COMPOSITE_RIG_II,
	M_EQUIPMENT_RIG,
	RAITARU,
	TATARA,
	industryFixture,
	insertTrackedFacility
} from '../../../test/facilities';
import { FakeCookies, fakeEnv, type FakeD1, type FakeEnv } from '../../../test/fakes';
import { NOW, insertStructureHub, insertSystems, insertUser, linkStructure } from '../../../test/fixtures';
import { insertLocation, insertSource } from '../../../test/inventory';
import { sessionUser } from '../../../test/sso';
import { actions, load } from './+page.server';

const alpha = { characterId: 90000001, name: 'Alpha' };
const gamma = { characterId: 90000003, name: 'Gamma' };
const FACTORY = 1035000000001;
const UNNAMED = 1035000000002;
const FOREIGN = 1035000000003;
/** A composite reaction product and a component (manufacturing) product. */
const COMPOSITE = 16670;
const COMPONENT = 11399;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	clearDataMemo();
});

function updaterStub(result: unknown = { users: 1 }) {
	return {
		rebuildLedger: vi.fn(async (_userId: string) => {
			if (result instanceof Error) throw result;
			return result;
		})
	};
}

function accounts(UPDATER: unknown = updaterStub(), extra: Record<string, unknown> = {}) {
	const env = fakeEnv({ UPDATER, ...extra } as never);
	insertSystems(env.DB);
	insertUser(env.DB, { userId: 'u1' }, [alpha]);
	insertUser(env.DB, { userId: 'u2' }, [gamma]);
	return { env, user: sessionUser('u1', [alpha]), other: sessionUser('u2', [gamma]) };
}

const setTracking = (db: FakeD1, sourceId: number, on: boolean, syncedAt: number | null = null) =>
	db.sqlite
		.prepare('UPDATE inventory_sources SET tracking_enabled = ?, tracking_synced_at = ? WHERE source_id = ?')
		.run(on ? 1 : 0, syncedAt, sourceId);

let nextJob = 1;
function insertJob(
	db: FakeD1,
	userId: string,
	sourceId: number,
	facilityId: number,
	manufacturing?: { blueprintTypeId: number; blueprintMe: number | null } | null,
	productTypeId: number | null = null
) {
	db.sqlite
		.prepare(
			`INSERT INTO tracked_jobs (user_id, job_id, source_id, installer_id, blueprint_type_id, runs, status,
				facility_id, output_location_id, start_date, end_date, activity_id, blueprint_me, product_type_id)
			VALUES (?, ?, ?, 1, ?, 1, 'delivered', ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			nextJob++,
			sourceId,
			manufacturing?.blueprintTypeId ?? 1,
			facilityId,
			facilityId,
			NOW - 7_200_000,
			NOW - 3_600_000,
			manufacturing ? 1 : 9,
			manufacturing?.blueprintMe ?? null,
			productTypeId
		);
}

let nextContract = 1;
function insertContract(
	db: FakeD1,
	userId: string,
	sourceId: number,
	/** `failed`: a Janice link whose appraisal failed (the updater's retry marker). */
	janice: 'none' | 'linked' | 'appraised' | 'failed'
): number {
	const contractId = nextContract++;
	db.sqlite
		.prepare(
			`INSERT INTO tracked_contracts (user_id, contract_id, source_id, type, status, issuer_id, issuer_corporation_id,
				acceptor_id, assignee_id, for_corporation, date_issued, janice_code, janice_json)
			VALUES (?, ?, ?, 'item_exchange', 'finished', 1, 1, 2, 2, 0, ?, ?, ?)`
		)
		.run(
			userId,
			contractId,
			sourceId,
			NOW,
			janice === 'none' ? null : 'abc',
			janice === 'appraised'
				? '{"code":"abc","items":[]}'
				: janice === 'failed'
					? `{"failures":1,"retryAt":${NOW}}`
					: null
		);
	return contractId;
}

/** A price of contract `contractId` (one type), needing review or not. */
function insertPrice(db: FakeD1, userId: string, contractId: number, needsReview: boolean) {
	db.sqlite
		.prepare(
			`INSERT INTO ledger_prices (user_id, ref, type_id, incoming, at, quantity, unit_price, source_kind,
				source_text, needs_review, transfer)
			VALUES (?, ?, 1, 1, ?, 1, 1, 'review', 'x', ?, 0)`
		)
		.run(userId, `contract:${contractId}`, NOW, needsReview ? 1 : 0);
}

function event(env: FakeEnv, user: SessionUser | null, fields?: Record<string, string | string[]>) {
	const url = new URL('https://reactions.coalition.space/account/tracking');
	let body: FormData | undefined;
	if (fields) {
		body = new FormData();
		for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
	}
	return {
		url,
		request: new Request(url, body ? { method: 'POST', body } : undefined),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function settle(promise: unknown): Promise<{ status?: number; data?: unknown; redirect?: string }> {
	try {
		const result = await promise;
		if (isActionFailure(result)) return { status: result.status, data: result.data };
		return { data: result };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

const pageData = async (env: FakeEnv, user: SessionUser) =>
	(await load(event(env, user))) as TrackingSettingsPageData;

const stored = (env: FakeEnv, userId: string) => {
	const [row] = env.DB.rows<{ tracking_json: string | null }>(
		'SELECT tracking_json FROM users WHERE user_id = ?',
		userId
	);
	return row.tracking_json === null ? null : JSON.parse(row.tracking_json);
};

const CONTRACTS = { hubId: 'amarr', basis: 'sell', expectedPct: '90', tolerancePct: '10' };
/** Stored settings fields the forms below do not change. */
const OTHER_DEFAULTS = {
	blueprintMe: {},
	manufacturingUse: 'buy_value',
	defaultPeriod: '30'
};
const WORKSHOP = 1035000000011;
const YARD = 1035000000012;
const BLUEPRINT = 99_001;
const READ_BLUEPRINT = 99_002;

/** {@link trackedAccounts} plus manufacturing jobs: u1 in two facilities, u2 and a tracking-off one elsewhere. */
function manufacturingAccounts(UPDATER?: unknown) {
	const setup = trackedAccounts(UPDATER);
	const { env, mine, theirs } = setup;
	insertLocation(env.DB, mine, WORKSHOP, { kind: 'structure', name: 'Workshop', systemId: 30002647 });
	insertJob(env.DB, 'u1', mine, WORKSHOP, { blueprintTypeId: BLUEPRINT, blueprintMe: null }, COMPONENT);
	insertJob(env.DB, 'u1', mine, WORKSHOP, { blueprintTypeId: BLUEPRINT, blueprintMe: null }, COMPONENT);
	insertJob(env.DB, 'u1', mine, YARD, { blueprintTypeId: READ_BLUEPRINT, blueprintMe: 9 });
	// Another user's and a tracking-off connection's manufacturing jobs never show.
	insertJob(env.DB, 'u2', theirs, FOREIGN, { blueprintTypeId: 99_003, blueprintMe: null });
	const off = insertSource(env.DB, {
		userId: 'u1',
		characterId: alpha.characterId,
		ownerId: 90000009,
		ownerName: 'Zulu'
	});
	insertJob(env.DB, 'u1', off, 1035000000098, { blueprintTypeId: 99_004, blueprintMe: null });
	return setup;
}

/** u1: a tracked personal connection with jobs in a named and an unnamed facility; u2 has its own data. */
function trackedAccounts(UPDATER?: unknown) {
	const setup = accounts(UPDATER);
	const { env } = setup;
	const mine = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId, ownerName: 'Alpha' });
	setTracking(env.DB, mine, true, NOW - 60_000);
	insertLocation(env.DB, mine, FACTORY, { kind: 'structure', name: 'Moon Factory', systemId: 30002647 });
	insertJob(env.DB, 'u1', mine, FACTORY, null, COMPOSITE);
	insertJob(env.DB, 'u1', mine, FACTORY, null, COMPOSITE);
	insertJob(env.DB, 'u1', mine, UNNAMED, null, COMPOSITE);
	const theirs = insertSource(env.DB, { userId: 'u2', characterId: gamma.characterId, ownerName: 'Gamma' });
	setTracking(env.DB, theirs, true);
	insertLocation(env.DB, theirs, UNNAMED, { kind: 'structure', name: 'Secret Base', systemId: 30000142 });
	insertJob(env.DB, 'u2', theirs, FOREIGN);
	insertPrice(env.DB, 'u2', insertContract(env.DB, 'u2', theirs, 'appraised'), true);
	return { ...setup, mine, theirs };
}

/** A dataset in KV with `industry` (or without industry data) and the composite formula making COMPOSITE. */
async function putDataset(env: FakeEnv, industry: IndustryData | undefined) {
	const dataset: Dataset = {
		sdeBuild: 1,
		reactions: [
			{
				blueprintTypeId: 46_201,
				slug: 'composite',
				name: 'Composite',
				formulaName: 'Composite Reaction Formula',
				reactor: 'composite',
				tier: 'composite',
				baseTimeSeconds: 10_800,
				maxRuns: 100,
				requiredSkillLevel: 1,
				product: { typeId: COMPOSITE, quantity: 200 },
				materials: []
			}
		],
		types: {},
		reprocess: {},
		constants: DEFAULT_CONSTANTS,
		industry
	};
	await env.CACHE.put('dataset:v1', JSON.stringify(dataset));
}

/**
 * {@link manufacturingAccounts} with EVE's lookups: the Moon Factory is a Tatara whose rigs were read
 * (a reactor rig and one without a material bonus); the Workshop a Raitaru whose rigs were not; u2's
 * lookup of the unnamed facility is not u1's. The dataset has industry data unless `industry` is false.
 */
async function facilityAccounts(UPDATER?: unknown, industry = true) {
	const setup = manufacturingAccounts(UPDATER);
	const { env } = setup;
	insertTrackedFacility(env.DB, 'u1', {
		facilityId: FACTORY,
		name: 'Moon Factory',
		systemId: 30002647,
		typeId: TATARA,
		rigs: [L_REACTOR_RIG, 99_999],
		rigsReadAt: NOW - 86_400_000
	});
	insertTrackedFacility(env.DB, 'u1', { facilityId: WORKSHOP, systemId: 30002647, typeId: RAITARU });
	insertTrackedFacility(env.DB, 'u2', { facilityId: UNNAMED, name: 'Secret Base', typeId: TATARA, rigs: [] });
	await putDataset(
		env,
		industry ? industryFixture({ composite: [COMPOSITE], component: [COMPONENT] }) : undefined
	);
	return setup;
}

describe('/account/tracking load', () => {
	it('sends anonymous visitors to log in and back', async () => {
		const { env } = accounts();
		expect(await settle(load(event(env, null)))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Ftracking'
		});
	});

	it('without tracked connections: empty summary and default settings', async () => {
		const { env, user } = accounts();
		// Inventory only: not tracked.
		insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId });
		const data = await pageData(env, user);
		expect(data.connections).toEqual([]);
		expect(data.facilities).toMatchObject({ list: [], needsInput: 0 });
		expect(data).toMatchObject({
			rebuiltAt: null,
			dirty: false,
			reviewCount: 0,
			janice: { linked: 0, appraised: 0 },
			settings: {
				contractRule: { hubId: 'jita', basis: 'buy', expectedPct: 100, tolerancePct: 5 },
				facilities: {}
			}
		});
	});

	it("summarizes only the user's tracked connections, facilities, Janice and review counts", async () => {
		const { env, user, mine } = trackedAccounts();
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		// A connection with tracking off: its jobs and contracts do not count.
		const off = insertSource(env.DB, {
			userId: 'u1',
			characterId: alpha.characterId,
			ownerId: 90000009,
			ownerName: 'Zulu'
		});
		insertJob(env.DB, 'u1', off, 1035000000099);
		const offContract = insertContract(env.DB, 'u1', off, 'appraised');
		setTracking(env.DB, corp, true);
		const plain = insertContract(env.DB, 'u1', mine, 'none');
		const linked = insertContract(env.DB, 'u1', mine, 'linked');
		const appraised = insertContract(env.DB, 'u1', corp, 'appraised');
		insertContract(env.DB, 'u1', mine, 'failed');
		// Contracts needing review, as `/profits/ledger?review=1` counts them: not the tracking-off connection's.
		insertPrice(env.DB, 'u1', plain, true);
		insertPrice(env.DB, 'u1', appraised, true);
		insertPrice(env.DB, 'u1', linked, false);
		insertPrice(env.DB, 'u1', offContract, true);
		env.DB.sqlite
			.prepare('INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES (?, ?, 0)')
			.run('u1', NOW);

		const data = await pageData(env, user);
		expect(data.connections).toEqual([
			{ sourceId: mine, kind: 'character', ownerName: 'Alpha', trackingSyncedAt: NOW - 60_000 },
			{ sourceId: corp, kind: 'corporation', ownerName: 'Seed Corp', trackingSyncedAt: null }
		]);
		expect(data.facilities.list.map((f) => [f.facilityId, f.name, f.systemName, f.band, f.jobs])).toEqual([
			[String(FACTORY), 'Moon Factory', 'Ignoitton', 'lowsec', { reaction: 2, manufacturing: 0 }],
			// Named only in the other user's places: not used.
			[String(UNNAMED), null, null, null, { reaction: 1, manufacturing: 0 }]
		]);
		// A failed appraisal is linked but not appraised.
		expect(data.janice).toEqual({ linked: 3, appraised: 1 });
		expect(data.reviewCount).toBe(2);
		expect(data).toMatchObject({ rebuiltAt: NOW, dirty: false });
	});

	it('shows a dirty ledger and private hubs of the user only', async () => {
		const { env, user, other } = accounts();
		env.DB.sqlite
			.prepare('INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES (?, ?, 1)')
			.run('u1', NOW);
		insertStructureHub(env.DB, { structureId: 1035000000500, name: 'My Market' });
		linkStructure(env.DB, 'u2', 1035000000500, gamma.characterId);
		expect((await pageData(env, user)).dirty).toBe(true);
		expect((await pageData(env, user)).hubs.map((h) => h.hubId)).not.toContain('structure-1035000000500');
		expect((await pageData(env, other)).hubs.map((h) => h.hubId)).toContain('structure-1035000000500');
	});
});

describe('/account/tracking actions', () => {
	it('sends anonymous visitors to log in', async () => {
		const { env } = accounts();
		expect(await settle(actions.contracts(event(env, null, CONTRACTS)))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Ftracking'
		});
		expect(await settle(actions.facilities(event(env, null, {})))).toEqual({
			redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Ftracking'
		});
	});

	it('saves the contract rule, keeps the facilities and rebuilds the ledger', async () => {
		const updater = updaterStub();
		const { env, user } = trackedAccounts(updater);
		env.DB.sqlite
			.prepare('UPDATE users SET tracking_json = ? WHERE user_id = ?')
			.run(JSON.stringify({ facilities: { [FACTORY]: { structureTypeId: TATARA, rigs: [] } } }), 'u1');
		const result = await settle(actions.contracts(event(env, user, CONTRACTS)));
		expect(result.status).toBeUndefined();
		expect(result.data).toMatchObject({ notice: 'Saved. Results recalculated.' });
		expect(stored(env, 'u1')).toEqual({
			contractRule: { hubId: 'amarr', basis: 'sell', expectedPct: 90, tolerancePct: 10 },
			facilities: { [FACTORY]: { structureTypeId: TATARA, rigs: [] } },
			...OTHER_DEFAULTS
		});
		expect(updater.rebuildLedger).toHaveBeenCalledWith('u1');
		expect(stored(env, 'u2')).toBeNull();
	});

	it.each([
		['expected % above 200', { expectedPct: '201' }],
		['expected % below 1', { expectedPct: '0' }],
		['tolerance above 50', { tolerancePct: '51' }],
		['missing tolerance', { tolerancePct: '' }],
		['unknown basis', { basis: 'average' }],
		['unknown hub', { hubId: 'nowhere' }]
	])('rejects %s without saving', async (_, change) => {
		const updater = updaterStub();
		const { env, user } = accounts(updater);
		const result = await settle(actions.contracts(event(env, user, { ...CONTRACTS, ...change })));
		expect(result.status).toBe(400);
		expect(stored(env, 'u1')).toBeNull();
		expect(updater.rebuildLedger).not.toHaveBeenCalled();
	});

	it("rejects another user's private hub; accepts the user's own", async () => {
		const { env, user } = accounts();
		insertStructureHub(env.DB, { structureId: 1035000000500, name: 'Their Market' });
		linkStructure(env.DB, 'u2', 1035000000500, gamma.characterId);
		const hub = { ...CONTRACTS, hubId: 'structure-1035000000500' };
		expect((await settle(actions.contracts(event(env, user, hub)))).status).toBe(400);
		expect(stored(env, 'u1')).toBeNull();

		linkStructure(env.DB, 'u1', 1035000000500, alpha.characterId);
		expect((await settle(actions.contracts(event(env, user, hub)))).status).toBeUndefined();
		expect(stored(env, 'u1').contractRule.hubId).toBe('structure-1035000000500');
	});

	it.each([
		['the updater is unavailable', updaterStub({ error: 'unavailable' })],
		['the updater fails', updaterStub(new Error('down'))],
		['there is no updater', null]
	])('when %s: saved, recalculated later', async (_, updater) => {
		const { env, user } = accounts(updater);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await settle(actions.contracts(event(env, user, CONTRACTS)));
		expect(result.data).toMatchObject({ notice: 'Saved. Results are recalculated within 10 minutes.' });
		expect(stored(env, 'u1').contractRule.hubId).toBe('amarr');
		// The ledger is marked dirty before the updater is asked; only a finished rebuild clears it.
		expect((await pageData(env, user)).dirty).toBe(true);
	});

	it('is rate limited', async () => {
		const { env, user } = accounts(updaterStub(), {
			ACCOUNT_RATE_LIMITER: { limit: async () => ({ success: false }) }
		});
		expect((await settle(actions.contracts(event(env, user, CONTRACTS)))).status).toBe(429);
		expect(stored(env, 'u1')).toBeNull();
	});
});

describe('/account/tracking manufacturing and default period', () => {
	const MANUFACTURING = (fields: Record<string, string> = {}) => ({
		manufacturingUse: 'zero',
		[`me-${BLUEPRINT}`]: '7',
		...fields
	});

	it("lists every facility and the unread blueprints of the user's tracking-on connections", async () => {
		const { env, user } = manufacturingAccounts();
		const data = await pageData(env, user);
		expect(data.facilities.list.map((f) => [f.facilityId, f.name, f.jobs])).toEqual([
			[String(FACTORY), 'Moon Factory', { reaction: 2, manufacturing: 0 }],
			[String(WORKSHOP), 'Workshop', { reaction: 0, manufacturing: 2 }],
			[String(UNNAMED), null, { reaction: 1, manufacturing: 0 }],
			[String(YARD), null, { reaction: 0, manufacturing: 1 }]
		]);
		// The blueprint read from EVE needs no ME; there is no dataset, so it is named by id.
		expect(data.blueprints).toEqual([
			{ blueprintTypeId: String(BLUEPRINT), name: `Blueprint ${BLUEPRINT}`, jobs: 2 }
		]);
		expect(data.settings).toMatchObject({ manufacturingUse: 'buy_value', defaultPeriod: '30' });
	});

	it('saves the use, facilities and blueprint ME, keeps the other settings and rebuilds', async () => {
		const updater = updaterStub();
		const { env, user } = manufacturingAccounts(updater);
		env.DB.sqlite.prepare('UPDATE users SET tracking_json = ? WHERE user_id = ?').run(
			JSON.stringify({
				facilities: { [FACTORY]: { structureTypeId: TATARA } },
				// Stored for a blueprint no longer listed: kept.
				blueprintMe: { '12345': 3 },
				defaultPeriod: '7'
			}),
			'u1'
		);
		const result = await settle(actions.manufacturing(event(env, user, MANUFACTURING())));
		expect(result.status).toBeUndefined();
		expect(result.data).toMatchObject({ form: 'manufacturing', notice: 'Saved. Results recalculated.' });
		expect(stored(env, 'u1')).toEqual({
			contractRule: { hubId: 'jita', basis: 'buy', expectedPct: 100, tolerancePct: 5 },
			facilities: { [FACTORY]: { structureTypeId: TATARA } },
			blueprintMe: { '12345': 3, [BLUEPRINT]: 7 },
			manufacturingUse: 'zero',
			defaultPeriod: '7'
		});
		expect(updater.rebuildLedger).toHaveBeenCalledWith('u1');
		expect(stored(env, 'u2')).toBeNull();
	});

	it.each([
		['an unknown use', { manufacturingUse: 'market' }],
		['an ME above 10', { [`me-${BLUEPRINT}`]: '11' }],
		['a negative ME', { [`me-${BLUEPRINT}`]: '-1' }],
		['a fractional ME', { [`me-${BLUEPRINT}`]: '2.5' }],
		['an empty ME', { [`me-${BLUEPRINT}`]: '' }],
		["another user's blueprint", { 'me-99003': '5' }],
		["a tracking-off connection's blueprint", { 'me-99004': '5' }],
		['a blueprint whose ME was read', { [`me-${READ_BLUEPRINT}`]: '5' }]
	])('rejects %s without saving', async (_, change) => {
		const updater = updaterStub();
		const { env, user } = manufacturingAccounts(updater);
		const result = await settle(actions.manufacturing(event(env, user, MANUFACTURING(change))));
		expect(result.status).toBe(400);
		expect(result.data).toMatchObject({ form: 'manufacturing' });
		expect(stored(env, 'u1')).toBeNull();
		expect(updater.rebuildLedger).not.toHaveBeenCalled();
	});

	it('saves the default period alone, without a rebuild; rejects unknown periods', async () => {
		const updater = updaterStub();
		const { env, user } = trackedAccounts(updater);
		env.DB.sqlite
			.prepare('UPDATE users SET tracking_json = ? WHERE user_id = ?')
			.run(JSON.stringify({ manufacturingUse: 'zero' }), 'u1');
		const bad = await settle(actions.period(event(env, user, { defaultPeriod: '14' })));
		expect(bad.status).toBe(400);
		expect(stored(env, 'u1').defaultPeriod).toBeUndefined();
		const result = await settle(actions.period(event(env, user, { defaultPeriod: 'all' })));
		expect(result.data).toEqual({ form: 'period', notice: 'Saved.' });
		expect(stored(env, 'u1')).toMatchObject({ defaultPeriod: 'all', manufacturingUse: 'zero' });
		expect(updater.rebuildLedger).not.toHaveBeenCalled();
		expect((await pageData(env, user)).settings.defaultPeriod).toBe('all');
	});

	it('sends anonymous visitors to log in', async () => {
		const { env } = accounts();
		for (const action of [actions.manufacturing, actions.period])
			expect(await settle(action(event(env, null, {})))).toEqual({
				redirect: '/auth/login?purpose=login&returnTo=%2Faccount%2Ftracking'
			});
	});
});

describe('/account/tracking facilities', () => {
	const view = (data: TrackingSettingsPageData, facilityId: number) =>
		data.facilities.list.find((f) => f.facilityId === String(facilityId))!;
	const names = (list: { name: string }[]) => list.map((s) => s.name);

	it('tells what EVE detected from what needs input, with the bonus of the job products', async () => {
		const { env, user } = await facilityAccounts();
		const data = await pageData(env, user);
		expect(data.facilities.list.map((f) => f.facilityId)).toEqual(
			[FACTORY, WORKSHOP, UNNAMED, YARD].map(String)
		);
		expect(view(data, FACTORY)).toMatchObject({
			name: 'Moon Factory',
			systemName: 'Ignoitton',
			band: 'lowsec',
			detectedStructure: { typeId: TATARA, name: 'Tatara' },
			detectedRigs: { names: ['Standup L-Set Reactor Efficiency II'], others: 1, readAt: NOW - 86_400_000 },
			needs: { structure: false, rigs: false },
			bonus: [{ activity: 'reaction', label: 'Composite Reactions', reduction: expect.closeTo(0.024, 10) }],
			reactionProfile: false
		});
		// A Raitaru whose rigs were not read: its role bonus applies to the component made there.
		expect(view(data, WORKSHOP)).toMatchObject({
			detectedStructure: { typeId: RAITARU, name: 'Raitaru' },
			detectedRigs: null,
			needs: { structure: false, rigs: true },
			bonus: [{ activity: 'manufacturing', label: 'Components', reduction: expect.closeTo(0.01, 10) }]
		});
		// u2's lookup is not used: unknown here, reaction jobs use the reactor settings.
		expect(view(data, UNNAMED)).toMatchObject({
			name: null,
			detectedStructure: null,
			needs: { structure: true, rigs: false },
			bonus: [],
			reactionProfile: true
		});
		expect(names(view(data, UNNAMED).structures)).toEqual(['Athanor', 'Tatara']);
		expect(names(view(data, YARD).structures)).toEqual(['Raitaru']);
		expect(data.facilities.needsInput).toBe(3);
		expect(data.facilities.industryAvailable).toBe(true);
		// Rigs that fit none of the listed structures (an L-Set engineering rig) are not offered.
		expect(data.facilities.rigs.map((r) => r.typeId)).toEqual([
			L_REACTOR_RIG,
			M_COMPOSITE_RIG,
			M_COMPOSITE_RIG_II,
			M_EQUIPMENT_RIG
		]);
	});

	it('without industry data: no rigs, the Upwell structures to pick, reactions on the reactor settings', async () => {
		const { env, user } = await facilityAccounts(undefined, false);
		const data = await pageData(env, user);
		expect(data.facilities).toMatchObject({ industryAvailable: false, rigs: [], needsInput: 2 });
		// In the reactor settings system (Ignoitton): their T2 ME rig.
		expect(view(data, FACTORY)).toMatchObject({
			detectedStructure: { typeId: TATARA, name: 'Tatara' },
			needs: { structure: false, rigs: false },
			bonus: [
				{
					activity: 'reaction',
					label: 'Reactions',
					reduction: expect.closeTo(0.024, 10),
					fromReactorSettings: true
				}
			],
			reactionProfile: false
		});
		expect(view(data, WORKSHOP)).toMatchObject({ needs: { structure: false, rigs: false }, bonus: [] });
		expect(names(view(data, UNNAMED).structures)).toEqual(['Athanor', 'Tatara']);
		expect(names(view(data, YARD).structures)).toEqual(['Raitaru', 'Azbel', 'Sotiyo']);
	});

	it('merges the posted facilities into the stored ones and rebuilds', async () => {
		const updater = updaterStub();
		const { env, user } = await facilityAccounts(updater);
		const gone = '1035000000077';
		env.DB.sqlite
			.prepare('UPDATE users SET tracking_json = ? WHERE user_id = ?')
			.run(JSON.stringify({ facilities: { [gone]: { structureTypeId: ATHANOR, rigs: [] } } }), 'u1');
		const result = await settle(
			actions.facilities(
				event(env, user, {
					[`structure-${UNNAMED}`]: String(ATHANOR),
					[`rigsFor-${UNNAMED}`]: String(ATHANOR),
					[`rig-${UNNAMED}`]: [String(M_COMPOSITE_RIG), 'none', 'none'],
					[`rigsFor-${WORKSHOP}`]: String(RAITARU),
					[`rig-${WORKSHOP}`]: [String(M_EQUIPMENT_RIG), 'none', ''],
					[`structure-${YARD}`]: '0'
				})
			)
		);
		expect(result).toMatchObject({ data: { form: 'facilities', notice: 'Saved. Results recalculated.' } });
		expect(stored(env, 'u1').facilities).toEqual({
			// Not among the listed facilities: kept.
			[gone]: { structureTypeId: ATHANOR, rigs: [] },
			[UNNAMED]: { structureTypeId: ATHANOR, rigs: [M_COMPOSITE_RIG] },
			[WORKSHOP]: { rigs: [M_EQUIPMENT_RIG] },
			[YARD]: { structureTypeId: 0 }
		});
		expect(updater.rebuildLedger).toHaveBeenCalledWith('u1');
		const data = await pageData(env, user);
		expect(data.facilities.needsInput).toBe(0);
		expect(view(data, UNNAMED).bonus).toEqual([
			{
				activity: 'reaction',
				label: 'Composite Reactions',
				reduction: expect.closeTo(0.02, 10),
				fromReactorSettings: false
			}
		]);
	});

	it('stores no rigs while every slot is left "Not set", and an empty list for "No rig"', async () => {
		const { env, user } = await facilityAccounts();
		const save = (rigs: string[]) =>
			settle(
				actions.facilities(
					event(env, user, { [`rigsFor-${WORKSHOP}`]: String(RAITARU), [`rig-${WORKSHOP}`]: rigs })
				)
			);
		await save(['', '', '']);
		expect(stored(env, 'u1').facilities).toEqual({});
		await save(['none', 'none', 'none']);
		expect(stored(env, 'u1').facilities).toEqual({ [WORKSHOP]: { rigs: [] } });
		await save(['', '', '']);
		expect(stored(env, 'u1').facilities).toEqual({});
	});

	it('a reaction facility in the reactor settings system takes what EVE could not tell from them', async () => {
		const { env, user, mine } = await facilityAccounts();
		const REFINERY = 1035000000021;
		const ELSEWHERE = 1035000000022;
		// Lookup refused: only the system is known (from the user's places). Default settings: Ignoitton
		// (30002647), Tatara, T2 ME rig.
		insertLocation(env.DB, mine, REFINERY, { kind: 'structure', name: 'Refinery', systemId: 30002647 });
		insertJob(env.DB, 'u1', mine, REFINERY, null, COMPOSITE);
		insertLocation(env.DB, mine, ELSEWHERE, { kind: 'structure', name: 'Far Away', systemId: 30000142 });
		insertJob(env.DB, 'u1', mine, ELSEWHERE, null, COMPOSITE);
		const data = await pageData(env, user);
		expect(view(data, REFINERY)).toMatchObject({
			reactorDefault: { structure: 'Tatara', meRig: 't2' },
			needs: { structure: false, rigs: false },
			reactionProfile: false,
			bonus: [
				{
					activity: 'reaction',
					label: 'Composite Reactions',
					reduction: expect.closeTo(0.024, 10),
					fromReactorSettings: true
				}
			]
		});
		// Another system: unknown, the user is asked.
		expect(view(data, ELSEWHERE)).toMatchObject({
			reactorDefault: null,
			needs: { structure: true, rigs: false },
			reactionProfile: true,
			bonus: []
		});
	});

	it('drops rigs picked for another structure; an empty structure clears the facility', async () => {
		const { env, user } = await facilityAccounts();
		env.DB.sqlite
			.prepare('UPDATE users SET tracking_json = ? WHERE user_id = ?')
			.run(
				JSON.stringify({ facilities: { [UNNAMED]: { structureTypeId: ATHANOR, rigs: [M_COMPOSITE_RIG] } } }),
				'u1'
			);
		await settle(
			actions.facilities(
				event(env, user, {
					[`structure-${UNNAMED}`]: String(TATARA),
					[`rigsFor-${UNNAMED}`]: String(ATHANOR),
					[`rig-${UNNAMED}`]: String(M_COMPOSITE_RIG)
				})
			)
		);
		expect(stored(env, 'u1').facilities).toEqual({ [UNNAMED]: { structureTypeId: TATARA } });
		expect(view(await pageData(env, user), UNNAMED).needs).toEqual({ structure: false, rigs: true });

		await settle(actions.facilities(event(env, user, { [`structure-${UNNAMED}`]: '' })));
		expect(stored(env, 'u1').facilities).toEqual({});
	});

	it.each([
		["another user's facility", { [`structure-${FOREIGN}`]: String(TATARA) }],
		['an unknown structure', { [`structure-${UNNAMED}`]: '12345' }],
		['a structure not running these jobs', { [`structure-${YARD}`]: String(ATHANOR) }],
		[
			'a rig that does not fit the structure',
			{
				[`structure-${UNNAMED}`]: String(ATHANOR),
				[`rigsFor-${UNNAMED}`]: String(ATHANOR),
				[`rig-${UNNAMED}`]: String(L_REACTOR_RIG)
			}
		],
		[
			'a rig not offered',
			{ [`rigsFor-${WORKSHOP}`]: String(RAITARU), [`rig-${WORKSHOP}`]: String(L_COMPONENT_RIG) }
		],
		[
			'more rigs than rig slots',
			{
				[`structure-${UNNAMED}`]: String(ATHANOR),
				[`rigsFor-${UNNAMED}`]: String(ATHANOR),
				[`rig-${UNNAMED}`]: Array(4).fill(String(M_COMPOSITE_RIG))
			}
		],
		[
			'two rigs of one kind (T1 and T2)',
			{
				[`structure-${UNNAMED}`]: String(ATHANOR),
				[`rigsFor-${UNNAMED}`]: String(ATHANOR),
				[`rig-${UNNAMED}`]: [String(M_COMPOSITE_RIG), String(M_COMPOSITE_RIG_II), 'none']
			}
		]
	])('rejects %s without saving', async (_, fields) => {
		const updater = updaterStub();
		const { env, user } = await facilityAccounts(updater);
		const result = await settle(actions.facilities(event(env, user, fields)));
		expect(result).toMatchObject({ status: 400, data: { form: 'facilities' } });
		expect(stored(env, 'u1')).toBeNull();
		expect(updater.rebuildLedger).not.toHaveBeenCalled();
	});
});
