import type { ServerLoadEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '#lib/server/data.js';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, defaults, insertSystems, insertUser, loadSde, putKv } from '../../test/fixtures';
import { insertItems, insertSource, selectBucket, typesByRole } from '../../test/inventory';
import { load } from './+page.server';

beforeEach(() => clearDataMemo());

const JITA = 60003760;

async function seededEnv() {
	const env = fakeEnv();
	const sde = await loadSde();
	await putKv(env, sde);
	insertSystems(env.DB);
	return { env, types: typesByRole(sde.dataset) };
}

async function run(path: string, env: FakeEnv | null = null, userId: string | null = null) {
	const event = {
		params: {},
		url: new URL(`https://reactions.coalition.space${path}`),
		locals: {
			settings: defaults(),
			user: userId ? { userId, characterId: null } : null,
			theme: 'dark',
			env: asEnv(env ?? (await seededEnv()).env)
		}
	} as unknown as ServerLoadEvent;
	return (await load(event as Parameters<typeof load>[0])) as Record<string, unknown>;
}

describe('/planner load', () => {
	it('returns the client engine data', async () => {
		const data = await run('/planner?inputsDaysAgo=3');
		expect(data).toMatchObject({ available: true, inputsDaysAgo: 3, settings: { cycleDays: 7 } });
		expect(Object.keys(data)).toEqual(
			expect.arrayContaining(['dataset', 'prices', 'inputPrices', 'profiles', 'hubs', 'volumes'])
		);
	});

	it('missing KV data → data-not-available state', async () => {
		expect(await run('/planner', fakeEnv())).toEqual({ available: false });
	});

	it('returns the selected inventory of the logged-in account only; null when anonymous or without sources', async () => {
		const { env, types } = await seededEnv();
		insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
		insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000003, name: 'Gamma' }]);
		insertUser(env.DB, { userId: 'u3' });
		const mine = insertSource(env.DB, { userId: 'u1', characterId: 90000001, ownerName: 'Alpha' });
		insertItems(env.DB, mine, JITA, 'hangar', { [types.fuel]: 100, [types.formula]: 2 });
		insertItems(env.DB, mine, JITA, 'deliveries', { [types.raw]: 7 });
		selectBucket(env.DB, mine, JITA, 'hangar');
		const theirs = insertSource(env.DB, { userId: 'u2', characterId: 90000003 });
		insertItems(env.DB, theirs, JITA, 'hangar', { [types.fuel]: 1_000_000 });
		selectBucket(env.DB, theirs, JITA, 'hangar');

		expect((await run('/planner', env, 'u1')).inventory).toEqual({
			stock: { [types.fuel]: 100 },
			formulas: { [types.formula]: 2 },
			sources: [
				{
					sourceId: mine,
					ownerName: 'Alpha',
					kind: 'character',
					status: 'ok',
					lastSyncedAt: NOW - 3_600_000,
					dataAsOf: NOW - 4_000_000
				}
			],
			oldestSyncAt: NOW - 3_600_000
		});
		expect((await run('/planner', env, null)).inventory).toBeNull();
		expect((await run('/planner', env, 'u3')).inventory).toBeNull();
	});
});
