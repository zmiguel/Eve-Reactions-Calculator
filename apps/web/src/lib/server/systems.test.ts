import { createEsiClient } from '@reactions/eve';
import { describe, expect, it } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import { insertSystems } from '../../test/fixtures';
import { fakeEve, type EveAnswers } from '../../test/sso';
import {
	SYSTEM_LOOKUP_FAILED,
	SYSTEM_UNKNOWN,
	SYSTEM_UNSUPPORTED,
	ensureSystem,
	getSystemByName,
	getSystemsByIds,
	searchSystems
} from './systems';

const env = () => {
	const e = fakeEnv();
	insertSystems(e.DB);
	e.DB.sqlite.exec(`INSERT INTO regions VALUES (10000058, 'Fountain')`);
	return asEnv(e);
};

describe('systems', () => {
	it('searchSystems matches a case-insensitive prefix including the last character boundary', async () => {
		const e = env();
		expect(
			(await searchSystems(e, { q: '671-s', limit: 10, reactionsOnly: true })).map((s) => s.name)
		).toEqual(['671-ST']);
		expect(await searchSystems(e, { q: '671-sz', limit: 10, reactionsOnly: true })).toEqual([]);
		expect((await searchSystems(e, { q: 'j', limit: 10, reactionsOnly: false })).map((s) => s.name)).toEqual([
			'J105443',
			'Jita'
		]);
	});

	it('getSystemsByIds returns region names and cost indices, skipping unknown ids', async () => {
		const found = await getSystemsByIds(env(), [30004604, 30002647, 42]);
		expect([...found.keys()].sort()).toEqual([30002647, 30004604]);
		expect(found.get(30004604)).toEqual({
			id: 30004604,
			name: '671-ST',
			regionName: 'Fountain',
			securityBand: 'nullsec',
			securityStatus: -0.2,
			reactionCostIndex: null
		});
		expect(found.get(30002647)?.reactionCostIndex).toBe(0.0412);
		expect((await getSystemsByIds(env(), [])).size).toBe(0);
	});

	it('getSystemByName matches the exact name case-insensitively', async () => {
		expect((await getSystemByName(env(), '  ignoitton '))?.id).toBe(30002647);
		expect(await getSystemByName(env(), 'Ignoit')).toBeNull();
	});
});

describe('ensureSystem', () => {
	const setup = (systems: EveAnswers['systems'] = {}) => {
		const e = fakeEnv();
		insertSystems(e.DB);
		e.DB.sqlite.exec(`INSERT INTO regions VALUES (10000058, 'Fountain')`);
		const eve = fakeEve({ systems });
		const client = createEsiClient({ fetch: eve.fetch, userAgent: 'test', sleep: async () => {} });
		return { e, env: asEnv(e), eve, client };
	};
	const rows = (e: FakeEnv, id: number) =>
		e.DB.sqlite
			.prepare(
				'SELECT s.name, s.region_id, s.security_status, s.security_band, r.name AS region FROM systems s LEFT JOIN regions r USING (region_id) WHERE s.system_id = ?'
			)
			.all(id);

	it('returns a stored system without asking ESI', async () => {
		const { env, eve, client } = setup();
		expect(await ensureSystem(env, client, 30004604)).toEqual({
			ok: true,
			system: { systemId: 30004604, name: '671-ST', regionId: 10000058, regionName: 'Fountain' }
		});
		expect(eve.calls).toHaveLength(0);
	});

	it('stores a missing system and its region with the SDE security band', async () => {
		const { e, env, eve, client } = setup({
			30004605: { name: 'G-M4I8', securityStatus: -0.05, regionId: 10000058, regionName: 'Fountain' },
			30003070: { name: 'Aldranette', securityStatus: 0.3, regionId: 10000048, regionName: 'Placid' },
			31000005: { name: 'Thera', securityStatus: -0.99, regionId: 11000031, regionName: 'G-R00031' }
		});
		expect(await ensureSystem(env, client, 30004605)).toEqual({
			ok: true,
			system: { systemId: 30004605, name: 'G-M4I8', regionId: 10000058, regionName: 'Fountain' }
		});
		expect(eve.calls.map((c) => new URL(c.url).pathname)).toEqual([
			'/universe/systems/30004605',
			'/universe/constellations/30004605',
			'/universe/regions/10000058'
		]);
		await ensureSystem(env, client, 30003070);
		await ensureSystem(env, client, 31000005);
		expect(rows(e, 30004605)).toEqual([
			{
				name: 'G-M4I8',
				region_id: 10000058,
				security_status: -0.05,
				security_band: 'nullsec',
				region: 'Fountain'
			}
		]);
		expect(rows(e, 30003070)).toEqual([
			{
				name: 'Aldranette',
				region_id: 10000048,
				security_status: 0.3,
				security_band: 'lowsec',
				region: 'Placid'
			}
		]);
		expect(rows(e, 31000005)).toEqual([
			{
				name: 'Thera',
				region_id: 11000031,
				security_status: -0.99,
				security_band: 'wormhole',
				region: 'G-R00031'
			}
		]);
		// Stored now: no second round of requests.
		const before = eve.calls.length;
		expect((await ensureSystem(env, client, 31000005)).ok).toBe(true);
		expect(eve.calls).toHaveLength(before);
	});

	it('reports an ESI failure or an unknown id and stores nothing', async () => {
		const { e, env, client } = setup({ 30004605: 503 });
		expect(await ensureSystem(env, client, 30004605)).toEqual({ ok: false, message: SYSTEM_LOOKUP_FAILED });
		expect(await ensureSystem(env, client, 30009999)).toEqual({ ok: false, message: SYSTEM_UNKNOWN });
		expect(rows(e, 30004605)).toEqual([]);
	});

	it('refuses Abyssal and other special space', async () => {
		const { e, env, client } = setup({
			32000001: { name: 'AD001', securityStatus: -1, regionId: 12000001, regionName: 'ADR01' }
		});
		expect(await ensureSystem(env, client, 32000001)).toEqual({ ok: false, message: SYSTEM_UNSUPPORTED });
		expect(rows(e, 32000001)).toEqual([]);
	});
});
