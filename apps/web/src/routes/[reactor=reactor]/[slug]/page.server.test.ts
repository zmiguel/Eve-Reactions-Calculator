import { isHttpError, isRedirect, type ServerLoadEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { defaults, insertSystems, loadSde, putKv } from '../../../test/fixtures';
import { load } from './+page.server';

beforeEach(() => clearDataMemo());

async function run(path: string, seeded = true) {
	const env = fakeEnv();
	if (seeded) {
		await putKv(env, await loadSde());
		insertSystems(env.DB);
	}
	const url = new URL(`https://reactions.coalition.space${path}`);
	const [, reactor, slug] = url.pathname.split('/');
	const event = {
		params: { reactor, slug },
		url,
		platform: { env: asEnv(env) },
		locals: { settings: defaults(), user: null, theme: 'dark' }
	} as unknown as ServerLoadEvent;
	try {
		return { data: (await load(event as Parameters<typeof load>[0])) as Record<string, unknown> };
	} catch (e) {
		if (isRedirect(e)) return { redirect: { status: e.status, location: e.location } };
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
}

describe('/[reactor]/[slug] load', () => {
	it('serves the reaction page', async () => {
		const { data } = await run('/composite/titanium-carbide?view=chain');
		expect(data).toMatchObject({ available: true, query: { view: 'chain' } });
	});

	it('numeric product type id → 301 to the slug (old /hybrid/<id> URLs too)', async () => {
		expect((await run('/composite/16671')).redirect).toEqual({
			status: 301,
			location: '/composite/titanium-carbide'
		});
		const hybrid = (await loadSde()).dataset.reactions.find((r) => r.product.typeId === 30306)!;
		expect(hybrid.reactor).toBe('hybrid');
		expect((await run('/hybrid/30306')).redirect).toEqual({
			status: 301,
			location: `/hybrid/${hybrid.slug}`
		});
	});

	it('slug under the wrong reactor → 301 to the right one', async () => {
		expect((await run('/biochemical/titanium-carbide?view=chain')).redirect).toEqual({
			status: 301,
			location: '/composite/titanium-carbide?view=chain'
		});
	});

	it('unknown slug → 404', async () => {
		expect(await run('/composite/not-a-reaction')).toEqual({ status: 404 });
	});

	it('missing KV data → data-not-available state', async () => {
		expect((await run('/composite/titanium-carbide', false)).data).toEqual({
			available: false,
			reactor: 'composite',
			slug: 'titanium-carbide'
		});
	});
});
