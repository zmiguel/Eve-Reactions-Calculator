import type { ServerLoadEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import { asEnv, fakeEnv } from '../../test/fakes';
import { defaults, insertSystems, loadSde, putKv } from '../../test/fixtures';
import { load } from './+page.server';

beforeEach(() => clearDataMemo());

async function run(path: string, seeded = true) {
	const env = fakeEnv();
	if (seeded) {
		await putKv(env, await loadSde());
		insertSystems(env.DB);
	}
	const event = {
		params: {},
		url: new URL(`https://reactions.coalition.space${path}`),
		platform: { env: asEnv(env) },
		locals: { settings: defaults(), user: null, theme: 'dark' }
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
		expect(await run('/planner', false)).toEqual({ available: false });
	});
});
