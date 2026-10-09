import { DEFAULT_SETTINGS, listReactions, type CalcContext, type ResolvedProfile } from '@reactions/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSde, marketFor } from '../../test/fixtures';
import type { HubInfo } from './hubs';
import {
	DAY_MS,
	buildTierSections,
	dateBounds,
	formatAge,
	isValidDateParam,
	profileSystems,
	summarizeResult,
	summarizeSettings
} from './listing';
import { buildPriceBook } from './prices';

let ctx: CalcContext;

const profile = (over: Partial<ResolvedProfile> = {}): ResolvedProfile => ({
	...DEFAULT_SETTINGS.shared,
	securityBand: 'lowsec',
	costIndex: 0.0412,
	systemName: 'Ignoitton',
	costIndexMissing: false,
	...over
});

const hubs: HubInfo[] = [
	{
		hubId: 'jita',
		name: 'Jita 4-4',
		kind: 'station',
		regionId: 10000002,
		systemId: 30000142,
		locationId: 60003760,
		private: false
	}
];

beforeAll(async () => {
	const sde = await loadSde();
	const book = buildPriceBook(marketFor(sde));
	ctx = {
		dataset: sde.dataset,
		profiles: { composite: profile(), biochemical: profile(), hybrid: profile() },
		settings: DEFAULT_SETTINGS,
		inputPrices: book,
		outputPrices: book
	};
});

/** Copy of the context with one hub price replaced. */
function withPrice(base: CalcContext, typeId: number, price: { buy: number | null; sell: number | null }) {
	const book = structuredClone(base.outputPrices);
	book.hubs.jita[typeId] = price;
	return { ...base, inputPrices: book, outputPrices: book };
}

const bySlug = (slug: string) => ctx.dataset.reactions.find((r) => r.slug === slug)!;

describe('buildTierSections', () => {
	it('groups composite reactions into four sections with chain/unrefined/reprocess tabs', () => {
		const sections = buildTierSections(
			'composite',
			listReactions(ctx, { reactor: 'composite' }),
			ctx.dataset
		);
		expect(sections.map((s) => [s.title, s.rows.length])).toEqual([
			['Intermediate', 24],
			['Composite', 17],
			['Unrefined', 17],
			['Unrefined Minerals', 8]
		]);
		expect(sections.map((s) => s.tabs.map((t) => t.label))).toEqual([
			['Buy inputs'],
			['Buy inputs', 'Full chain', 'Using unrefined'],
			['Sell unrefined', 'Reprocess'],
			['Sell unrefined', 'Reprocess']
		]);
	});

	it('adds chain tabs only to biochemical tiers with a chainable reaction', () => {
		const sections = buildTierSections(
			'biochemical',
			listReactions(ctx, { reactor: 'biochemical' }),
			ctx.dataset
		);
		expect(sections.map((s) => [s.title, s.tabs.length])).toEqual([
			['Synth', 1],
			['Standard', 1],
			['Improved', 2],
			['Strong', 2],
			['Molecular-Forged', 2]
		]);
		expect(buildTierSections('hybrid', listReactions(ctx, { reactor: 'hybrid' }), ctx.dataset)).toMatchObject(
			[{ title: 'Polymers', tabs: [{ variant: 'single' }] }]
		);
	});

	it('puts reactions of unlisted tiers into an "Other" section', () => {
		const rows = listReactions(ctx, { reactor: 'hybrid' });
		rows[0] = { ...rows[0], reaction: { ...rows[0].reaction, tier: 'other' } };
		const sections = buildTierSections('hybrid', rows, ctx.dataset);
		expect(sections.map((s) => [s.title, s.rows.length])).toEqual([
			['Polymers', 8],
			['Other', 1]
		]);
	});
});

describe('summarizeResult', () => {
	it('sends net input/output values and names of missing prices', () => {
		const reaction = bySlug('titanium-carbide');
		const [row] = listReactions(ctx).filter((r) => r.reaction === reaction);
		const summary = summarizeResult(row.single, ctx.dataset);
		const t = row.single.totals;
		expect(summary).toEqual({
			profitPerSlotDay: t.profitPerSlotDay,
			profit: t.profit,
			marginPct: t.marginPct,
			inputCost: t.inputCost + t.inputFees + t.inputShipping,
			outputValue: t.outputValue - t.outputFees - t.outputShipping,
			jobCost: t.jobCost,
			runs: row.single.runs,
			missing: [],
			slots: null
		});
		expect(summary.outputValue - summary.inputCost - summary.jobCost).toBeCloseTo(t.profit!, 4);

		const missingType = reaction.materials[1].typeId;
		const broken = withPrice(ctx, missingType, { buy: null, sell: null });
		const [brokenRow] = listReactions(broken).filter((r) => r.reaction === reaction);
		const brokenSummary = summarizeResult(brokenRow.single, ctx.dataset);
		expect(brokenSummary.profit).toBeNull();
		expect(brokenSummary.missing).toEqual([ctx.dataset.types[missingType].name]);
	});

	it('summarises the optimal slot allocation of a full chain (Titanium Carbide: 2 + 2 slots)', () => {
		const optimal = { ...ctx, settings: { ...DEFAULT_SETTINGS, slotAllocation: 'optimal' as const } };
		const [row] = listReactions(optimal, { tier: 'composite' }).filter(
			(r) => r.reaction === bySlug('titanium-carbide')
		);
		expect(summarizeResult(row.chain!, ctx.dataset).slots).toEqual({
			lines: 2,
			total: 4,
			levels: [2, 2],
			reactions: [
				{ name: 'Titanium Carbide', runsPerSlot: [122, 122] },
				{ name: 'Silicon Diborite', runsPerSlot: [120] },
				{ name: 'Titanium Chromide', runsPerSlot: [120] }
			]
		});
		expect(summarizeResult(row.single, ctx.dataset).slots).toBeNull();
	});
});

describe('settings summary', () => {
	it('maps the resolved profile and hub names', () => {
		const summary = summarizeSettings(
			profile({
				structure: 'athanor',
				meRig: 't1',
				costIndexOverridePct: 5,
				costIndex: 0.05,
				market: { ...DEFAULT_SETTINGS.shared.market, outputHub: 'amarr', inputMethod: 'instant' }
			}),
			hubs
		);
		expect(summary).toEqual({
			structure: 'athanor',
			meRig: 't1',
			teRig: 't2',
			systemName: 'Ignoitton',
			securityBand: 'lowsec',
			costIndex: 0.05,
			costIndexOverridden: true,
			inputHub: 'Jita 4-4',
			outputHub: 'amarr',
			inputMethod: 'instant',
			outputMethod: 'sell_order'
		});
	});

	it('lists each distinct system once', () => {
		const systems = profileSystems({
			composite: profile(),
			biochemical: profile(),
			hybrid: profile({ systemId: 30004604, systemName: '671-ST', costIndex: 0, costIndexMissing: true })
		});
		expect(systems).toEqual([
			{ systemName: 'Ignoitton', costIndex: 0.0412, costIndexMissing: false },
			{ systemName: '671-ST', costIndex: 0, costIndexMissing: true }
		]);
	});
});

describe('formatAge', () => {
	it.each([
		[0, 'just now'],
		[59_000, 'just now'],
		[60_000, '1 minute ago'],
		[5 * 60_000, '5 minutes ago'],
		[3_600_000, '1 hour ago'],
		[47 * 3_600_000, '47 hours ago'],
		[3 * DAY_MS, '3 days ago']
	])('%i ms → %s', (ms, text) => {
		expect(formatAge(ms)).toBe(text);
	});
});

describe('date parameter', () => {
	const now = Date.UTC(2026, 9, 6, 12);
	const bounds = dateBounds(now);

	it('allows the last 400 days up to yesterday', () => {
		expect(bounds).toEqual({ min: '2025-09-01', max: '2026-10-05' });
		expect(isValidDateParam('2026-10-05', bounds)).toBe(true);
		expect(isValidDateParam('2025-09-01', bounds)).toBe(true);
	});

	it.each(['2026-10-06', '2026-12-01', '2025-08-31', '2026-02-30', '2026-1-01', 'yesterday', ''])(
		'rejects %s',
		(value) => {
			expect(isValidDateParam(value, bounds)).toBe(false);
		}
	);
});
