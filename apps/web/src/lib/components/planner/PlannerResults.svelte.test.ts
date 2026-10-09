import { planReactions, type PlanInput } from '@reactions/engine';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../../../../../../packages/engine/test/fixtures/context';
import { jitaPrices, priceBook } from '../../../../../../packages/engine/test/fixtures/dataset';
import PlannerResults from './PlannerResults.svelte';

const CRYSTALLINE_CARBONIDE = 46205;
const formulaNames = {
	46205: 'Crystalline Carbonide Reaction Formula',
	46167: 'Carbon Polymers Reaction Formula'
};

function plan(overrides: Partial<PlanInput> = {}) {
	return planReactions({
		ctx: makeCtx(),
		totalSlots: 150,
		targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 }],
		buyInsteadOfBuild: [],
		stock: {},
		ownedFormulas: {},
		dailyVolumes: {},
		...overrides
	});
}

function setup(overrides: Partial<PlanInput> = {}, extra: Record<string, unknown> = {}) {
	const p = plan(overrides);
	return render(PlannerResults, {
		props: { plan: p, totalSlots: overrides.totalSlots ?? 150, cycleDays: 7, formulaNames, ...extra }
	});
}

const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();
const warnings = (container: HTMLElement) =>
	[...container.querySelectorAll('[data-warning]')].map((w) => (w as HTMLElement).dataset.warning);
const cellOf = (container: HTMLElement, field: string) =>
	container.querySelector(`[data-output="16670"] [data-field="${field}"]`)!;

describe('PlannerResults', () => {
	it('shows slots used and remaining with the summary cards', () => {
		const { container } = setup();
		expect(text(container.querySelector('[data-field="slotsUsed"]'))).toBe('4 / 150');
		expect(text(container.querySelector('[data-field="slotsRemaining"]'))).toBe('146 remaining');
		const labels = [...container.querySelectorAll('[data-metric] dt')].map((d) => text(d));
		expect(labels).toEqual([
			'Slots used',
			'Utilisation',
			'Recurring / cycle',
			'Initial investment',
			'Profit / cycle',
			'Profit / day',
			'Profit / slot / day',
			'Margin'
		]);
		expect(warnings(container)).toEqual([]);
	});

	it('lists the reactions to run with slots, runs per slot and first cycle', () => {
		const { container } = setup();
		const rows = [...container.querySelectorAll('[data-plan-reaction]')].map((r) =>
			[...r.querySelectorAll('td')].map((td) => text(td))
		);
		expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[5]])).toEqual([
			['Crystalline Carbonide', '0', '2', '126', '2'],
			['Carbon Polymers', '1', '1', '123', '1'],
			['Crystallite Alloy', '1', '1', '123', '1']
		]);
	});

	it('warns when the plan needs more slots than available', () => {
		const { container } = setup({ totalSlots: 3 });
		expect(text(container.querySelector('[data-field="slotsUsed"]'))).toBe('4 / 3');
		expect(text(container.querySelector('[data-field="slotsRemaining"]'))).toBe('0 remaining');
		expect(warnings(container)).toEqual(['SLOTS_EXCEEDED']);
		expect(text(container.querySelector('[data-warning="SLOTS_EXCEEDED"]'))).toBe(
			'This plan needs 4 slots but only 3 are available.'
		);
	});

	it('renders the phases timeline from build-up to steady with slots per phase', () => {
		const { container } = setup();
		const phases = [...container.querySelectorAll('[data-phase]')];
		expect(phases.map((p) => (p as HTMLElement).dataset.phase)).toEqual(['build_up', 'steady']);
		expect(phases.map((p) => text(p))).toEqual(['Cycle 1 2 slots · build-up', 'Cycle 2+ 4 slots · steady']);
		expect(phases[0].getAttribute('title')).toBe('Carbon Polymers, Crystallite Alloy');
	});

	it('shows sold per day, the region’s daily volume and the share, flagging shares above 20 %', () => {
		// 2 lines × 126 runs × 10,000 units = 2,520,000 per cycle ÷ 7 days = 360,000 per day.
		const volumes = { 16670: { regionName: 'The Forge', volume: 1_000_000 } };
		const high = setup({ dailyVolumes: { 16670: 1_000_000 } }, { volumes });
		const cell = (field: string) =>
			text(high.container.querySelector(`[data-output="16670"] [data-field="${field}"]`));
		expect(
			[...high.container.querySelectorAll('section[aria-labelledby="plan-outputs"] th')].map((th) => text(th))
		).toEqual(['Product', 'Per cycle', 'Sold / day', 'Region daily volume', 'Share', 'Value', 'Net']);
		expect([cell('perCycle'), cell('perDay'), cell('regionVolume'), cell('volumeShare')]).toEqual([
			'2,520,000',
			'360,000',
			'1,000,000 The Forge',
			'36.0%'
		]);
		expect(cellOf(high.container, 'volumeShare').className).toContain('text-red-600');
		expect(warnings(high.container)).toEqual(['HIGH_VOLUME_SHARE']);
		expect(text(high.container.querySelector('[data-warning="HIGH_VOLUME_SHARE"]'))).toBe(
			"Crystalline Carbonide: 360,000/day (2,520,000 per 7-day cycle) is 36.0% of The Forge's average daily volume (1,000,000/day), which may push the price down."
		);
		high.unmount();

		const low = setup({ dailyVolumes: { 16670: 9_000_000 } });
		const lowShare = low.container.querySelector('[data-output="16670"] [data-field="volumeShare"]')!;
		expect(text(lowShare)).toBe('4.0%');
		expect(lowShare.className).not.toContain('text-red-600');
		expect(text(cellOf(low.container, 'regionVolume'))).toBe('n/a');
		expect(warnings(low.container)).toEqual([]);
	});

	it('divides by the locally edited cycle length', () => {
		// 3.5-day cycle: 63 runs per line → 2 × 63 × 10,000 = 1,260,000 per cycle = 360,000 per day.
		const p = plan({ ctx: makeCtx({ settings: { cycleDays: 3.5 } }), dailyVolumes: { 16670: 3_600_000 } });
		const { container } = render(PlannerResults, {
			props: { plan: p, totalSlots: 150, cycleDays: 3.5, formulaNames }
		});
		const cell = (field: string) =>
			text(container.querySelector(`[data-output="16670"] [data-field="${field}"]`));
		expect([cell('perCycle'), cell('perDay'), cell('volumeShare')]).toEqual([
			'1,260,000',
			'360,000',
			'10.0%'
		]);
	});

	it('keeps the shopping list plain and shows market availability in its own table', () => {
		// The structure input hub lists 5,000 Cobalt; Crystallite Alloy needs 11,976 per cycle.
		const local = { ...jitaPrices, 16640: { buy: 1000, sell: 1100, buyVolume: 0, sellVolume: 5000 } };
		const ctx = makeCtx({
			profile: { market: { inputHub: 'local' } },
			inputPrices: priceBook({ jita: jitaPrices, local }),
			outputPrices: priceBook()
		});
		const { container } = setup(
			{ ctx, inputDailyVolumes: { local: { 16640: 5_000 } } },
			{
				purchaseVolumes: { 16640: { regionName: 'The Forge', volume: 5_000 } },
				inputMarket: { name: 'Seed Market', fallbackName: 'Jita 4-4', structure: true }
			}
		);
		const shopping = screen.getByRole('region', { name: 'Shopping list per cycle' });
		expect([...shopping.querySelectorAll('thead th')].map((th) => text(th))).toEqual([
			'Item',
			'Quantity',
			'Unit price',
			'Total',
			'Fees',
			'Volume m³'
		]);
		expect(shopping.querySelector('[data-sources]')).toBeNull();

		const market = container.querySelector('section[aria-labelledby="plan-market"]')!;
		expect(text(market.querySelector('h3'))).toBe('Market availability at Seed Market');
		expect([...market.querySelectorAll('thead th')].map((th) => text(th))).toEqual([
			'Item',
			'Needed per cycle',
			'Listed',
			'From Jita 4-4',
			'Share of region volume'
		]);
		const row = market.querySelector('[data-purchase="16640"]')!;
		const cell = (field: string) => row.querySelector(`[data-field="${field}"]`)!;
		// 11,976 per 7-day cycle vs 5,000/day × 7 days = 34.2 %.
		expect(['needed', 'listed', 'fallback', 'volumeShare'].map((f) => text(cell(f)))).toEqual([
			'11,976',
			'5,000',
			'6,976',
			'34.2%'
		]);
		expect(cell('listed').className).toContain('text-amber-700');
		expect(cell('volumeShare').className).toContain('text-red-600');
		expect(cell('volumeShare').getAttribute('title')).toBe('5,000/day traded in The Forge');

		expect(warnings(container)).toEqual(['INPUT_VOLUME_SHORT', 'HIGH_INPUT_VOLUME_SHARE']);
		expect(text(container.querySelector('[data-warning="INPUT_VOLUME_SHORT"]'))).toBe(
			'Cobalt: 11,976 needed per cycle, 5,000 listed at Seed Market; 6,976 priced at Jita 4-4.'
		);
		expect(text(container.querySelector('[data-warning="HIGH_INPUT_VOLUME_SHARE"]'))).toBe(
			"Cobalt: 11,976 per 7-day cycle is 34.2% of The Forge's traded volume over the same period, which may push the price up."
		);
	});

	it('omits the fallback column when the input hub lists enough', () => {
		const listed = Object.fromEntries(
			Object.entries(jitaPrices).map(([id, p]) => [id, { ...p, buyVolume: 1e9, sellVolume: 1e9 }])
		);
		const ctx = makeCtx({ inputPrices: priceBook({ jita: listed }), outputPrices: priceBook() });
		const { container } = setup({ ctx });
		const market = container.querySelector('section[aria-labelledby="plan-market"]')!;
		expect([...market.querySelectorAll('thead th')].map((th) => text(th))).toEqual([
			'Item',
			'Needed per cycle',
			'Listed',
			'Share of region volume'
		]);
		expect(text(market.querySelector('[data-purchase="16640"] [data-field="listed"]'))).toBe('1,000,000,000');
	});

	it('hides market availability when nothing is known about the market', () => {
		const { container } = setup();
		expect(container.querySelector('section[aria-labelledby="plan-market"]')).toBeNull();
	});

	it('shows engine, profile and missing-price warnings', () => {
		const { container } = setup({}, { missing: ['Cobalt'], profileWarnings: ['HUB_UNAVAILABLE'] });
		expect(warnings(container)).toEqual(['HUB_UNAVAILABLE', 'MISSING_PRICES']);
		expect(text(container.querySelector('[data-warning="MISSING_PRICES"]'))).toContain(
			'No market price for Cobalt'
		);
	});

	it('offers multibuy copies of the per-cycle list, each start-up cycle and all start-up purchases', () => {
		const { container } = setup();
		const lists = [...container.querySelectorAll('textarea')].map((t) => (t as HTMLTextAreaElement).value);
		expect(lists).toHaveLength(4);
		for (const list of lists) for (const line of list.split('\n')) expect(line).toMatch(/^[^\t]+\t\d+$/);
		expect(screen.getByRole('region', { name: 'Shopping list per cycle' })).toBeTruthy();
		expect(
			[...container.querySelectorAll('[data-plan-startup] [data-startup-phase] h4')].map((h) => text(h))
		).toEqual(['Cycle 1, start-up', 'Cycle 2, first steady cycle']);
		expect(container.querySelector('[data-startup-choice]')).toBeNull();
		expect(container.querySelector('[data-unrefined-routes]')).toBeNull();
		expect(text(container.querySelector('[data-formula="46205"] td'))).toBe(
			'Crystalline Carbonide Reaction Formula'
		);
	});

	it('explains the unrefined routes and a chosen step 0, with its own buy list', () => {
		const p = plan();
		const [top, polymers, alloy] = p.reactions;
		const unrefined = {
			...alloy,
			name: 'Unrefined Crystallite Alloy',
			reprocess: {
				replaces: [
					{ typeId: 16655, name: 'Crystallite Alloy', quantity: 24600, regularName: 'Crystallite Alloy' }
				],
				byproducts: [
					{
						typeId: 16640,
						name: 'Cobalt',
						quantity: 30000,
						used: 12000,
						sold: 18000,
						usedBy: [{ blueprintTypeId: polymers.blueprintTypeId, fromCycle: 1 }]
					}
				]
			}
		};
		const step0 = {
			cycle: 0,
			label: 'step_0' as const,
			blueprintTypeIds: [alloy.blueprintTypeId],
			slots: 1,
			purchases: p.phases[0].purchases.slice(0, 1),
			jobCost: 1_000_000
		};
		const withRoutes = {
			...p,
			reactions: [top, polymers, unrefined],
			phases: [step0, ...p.phases],
			startup: {
				mode: 'step0' as const,
				reused: [{ typeId: 16640, name: 'Cobalt', quantity: 12000 }],
				buy: { initialInvestment: 2_000_000_000, cycles: 2 },
				step0: {
					initialInvestment: 1_900_000_000,
					cycles: 3,
					blueprintTypeIds: [alloy.blueprintTypeId],
					saves: [{ typeId: 16640, name: 'Cobalt', quantity: 12000 }],
					stock: [{ typeId: 16655, name: 'Crystallite Alloy', quantity: 24600 }]
				}
			}
		};
		const { container } = render(PlannerResults, {
			props: { plan: withRoutes, totalSlots: 150, cycleDays: 7, formulaNames }
		});
		const route = container.querySelector(
			`[data-unrefined-routes] [data-unrefined-route="${alloy.blueprintTypeId}"]`
		)!;
		// Raw text: the words must be separated in the DOM itself, not only after whitespace collapsing.
		// Byproducts are left to the material flow.
		expect(route.textContent).toBe(
			'Crystallite Alloy → replaced by Unrefined Crystallite Alloy · runs once in step 0'
		);
		const note = container.querySelector('[data-startup-choice]')!;
		expect(text(note.querySelector('[data-startup-title]'))).toBe('Step 0, once before cycle 1');
		expect([...note.querySelectorAll('li')].map((li) => text(li))).toEqual([
			'Unrefined Crystallite Alloy runs one extra time before cycle 1, so cycle 1 already has 12,000 Cobalt from reprocessing instead of buying it.',
			'Initial investment 1.90B instead of 2.00B, but one more cycle.',
			'Step 0 also leaves 24,600 Crystallite Alloy in stock.',
			'From cycle 1, every unrefined reaction runs each cycle, like the other reactions.',
			'From the cycle after their first run, their reprocessing byproducts replace purchases: 12,000 Cobalt per cycle. Until then, the start-up buys these.'
		]);
		expect([...container.querySelectorAll('[data-phase]')].map((ph) => text(ph))[0]).toBe(
			'Step 0 1 slot · once'
		);
		expect(
			[...container.querySelectorAll('[data-plan-startup] [data-startup-phase] h4')].map((h) => text(h))
		).toEqual(['Step 0, once before cycle 1', 'Cycle 1, start-up', 'Cycle 2, first steady cycle']);
	});
});
