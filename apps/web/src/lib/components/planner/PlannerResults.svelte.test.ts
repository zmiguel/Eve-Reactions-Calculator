import { planReactions, type PlanInput } from '@reactions/engine';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../../../../../../packages/engine/test/fixtures/context';
import { jitaPrices, priceBook } from '../../../../../../packages/engine/test/fixtures/dataset';
import { formatIsk, formatIskFull } from '#lib/format.js';
import { ownRuns } from '#lib/planner/plan.js';
import PlannerResults from './PlannerResults.svelte';

const CRYSTALLINE_CARBONIDE = 46205;
const CARBON_POLYMERS_BP = 46167;
const CRYSTALLITE_ALLOY_BP = 46169;
const UNREFINED_TRITANIUM = 90274;
const formulaNames = {
	46205: 'Crystalline Carbonide Reaction Formula',
	46167: 'Carbon Polymers Reaction Formula'
};
const dataset = makeCtx().dataset;

const input = (overrides: Partial<PlanInput> = {}): PlanInput => ({
	ctx: makeCtx(),
	totalSlots: 150,
	targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 }],
	buyInsteadOfBuild: [],
	stock: {},
	ownedFormulas: {},
	dailyVolumes: {},
	...overrides
});

function plan(overrides: Partial<PlanInput> = {}) {
	return planReactions(input(overrides));
}

function setup(overrides: Partial<PlanInput> = {}, extra: Record<string, unknown> = {}) {
	const p = plan(overrides);
	return render(PlannerResults, {
		props: { plan: p, dataset, totalSlots: overrides.totalSlots ?? 150, cycleDays: 7, formulaNames, ...extra }
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

	it('lists the reactions to run with slots and runs per slot, grouped by step, type and first cycle', () => {
		const { container } = setup();
		const groups = [...container.querySelectorAll('[data-plan-group]')].map((g) => ({
			header: text(g.querySelector('th')),
			rows: [...g.querySelectorAll('[data-plan-reaction]')].map((r) =>
				[...r.querySelectorAll('td')].slice(0, 3).map((td) => text(td))
			)
		}));
		expect(groups).toEqual([
			{
				header: 'Final products · Composite · from cycle 2 · 2 slots',
				rows: [['Crystalline Carbonide', '2', '126']]
			},
			{
				header: 'Intermediates · from cycle 1 · 2 slots',
				rows: [
					['Carbon Polymers', '1', '123'],
					['Crystallite Alloy', '1', '123']
				]
			}
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
			props: { plan: p, dataset, totalSlots: 150, cycleDays: 3.5, formulaNames }
		});
		const cell = (field: string) =>
			text(container.querySelector(`[data-output="16670"] [data-field="${field}"]`));
		expect([cell('perCycle'), cell('perDay'), cell('volumeShare')]).toEqual([
			'1,260,000',
			'360,000',
			'10.0%'
		]);
	});

	it('notes what a quantity target asked for when its runs make more, not for lines', () => {
		// 35,276,442 asked ÷ 10,000 per run → 3,528 runs = 35,280,000 sold, the rest of the last run included.
		const quantity = setup({
			targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 35_276_442 }]
		});
		const requested = quantity.container.querySelector(
			'[data-output="16670"] [data-field="perCycle"] [data-field="requested"]'
		);
		expect(text(requested)).toBe('asked 35,276,442');
		expect(text(cellOf(quantity.container, 'perCycle'))).toBe('35,280,000 asked 35,276,442');
		quantity.unmount();

		// Exactly whole runs: nothing to note.
		const exact = setup({
			targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 35_280_000 }]
		});
		expect(exact.container.querySelector('[data-field="requested"]')).toBeNull();
		exact.unmount();

		const lines = setup();
		expect(lines.container.querySelector('[data-field="requested"]')).toBeNull();
		expect(text(cellOf(lines.container, 'perCycle'))).toBe('2,520,000');
	});

	describe('auto-fill note in the outputs table', () => {
		const note = (container: HTMLElement) =>
			container.querySelector('[data-output="16670"] [data-field="perCycle"] [data-field="autoFilled"]');

		it("shows the product's total with auto-fill's part noted under it", () => {
			const { container } = render(PlannerResults, {
				props: {
					plan: plan({
						targets: [
							{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 },
							{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, auto: true }
						]
					}),
					dataset,
					totalSlots: 150,
					cycleDays: 7,
					formulaNames
				}
			});
			// 3 lines × 126 runs × 10,000 = 3,780,000 made in total; auto-fill's line is 1,260,000 of it.
			expect(text(cellOf(container, 'perCycle'))).toBe('3,780,000 Auto-fill +1,260,000');
			expect(text(note(container))).toBe('Auto-fill +1,260,000');
			expect(container.querySelectorAll('[data-output]')).toHaveLength(1);
		});

		it('lists a product only auto-fill makes as an output with its note, and no note without auto-fill', () => {
			const { container, unmount } = render(PlannerResults, {
				props: {
					plan: plan({
						targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 12_300, auto: true }]
					}),
					dataset,
					totalSlots: 150,
					cycleDays: 7,
					formulaNames
				}
			});
			// 12,300 ÷ 10,000 per run → 2 runs: 20,000 made, all of it auto-fill's; nothing "asked".
			expect(text(cellOf(container, 'perCycle'))).toBe('20,000 Auto-fill +20,000');
			expect(container.querySelector('[data-field="requested"]')).toBeNull();
			unmount();

			const plain = setup();
			expect(note(plain.container)).toBeNull();
		});
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

	it('offers multibuy copies of the per-cycle list, each start-up cycle and the N-cycle shopping list', () => {
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
		const formula = container.querySelector('[data-formula="46205"] td')!;
		expect(text(formula)).toBe('Crystalline Carbonide Reaction Formula');
		// Formulas are blueprints: the image server only serves them under `bp`.
		expect(formula.querySelector('img')?.getAttribute('src')).toBe(
			'https://images.evetech.net/types/46205/bp?size=32'
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
			props: { plan: withRoutes, dataset, totalSlots: 150, cycleDays: 7, formulaNames }
		});
		const route = container.querySelector(
			`[data-unrefined-routes] [data-unrefined-route="${alloy.blueprintTypeId}"]`
		)!;
		// Raw text (what a copy gives): words separated in the DOM itself, only the arrow between them.
		// Byproducts are left to the material flow.
		expect(route.textContent).toBe('Crystallite Alloy → Unrefined Crystallite Alloy · runs once in step 0');
		// Screen readers hear the arrow as "replaced by".
		expect(screen.getByRole('img', { name: 'replaced by' }).textContent).toBe('→');
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

	it('shopping list for N cycles: the plan’s horizon with its cycles, totals and controls', async () => {
		const p = plan({ horizonCycles: 3 });
		const cycles: number[] = [];
		const toggles: boolean[] = [];
		const { container, rerender } = render(PlannerResults, {
			props: {
				plan: p,
				dataset,
				totalSlots: 150,
				cycleDays: 7,
				formulaNames,
				oncycles: (n: number) => cycles.push(n),
				onusestock: (on: boolean) => toggles.push(on)
			}
		});
		const section = container.querySelector('[data-plan-shopping]')!;
		expect(text(section.querySelector('h3'))).toBe('Shopping list for 3 cycles');
		expect(text(section.querySelector('[data-shopping-note]'))).toBe(
			'Covers build-up cycle 1 and steady cycles 2 to 3.'
		);
		const cost = p.horizon.purchases.reduce((a, i) => a + i.total + i.fees + i.shipping, 0);
		expect(section.querySelector('[data-field="shoppingTotal"]')!.getAttribute('title')).toBe(
			formatIskFull(cost)
		);
		expect(text(section.querySelector('[data-field="shoppingJobCost"]'))).toBe(formatIsk(p.horizon.jobCost));
		expect(section.querySelectorAll('tbody tr[data-type-id]')).toHaveLength(p.horizon.purchases.length);
		expect(section.querySelector('[data-field="shoppingUseStock"]')).toBeNull();

		// Out-of-range entries are clamped to 1–52.
		const input = section.querySelector('[data-field="shoppingCycles"]') as HTMLInputElement;
		await fireEvent.change(input, { target: { value: '99' } });
		await fireEvent.change(input, { target: { value: '1' } });
		expect(cycles).toEqual([52, 1]);

		// One cycle of the plan without stock, with the toggle.
		const one = plan({ horizonCycles: 1 });
		await rerender({ shoppingPlan: one, hasStock: true, useStock: false });
		expect(text(section.querySelector('h3'))).toBe('Shopping list for 1 cycle');
		expect(text(section.querySelector('[data-shopping-note]'))).toBe('Covers build-up cycle 1.');
		const toggle = screen.getByRole('checkbox', { name: 'Subtract my stock' }) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		await fireEvent.click(toggle);
		expect(toggles).toEqual([true]);
	});

	it('lists the stock the plan does not use by role, only when there is some', () => {
		expect(setup().container.querySelector('[data-unused-stock]')).toBeNull();
		const withUnused = {
			...plan(),
			unusedStock: [
				{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 40 },
				{ typeId: 16670, name: 'Crystalline Carbonide', quantity: 12_500 },
				{ typeId: 16659, name: 'Carbon Polymers', quantity: 300 },
				{ typeId: 16640, name: 'Cobalt', quantity: 7 }
			]
		};
		const { container } = render(PlannerResults, {
			props: { plan: withUnused, dataset, totalSlots: 150, cycleDays: 7, formulaNames }
		});
		const section = container.querySelector('[data-unused-stock]')!;
		expect(text(section.querySelector('h3'))).toBe('Stock not used');
		expect([...section.querySelectorAll('tbody')].map((g) => text(g.querySelector('th')))).toEqual([
			'Fuel blocks',
			'Raw materials',
			'Intermediates',
			'Products'
		]);
		expect(
			[...section.querySelectorAll('tbody tr[data-type-id]')].map((r) =>
				[...r.children].map((td) => text(td))
			)
		).toEqual([
			['Oxygen Fuel Block', '40'],
			['Cobalt', '7'],
			['Carbon Polymers', '300'],
			['Crystalline Carbonide', '12,500']
		]);
	});

	describe('slot time', () => {
		// Every reaction of the fixture takes 4,769.28 s per run; a 7-day cycle is 604,800 s per slot.
		const slotTimeOf = (container: HTMLElement, id: number) => {
			const cell = container.querySelector(`[data-plan-reaction="${id}"] [data-field="slotTime"]`)!;
			return {
				text: text(cell.querySelector('[data-field="slotTimeText"]')),
				parts: [...cell.querySelectorAll('[data-part]')].map((p) => (p as HTMLElement).dataset.part)
			};
		};
		const split = (container: HTMLElement) =>
			text(container.querySelector('[data-field="utilisationSplit"]'));

		it('splits slot time and utilisation into your targets, auto-fill and idle', () => {
			const targets = [
				{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1 },
				{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, auto: true }
			];
			// Your line alone: 126 Crystalline Carbonide, 62 Carbon Polymers, 62 Crystallite Alloy runs; with
			// the auto line: 252, 123, 123.
			const { container } = setup({ targets }, { ownRuns: ownRuns(input({ targets })) });
			// Crystalline Carbonide: 126 runs each = 600,929.28 s = 6.96 d; 2 slots = 14 d, idle 7,741.44 s = 0.09 d.
			expect(slotTimeOf(container, CRYSTALLINE_CARBONIDE)).toEqual({
				text: 'you 7.0 · auto 7.0 · idle 0.1 d',
				parts: ['yours', 'auto', 'idle']
			});
			// Carbon Polymers: 62 runs = 3.42 d yours, 61 = 3.37 d auto, idle 7 − 6.79 = 0.21 d.
			expect(slotTimeOf(container, CARBON_POLYMERS_BP).text).toBe('you 3.4 · auto 3.4 · idle 0.2 d');
			// Of 4 slots × 604,800 s: yours 250 runs = 49.3 %, auto 248 runs = 48.9 %, idle 1.8 %.
			expect(split(container)).toBe('yours 49.3% · auto-fill 48.9% · idle 1.8%');
		});

		it('counts every run as yours without auto targets', () => {
			const { container } = setup();
			// 252 runs = 13.91 d of 14 d.
			expect(slotTimeOf(container, CRYSTALLINE_CARBONIDE)).toEqual({
				text: 'you 13.9 · idle 0.1 d',
				parts: ['yours', 'idle']
			});
			expect(split(container)).toBe('yours 98.2% · idle 1.8%');
		});

		it('counts one cycle for a slot holding two of a reaction’s own jobs', () => {
			// Unrefined Tritanium: 158.976 s per run, capped at 1,000 runs per job, so 2 lines = 2 jobs of
			// 158,976 s each. Shared slots pack both into one slot: 317,952 s = 3.68 d busy, 286,848 s = 3.32 d idle.
			const target = { blueprintTypeId: UNREFINED_TRITANIUM, lines: 2 };
			const shared = setup({ targets: [target], shareSlots: true });
			expect(slotTimeOf(shared.container, UNREFINED_TRITANIUM).text).toBe('you 3.7 · idle 3.3 d');
			shared.unmount();
			// Without sharing each job has its own slot: 14 d − 3.68 d = 10.32 d idle.
			const own = setup({ targets: [target] });
			expect(slotTimeOf(own.container, UNREFINED_TRITANIUM).text).toBe('you 3.7 · idle 10.3 d');
		});

		it('counts a shared job only for its own duration and marks it in Runs / slot', () => {
			// 1,500,000 units = 150 Crystalline Carbonide runs: one full job of 126 and one of 24; 74 runs each of
			// Carbon Polymers and Crystallite Alloy. The 24-run job shares a slot with Carbon Polymers.
			const { container } = setup({
				targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 1_500_000 }],
				shareSlots: true
			});
			const runs = (id: number) =>
				text(container.querySelector(`[data-plan-reaction="${id}"] [data-field="runs"]`));
			expect([runs(CRYSTALLINE_CARBONIDE), runs(CARBON_POLYMERS_BP), runs(CRYSTALLITE_ALLOY_BP)]).toEqual([
				'1 × 126 + 1 × 24 (shared)',
				'74 (shared)',
				'74'
			]);
			// Crystalline Carbonide: 150 runs = 8.28 d in 7 d + the 24-run job (1.32 d); idle 3,870.72 s rounds to 0.0.
			expect(slotTimeOf(container, CRYSTALLINE_CARBONIDE).text).toBe('you 8.3 d');
			// Carbon Polymers only shares a slot: 74 runs = 4.08 d, no idle of its own.
			expect(slotTimeOf(container, CARBON_POLYMERS_BP)).toEqual({ text: 'you 4.1 d', parts: ['yours'] });
			// Crystallite Alloy runs alone: 4.08 d of 7 d.
			expect(slotTimeOf(container, CRYSTALLITE_ALLOY_BP).text).toBe('you 4.1 · idle 2.9 d');
		});
	});

	describe('shared slots', () => {
		it('lists each shared slot as its jobs in run order, then the idle time left', () => {
			const { container } = setup({
				targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 1_500_000 }],
				shareSlots: true
			});
			// Carbon Polymers 74 runs × 4,769.28 s = 352,926.72 s; Crystalline Carbonide 24 runs = 114,462.72 s;
			// idle 604,800 − 467,389.44 = 137,410.56 s.
			const steps = [...container.querySelectorAll('[data-shared-slot] [data-field="instruction"]')].map(
				(p) => [...p.querySelectorAll('span.whitespace-nowrap')].map((s) => text(s))
			);
			expect(steps).toEqual([
				[
					'Carbon Polymers 74 runs (4d 2h 2m)',
					'Crystalline Carbonide: 24 runs (1d 7h 47m)',
					'Idle 1d 14h 10m'
				]
			]);
		});

		it('is hidden when no slot is shared', () => {
			expect(setup().container.querySelector('[data-shared-slots]')).toBeNull();
			expect(setup({ shareSlots: true }).container.querySelector('[data-shared-slots]')).toBeNull();
		});
	});
});
