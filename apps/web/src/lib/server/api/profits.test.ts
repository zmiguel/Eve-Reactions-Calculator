import { describe, expect, it } from 'vitest';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { defaults, insertSystems, loadSde, putKv } from '../../../test/fixtures';
import { loadCalc } from '../context';
import { clearDataMemo } from '../data';
import { profitResults, profitRow, sortRows } from './profits';

async function ctx(slotAllocation: 'single' | 'optimal' = 'single') {
	clearDataMemo();
	const env = fakeEnv();
	insertSystems(env.DB);
	await putKv(env, await loadSde());
	const settings = { ...defaults(), slotAllocation };
	return (await loadCalc(asEnv(env), { settings, user: null }))!.ctx;
}

describe('profitResults', () => {
	it('picks the requested variant; chain falls back to single without a chain', async () => {
		const c = await ctx();
		const views = (view: 'single' | 'chain' | 'best') =>
			Object.fromEntries(profitResults(c, { reactor: 'composite' }, view, {}).map((r) => [r.slug, r]));
		const single = views('single');
		const chain = views('chain');
		const best = views('best');
		expect(Object.keys(single)).toHaveLength(66);
		expect(single['titanium-carbide'].view).toBe('single');
		expect(chain['titanium-carbide'].view).toBe('chain');
		expect(chain['caesarium-cadmide'].view).toBe('single');
		for (const slug of Object.keys(best)) {
			const candidates = [single[slug], chain[slug]].map((r) => r.totals.profitPerSlotDay ?? -Infinity);
			expect(best[slug].totals.profitPerSlotDay ?? -Infinity).toBeGreaterThanOrEqual(Math.max(...candidates));
		}
	});

	it('passes a fixed line count to optimal chains', async () => {
		const c = await ctx('optimal');
		const [tic] = profitResults(c, { tier: 'composite' }, 'chain', { lines: 3 }).filter(
			(r) => r.slug === 'titanium-carbide'
		);
		expect(tic.allocation?.lines).toBe(3);
	});
});

describe('profitRow and sortRows', () => {
	it('sums fees and shipping of both sides and adds allocation columns on request', async () => {
		const c = await ctx('optimal');
		const [tic] = profitResults(c, { tier: 'composite' }, 'chain', {}).filter(
			(r) => r.slug === 'titanium-carbide'
		);
		const t = tic.totals;
		const row = profitRow(tic, true);
		expect(row).toMatchObject({
			slug: 'titanium-carbide',
			view: 'chain',
			runs: tic.runs,
			inputCost: t.inputCost,
			outputValue: t.outputValue,
			jobCost: t.jobCost,
			fees: t.inputFees + t.outputFees,
			shipping: t.inputShipping + t.outputShipping,
			profit: t.profit,
			slotsUsed: tic.allocation!.slotsUsed,
			lines: tic.allocation!.lines
		});
		expect(profitRow(tic, false)).not.toHaveProperty('lines');
	});

	it('sorts by profit per slot-day descending with nulls last', () => {
		const row = (slug: string, profitPerSlotDay: number | null) =>
			({ slug, profitPerSlotDay }) as Parameters<typeof sortRows>[0][number];
		expect(
			sortRows([row('a', null), row('b', 1), row('c', 3), row('d', null), row('e', -2)]).map((r) => r.slug)
		).toEqual(['c', 'b', 'e', 'a', 'd']);
	});
});
