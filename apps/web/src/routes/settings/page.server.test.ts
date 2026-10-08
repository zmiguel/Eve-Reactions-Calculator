import {
	DEFAULT_SETTINGS,
	Settings,
	decodeJson,
	decodeSettings,
	encodeJson,
	encodeSettings
} from '@reactions/engine';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, insertStructureHub, insertSystems, insertUser, linkStructure } from '../../test/fixtures';
import { actions, load } from './+page.server';
import type { PageServerData } from './$types';

interface FailureData {
	errors: Record<string, string>;
	values: Settings;
	systemText: Record<string, string>;
	importError: string;
}

const SYSTEM_NAMES: Record<number, string> = {
	30002647: 'Ignoitton',
	30004604: '671-ST',
	31000007: 'J105443',
	30000142: 'Jita'
};

beforeEach(() => {
	clearDataMemo();
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

function seeded() {
	const env = fakeEnv();
	insertSystems(env.DB);
	return env;
}

const userOf = (userId: string): SessionUser => ({
	userId,
	characterId: null,
	characters: [],
	isAdmin: false
});

/** Form fields exactly as `SettingsForm` names them, for the profiles the form would show. */
function formFor(
	s: Settings,
	overrides: Record<string, string | null> = {},
	editing: Settings['mode'] = s.mode
) {
	const form = new FormData();
	const add = (prefix: string, value: unknown) => {
		if (typeof value === 'object' && value !== null) {
			for (const [k, v] of Object.entries(value)) add(prefix ? `${prefix}.${k}` : k, v);
		} else if (typeof value === 'boolean') {
			if (value) form.set(prefix, 'on');
		} else form.set(prefix, value === null ? '' : String(value));
	};
	add('', {
		mode: s.mode,
		cycleDays: s.cycleDays,
		slotAllocation: s.slotAllocation,
		defaultView: s.defaultView,
		defaultOutput: s.defaultOutput,
		unrefinedInChains: s.unrefinedInChains,
		reprocessing: s.reprocessing
	});
	form.set('editing', editing);
	const profiles = editing === 'shared' ? { shared: s.shared } : { reactors: s.reactors };
	add('', profiles);
	for (const prefix of editing === 'shared'
		? ['shared']
		: ['reactors.biochemical', 'reactors.composite', 'reactors.hybrid']) {
		form.set(`${prefix}.system`, SYSTEM_NAMES[Number(form.get(`${prefix}.systemId`))] ?? '');
	}
	for (const [k, v] of Object.entries(overrides)) {
		if (v === null) form.delete(k);
		else form.set(k, v);
	}
	return form;
}

interface Ctx {
	env: FakeEnv;
	cookies: FakeCookies;
	settings?: Settings;
	user?: SessionUser | null;
}

function event(ctx: Ctx, path: string, form?: FormData) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	return {
		url,
		request: new Request(url, form ? { method: 'POST', body: form } : undefined),
		cookies: ctx.cookies.asCookies(),
		platform: { env: ctx.env },
		locals: { settings: ctx.settings ?? DEFAULT_SETTINGS, user: ctx.user ?? null, theme: 'dark' }
	} as unknown as RequestEvent;
}

async function act(name: 'save' | 'reset' | 'import', ctx: Ctx, form = new FormData()) {
	try {
		const result = await actions[name](event(ctx, `/settings?/${name}`, form) as never);
		if (isActionFailure(result))
			return { status: result.status, data: result.data as unknown as FailureData };
		throw new Error(`unexpected action result ${JSON.stringify(result)}`);
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location };
		throw e;
	}
}

const settingsCookie = (cookies: FakeCookies) => cookies.jar.get('rc_settings');
const userRow = (env: FakeEnv) =>
	env.DB.rows<{ settings_json: string | null; settings_updated_at: number | null }>(
		'SELECT settings_json, settings_updated_at FROM users'
	)[0];

describe('save', () => {
	it('stores only the diff in the cookie, which decodes to the submitted values', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const submitted = Settings.parse({ shared: { structure: 'athanor', market: { brokerFeePct: 2.25 } } });
		expect(await act('save', ctx, formFor(submitted))).toEqual({ redirect: '/settings?notice=saved' });
		const cookie = settingsCookie(ctx.cookies)!;
		expect(await decodeSettings(cookie)).toEqual(submitted);
		expect(await decodeJson(cookie)).toEqual({
			v: 1,
			shared: { structure: 'athanor', market: { brokerFeePct: 2.25 } }
		});
		expect(ctx.cookies.set_calls.at(-1)!.opts).toMatchObject({
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 31_536_000
		});
	});

	it('anonymous saves touch only the cookie', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		insertUser(ctx.env.DB, { userId: 'someone' });
		const before = ctx.env.DB.log.length;
		await act('save', ctx, formFor(Settings.parse({ cycleDays: 3 })));
		expect(ctx.env.DB.log.slice(before).filter((sql) => /^\s*(update|insert|delete)/i.test(sql))).toEqual([]);
		expect(userRow(ctx.env)).toEqual({ settings_json: null, settings_updated_at: null });
		expect(settingsCookie(ctx.cookies)).toBeDefined();
	});

	it('logged-in saves write both the cookie and the account (sparse JSON + timestamp)', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'u1' });
		const ctx = { env, cookies: new FakeCookies(), user: userOf('u1') };
		await act('save', ctx, formFor(Settings.parse({ shared: { reactionsSkill: 4 } })));
		expect(JSON.parse(userRow(env).settings_json!)).toEqual({ v: 1, shared: { reactionsSkill: 4 } });
		expect(userRow(env).settings_updated_at).toBe(NOW);
		expect((await decodeSettings(settingsCookie(ctx.cookies)!))?.shared.reactionsSkill).toBe(4);
	});

	it('saving the defaults deletes the cookie instead of writing one', async () => {
		const cookies = new FakeCookies({ rc_settings: await encodeSettings(Settings.parse({ cycleDays: 3 })) });
		await act('save', { env: seeded(), cookies }, formFor(DEFAULT_SETTINGS));
		expect(settingsCookie(cookies)).toBeUndefined();
		expect(cookies.deleted).toEqual(['rc_settings']);
	});

	it('saves the optimal chain slot allocation as a one-field diff and rejects unknown modes', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const optimal = Settings.parse({ slotAllocation: 'optimal' });
		expect(await act('save', ctx, formFor(optimal))).toEqual({ redirect: '/settings?notice=saved' });
		expect(await decodeJson(settingsCookie(ctx.cookies)!)).toEqual({ v: 1, slotAllocation: 'optimal' });
		expect(await decodeSettings(settingsCookie(ctx.cookies)!)).toEqual(optimal);

		const bad = await act('save', ctx, formFor(DEFAULT_SETTINGS, { slotAllocation: 'parallel' }));
		expect(bad).toMatchObject({
			status: 400,
			data: { errors: { slotAllocation: 'Choose one of the options' } }
		});
	});

	it('saves "Open reactions on: Full chain" as a one-field diff and rejects unknown views', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const chainFirst = Settings.parse({ defaultView: 'chain' });
		expect(await act('save', ctx, formFor(chainFirst))).toEqual({ redirect: '/settings?notice=saved' });
		expect(await decodeJson(settingsCookie(ctx.cookies)!)).toEqual({ v: 1, defaultView: 'chain' });
		const bad = await act('save', ctx, formFor(DEFAULT_SETTINGS, { defaultView: 'reprocessed' }));
		expect(bad).toMatchObject({
			status: 400,
			data: { errors: { defaultView: 'Choose one of the options' } }
		});
	});

	it('saves "Open reprocessable reactions on: Reprocess" as a one-field diff and rejects unknown outputs', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const reprocessFirst = Settings.parse({ defaultOutput: 'reprocessed' });
		expect(await act('save', ctx, formFor(reprocessFirst))).toEqual({ redirect: '/settings?notice=saved' });
		expect(await decodeJson(settingsCookie(ctx.cookies)!)).toEqual({ v: 1, defaultOutput: 'reprocessed' });
		const bad = await act('save', ctx, formFor(DEFAULT_SETTINGS, { defaultOutput: 'chain' }));
		expect(bad).toMatchObject({
			status: 400,
			data: { errors: { defaultOutput: 'Choose one of the options' } }
		});
	});

	it('saves "Unrefined reactions in chains: When better" as a one-field diff and rejects unknown values', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const best = Settings.parse({ unrefinedInChains: 'best' });
		expect(await act('save', ctx, formFor(best))).toEqual({ redirect: '/settings?notice=saved' });
		expect(await decodeJson(settingsCookie(ctx.cookies)!)).toEqual({ v: 1, unrefinedInChains: 'best' });
		const bad = await act('save', ctx, formFor(DEFAULT_SETTINGS, { unrefinedInChains: 'always' }));
		expect(bad).toMatchObject({
			status: 400,
			data: { errors: { unrefinedInChains: 'Choose one of the options' } }
		});
	});

	it('rejects out-of-range numbers with field errors and keeps the submitted values', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const result = await act(
			'save',
			ctx,
			formFor(DEFAULT_SETTINGS, {
				'shared.facilityTaxPct': '75',
				'shared.market.inputPricePct': '20',
				cycleDays: '0.1',
				'shared.sccPct': 'abc'
			})
		);
		expect(result.status).toBe(400);
		expect(result.data!.errors).toEqual({
			'shared.facilityTaxPct': 'Must be at most 50',
			'shared.market.inputPricePct': 'Must be at least 50',
			'shared.sccPct': 'Enter a number',
			cycleDays: 'Must be at least 0.25'
		});
		const values = result.data!.values as Settings;
		expect(values.shared.facilityTaxPct).toBe(75);
		expect(values.shared.market.inputPricePct).toBe(20);
		expect(values.cycleDays).toBe(0.1);
		expect(ctx.cookies.set_calls).toEqual([]);
	});

	it('rejects highsec and unknown systems with a field error', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const highsec = await act(
			'save',
			ctx,
			formFor(DEFAULT_SETTINGS, { 'shared.systemId': '30000142', 'shared.system': 'Jita' })
		);
		expect(highsec.status).toBe(400);
		expect(highsec.data!.errors['shared.systemId']).toMatch(/Jita is a highsec system/);
		expect(highsec.data!.systemText).toEqual({ shared: 'Jita' });

		const unknown = await act(
			'save',
			ctx,
			formFor(DEFAULT_SETTINGS, { 'shared.systemId': '', 'shared.system': 'Nowhere' })
		);
		expect(unknown.data!.errors).toEqual({ 'shared.systemId': 'Unknown system "Nowhere"' });
		expect(unknown.data!.systemText).toEqual({ shared: 'Nowhere' });
		expect(ctx.cookies.set_calls).toEqual([]);
	});

	it('resolves a typed system name or id without JS (stale hidden id)', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		await act(
			'save',
			ctx,
			formFor(DEFAULT_SETTINGS, { 'shared.systemId': '30002647', 'shared.system': '671-st' })
		);
		expect((await decodeSettings(settingsCookie(ctx.cookies)!))?.shared.systemId).toBe(30004604);
		await act('save', ctx, formFor(DEFAULT_SETTINGS, { 'shared.systemId': '', 'shared.system': '31000007' }));
		expect((await decodeSettings(settingsCookie(ctx.cookies)!))?.shared.systemId).toBe(31000007);
	});

	it('rejects a hub that is not accessible (another user’s private structure market)', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'owner' }, [{ characterId: 90000001, name: 'Owner' }]);
		insertUser(env.DB, { userId: 'other' }, [{ characterId: 90000002, name: 'Other' }]);
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Seed Market' });
		linkStructure(env.DB, 'owner', 1044752365771, 90000001);
		const form = () => formFor(DEFAULT_SETTINGS, { 'shared.market.inputHub': 'structure-1044752365771' });

		const other = { env, cookies: new FakeCookies(), user: userOf('other') };
		const rejected = await act('save', other, form());
		expect(rejected.status).toBe(400);
		expect(rejected.data!.errors).toEqual({
			'shared.market.inputHub': 'This market hub is not available to you'
		});
		expect(userRow(env).settings_json).toBeNull();

		const anonymous = await act('save', { env, cookies: new FakeCookies() }, form());
		expect(anonymous.status).toBe(400);

		const owner = { env, cookies: new FakeCookies(), user: userOf('owner') };
		expect(await act('save', owner, form())).toEqual({ redirect: '/settings?notice=saved' });
	});

	it('switching to per-reactor copies the shared profile into all three reactors', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const shared = Settings.parse({ shared: { structure: 'athanor', teRig: 't1', systemId: 30004604 } });
		const form = formFor(shared, { mode: 'per_reactor' }, 'shared');
		expect(await act('save', ctx, form)).toEqual({ redirect: '/settings?notice=saved' });
		const saved = (await decodeSettings(settingsCookie(ctx.cookies)!))!;
		expect(saved.mode).toBe('per_reactor');
		for (const r of ['biochemical', 'composite', 'hybrid'] as const)
			expect(saved.reactors[r]).toEqual(saved.shared);
		expect(saved.reactors.composite).toMatchObject({ structure: 'athanor', teRig: 't1', systemId: 30004604 });
	});

	it('per-reactor saves change only the edited reactor; errors are keyed per reactor', async () => {
		const current = Settings.parse({ mode: 'per_reactor' });
		const ctx = { env: seeded(), cookies: new FakeCookies(), settings: current };
		await act(
			'save',
			ctx,
			formFor(current, { 'reactors.composite.meRig': 't1', 'reactors.composite.teRig': 't1' })
		);
		const saved = (await decodeSettings(settingsCookie(ctx.cookies)!))!;
		expect(saved.reactors.composite).toMatchObject({ meRig: 't1', teRig: 't1' });
		expect(saved.reactors.hybrid).toEqual(DEFAULT_SETTINGS.reactors.hybrid);
		expect(saved.shared).toEqual(DEFAULT_SETTINGS.shared);

		const bad = await act('save', ctx, formFor(current, { 'reactors.hybrid.market.brokerFeePct': '11' }));
		expect(bad.data!.errors).toEqual({ 'reactors.hybrid.market.brokerFeePct': 'Must be at most 10' });
	});

	it('disabled (unposted) shipping fields keep their saved values; unchecked boxes turn shipping off', async () => {
		const current = Settings.parse({
			shared: { shipping: { input: { enabled: true, iskPerM3: 800, discountPct: 20 } } }
		});
		const ctx = { env: seeded(), cookies: new FakeCookies(), settings: current };
		const form = formFor(current, {
			'shared.shipping.input.enabled': null,
			'shared.shipping.input.iskPerM3': null,
			'shared.shipping.input.collateralPct': null,
			'shared.shipping.input.discountPct': null
		});
		await act('save', ctx, form);
		const saved = (await decodeSettings(settingsCookie(ctx.cookies)!))!;
		expect(saved.shared.shipping.input).toEqual({
			enabled: false,
			iskPerM3: 800,
			collateralPct: 0,
			discountPct: 20
		});
	});

	it('saves a shipping discount per side and rejects out-of-range discounts', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const submitted = Settings.parse({
			shared: {
				shipping: {
					input: { enabled: true, iskPerM3: 1000, discountPct: 25 },
					output: { enabled: true, iskPerM3: 500, discountPct: 10 }
				}
			}
		});
		expect(await act('save', ctx, formFor(submitted))).toEqual({ redirect: '/settings?notice=saved' });
		expect(await decodeSettings(settingsCookie(ctx.cookies)!)).toEqual(submitted);
		expect(await decodeJson(settingsCookie(ctx.cookies)!)).toEqual({
			v: 1,
			shared: {
				shipping: {
					input: { enabled: true, iskPerM3: 1000, discountPct: 25 },
					output: { enabled: true, iskPerM3: 500, discountPct: 10 }
				}
			}
		});

		const bad = await act(
			'save',
			ctx,
			formFor(submitted, {
				'shared.shipping.input.discountPct': '101',
				'shared.shipping.output.discountPct': '-5'
			})
		);
		expect(bad.status).toBe(400);
		expect(bad.data!.errors).toEqual({
			'shared.shipping.input.discountPct': 'Must be at most 100',
			'shared.shipping.output.discountPct': 'Must be at least 0'
		});
		expect((bad.data!.values as Settings).shared.shipping.input.discountPct).toBe(101);
	});
});

describe('reset', () => {
	it('deletes the cookie (anonymous)', async () => {
		const cookies = new FakeCookies({ rc_settings: await encodeSettings(Settings.parse({ cycleDays: 2 })) });
		expect(await act('reset', { env: seeded(), cookies })).toEqual({ redirect: '/settings?notice=reset' });
		expect(settingsCookie(cookies)).toBeUndefined();
		expect(cookies.deleted).toEqual(['rc_settings']);
	});

	it('stores the defaults on the account when logged in', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'u1', settings: Settings.parse({ cycleDays: 2 }) });
		const cookies = new FakeCookies({ rc_settings: await encodeSettings(Settings.parse({ cycleDays: 2 })) });
		await act('reset', { env, cookies, user: userOf('u1') });
		expect(userRow(env)).toEqual({ settings_json: '{"v":1}', settings_updated_at: NOW });
		expect(cookies.deleted).toEqual(['rc_settings']);
	});
});

describe('import', () => {
	const shared = Settings.parse({ shared: { structure: 'athanor', meRig: 't1' } });

	it('applies valid settings', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const form = new FormData();
		form.set('code', await encodeSettings(shared));
		expect(await act('import', ctx, form)).toEqual({ redirect: '/settings?notice=imported' });
		expect(await decodeSettings(settingsCookie(ctx.cookies)!)).toEqual(shared);
	});

	it('round-trips shipping discounts', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const discounted = Settings.parse({
			shared: { shipping: { input: { enabled: true, discountPct: 30 }, output: { discountPct: 12.5 } } }
		});
		const form = new FormData();
		form.set('code', await encodeSettings(discounted));
		expect(await act('import', ctx, form)).toEqual({ redirect: '/settings?notice=imported' });
		expect(await decodeSettings(settingsCookie(ctx.cookies)!)).toEqual(discounted);
	});

	it('rejects garbage and settings referencing highsec without changing anything', async () => {
		const original = await encodeSettings(Settings.parse({ cycleDays: 2 }));
		const ctx = { env: seeded(), cookies: new FakeCookies({ rc_settings: original }) };
		for (const code of ['garbage!!', await encodeJson({ shared: { systemId: 30000142 } })]) {
			const form = new FormData();
			form.set('code', code);
			const result = await act('import', ctx, form);
			expect(result.status).toBe(400);
			expect(result.data!.importError).toMatch(/not changed/);
		}
		expect(ctx.cookies.set_calls).toEqual([]);
		expect(settingsCookie(ctx.cookies)).toBe(original);
	});
});

describe('load', () => {
	async function run(ctx: Ctx, path = '/settings') {
		return (await load(event(ctx, path) as never)) as PageServerData;
	}

	it('lists accessible hubs, the referenced systems and a share code of the diff', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const data = await run(ctx);
		expect(data.hubs.map((h) => h.hubId)).toEqual(['jita', 'amarr', 'perimeter', 'dodixie', 'rens', 'hek']);
		expect(data.systems[30002647].name).toBe('Ignoitton');
		expect(await decodeJson(data.shareCode)).toEqual({ v: 1 });
		expect(data.account).toBeNull();
		expect(data.importPreview).toBeNull();
		expect(data.notice).toBeNull();
	});

	it('reports the account sync time when logged in', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'u1' });
		env.DB.sqlite.exec(`UPDATE users SET settings_updated_at = ${NOW - 5000}`);
		expect((await run({ env, cookies: new FakeCookies(), user: userOf('u1') })).account).toEqual({
			updatedAt: NOW - 5000
		});
	});

	it('lists a private structure hub for its owner only, after the public hubs', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'owner' }, [{ characterId: 90000001, name: 'Owner' }]);
		insertUser(env.DB, { userId: 'other' }, [{ characterId: 90000002, name: 'Other' }]);
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Seed Market' });
		linkStructure(env.DB, 'owner', 1044752365771, 90000001);
		const owner = await run({ env, cookies: new FakeCookies(), user: userOf('owner') });
		expect(owner.hubs.at(-1)).toMatchObject({ hubId: 'structure-1044752365771', private: true });
		expect(owner.hubs).toHaveLength(7);
		for (const user of [userOf('other'), null]) {
			const data = await run({ env, cookies: new FakeCookies(), user });
			expect(data.hubs.map((h) => h.hubId)).not.toContain('structure-1044752365771');
		}
	});

	it('?import= previews the differences and changes nothing', async () => {
		const env = seeded();
		insertUser(env.DB, { userId: 'u1' });
		const cookies = new FakeCookies();
		const imported = Settings.parse({ shared: { structure: 'athanor', systemId: 30004604 }, cycleDays: 3 });
		const before = env.DB.log.length;
		const data = await run(
			{ env, cookies, user: userOf('u1') },
			`/settings?import=${await encodeSettings(imported)}`
		);
		expect(data.importPreview!.changes.map((c) => [c.label, c.from, c.to])).toEqual([
			['Structure', 'Tatara', 'Athanor'],
			['System', 'Ignoitton', '671-ST'],
			['Cycle days', '7', '3']
		]);
		expect(data.importPreview!.problems).toEqual([]);
		expect(cookies.set_calls).toEqual([]);
		expect(env.DB.log.slice(before).filter((sql) => /^\s*(update|insert|delete)/i.test(sql))).toEqual([]);
	});

	it('?import= with garbage shows a notice; with a highsec system lists the problem', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		const garbage = await run(ctx, '/settings?import=nonsense');
		expect(garbage.importInvalid).toMatch(/not valid/);
		expect(garbage.importPreview).toBeNull();
		const highsec = await run(
			ctx,
			`/settings?import=${await encodeJson({ shared: { systemId: 30000142 } })}`
		);
		expect(highsec.importPreview!.problems).toEqual([
			'Shared profile · System: Jita is a highsec system; reactions need low, null or J-space'
		]);
	});

	it('accepts only known notices', async () => {
		const ctx = { env: seeded(), cookies: new FakeCookies() };
		expect((await run(ctx, '/settings?notice=saved')).notice).toBe('saved');
		expect((await run(ctx, '/settings?notice=<script>')).notice).toBeNull();
	});
});
