import type { MarketSnapshot } from '@reactions/db';
import { Settings, type Reaction } from '@reactions/engine';
import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import { DAY_MS } from '$lib/server/listing';
import { isoDate } from '$lib/server/prices';
import { asEnv, fakeEnv, type FakeEnv } from '../test/fakes';
import { NOW, insertSystems, loadSde, marketFor, putKv } from '../test/fixtures';
import type { PageServerData as HomeData, PageServerLoadEvent as HomeEvent } from './$types';
import { load as homeLoad } from './+page.server';
import type {
	PageServerData as ReactorData,
	PageServerLoadEvent as ReactorEvent
} from './[reactor=reactor]/$types';
import { load as reactorLoad } from './[reactor=reactor]/+page.server';

beforeEach(() => clearDataMemo());

const locals = (settings = Settings.parse({})) => ({ settings, user: null, theme: 'dark' as const });

async function home(env: FakeEnv | null): Promise<HomeData> {
	const event = { platform: env ? { env: asEnv(env) } : undefined, locals: locals() };
	return (await homeLoad(event as unknown as HomeEvent)) as HomeData;
}

async function reactorPage(env: FakeEnv | null, path: string, settings?: Settings): Promise<ReactorData> {
	const url = new URL(`https://reactions.coalition.space${path}`);
	const event = {
		params: { reactor: url.pathname.slice(1) },
		url,
		platform: env ? { env: asEnv(env) } : undefined,
		locals: locals(settings)
	};
	return (await reactorLoad(event as unknown as ReactorEvent)) as ReactorData;
}

async function seeded() {
	const env = fakeEnv();
	const sde = await loadSde();
	const market = marketFor(sde);
	await putKv(env, sde, market);
	insertSystems(env.DB);
	return { env, sde, market };
}

/** `price_daily` rows for Jita on `date` copying the market, with some product sell prices overridden. */
function insertDaily(
	env: FakeEnv,
	market: MarketSnapshot,
	date: string,
	sellOverrides = new Map<number, number>()
) {
	const insert = env.HISTORY_DB.sqlite.prepare(
		`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES (?, 'jita', ?, ?, ?, 4)`
	);
	for (const [typeId, [buy, sell]] of Object.entries(market.prices.jita))
		insert.run(date, Number(typeId), buy, sellOverrides.get(Number(typeId)) ?? sell);
}

const reactionBySlug = (reactions: Reaction[], slug: string) => reactions.find((r) => r.slug === slug)!;
const daysAgo = (n: number) => isoDate(NOW - n * DAY_MS);

describe('home loader', () => {
	it('returns the data-missing state without KV data', async () => {
		expect(await home(fakeEnv())).toEqual({ home: null });
		expect(await home(null)).toEqual({ home: null });
	});

	it('returns status and empty boards without price history or market statistics', async () => {
		const { env, sde } = await seeded();
		const { home: data } = await home(env);
		expect(data!.status).toMatchObject({
			pricesUpdatedAt: NOW,
			sdeBuild: sde.dataset.sdeBuild,
			reactionCount: 119,
			systems: [{ systemName: 'Ignoitton', costIndex: 0.0412, costIndexMissing: false }]
		});
		expect(data!.window).toBeNull();
		expect(
			data!.boards.map((b) => [b.reactor, b.single.items.length, b.chain?.items.length ?? null])
		).toEqual([
			['composite', 0, 0],
			['biochemical', 0, 0],
			['hybrid', 0, null]
		]);
		expect(data!.inputs).toMatchObject({ up: [], down: [], available: false });
		expect(data!.description).not.toContain('Best');
		expect(data!.description).toContain('Prices updated');
	});

	it('averages the latest 7 days with prices before today and leaves out other tiers', async () => {
		const { env, sde, market } = await seeded();
		const carbide = reactionBySlug(sde.dataset.reactions, 'titanium-carbide');
		const hexite = reactionBySlug(sde.dataset.reactions, 'unrefined-hexite');
		const rich = new Map([
			[carbide.product.typeId, 1e6],
			[hexite.product.typeId, 1e9]
		]);
		// Days 1 to 9 ago; today and the two oldest days fall outside the window.
		insertDaily(env, market, daysAgo(0), new Map([[carbide.product.typeId, 1]]));
		for (let n = 1; n <= 9; n++) insertDaily(env, market, daysAgo(n), n === 2 ? new Map() : rich);

		const { home: data } = await home(env);
		expect(data!.window).toEqual({ from: daysAgo(7), to: daysAgo(1), days: 7, approximate: false });
		const composite = data!.boards.find((b) => b.reactor === 'composite')!;
		expect(composite.single.items[0]).toMatchObject({
			slug: 'titanium-carbide',
			variant: 'single',
			days: 7,
			slots: null
		});
		expect(composite.single.items[0].profitableDays).toBeGreaterThanOrEqual(6);
		const listed = data!.boards.flatMap((b) => [...b.single.items, ...(b.chain?.items ?? [])]);
		expect(listed.map((i) => i.slug)).not.toContain('unrefined-hexite');
		expect(data!.description).toContain('Best over the last 7 days: Titanium Carbide (Composite)');
	});

	it("fills a day without hub prices from the region's ESI average", async () => {
		const { env, market } = await seeded();
		const insert = env.HISTORY_DB.sqlite.prepare(
			`INSERT INTO esi_market_history VALUES (10000002, ?, ?, ?, ?, ?, 10, 1)`
		);
		for (const [typeId, [, sell]] of Object.entries(market.prices.jita))
			insert.run(Number(typeId), daysAgo(3), sell, sell, sell);
		insertDaily(env, market, daysAgo(2));
		const { home: data } = await home(env);
		expect(data!.window).toEqual({ from: daysAgo(3), to: daysAgo(2), days: 2, approximate: true });
	});

	it("lists only products the output region's volume absorbs and the input price moves", async () => {
		const { env, sde, market } = await seeded();
		const liquid = reactionBySlug(sde.dataset.reactions, 'titanium-carbide').product.typeId;
		const thin = reactionBySlug(sde.dataset.reactions, 'crystalline-carbonide').product.typeId;
		const hydrocarbons = Number(
			Object.values(sde.dataset.types).find((t) => t.name === 'Hydrocarbons')!.typeId
		);
		const stat = env.DB.sqlite.prepare(
			`INSERT INTO market_stats (region_id, type_id, avg_daily_volume_30d, avg_daily_volume_7d, avg_price_5d, avg_price_30d, last_date, updated_at)
			VALUES (10000002, ?, ?, ?, ?, ?, '2026-10-05', ?)`
		);
		stat.run(liquid, 1e9, 1.1e9, 1, 1, NOW);
		stat.run(thin, 1, 1, 1, 1, NOW);
		stat.run(hydrocarbons, 1e6, 1e6, 550, 500, NOW);
		insertDaily(
			env,
			market,
			daysAgo(1),
			new Map([
				[liquid, 1e6],
				[thin, 1e6]
			])
		);

		const { home: data } = await home(env);
		const composite = data!.boards.find((b) => b.reactor === 'composite')!;
		// Every other product has no trades in the region, so it is left out too.
		expect(composite.single.items.map((i) => i.slug)).toEqual(['titanium-carbide']);
		expect(composite.single.items[0]).toMatchObject({ volume: 1e9 });
		expect(composite.single.items[0].slots).toBeGreaterThan(1);
		expect(composite.single.thin).toBeGreaterThanOrEqual(1);
		expect(data!.inputs).toMatchObject({ available: true, down: [] });
		expect(data!.inputs.up.map((m) => m.name)).toEqual(['Hydrocarbons']);
	});
});

describe('reactor loader', () => {
	it('returns the data-missing state without KV data', async () => {
		expect(await reactorPage(fakeEnv(), '/composite')).toMatchObject({
			reactor: 'composite',
			date: null,
			noindex: false,
			listing: null
		});
	});

	it('builds the composite tier sections with chain numbers that differ from buy-inputs', async () => {
		const { env } = await seeded();
		const data = await reactorPage(env, '/composite');
		expect(data.noindex).toBe(false);
		const listing = data.listing!;
		expect(listing.approximate).toBe(false);
		expect(listing.sections.map((s) => s.title)).toEqual([
			'Intermediate',
			'Composite',
			'Unrefined',
			'Unrefined Minerals'
		]);
		const carbide = listing.sections[1].rows.find((r) => r.slug === 'titanium-carbide')!;
		expect(carbide.chain!.profitPerSlotDay).not.toBe(carbide.single.profitPerSlotDay);
		expect(carbide.reprocessed).toBeNull();
		// Payload stays small: per-variant summary numbers only.
		expect(Object.keys(carbide.single).sort()).toEqual(
			[
				'inputCost',
				'jobCost',
				'marginPct',
				'missing',
				'outputValue',
				'profit',
				'profitPerSlotDay',
				'runs',
				'slots'
			].sort()
		);
		expect(listing.settings).toMatchObject({
			structure: 'tatara',
			systemName: 'Ignoitton',
			costIndex: 0.0412,
			inputHub: 'Jita 4-4',
			outputHub: 'Jita 4-4'
		});
		expect(listing.warnings).toEqual([]);
		expect(listing.description).toMatch(
			/^Composite reaction profits for EVE Online: 66 reactions priced live\./
		);
	});

	it('computes the Full chain tab in the optimal slot allocation when the setting asks for it', async () => {
		const { env } = await seeded();
		const single = await reactorPage(env, '/composite');
		const optimal = await reactorPage(env, '/composite', Settings.parse({ slotAllocation: 'optimal' }));
		const carbide = (data: ReactorData) =>
			data.listing!.sections[1].rows.find((r) => r.slug === 'titanium-carbide')!;
		expect(carbide(single).chain!.slots).toBeNull();
		expect(carbide(optimal).chain!.slots).toMatchObject({ lines: 2, total: 4, levels: [2, 2] });
		expect(carbide(optimal).chain!.runs).toBe(244);
		expect(carbide(optimal).chain!.profitPerSlotDay).toBeCloseTo(carbide(optimal).chain!.profit! / 28, 4);
		expect(carbide(optimal).single).toEqual(carbide(single).single);
	});

	it('lists biochemical and hybrid tiers', async () => {
		const { env } = await seeded();
		const bio = await reactorPage(env, '/biochemical');
		expect(bio.listing!.sections.map((s) => s.title)).toEqual([
			'Synth',
			'Standard',
			'Improved',
			'Strong',
			'Molecular-Forged'
		]);
		const hybrid = await reactorPage(env, '/hybrid');
		expect(hybrid.listing!.sections.map((s) => [s.title, s.rows.length])).toEqual([['Polymers', 9]]);
	});

	it('marks rows without prices with the missing item names', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		const market = marketFor(sde);
		const carbide = reactionBySlug(sde.dataset.reactions, 'titanium-carbide');
		const input = carbide.materials[0].typeId;
		delete market.prices.jita[input];
		await putKv(env, sde, market);
		insertSystems(env.DB);
		const data = await reactorPage(env, '/composite');
		const row = data.listing!.sections[1].rows.find((r) => r.slug === 'titanium-carbide')!;
		expect(row.single.profitPerSlotDay).toBeNull();
		expect(row.single.missing).toContain(sde.dataset.types[input].name);
	});

	it('reports HUB_UNAVAILABLE and COST_INDEX_MISSING', async () => {
		const env = fakeEnv();
		const sde = await loadSde();
		await putKv(env, sde);
		const settings = Settings.parse({ shared: { market: { inputHub: 'structure-1' } } });
		const data = await reactorPage(env, '/hybrid', settings);
		expect(data.listing!.warnings).toEqual(['HUB_UNAVAILABLE', 'COST_INDEX_MISSING']);
		expect(data.listing!.settings.inputHub).toBe('Jita 4-4');
	});

	it('loads a historical, noindexed, approximate listing for ?date= from ESI history', async () => {
		const { env, sde } = await seeded();
		const date = isoDate(Date.now() - 30 * DAY_MS);
		const insert = env.HISTORY_DB.sqlite.prepare(
			`INSERT INTO esi_market_history VALUES (10000002, ?, ?, ?, ?, ?, 10, 1)`
		);
		for (const t of sde.types) insert.run(t.typeId, date, 100, 110, 90);
		const data = await reactorPage(env, `/biochemical?date=${date}`);
		expect(data.date).toBe(date);
		expect(data.noindex).toBe(true);
		expect(data.listing!.approximate).toBe(true);
		expect(data.listing!.pricesAsOf).toBe(date);
		expect(data.listing!.description).toContain(`priced as of ${date}.`);
	});

	it('is exact for a date covered by price_daily', async () => {
		const { env, sde } = await seeded();
		const date = isoDate(Date.now() - 3 * DAY_MS);
		const insert = env.HISTORY_DB.sqlite.prepare(
			`INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES (?, ?, ?, 90, 100, 4)`
		);
		for (const t of sde.types)
			for (const hub of ['jita', 'amarr', 'dodixie', 'rens', 'hek', 'perimeter'])
				insert.run(date, hub, t.typeId);
		const data = await reactorPage(env, `/hybrid?date=${date}`);
		expect(data.noindex).toBe(true);
		expect(data.listing!.approximate).toBe(false);
	});

	it.each(['not-a-date', '2026-02-30', isoDate(Date.now() + DAY_MS), isoDate(Date.now() - 401 * DAY_MS)])(
		'rejects ?date=%s with 400',
		async (date) => {
			const { env } = await seeded();
			try {
				await reactorPage(env, `/composite?date=${date}`);
				expect.unreachable('expected a 400');
			} catch (e) {
				expect(isHttpError(e) && e.status).toBe(400);
			}
		}
	);
});
