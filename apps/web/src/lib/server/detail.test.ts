import { isHttpError, isRedirect } from '@sveltejs/kit';
import { Settings, chainable, unrefinable } from '@reactions/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import {
	NOW,
	defaults,
	insertLatestPrice,
	insertStructureHub,
	insertSystems,
	insertUser,
	linkStructure,
	loadSde,
	routeMarket,
	putKv
} from '../../test/fixtures';
import { clearDataMemo } from './data';
import {
	clampDays,
	defaultBoughtDays,
	loadDetail,
	parseDetailQuery,
	resolveDetailRoute,
	type DetailData
} from './detail';
import { isoDate } from './prices';

const DAY = 86_400_000;

beforeEach(() => clearDataMemo());

async function seeded() {
	const env = fakeEnv();
	await putKv(env, await loadSde());
	insertSystems(env.DB);
	return env;
}

async function detail(env: FakeEnv, path: string, settings = defaults()) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	const [, reactor, slug] = url.pathname.split('/');
	return (await loadDetail(
		asEnv(env),
		{ settings, user: null },
		{ reactor: reactor as 'composite', slug },
		url,
		NOW
	)) as DetailData;
}

async function thrown(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (e) {
		if (isRedirect(e)) return { status: e.status, location: e.location };
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
	throw new Error('expected a redirect or HTTP error');
}

describe('resolveDetailRoute', () => {
	it('finds by slug, redirects numeric ids and wrong reactors, 404s unknown slugs', async () => {
		const { dataset } = await loadSde();
		expect(resolveDetailRoute(dataset, 'composite', 'titanium-carbide')).toMatchObject({ kind: 'found' });
		expect(resolveDetailRoute(dataset, 'composite', '16671', '?view=chain')).toEqual({
			kind: 'redirect',
			location: '/composite/titanium-carbide?view=chain'
		});
		expect(resolveDetailRoute(dataset, 'biochemical', 'titanium-carbide')).toEqual({
			kind: 'redirect',
			location: '/composite/titanium-carbide'
		});
		expect(resolveDetailRoute(dataset, 'composite', 'no-such-thing')).toEqual({ kind: 'not_found' });
		expect(resolveDetailRoute(dataset, 'composite', '99999999')).toEqual({ kind: 'not_found' });
	});
});

describe('parseDetailQuery', () => {
	it('applies view/output only where possible and clamps bought days', async () => {
		const { dataset } = await loadSde();
		const find = (slug: string) => dataset.reactions.find((r) => r.slug === slug)!;
		const q = (s: string, slug: string) => parseDetailQuery(new URLSearchParams(s), find(slug), dataset);
		expect(q('view=chain&output=reprocessed&bought=12&range=1y', 'titanium-carbide')).toEqual({
			view: 'chain',
			outputMode: 'product',
			bought: 12,
			range: '1y',
			slots: null,
			lines: null
		});
		expect(q('view=chain&slots=optimal', 'titanium-carbide').slots).toBe('optimal');
		expect(q('view=chain&slots=single', 'titanium-carbide').slots).toBe('single');
		expect(q('view=chain&slots=parallel', 'titanium-carbide').slots).toBeNull();
		expect(q('slots=optimal', 'titanium-carbide').slots).toBeNull();
		expect(q('view=chain&lines=3', 'titanium-carbide').lines).toBe(3);
		for (const bad of ['0', '11', '2.5', 'abc', '', '-1'])
			expect(q(`view=chain&lines=${bad}`, 'titanium-carbide').lines).toBeNull();
		expect(q('lines=3', 'titanium-carbide').lines).toBeNull();
		expect(q('view=chain&output=reprocessed', 'unrefined-hexite')).toMatchObject({
			view: 'single',
			outputMode: 'reprocessed'
		});
		expect(q('bought=100', 'caesarium-cadmide').bought).toBe(60);
		expect(q('bought=-3', 'caesarium-cadmide').bought).toBe(0);
		expect(q('bought=abc&range=5y', 'caesarium-cadmide')).toMatchObject({ bought: null, range: '30d' });
		expect(q('bought=', 'caesarium-cadmide').bought).toBeNull();
	});

	it('without ?view= / ?output= opens on the preferred tabs where they apply; the query overrides them', async () => {
		const { dataset } = await loadSde();
		const find = (slug: string) => dataset.reactions.find((r) => r.slug === slug)!;
		const prefs = { view: 'chain', output: 'reprocessed' } as const;
		const q = (s: string, slug: string) =>
			parseDetailQuery(new URLSearchParams(s), find(slug), dataset, prefs);
		expect(q('', 'titanium-carbide')).toMatchObject({ view: 'chain', outputMode: 'product' });
		expect(q('view=single', 'titanium-carbide').view).toBe('single');
		expect(q('', 'unrefined-hexite')).toMatchObject({ view: 'single', outputMode: 'reprocessed' });
		expect(q('output=product', 'unrefined-hexite').outputMode).toBe('product');
		// Neither tab exists: buy inputs and sell the product regardless of the settings.
		expect(q('', 'caesarium-cadmide')).toMatchObject({ view: 'single', outputMode: 'product' });
	});

	it('?view=unrefined applies where the chain has an unrefined route, else falls back', async () => {
		const { dataset } = await loadSde();
		const find = (slug: string) => dataset.reactions.find((r) => r.slug === slug)!;
		const q = (s: string, slug: string) => parseDetailQuery(new URLSearchParams(s), find(slug), dataset);
		expect(q('view=unrefined&slots=optimal&lines=2', 'fermionic-condensates')).toMatchObject({
			view: 'unrefined',
			slots: 'optimal',
			lines: 2
		});
		expect(q('view=unrefined', 'caesarium-cadmide').view).toBe('single');
		const noRoute = dataset.reactions.find(
			(r) => chainable(r, dataset) && !unrefinable(r, dataset) && r.reactor === 'biochemical'
		)!;
		expect(parseDetailQuery(new URLSearchParams('view=unrefined'), noRoute, dataset).view).toBe('chain');
	});

	it('default bought days = chain depth × cycle days, clamped to 0–60', () => {
		expect(defaultBoughtDays(1, 7)).toBe(7);
		expect(defaultBoughtDays(2, 7)).toBe(14);
		expect(defaultBoughtDays(3, 0.25)).toBe(1);
		expect(defaultBoughtDays(3, 30)).toBe(60);
		expect(clampDays(2.4)).toBe(2);
	});
});

describe('loadDetail', () => {
	it('renders the data-missing state when KV data is absent or there is no platform', async () => {
		const params = { reactor: 'composite' as const, slug: 'titanium-carbide' };
		const url = new URL('https://x/composite/titanium-carbide');
		const locals = { settings: defaults(), user: null };
		const expected = { available: false, reactor: 'composite', slug: 'titanium-carbide' };
		expect(await loadDetail(asEnv(fakeEnv()), locals, params, url, NOW)).toEqual(expected);
		expect(await loadDetail(undefined, locals, params, url, NOW)).toEqual(expected);
	});

	it('redirects numeric slugs and wrong reactors (301) and 404s unknown slugs', async () => {
		const env = await seeded();
		expect(await thrown(detail(env, '/composite/16671?view=chain'))).toEqual({
			status: 301,
			location: '/composite/titanium-carbide?view=chain'
		});
		expect(await thrown(detail(env, '/hybrid/titanium-carbide'))).toEqual({
			status: 301,
			location: '/composite/titanium-carbide'
		});
		expect(await thrown(detail(env, '/composite/unobtainium'))).toEqual({ status: 404 });
	});

	it('returns the chain only for chainable reactions', async () => {
		const env = await seeded();
		const chain = await detail(env, '/composite/titanium-carbide?view=chain');
		expect(chain.chainable).toBe(true);
		expect(chain.query.view).toBe('chain');
		expect(chain.result.chain!.children.map((c) => [c.name, c.runs, c.surplus])).toEqual([
			['Titanium Chromide', 60, 92],
			['Silicon Diborite', 60, 92]
		]);
		expect(chain.result.runs).toBe(122);
		expect(chain.root).toBe(chain.result.chain);
		expect(chain.root.materials.map((m) => m.source)).toEqual(['buy', 'chain', 'chain']);

		const single = await detail(env, '/composite/caesarium-cadmide?view=chain');
		expect(single.chainable).toBe(false);
		expect(single.query.view).toBe('single');
		expect(single.result.chain).toBeNull();
	});

	it('?slots=optimal prices one steady cycle of the optimal lines (Titanium Carbide: 2 + 2 slots)', async () => {
		const env = await seeded();
		const data = await detail(env, '/composite/titanium-carbide?view=chain&slots=optimal');
		expect(data.query.slots).toBe('optimal');
		expect(data.slotAllocation).toBe('optimal');
		expect(data.defaultSlotAllocation).toBe('single');
		const { result } = data;
		expect(result.runs).toBe(244);
		expect(result.chain!.runsPerSlot).toEqual([122, 122]);
		expect(result.chain!.children.map((c) => [c.name, c.runs, c.runsPerSlot])).toEqual([
			['Titanium Chromide', 120, [120]],
			['Silicon Diborite', 120, [120]]
		]);
		expect(result.allocation).toMatchObject({ lines: 2, slotsUsed: 4 });
		expect(result.allocation!.utilisation).toBeCloseTo(((244 + 240) * 4924.8) / (4 * 7 * 86400), 9);
		expect(result.totals.profitPerSlotDay).toBeCloseTo(result.totals.profit! / 28, 4);
		expect(data.root).toBe(result.chain);
		// Price timing keeps the same lines: "now" equals the page result.
		expect(data.timing.now.profit).toBe(result.totals.profit);
	});

	it('?lines=N fixes the optimal line count; invalid or out-of-range values fall back to Auto', async () => {
		const env = await seeded();
		const base = '/composite/titanium-carbide?view=chain&slots=optimal';
		const three = await detail(env, `${base}&lines=3`);
		expect(three.query.lines).toBe(3);
		expect(three.result.allocation).toMatchObject({ lines: 3, slotsUsed: 7 });
		expect(three.result.runs).toBe(366);
		expect(three.timing.now.profit).toBe(three.result.totals.profit);
		for (const bad of ['0', '11', 'abc', '2.5']) {
			const auto = await detail(env, `${base}&lines=${bad}`);
			expect(auto.query.lines).toBeNull();
			expect(auto.result.allocation).toMatchObject({ lines: 2, slotsUsed: 4 });
		}
	});

	it('follows the slot allocation setting unless ?slots= overrides it', async () => {
		const env = await seeded();
		const optimal = Settings.parse({ slotAllocation: 'optimal' });
		const fromSetting = await detail(env, '/composite/titanium-carbide?view=chain', optimal);
		expect(fromSetting.query.slots).toBeNull();
		expect(fromSetting.slotAllocation).toBe('optimal');
		expect(fromSetting.result.allocation?.lines).toBe(2);

		const single = await detail(env, '/composite/titanium-carbide?view=chain&slots=single', optimal);
		const before = await detail(env, '/composite/titanium-carbide?view=chain');
		expect(single.slotAllocation).toBe('single');
		expect(single.result).toEqual(before.result);
		expect(single.result.allocation).toBeUndefined();
		expect(single.result.runs).toBe(122);

		const buyInputs = await detail(env, '/composite/titanium-carbide?slots=optimal', optimal);
		expect(buyInputs.query.slots).toBeNull();
		expect(buyInputs.result.allocation).toBeUndefined();
	});

	it("opens on the visitor's preferred tabs and reports the ones that apply for the page links", async () => {
		const env = await seeded();
		const prefs = Settings.parse({ defaultView: 'chain', defaultOutput: 'reprocessed' });
		const carbide = await detail(env, '/composite/titanium-carbide', prefs);
		expect(carbide.result.view).toBe('chain');
		expect(carbide.defaultTabs).toEqual({ view: 'chain', output: 'product' });
		expect((await detail(env, '/composite/titanium-carbide?view=single', prefs)).result.view).toBe('single');
		expect((await detail(env, '/composite/titanium-carbide')).result.view).toBe('single');

		const hexite = await detail(env, '/composite/unrefined-hexite', prefs);
		expect(hexite.result.outputMode).toBe('reprocessed');
		expect(hexite.defaultTabs).toEqual({ view: 'single', output: 'reprocessed' });
		expect((await detail(env, '/composite/unrefined-hexite?output=product', prefs)).result.outputMode).toBe(
			'product'
		);
	});

	it('Full chain always shows the regular chain and Using unrefined the routes, whatever the setting', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		await putKv(env, sde, routeMarket(sde));
		insertSystems(env.DB);
		const path = '/composite/fermionic-condensates';
		const best = Settings.parse({ unrefinedInChains: 'best' });
		for (const settings of [defaults(), best]) {
			const unrefined = await detail(env, `${path}?view=unrefined`, settings);
			expect([unrefined.unrefinable, unrefined.result.view]).toEqual([true, 'unrefined']);
			expect(unrefined.result.viaUnrefined.length).toBeGreaterThan(0);
			const chain = await detail(env, `${path}?view=chain`, settings);
			expect(chain.result.viaUnrefined).toEqual([]);
			expect(chain.result.totals.profit).not.toBe(unrefined.result.totals.profit);
		}
		// Without ?view= the page opens on Using unrefined only when the setting uses unrefined routes.
		expect((await detail(env, path)).result.view).toBe('single');
		expect((await detail(env, path, best)).result.view).toBe('unrefined');
		expect((await detail(env, '/biochemical/pure-strong-blue-pill-booster', best)).result.view).toBe(
			'single'
		);
		expect((await detail(env, '/composite/caesarium-cadmide')).unrefinable).toBe(false);
	});

	it('describes the single view as one job built from the inputs and totals', async () => {
		const env = await seeded();
		const data = await detail(env, '/composite/titanium-carbide');
		const { root, result } = data;
		expect(result.chain).toBeNull();
		expect(root).toMatchObject({
			name: 'Titanium Carbide',
			productTypeId: data.reaction.productTypeId,
			depth: 0,
			runs: 122,
			surplus: 0,
			children: [],
			slotSeconds: result.totals.slotSeconds,
			jobCost: result.jobCost,
			jobRates: { costIndex: 0.0412, facilityTaxPct: 1, sccPct: 4 }
		});
		expect(root.quantityProduced).toBe(122 * 10_000);
		expect(root.materials).toEqual(result.inputs.map((i) => ({ ...i, source: 'buy' })));
		expect(root.subtotal.total).toBeCloseTo(result.totals.totalCost, 6);
		expect(root.subtotal.jobCost).toBe(result.totals.jobCost);
	});

	it('applies ?output=reprocessed only for reprocessable reactions', async () => {
		const env = await seeded();
		const hexite = await detail(env, '/composite/unrefined-hexite?output=reprocessed');
		expect(hexite.reprocessable).toBe(true);
		expect(hexite.result.outputMode).toBe('reprocessed');
		expect(hexite.result.outputs.map((o) => o.typeId)).not.toContain(hexite.reaction.productTypeId);

		const carbide = await detail(env, '/composite/titanium-carbide?output=reprocessed');
		expect(carbide.reprocessable).toBe(false);
		expect(carbide.result.outputMode).toBe('product');
		expect(carbide.result.warnings).not.toContain('NO_REPROCESS_DATA');
	});

	it('price timing defaults to chainDepth × cycleDays', async () => {
		const env = await seeded();
		expect((await detail(env, '/composite/titanium-carbide')).timing).toMatchObject({
			days: 7,
			defaultDays: 7
		});
		expect((await detail(env, '/composite/titanium-carbide?view=chain')).timing).toMatchObject({
			days: 14,
			defaultDays: 14
		});
		const short = Settings.parse({ cycleDays: 1.4 });
		expect((await detail(env, '/composite/titanium-carbide?view=chain', short)).timing.days).toBe(3);
	});

	it('price timing prices inputs from the historical book of now − N days and clamps N', async () => {
		const env = await seeded();
		const now = await detail(env, '/composite/caesarium-cadmide?bought=10');
		const date = isoDate(NOW - 10 * DAY);
		const stmt = env.HISTORY_DB.sqlite.prepare(
			'INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES (?, ?, ?, ?, ?, 4)'
		);
		for (const input of now.result.inputs) stmt.run(date, 'jita', input.typeId, 1000, 1100);

		const data = await detail(env, '/composite/caesarium-cadmide?bought=10');
		const quantity = data.result.inputs.reduce((a, i) => a + i.quantity, 0);
		expect(data.timing.days).toBe(10);
		expect(data.timing.asOf).toBe(date);
		expect(data.timing.approximate).toBe(false);
		expect(data.timing.then.inputCost).toBeCloseTo(quantity * 1000, 6);
		expect(data.timing.now.inputCost).toBeCloseTo(data.result.totals.inputCost, 6);
		expect(data.timing.now.profit).toBeCloseTo(data.result.totals.profit!, 6);
		expect(data.timing.then.profit).not.toBeCloseTo(data.timing.now.profit!, 0);

		expect((await detail(env, '/composite/caesarium-cadmide?bought=500')).timing).toMatchObject({
			days: 60,
			asOf: isoDate(NOW - 60 * DAY)
		});
		expect((await detail(env, '/composite/caesarium-cadmide?bought=-4')).timing.days).toBe(0);
	});

	it('flags an approximate historical book (ESI history fallback)', async () => {
		const env = await seeded();
		env.HISTORY_DB.sqlite.exec(
			`INSERT INTO esi_market_history VALUES (10000002, 16643, '${isoDate(NOW - 7 * DAY)}', 5, 6, 4, 1, 1);`
		);
		expect((await detail(env, '/composite/caesarium-cadmide')).timing.approximate).toBe(true);
	});

	it('returns the profit series of the requested range and the settings summary', async () => {
		const env = await seeded();
		const data = await detail(env, '/composite/caesarium-cadmide');
		expect(data.series).toEqual([]);
		const stmt = env.HISTORY_DB.sqlite.prepare(
			'INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES (?, ?, ?, ?, ?, 4)'
		);
		for (let d = 1; d <= 100; d++) stmt.run(isoDate(NOW - d * DAY), 'jita', 16663, 1, 2);
		expect((await detail(env, '/composite/caesarium-cadmide')).series).toHaveLength(30);
		const quarter = await detail(env, '/composite/caesarium-cadmide?range=90d');
		expect(quarter.series).toHaveLength(90);
		expect(quarter.query.range).toBe('90d');
		expect(quarter.cycleDays).toBe(7);
		expect(quarter.settingsSummary).toEqual({
			structure: 'tatara',
			meRig: 't2',
			teRig: 't2',
			systemName: 'Ignoitton',
			securityBand: 'lowsec',
			costIndex: 0.0412,
			costIndexOverridden: false,
			inputHub: 'Jita 4-4',
			outputHub: 'Jita 4-4',
			inputMethod: 'buy_order',
			outputMethod: 'sell_order'
		});
	});

	it('splits profile warnings (settings summary) from reaction warnings and names missing prices', async () => {
		const env = await seeded();
		const market = JSON.parse((await env.CACHE.get('market:v1')) as string);
		delete market.prices.jita[16663];
		await env.CACHE.put('market:v1', JSON.stringify(market));
		const settings = Settings.parse({
			shared: { market: { inputHub: 'nowhere' }, reactionsSkill: 1, systemId: 30004604 }
		});
		const data = await detail(env, '/composite/caesarium-cadmide', settings);
		expect(data.profileWarnings).toEqual(['HUB_UNAVAILABLE', 'COST_INDEX_MISSING']);
		expect(data.warnings).toEqual(['SKILL_TOO_LOW']);
		expect(data.missing).toEqual([{ typeId: 16663, name: 'Caesarium Cadmide' }]);
		expect(data.result.totals.profit).toBeNull();
	});

	it('exposes the units listed at a structure input hub and the per-market split', async () => {
		const env = await seeded();
		insertUser(env.DB, { userId: 'owner' }, [{ characterId: 1, name: 'Owner' }]);
		insertStructureHub(env.DB, { structureId: 1001, name: 'Owner Market' });
		linkStructure(env.DB, 'owner', 1001, 1);
		const { dataset } = await loadSde();
		const [short, ...rest] = dataset.reactions.find((r) => r.slug === 'caesarium-cadmide')!.materials;
		insertLatestPrice(env.DB, 'structure-1001', short.typeId, 50, 60, { buy: 0, sell: 100 });
		for (const m of rest)
			insertLatestPrice(env.DB, 'structure-1001', m.typeId, 50, 60, { buy: 0, sell: 1_000_000 });
		const settings = Settings.parse({ shared: { market: { inputHub: 'structure-1001' } } });
		const user = { userId: 'owner', characterId: null, characters: [], isAdmin: false };
		const url = new URL('https://reactions.coalition.space/composite/caesarium-cadmide');
		const data = (await loadDetail(
			asEnv(env),
			{ settings, user },
			{ reactor: 'composite', slug: 'caesarium-cadmide' },
			url,
			NOW
		)) as DetailData;

		expect(data.warnings).toContain('INPUT_VOLUME_SHORT');
		const input = data.result.inputs.find((i) => i.typeId === short.typeId)!;
		expect(input.availableAtInputHub).toBe(100);
		expect(input.sources!.map((s) => [s.hubId, s.quantity])).toEqual([
			['structure-1001', 100],
			['jita', input.quantity - 100]
		]);
		expect(data.result.inputs.find((i) => i.typeId === rest[0].typeId)).toMatchObject({
			availableAtInputHub: 1_000_000,
			unitPrice: 50
		});
		expect(data.inputMarket).toEqual({
			name: 'Owner Market',
			fallbackName: 'Jita 4-4',
			showAvailable: true,
			names: expect.objectContaining({ 'structure-1001': 'Owner Market', jita: 'Jita 4-4' })
		});

		// Jita as input hub: same fallback, so no split, and no Available column.
		clearDataMemo();
		const jita = (await loadDetail(
			asEnv(env),
			{ settings: defaults(), user },
			{ reactor: 'composite', slug: 'caesarium-cadmide' },
			url,
			NOW
		)) as DetailData;
		expect(jita.warnings).not.toContain('INPUT_VOLUME_SHORT');
		expect(jita.result.inputs.every((i) => i.sources === undefined)).toBe(true);
		expect(jita.inputMarket.showAvailable).toBe(false);
	});
});
