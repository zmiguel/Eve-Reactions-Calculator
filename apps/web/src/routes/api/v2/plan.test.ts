import { encodeSettings, planReactions, Settings } from '@reactions/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorResponse, PlanResultResponse } from '#lib/server/api/schemas.js';
import { loadCalc } from '#lib/server/context.js';
import { clearDataMemo } from '#lib/server/data.js';
import { apiEvent, callApi, invalidParams, seededEnv } from '../../../test/api';
import { asEnv, type FakeEnv } from '../../../test/fakes';
import { NOW, defaults, insertStructureHub } from '../../../test/fixtures';
import { POST as plan } from './plan/+server';

beforeEach(() => {
	clearDataMemo();
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

const post = (env: FakeEnv, body: unknown) =>
	callApi(
		plan,
		apiEvent(env, '/api/v2/plan', {
			init: {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: typeof body === 'string' ? body : JSON.stringify(body)
			}
		})
	);

function insertVolume(env: FakeEnv, regionId: number, typeId: number, volume: number) {
	env.DB.sqlite
		.prepare(
			`INSERT INTO market_stats (region_id, type_id, avg_daily_volume_30d, avg_price_5d, avg_price_30d, last_date, updated_at)
			VALUES (?, ?, ?, 1, 1, '2026-10-05', ?)`
		)
		.run(regionId, typeId, volume, NOW);
}

describe('POST /api/v2/plan', () => {
	it('returns exactly what planReactions returns for the same input', async () => {
		const { env } = await seededEnv();
		insertVolume(env, 10000002, 16670, 3_588_569); // Crystalline Carbonide at Jita's region
		insertVolume(env, 10000043, 16671, 5); // another region: ignored
		const { response, body } = await post(env, {
			totalSlots: 150,
			targets: [{ slug: 'crystalline-carbonide', lines: 2 }, { blueprintTypeId: 46166 }],
			buyInsteadOfBuild: [16659],
			stock: { '16663': 500 },
			ownedFormulas: { '46205': 1 }
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

		const calc = (await loadCalc(asEnv(env), { settings: defaults(), user: null }))!;
		const expected = planReactions({
			ctx: calc.ctx,
			totalSlots: 150,
			targets: [
				{ blueprintTypeId: 46205, lines: 2 },
				{ blueprintTypeId: 46166, lines: 1 }
			],
			buyInsteadOfBuild: [16659],
			stock: { 16663: 500 },
			ownedFormulas: { 46205: 1 },
			dailyVolumes: { 16670: 3_588_569 }
		});
		const { horizon: _horizon, ...api } = expected;
		expect(body).toEqual(JSON.parse(JSON.stringify(api)));
		expect(body).not.toHaveProperty('horizon');
		const result = PlanResultResponse.parse(body);
		expect(result.outputsPerCycle.some((o) => o.dailyVolumeSharePct !== null)).toBe(true);
		// Stock of a target product: the plan sells what it makes and leaves the stock unused.
		expect(result.unusedStock).toEqual([{ typeId: 16663, name: 'Caesarium Cadmide', quantity: 500 }]);
	});

	it('plans a quantity target: 35,280,000 Crystalline Carbonide = 3528 runs', async () => {
		const { env } = await seededEnv();
		const { body } = await post(env, {
			totalSlots: 150,
			targets: [{ slug: 'crystalline-carbonide', quantity: 35_280_000 }]
		});
		const result = PlanResultResponse.parse(body);
		const top = result.reactions.find((r) => r.blueprintTypeId === 46205)!;
		expect(top.totalRuns).toBe(3528);
		expect(top.runsPerSlot.reduce((a, b) => a + b, 0)).toBe(3528);
		expect(result.slotsUsed).toBe(result.reactions.reduce((n, r) => n + r.slots, 0));
	});

	it('sells the rest of a quantity target’s last run and reports what it asked for', async () => {
		const { env } = await seededEnv();
		const { body } = await post(env, {
			totalSlots: 150,
			targets: [{ slug: 'crystalline-carbonide', quantity: 35_276_442 }]
		});
		const result = PlanResultResponse.parse(body);
		// 35,276,442 ÷ 10,000 per run → 3,528 runs = 35,280,000 units, all sold.
		const output = result.outputsPerCycle.find((o) => o.typeId === 16670)!;
		expect(output).toMatchObject({ quantity: 35_280_000, requested: 35_276_442 });
		expect(result.surplusPerCycle.some((s) => s.typeId === 16670)).toBe(false);
	});

	it('packs leftover runs of different reactions into shared slots with shareSlots', async () => {
		const { env } = await seededEnv();
		const targets = [{ slug: 'crystalline-carbonide', quantity: 1_500_000 }];
		const shared = PlanResultResponse.parse(
			(await post(env, { totalSlots: 150, targets, shareSlots: true })).body
		);
		// 1,500,000 ÷ 10,000 per run = 150 Crystalline Carbonide runs at 122 runs per slot (default settings):
		// a full job of 122 and a 28-run job, which fits after the 74 Carbon Polymers runs in one slot.
		expect(shared.sharedSlots.map((s) => s.jobs.map((j) => [j.name, j.runs]))).toEqual([
			[
				['Carbon Polymers', 74],
				['Crystalline Carbonide', 28]
			]
		]);
		const [first, second] = shared.sharedSlots[0].jobs;
		expect(second.startSeconds).toBe(first.seconds);
		const top = shared.reactions.find((r) => r.blueprintTypeId === 46205)!;
		expect(top).toMatchObject({ runsPerSlot: [122, 28], sharedRuns: 28 });
		// Its 28-run job (the last one) runs in the shared slot; the full job has a slot of its own.
		expect(top.jobSlots?.at(-1)).toBe(shared.sharedSlots[0].slot);
		expect(top.jobSlots?.[0]).not.toBe(shared.sharedSlots[0].slot);
		// Full Crystalline Carbonide slot, Crystallite Alloy alone, the shared slot.
		expect(shared.slotsUsed).toBe(3);

		const plain = PlanResultResponse.parse((await post(env, { totalSlots: 150, targets })).body);
		expect(plain.sharedSlots).toEqual([]);
		expect(plain.reactions.some((r) => r.sharedRuns !== undefined || r.jobSlots !== undefined)).toBe(false);
		// Without sharing: 2 slots of 75 runs + 1 slot each for the intermediates.
		expect(plain.slotsUsed).toBe(4);
	});

	it('plans auto-fill targets like any target and reports what they add in autoFilled', async () => {
		const { env } = await seededEnv();
		const { response, body } = await post(env, {
			totalSlots: 150,
			targets: [
				{ slug: 'crystalline-carbonide', lines: 1 },
				{ slug: 'crystalline-carbonide', quantity: 12_300, auto: true }
			]
		});
		expect(response.status).toBe(200);
		const result = PlanResultResponse.parse(body);
		const output = result.outputsPerCycle.find((o) => o.typeId === 16670)!;
		expect(result.autoFilled).toEqual([
			{
				blueprintTypeId: 46205,
				typeId: 16670,
				name: 'Crystalline Carbonide',
				// 12,300 asked ÷ 10,000 per run → 2 runs; auto-fill adds all they make.
				units: 20_000,
				value: expect.any(Number)
			}
		]);
		// Valued like the outputs: the share 20,000 / output units of the product's net line.
		expect(result.autoFilled[0].value).toBeCloseTo(
			((output.total - output.fees - output.shipping) * 20_000) / output.quantity,
			2
		);
		// Only the user's quantity targets set `requested`.
		expect(output).not.toHaveProperty('requested');

		const plain = PlanResultResponse.parse(
			(await post(env, { totalSlots: 150, targets: [{ slug: 'crystalline-carbonide', lines: 1 }] })).body
		);
		expect(plain.autoFilled).toEqual([]);
	});

	it('accepts settings as a partial object or an encoded string', async () => {
		const { env } = await seededEnv();
		const body = { totalSlots: 10, targets: [{ slug: 'crystalline-carbonide' }] };
		const plain = PlanResultResponse.parse((await post(env, body)).body);
		const athanor = PlanResultResponse.parse(
			(await post(env, { ...body, settings: { shared: { structure: 'athanor' } } })).body
		);
		const encoded = PlanResultResponse.parse(
			(
				await post(env, {
					...body,
					settings: await encodeSettings(Settings.parse({ shared: { structure: 'athanor' } }))
				})
			).body
		);
		expect(athanor).toEqual(encoded);
		expect(athanor.reactions[0].runTimeSeconds).toBeGreaterThan(plain.reactions[0].runTimeSeconds);
	});

	it.each([
		['{', ['body']],
		[[], ['body']],
		[{ totalSlots: 0, targets: [{ slug: 'fullerides' }] }, ['totalSlots']],
		[{ totalSlots: 10_001, targets: [{ slug: 'fullerides' }] }, ['totalSlots']],
		[{ totalSlots: 10, targets: [] }, ['targets']],
		[{ totalSlots: 10, targets: Array.from({ length: 51 }, () => ({ slug: 'fullerides' })) }, ['targets']],
		[{ totalSlots: 10, targets: [{ slug: 'fullerides', blueprintTypeId: 46209 }] }, ['targets.0']],
		[{ totalSlots: 10, targets: [{ slug: 'fullerides', lines: 1, quantity: 5 }] }, ['targets.0']],
		[{ totalSlots: 10, targets: [{ slug: 'fullerides', quantity: -1 }] }, ['targets.0.quantity']],
		[{ totalSlots: 10, targets: [{ slug: 'fullerides', auto: 'yes' }] }, ['targets.0.auto']],
		[{ totalSlots: 10, targets: [{ slug: 'fullerides' }], stock: { abc: 1 } }, ['stock.abc']],
		[
			{ totalSlots: 10, targets: [{ slug: 'fullerides' }], settings: { cycleDays: 99 } },
			['settings.cycleDays']
		],
		[{ totalSlots: 10, targets: [{ slug: 'fullerides' }], settings: 'garbage' }, ['settings']],
		[
			{ totalSlots: 10, targets: [{ slug: 'fullerides' }], settings: { shared: { systemId: 30000142 } } },
			['settings.shared.systemId']
		]
	])('%j → 400 INVALID_PARAM %j', async (body, params) => {
		const { env } = await seededEnv();
		const { response, body: error } = await post(env, body);
		expect(response.status).toBe(400);
		expect(ErrorResponse.parse(error).error.code).toBe('INVALID_PARAM');
		expect(invalidParams(error)).toEqual(params);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('rejects bodies over 64 KB with 413', async () => {
		const { env } = await seededEnv();
		const body = JSON.stringify({
			totalSlots: 1,
			targets: [{ slug: 'fullerides' }],
			pad: 'x'.repeat(65_536)
		});
		const { response, body: error } = await post(env, body);
		expect(response.status).toBe(413);
		expect(invalidParams(error)).toEqual(['body']);
	});

	it('404s for unknown reactions and non-public hubs', async () => {
		const { env } = await seededEnv();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		for (const body of [
			{ totalSlots: 10, targets: [{ slug: 'nope' }] },
			{ totalSlots: 10, targets: [{ blueprintTypeId: 1 }] },
			{
				totalSlots: 10,
				targets: [{ slug: 'fullerides' }],
				settings: { shared: { market: { outputHub: 'structure-1044752365771' } } }
			},
			{
				totalSlots: 10,
				targets: [{ slug: 'fullerides' }],
				settings: { mode: 'per_reactor', reactors: { hybrid: { market: { inputHub: 'nowhere' } } } }
			}
		]) {
			const { response, body: error } = await post(env, body);
			expect(response.status).toBe(404);
			expect(ErrorResponse.parse(error).error.code).toBe('NOT_FOUND');
		}
	});
});
