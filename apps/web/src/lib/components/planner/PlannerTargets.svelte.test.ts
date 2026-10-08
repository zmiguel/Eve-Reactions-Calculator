import type { PlanTarget } from '@reactions/engine';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { plannerContext, targetFootprint } from '$lib/planner/plan';
import { dataset } from '../../../../../../packages/engine/test/fixtures/dataset';
import { plannerData } from '../../../test/planner';
import PlannerTargets from './PlannerTargets.svelte';

const CRYSTALLINE_CARBONIDE = 46205;

const rows = (container: HTMLElement) => container.querySelectorAll('[data-target-row]');
// Selects are typed as inputs: the workers DOM types make `HTMLSelectElement` unusable; `.value` is shared.
const product = (i: number) =>
	screen.getByRole('combobox', { name: `Product of target ${i}` }) as HTMLInputElement;
const chosen = (select: HTMLElement) => select.querySelector('option:checked')!.textContent;
const lines = (i: number) =>
	screen.getByRole('spinbutton', { name: `Lines of target ${i}` }) as HTMLInputElement;

const planInput = {
	ctx: plannerContext(plannerData(), 7),
	totalSlots: 150,
	targets: [],
	buyInsteadOfBuild: [],
	stock: {},
	ownedFormulas: {},
	dailyVolumes: {}
};

function setup(targets: PlanTarget[] = [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 }]) {
	return render(PlannerTargets, {
		props: {
			targets,
			reactions: dataset.reactions,
			footprint: (t: PlanTarget) => targetFootprint(planInput, t)
		}
	});
}

const slotsText = (container: HTMLElement, row = 0) =>
	container
		.querySelector(`[data-target-row="${row}"] [data-field="slots"]`)!
		.textContent!.replace(/\s+/g, ' ')
		.trim();
const quantity = (i: number) =>
	screen.getByRole('textbox', { name: `Quantity per cycle of target ${i}` }) as HTMLInputElement;

describe('PlannerTargets', () => {
	it('groups the product select by tier for the row’s reactor', () => {
		setup();
		const select = product(1);
		expect(select.value).toBe(String(CRYSTALLINE_CARBONIDE));
		expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
			'Intermediate',
			'Composite',
			'Unrefined',
			'Unrefined Minerals'
		]);
		const composite = select.querySelector('optgroup[label="Composite"]')!;
		expect([...composite.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
			'Crystalline Carbonide',
			'Fullerides',
			'Titanium Carbide'
		]);
		expect((screen.getByRole('combobox', { name: 'Reactor of target 1' }) as HTMLInputElement).value).toBe(
			'composite'
		);
	});

	it('switching the reactor lists that reactor’s tiers and picks its first product', async () => {
		setup();
		await fireEvent.change(screen.getByRole('combobox', { name: 'Reactor of target 1' }), {
			target: { value: 'biochemical' }
		});
		const select = product(1);
		expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
			'Standard',
			'Improved',
			'Strong'
		]);
		expect(chosen(select)).toBe('Pure Standard Blue Pill Booster');
	});

	it('adds a one-line target and removes rows', async () => {
		const { container } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '+ Add target' }));
		expect(rows(container)).toHaveLength(2);
		expect(lines(2).value).toBe('1');
		expect(chosen(product(2))).toBe('Caesarium Cadmide');

		await fireEvent.click(screen.getByRole('button', { name: 'Remove Crystalline Carbonide' }));
		expect(rows(container)).toHaveLength(1);
		expect(chosen(product(1))).toBe('Caesarium Cadmide');
		expect(lines(1).value).toBe('1');
	});

	it('keeps lines at 1 or more', async () => {
		setup();
		await fireEvent.change(lines(1), { target: { value: '0' } });
		expect(lines(1).value).toBe('1');
		await fireEvent.change(lines(1), { target: { value: '-5' } });
		expect(lines(1).value).toBe('1');
		await fireEvent.change(lines(1), { target: { value: '' } });
		expect(lines(1).value).toBe('1');
		await fireEvent.change(lines(1), { target: { value: '4' } });
		expect(lines(1).value).toBe('4');
	});

	it('shows each target’s slot footprint', async () => {
		const { container } = setup();
		expect(slotsText(container)).toBe('4 slots · 3/line');
		await fireEvent.change(lines(1), { target: { value: '1' } });
		expect(slotsText(container)).toBe('3 slots');
	});

	it('switches a row to a quantity per cycle and back', async () => {
		const { container } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Qty / cycle' }));
		// Starts from what the 2 lines make: 2 × 126 runs × 10,000 units.
		expect(quantity(1).value).toBe('2,520,000');
		expect(screen.queryByRole('spinbutton', { name: 'Lines of target 1' })).toBeNull();

		await fireEvent.change(quantity(1), { target: { value: '35 280 000' } });
		expect(quantity(1).value).toBe('35,280,000');
		expect(slotsText(container)).toBe('56 slots · 28 final');

		await fireEvent.change(quantity(1), { target: { value: 'lots' } });
		expect(quantity(1).value).toBe('35,280,000');
		await fireEvent.change(quantity(1), { target: { value: '0' } });
		expect(quantity(1).value).toBe('35,280,000');

		await fireEvent.click(screen.getByRole('button', { name: 'Lines' }));
		expect(lines(1).value).toBe('2');
		expect(slotsText(container)).toBe('4 slots · 3/line');
	});

	it('accepts any reaction product as a quantity target, including intermediates', async () => {
		const { container } = setup([{ blueprintTypeId: 46167, lines: 1, quantity: 1_000_000 }]);
		expect(chosen(product(1))).toBe('Carbon Polymers');
		expect(slotsText(container)).toBe('40 slots · 40 final');
	});

	it('derives the quantity per cycle from an order total over N cycles', async () => {
		const { container } = setup([{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 10_000 }]);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Total needed for target 1' }), {
			target: { value: '100,000,001' }
		});
		await fireEvent.input(screen.getByRole('spinbutton', { name: 'Cycles for target 1' }), {
			target: { value: '3' }
		});
		expect(container.querySelector('[data-field="perCycle"]')!.textContent).toBe('33,333,334');
		await fireEvent.click(screen.getByRole('button', { name: 'Use' }));
		expect(quantity(1).value).toBe('33,333,334');
	});

	it('invites adding a target when empty', () => {
		const { container } = setup([]);
		expect(rows(container)).toHaveLength(0);
		expect(container.textContent).toContain('No targets yet');
	});
});
