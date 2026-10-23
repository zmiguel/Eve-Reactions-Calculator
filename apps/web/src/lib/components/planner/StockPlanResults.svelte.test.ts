import type { LineItem, StockPlan } from '@reactions/engine';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../../../../../../packages/engine/test/fixtures/context';
import StockPlanResults from './StockPlanResults.svelte';

const dataset = makeCtx().dataset;

const NITROGEN_FUEL = 4051;
const HYDROGEN_FUEL = 4246;
const CARBON_POLYMERS = 16659;
const CRYSTALLINE_CARBONIDE = 16670;
const CARBON_POLYMERS_FORMULA = 46167;
const CARBONIDE_FORMULA = 46205;

const fuel = (typeId: number, name: string, quantity: number): LineItem => ({
	typeId,
	name,
	quantity,
	unitPrice: 15_000,
	total: quantity * 15_000,
	fees: 0,
	shipping: 0,
	volume: quantity * 5
});

function stockPlan(overrides: Partial<StockPlan> = {}): StockPlan {
	return {
		maxCycles: 2,
		cycles: [
			{
				cycle: 1,
				jobs: [
					{
						blueprintTypeId: CARBON_POLYMERS_FORMULA,
						name: 'Carbon Polymers Reaction Formula',
						slots: 3,
						runsPerSlot: [62, 62, 61],
						runs: 185,
						jobCost: 1_200_000
					}
				],
				fuel: [fuel(NITROGEN_FUEL, 'Nitrogen Fuel Block', 925)],
				consumed: [{ typeId: 16633, name: 'Hydrocarbons', quantity: 18_500 }],
				produced: [{ typeId: CARBON_POLYMERS, name: 'Carbon Polymers', quantity: 37_000 }],
				slotsUsed: 3,
				jobCost: 1_200_000
			},
			{
				cycle: 2,
				jobs: [
					{
						blueprintTypeId: CARBONIDE_FORMULA,
						name: 'Crystalline Carbonide Reaction Formula',
						slots: 2,
						runsPerSlot: [100, 100],
						runs: 200,
						jobCost: 3_400_000
					}
				],
				fuel: [fuel(HYDROGEN_FUEL, 'Hydrogen Fuel Block', 1_000)],
				consumed: [{ typeId: CARBON_POLYMERS, name: 'Carbon Polymers', quantity: 20_000 }],
				produced: [{ typeId: CRYSTALLINE_CARBONIDE, name: 'Crystalline Carbonide', quantity: 2_000 }],
				slotsUsed: 2,
				jobCost: 3_400_000
			}
		],
		fuelToBuy: [
			fuel(HYDROGEN_FUEL, 'Hydrogen Fuel Block', 1_000),
			fuel(NITROGEN_FUEL, 'Nitrogen Fuel Block', 925)
		],
		formulasToBuy: [
			{
				blueprintTypeId: CARBONIDE_FORMULA,
				name: 'Crystalline Carbonide Reaction Formula',
				count: 2,
				unitPrice: 50_000_000
			}
		],
		leftover: [
			{ typeId: CARBON_POLYMERS, name: 'Carbon Polymers', quantity: 17_000 },
			{ typeId: CRYSTALLINE_CARBONIDE, name: 'Crystalline Carbonide', quantity: 2_000 }
		],
		unpricedStock: [],
		totals: {
			valueConsumed: 40_000_000,
			valueProduced: 200_000_000,
			fuelCost: 28_875_000,
			jobCost: 4_600_000,
			formulaCost: 100_000_000,
			valueAdded: 26_525_000,
			slotDays: 35,
			profitPerSlotDay: 757_857.14
		},
		optimal: true,
		warnings: [],
		...overrides
	};
}

function setup(plan = stockPlan(), allowUnownedFormulas = true, final = true) {
	return render(StockPlanResults, { props: { plan, dataset, final, totalSlots: 11, allowUnownedFormulas } });
}

const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();
const multibuy = (el: Element) =>
	(el.querySelector('textarea[aria-label="Multibuy list"]') as HTMLTextAreaElement).value;

describe('StockPlanResults', () => {
	it('lists the jobs of every cycle with slots and runs per slot', () => {
		const { container } = setup();
		const cycles = [...container.querySelectorAll('[data-stock-cycle]')];
		expect(cycles.map((c) => (c as HTMLElement).dataset.stockCycle)).toEqual(['1', '2']);
		expect(text(cycles[0].querySelector('[data-field="slotsUsed"]'))).toMatch(/^3 \/ 11 slots/);
		const job = cycles[0].querySelector(`[data-stock-job="${CARBON_POLYMERS_FORMULA}"]`)!;
		expect(text(job.querySelector('[data-field="name"]'))).toBe('Carbon Polymers Reaction Formula');
		expect(text(job.querySelector('[data-field="slots"]'))).toBe('3');
		expect(text(job.querySelector('[data-field="runs"]'))).toBe('2 × 62 + 1 × 61');
		expect(
			cycles[1].querySelector(`[data-stock-job="${CARBONIDE_FORMULA}"] [data-field="runs"]`)!.textContent
		).toBe('100');
	});

	it('shows no cycles after the last one with jobs, and says no further cycles are needed', () => {
		const base = stockPlan();
		const empty = (cycle: number) => ({
			...base.cycles[0],
			cycle,
			jobs: [],
			fuel: [],
			consumed: [],
			produced: [],
			slotsUsed: 0,
			jobCost: 0
		});
		// A gap between cycles with jobs stays visible; only the empty tail goes.
		const plan = stockPlan({
			maxCycles: 5,
			cycles: [base.cycles[0], empty(2), { ...base.cycles[1], cycle: 3 }, empty(4), empty(5)]
		});
		const { container } = setup(plan);
		expect(
			[...container.querySelectorAll('[data-stock-cycle]')].map((c) => (c as HTMLElement).dataset.stockCycle)
		).toEqual(['1', '2', '3']);
		expect([...container.querySelectorAll('[data-stock-fuel-cycle]')]).toHaveLength(3);
		expect(text(container.querySelector('[data-stock-cycles-needed]'))).toBe(
			'No further cycles are needed: everything is done by cycle 3 of the 5 chosen.'
		);
		expect(setup(stockPlan()).container.querySelector('[data-stock-cycles-needed]')).toBeNull();
	});

	it('buys only fuel blocks, per cycle and in total, with multibuy lists', () => {
		const { container } = setup(stockPlan(), false);
		const perCycle = [...container.querySelectorAll('[data-stock-fuel-cycle]')];
		expect(
			perCycle.map((c) =>
				[...c.querySelectorAll('tr[data-type-id]')].map((r) => r.getAttribute('data-type-id'))
			)
		).toEqual([[String(NITROGEN_FUEL)], [String(HYDROGEN_FUEL)]]);
		expect(multibuy(perCycle[0])).toBe('Nitrogen Fuel Block\t925');
		expect(multibuy(perCycle[1])).toBe('Hydrogen Fuel Block\t1000');
		expect(multibuy(container.querySelector('[data-stock-fuel-all]')!)).toBe(
			'Hydrogen Fuel Block\t1000\nNitrogen Fuel Block\t925'
		);
		expect(text(container.querySelector('[data-stock-note]'))).toMatch(/^Nothing else is bought/);
	});

	it('lists formulas to buy only when allowed and not empty', () => {
		const allowed = setup();
		const row = allowed.container.querySelector(
			`[data-stock-formulas] [data-formula="${CARBONIDE_FORMULA}"]`
		)!;
		expect([...row.children].map((cell) => text(cell))).toEqual([
			'Crystalline Carbonide Reaction Formula',
			'2',
			'50.00M',
			'100.00M'
		]);
		expect(allowed.container.querySelector('[data-metric="Formula cost"]')).not.toBeNull();
		allowed.unmount();

		expect(setup(stockPlan(), false).container.querySelector('[data-stock-formulas]')).toBeNull();
		expect(
			setup(stockPlan({ formulasToBuy: [] }), true).container.querySelector('[data-stock-formulas]')
		).toBeNull();
	});

	it('shows value added and profit per slot and day', () => {
		const { container } = setup();
		expect(container.querySelector('[data-metric="Value added"] dd')!.getAttribute('title')).toBe(
			'26,525,000.00 ISK'
		);
		const perSlotDay = container.querySelector('[data-metric="Profit / slot / day"]')!;
		expect(text(perSlotDay.querySelector('dd'))).toBe('757.86K');
		expect(perSlotDay.querySelector('dd')!.className).toMatch(/text-green-600/);
		expect(perSlotDay.querySelector('dt')!.getAttribute('title')).toBe(
			'Value added ÷ (slots used × cycle days, summed over the cycles)'
		);
		const empty = setup(
			stockPlan({ totals: { ...stockPlan().totals, slotDays: 0, profitPerSlotDay: null } })
		);
		expect(text(empty.container.querySelector('[data-metric="Profit / slot / day"] dd'))).toBe('n/a');
	});

	it('groups item lists by role: fuel, raw, intermediate, product, then other; moon class, then name within', () => {
		const { container } = setup(
			stockPlan({
				leftover: [
					{ typeId: 1, name: 'Mystery Goo', quantity: 5 },
					{ typeId: CRYSTALLINE_CARBONIDE, name: 'Crystalline Carbonide', quantity: 2_000 },
					{ typeId: CARBON_POLYMERS, name: 'Carbon Polymers', quantity: 17_000 },
					{ typeId: 16640, name: 'Cobalt', quantity: 7 },
					{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 40 },
					{ typeId: 16633, name: 'Hydrocarbons', quantity: 9 }
				]
			})
		);
		const section = container.querySelector('[data-stock-leftover]')!;
		expect([...section.querySelectorAll('tbody')].map((g) => (g as HTMLElement).dataset.group)).toEqual([
			'fuel',
			'raw',
			'intermediate',
			'product',
			'other'
		]);
		expect([...section.querySelectorAll('tbody th')].map((h) => text(h))).toEqual([
			'Fuel blocks',
			'Raw materials',
			'Intermediates',
			'Products',
			'Other'
		]);
		expect([...section.querySelectorAll('tr[data-type-id]')].map((r) => text(r.children[0]))).toEqual([
			'Oxygen Fuel Block',
			'Hydrocarbons',
			'Cobalt',
			'Carbon Polymers',
			'Crystalline Carbonide',
			'Mystery Goo'
		]);
		const groups = (marker: string) =>
			[...container.querySelectorAll(`[data-${marker}] tbody`)].map((g) => (g as HTMLElement).dataset.group);
		expect(groups('stock-consumed')).toEqual(['raw', 'intermediate']);
		expect(groups('stock-produced')).toEqual(['intermediate', 'product']);
	});

	it('notes a final plan that is not proven optimal and explains warnings', () => {
		const notOptimal = stockPlan({
			optimal: false,
			warnings: ['UNPRICED_STOCK', 'SKILL_TOO_LOW'],
			unpricedStock: [
				{ typeId: 1, name: 'Mystery Goo', quantity: 5 },
				{ typeId: 16640, name: 'Cobalt', quantity: 7 }
			]
		});
		const { container } = setup(notOptimal);
		expect(text(container.querySelector('[data-not-optimal]'))).toBe(
			"This is the best plan found within the search's time limit; a better one may exist."
		);
		expect(text(container.querySelector('[data-warning="UNPRICED_STOCK"]'))).toBe(
			'No market price (valued at 0, used only when a reaction needs them): Raw materials: Cobalt; Other: Mystery Goo.'
		);
		expect(text(container.querySelector('[data-warning="SKILL_TOO_LOW"]'))).toMatch(/Reactions skill/);
		expect(setup().container.querySelector('[data-not-optimal]')).toBeNull();
		// A plan found so far, while the search goes on.
		expect(setup(notOptimal, true, false).container.querySelector('[data-not-optimal]')).toBeNull();
	});
});
