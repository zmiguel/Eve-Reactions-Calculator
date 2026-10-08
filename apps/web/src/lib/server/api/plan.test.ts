import { describe, expect, it } from 'vitest';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { NOW, defaults, insertSystems, loadSde, putKv } from '../../../test/fixtures';
import { loadCalc } from '../context';
import { clearDataMemo } from '../data';
import { publicHubs } from './data';
import { buildPlanInput, resolveTargets } from './plan';
import { PlanBody } from './schemas';

describe('resolveTargets', () => {
	it('resolves slugs and blueprint ids, defaulting to one line', async () => {
		const { dataset } = await loadSde();
		expect(
			resolveTargets(dataset, [
				{ slug: 'fullerides' },
				{ blueprintTypeId: 46205, lines: 3 },
				{ slug: 'crystalline-carbonide', quantity: 10_000 }
			])
		).toEqual([
			{ blueprintTypeId: 46209, lines: 1 },
			{ blueprintTypeId: 46205, lines: 3 },
			{ blueprintTypeId: 46205, lines: 1, quantity: 10_000 }
		]);
	});

	it('404s for an unknown reaction', async () => {
		const { dataset } = await loadSde();
		expect(() => resolveTargets(dataset, [{ slug: 'nope' }])).toThrow(
			expect.objectContaining({ status: 404, code: 'NOT_FOUND', message: 'Unknown reaction "nope".' })
		);
	});
});

describe('buildPlanInput', () => {
	it('takes daily volumes from market_stats of each product output hub region', async () => {
		clearDataMemo();
		const env = fakeEnv();
		insertSystems(env.DB);
		await putKv(env, await loadSde());
		const insert = env.DB.sqlite.prepare(
			`INSERT INTO market_stats (region_id, type_id, avg_daily_volume_30d, avg_price_5d, avg_price_30d, last_date, updated_at)
			VALUES (?, ?, ?, 1, 1, '2026-10-05', ?)`
		);
		insert.run(10000002, 16670, 1234, NOW);
		insert.run(10000043, 16671, 99, NOW); // Amarr's region: not an output hub
		insert.run(10000002, 34, 5, NOW); // not a reaction product
		const settings = defaults();
		const hubs = await publicHubs(asEnv(env));
		const { ctx } = (await loadCalc(asEnv(env), { settings, user: null }))!;
		const body = PlanBody.parse({
			totalSlots: 20,
			targets: [{ slug: 'crystalline-carbonide' }],
			stock: { 34: 10 }
		});
		const input = await buildPlanInput(asEnv(env), ctx, hubs, body);
		expect(input).toMatchObject({
			totalSlots: 20,
			targets: [{ blueprintTypeId: 46205, lines: 1 }],
			buyInsteadOfBuild: [],
			stock: { 34: 10 },
			ownedFormulas: {},
			dailyVolumes: { 16670: 1234 }
		});
	});
});
