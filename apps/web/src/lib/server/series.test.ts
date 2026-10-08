import { calculateReaction, producerIndex, type Reaction } from '@reactions/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, defaults, insertSystems, loadSde, putKv } from '../../test/fixtures';
import { loadCalc } from './context';
import { clearDataMemo } from './data';
import { isoDate } from './prices';
import { getProfitSeries, getVolumeSeries, seriesStartDate } from './series';

const DAY = 86_400_000;

beforeEach(() => clearDataMemo());

async function setup() {
	const env = fakeEnv();
	const sde = await loadSde();
	await putKv(env, sde);
	insertSystems(env.DB);
	const calc = (await loadCalc(asEnv(env), { settings: defaults(), user: null }))!;
	const bySlug = (slug: string) => calc.dataset.reactions.find((r) => r.slug === slug)!;
	return { env, calc, bySlug };
}

/** Every type a reaction (and, with `chain`, its sub-reactions) needs. */
function chainTypes(reaction: Reaction, producers: Map<number, Reaction>, chain: boolean): number[] {
	const types = new Set([reaction.product.typeId]);
	for (const m of reaction.materials) {
		types.add(m.typeId);
		const sub = chain ? producers.get(m.typeId) : undefined;
		if (sub) for (const t of chainTypes(sub, producers, true)) types.add(t);
	}
	return [...types];
}

function insertDaily(env: FakeEnv, date: string, hubId: string, typeIds: number[], price = (t: number) => t) {
	const stmt = env.HISTORY_DB.sqlite.prepare(
		'INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples) VALUES (?, ?, ?, ?, ?, 4)'
	);
	for (const t of typeIds) stmt.run(date, hubId, t, price(t) * 0.9, price(t));
}

describe('seriesStartDate', () => {
	it('counts the range back from now; all history has no start', () => {
		expect(seriesStartDate('30d', NOW)).toBe('2026-09-06');
		expect(seriesStartDate('90d', NOW)).toBe('2026-07-08');
		expect(seriesStartDate('1y', NOW)).toBe('2025-10-06');
		expect(seriesStartDate('all', NOW)).toBeNull();
	});
});

describe('getProfitSeries', () => {
	it('returns one point per history day inside the requested range', async () => {
		const { env, calc, bySlug } = await setup();
		const reaction = bySlug('caesarium-cadmide');
		const types = chainTypes(reaction, producerIndex(calc.dataset), false);
		for (let d = 1; d <= 40; d++) insertDaily(env, isoDate(NOW - d * DAY), 'jita', types);
		const opts = { view: 'single', outputMode: 'product', now: NOW } as const;

		const month = await getProfitSeries(asEnv(env), reaction, calc.ctx, '30d', opts);
		expect(month).toHaveLength(30);
		expect(month[0].date).toBe(isoDate(NOW - 30 * DAY));
		expect(month.at(-1)!.date).toBe(isoDate(NOW - DAY));
		expect(await getProfitSeries(asEnv(env), reaction, calc.ctx, '90d', opts)).toHaveLength(40);
		expect(await getProfitSeries(asEnv(env), reaction, calc.ctx, 'all', opts)).toHaveLength(40);
	});

	it('computes each day with that day’s prices, current adjusted prices and cost index', async () => {
		const { env, calc, bySlug } = await setup();
		const reaction = bySlug('caesarium-cadmide');
		const types = chainTypes(reaction, producerIndex(calc.dataset), false);
		const date = isoDate(NOW - 2 * DAY);
		insertDaily(env, date, 'jita', types, (t) => t / 10);
		const [point] = await getProfitSeries(asEnv(env), reaction, calc.ctx, '30d', {
			view: 'single',
			outputMode: 'product',
			now: NOW
		});
		const book = {
			asOf: date,
			approximate: false,
			hubs: { jita: Object.fromEntries(types.map((t) => [t, { buy: (t / 10) * 0.9, sell: t / 10 }])) },
			adjusted: calc.ctx.outputPrices.adjusted
		};
		const expected = calculateReaction(
			reaction,
			{ ...calc.ctx, inputPrices: book, outputPrices: book },
			{ view: 'single', outputMode: 'product' }
		);
		expect(point.date).toBe(date);
		expect(point.profitPerSlotDay).toBeCloseTo(expected.totals.profitPerSlotDay!, 6);
		expect(point.inputCost).toBeCloseTo(expected.totals.inputCost, 6);
		// Totals of the same job on both sides: the whole output, not the unit price.
		expect(point.outputValue).toBeCloseTo(expected.totals.outputValue, 6);
		expect(point.outputValue).toBeCloseTo(expected.outputs[0].quantity * (reaction.product.typeId / 10), 6);
	});

	it('ignores other hubs and reports null when a day lacks prices', async () => {
		const { env, calc, bySlug } = await setup();
		const reaction = bySlug('caesarium-cadmide');
		const types = chainTypes(reaction, producerIndex(calc.dataset), false);
		insertDaily(env, isoDate(NOW - 3 * DAY), 'amarr', types);
		insertDaily(env, isoDate(NOW - 2 * DAY), 'jita', [reaction.product.typeId]);
		const series = await getProfitSeries(asEnv(env), reaction, calc.ctx, '30d', {
			view: 'single',
			outputMode: 'product',
			now: NOW
		});
		expect(series).toEqual([
			{
				date: isoDate(NOW - 2 * DAY),
				profitPerSlotDay: null,
				outputValue: expect.any(Number),
				inputCost: null,
				approximate: false
			}
		]);
		expect(series[0].outputValue).toBeGreaterThan(reaction.product.typeId);
	});

	it("fills types without collected hub prices with the hub region's ESI average and flags the day", async () => {
		const { env, calc, bySlug } = await setup();
		const reaction = bySlug('caesarium-cadmide');
		const types = chainTypes(reaction, producerIndex(calc.dataset), false);
		const exactDay = isoDate(NOW - 2 * DAY);
		const regionalDay = isoDate(NOW - 3 * DAY);
		insertDaily(env, exactDay, 'jita', types);
		const esi = env.HISTORY_DB.sqlite.prepare(
			`INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
			VALUES (?, ?, ?, ?, 1, 1, 1, 1)`
		);
		for (const t of types) {
			esi.run(10000002, t, regionalDay, t / 2);
			esi.run(10000002, t, exactDay, 1); // ignored: the hub has its own prices that day
			esi.run(10000043, t, regionalDay, 1); // another region
		}
		const opts = { view: 'single' as const, outputMode: 'product' as const, now: NOW };
		const series = await getProfitSeries(asEnv(env), reaction, calc.ctx, '30d', {
			...opts,
			hubRegions: { jita: 10000002, amarr: 10000043 }
		});
		expect(series.map((p) => [p.date, p.approximate])).toEqual([
			[regionalDay, true],
			[exactDay, false]
		]);
		const averages = {
			asOf: regionalDay,
			approximate: true,
			hubs: { jita: Object.fromEntries(types.map((t) => [t, { buy: t / 2, sell: t / 2 }])) },
			adjusted: calc.ctx.outputPrices.adjusted
		};
		const expected = calculateReaction(
			reaction,
			{ ...calc.ctx, inputPrices: averages, outputPrices: averages },
			opts
		);
		expect(series[0].profitPerSlotDay).toBeCloseTo(expected.totals.profitPerSlotDay!, 6);
		expect(series[1].inputCost).toBeGreaterThan(series[0].inputCost!);

		// Without hub regions only collected hub prices count.
		expect((await getProfitSeries(asEnv(env), reaction, calc.ctx, '30d', opts)).map((p) => p.date)).toEqual([
			exactDay
		]);
	});

	it('chain view prices every chain type with a single bounded query', async () => {
		const { env, calc, bySlug } = await setup();
		const reaction = bySlug('titanium-carbide');
		const types = chainTypes(reaction, producerIndex(calc.dataset), true);
		for (let d = 1; d <= 5; d++) insertDaily(env, isoDate(NOW - d * DAY), 'jita', types);
		env.HISTORY_DB.log.length = 0;
		const chain = await getProfitSeries(asEnv(env), reaction, calc.ctx, '30d', {
			view: 'chain',
			outputMode: 'product',
			now: NOW
		});
		expect(env.HISTORY_DB.log).toHaveLength(1);
		expect(chain).toHaveLength(5);
		expect(chain.every((p) => p.profitPerSlotDay !== null)).toBe(true);

		// Without the intermediates' own inputs the single view is still complete, the chain is not.
		const env2 = fakeEnv();
		insertDaily(env2, isoDate(NOW - DAY), 'jita', chainTypes(reaction, new Map(), false));
		const opts = { outputMode: 'product', now: NOW } as const;
		const single = await getProfitSeries(asEnv(env2), reaction, calc.ctx, '30d', { ...opts, view: 'single' });
		const partial = await getProfitSeries(asEnv(env2), reaction, calc.ctx, '30d', { ...opts, view: 'chain' });
		expect(single[0].profitPerSlotDay).not.toBeNull();
		expect(partial[0].profitPerSlotDay).toBeNull();
	});
});

describe('getVolumeSeries', () => {
	it('returns the region and type traded volumes of the range in date order', async () => {
		const env = fakeEnv();
		const insert = env.HISTORY_DB.sqlite.prepare(
			`INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
			VALUES (?, ?, ?, 1, 1, 1, ?, 1)`
		);
		insert.run(10000002, 100, isoDate(NOW - DAY), 30);
		insert.run(10000002, 100, isoDate(NOW - 40 * DAY), 10);
		insert.run(10000002, 100, isoDate(NOW - 2 * DAY), 20);
		insert.run(10000002, 200, isoDate(NOW - DAY), 99);
		insert.run(10000043, 100, isoDate(NOW - DAY), 98);

		expect(await getVolumeSeries(asEnv(env), 10000002, 100, '30d', NOW)).toEqual([
			{ date: isoDate(NOW - 2 * DAY), volume: 20 },
			{ date: isoDate(NOW - DAY), volume: 30 }
		]);
		expect((await getVolumeSeries(asEnv(env), 10000002, 100, 'all', NOW)).map((p) => p.volume)).toEqual([
			10, 20, 30
		]);
	});
});
