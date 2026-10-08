import { DEFAULT_CONSTANTS, DEFAULT_SETTINGS, Settings } from '@reactions/engine';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { SystemSummary } from '$lib/settings/fields';
import SettingsForm from './SettingsForm.svelte';

const IGNOITTON: SystemSummary = {
	id: 30002647,
	name: 'Ignoitton',
	regionName: 'Sinq Laison',
	securityBand: 'lowsec',
	securityStatus: 0.4388,
	reactionCostIndex: 0.0412
};
const HUBS = [
	{ hubId: 'jita', name: 'Jita 4-4', private: false },
	{ hubId: 'amarr', name: 'Amarr VIII', private: false }
];

async function setup(settings: Settings = DEFAULT_SETTINGS, errors: Record<string, string> = {}) {
	const result = render(SettingsForm, {
		settings,
		hubs: HUBS,
		systems: { 30002647: IGNOITTON },
		errors,
		constants: DEFAULT_CONSTANTS
	});
	await tick(); // onMount: switch dependent fields to script control
	// Selects are typed as inputs too: the workers DOM types make `HTMLSelectElement` unusable; `.value` is shared.
	const field = (name: string) =>
		result.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
	return { ...result, field };
}

describe('SettingsForm', () => {
	it('posts to ?/save with the global fields and the shared profile in shared mode', async () => {
		const { container, field } = await setup();
		const form = container.querySelector('form')!;
		expect(form.getAttribute('method')).toBe('POST');
		expect(form.getAttribute('action')).toBe('?/save');
		expect(field('editing')!.value).toBe('shared');
		expect(field('cycleDays')!.value).toBe('7');
		expect(field('shared.structure')!.value).toBe('tatara');
		expect(field('shared.systemId')!.value).toBe('30002647');
		expect(field('reactors.composite.structure')).toBeNull();
		expect(screen.queryByRole('radiogroup', { name: 'Reactor profile' })).toBeNull();
		const reset = screen.getByRole('button', { name: 'Reset to defaults' });
		expect(reset.getAttribute('formaction')).toBe('?/reset');
	});

	it('offers the chain slot allocation with one explanation per mode, checked from the settings', async () => {
		const { container } = await setup(Settings.parse({ slotAllocation: 'optimal' }));
		const group = container.querySelector('fieldset[data-slot-allocation]')!;
		expect(group.querySelector('legend')!.textContent!.trim()).toBe('Chain slot allocation');
		const radios = [...group.querySelectorAll<HTMLInputElement>('input[name="slotAllocation"]')];
		expect(radios.map((r) => [r.value, r.checked])).toEqual([
			['single', false],
			['optimal', true]
		]);
		expect(group.textContent).toContain('Single slot');
		expect(group.textContent).toContain('every allocated slot-day');
	});

	it('offers max parallel lines as a whole number from 1 to 10', async () => {
		const { field } = await setup(Settings.parse({ maxParallelLines: 6 }));
		const input = field('maxParallelLines')!;
		expect([input.value, input.min, input.max, input.step]).toEqual(['6', '1', '10', '1']);
		expect(screen.getByLabelText('Max parallel lines')).toBe(input);
	});

	it('offers which tab reactions open on, checked from the settings', async () => {
		const { container } = await setup(Settings.parse({ defaultView: 'chain' }));
		const group = container.querySelector('fieldset[data-default-view]')!;
		expect(group.querySelector('legend')!.textContent!.trim()).toBe('Open reactions on');
		const radios = [...group.querySelectorAll<HTMLInputElement>('input[name="defaultView"]')];
		expect(radios.map((r) => [r.value, r.checked, r.closest('label')!.textContent!.trim()])).toEqual([
			['single', false, 'Buy inputs'],
			['chain', true, 'Full chain']
		]);
	});

	it('offers which tab reprocessable reactions open on, checked from the settings', async () => {
		const { container } = await setup(Settings.parse({ defaultOutput: 'reprocessed' }));
		const group = container.querySelector('fieldset[data-default-output]')!;
		expect(group.querySelector('legend')!.textContent!.trim()).toBe('Open reprocessable reactions on');
		const radios = [...group.querySelectorAll<HTMLInputElement>('input[name="defaultOutput"]')];
		expect(radios.map((r) => [r.value, r.checked, r.closest('label')!.textContent!.trim()])).toEqual([
			['product', false, 'Sell product'],
			['reprocessed', true, 'Reprocess']
		]);
	});

	it('offers whether chains may use unrefined reactions, checked from the settings', async () => {
		const radios = async (s: Settings) => {
			const { container, unmount } = await setup(s);
			const group = container.querySelector('fieldset[data-unrefined-in-chains]')!;
			const values = [...group.querySelectorAll<HTMLInputElement>('input[name="unrefinedInChains"]')].map(
				(r) => [r.value, r.checked]
			);
			unmount();
			return values;
		};
		expect(await radios(DEFAULT_SETTINGS)).toEqual([
			['never', true],
			['best', false]
		]);
		expect(await radios(Settings.parse({ unrefinedInChains: 'best' }))).toEqual([
			['never', false],
			['best', true]
		]);
	});

	it('per-reactor tabs appear only in per_reactor mode, starting from the shared profile', async () => {
		const { field } = await setup();
		await fireEvent.change(field('shared.structure')!, { target: { value: 'athanor' } });
		await fireEvent.click(screen.getByLabelText('Separate settings per reactor'));

		const tabs = screen.getByRole('radiogroup', { name: 'Reactor profile' });
		expect([...tabs.querySelectorAll('label')].map((l) => l.textContent!.trim())).toEqual([
			'Composite',
			'Biochemical',
			'Hybrid'
		]);
		expect(field('editing')!.value).toBe('per_reactor');
		expect(field('shared.structure')).toBeNull();
		for (const r of ['composite', 'biochemical', 'hybrid']) {
			expect(field(`reactors.${r}.structure`)!.value).toBe('athanor');
			expect(field(`reactors.${r}.systemId`)!.value).toBe('30002647');
		}

		await fireEvent.click(screen.getByLabelText('Same settings for every reactor'));
		expect(screen.queryByRole('radiogroup', { name: 'Reactor profile' })).toBeNull();
		expect(field('editing')!.value).toBe('shared');
	});

	it('shows per-reactor values and error counts on the tabs', async () => {
		const settings = Settings.parse({ mode: 'per_reactor', reactors: { hybrid: { meRig: 't1' } } });
		const { field } = await setup(settings, { 'reactors.hybrid.sccPct': 'Must be at most 20' });
		expect(field('reactors.hybrid.meRig')!.value).toBe('t1');
		expect(field('reactors.composite.meRig')!.value).toBe('t2');
		expect(screen.getByText('1 error')).toBeTruthy();
		expect(screen.getByText('Must be at most 20')).toBeTruthy();
		expect((screen.getByRole('radio', { name: /Hybrid/ }) as HTMLInputElement).checked).toBe(true);
	});

	it('disables the shipping fields while shipping is off', async () => {
		const { field } = await setup();
		const inputFields = ['iskPerM3', 'collateralPct', 'discountPct'].map((name) =>
			field(`shared.shipping.input.${name}`)!
		);
		expect(inputFields.map((f) => f.disabled)).toEqual([true, true, true]);
		await fireEvent.click(screen.getByLabelText('Ship inputs to the reactor'));
		expect(inputFields.map((f) => f.disabled)).toEqual([false, false, false]);
		expect(field('shared.shipping.output.iskPerM3')!.disabled).toBe(true);
		expect(field('shared.shipping.output.discountPct')!.disabled).toBe(true);
	});

	it('shows a discount field with a hint per shipping side', async () => {
		const values = Settings.parse({
			shared: { shipping: { input: { enabled: true, discountPct: 25 }, output: { discountPct: 5 } } }
		});
		const { field } = await setup(values);
		const discounts = screen.getAllByLabelText('Discount %') as HTMLInputElement[];
		expect(discounts.map((d) => [d.name, d.value])).toEqual([
			['shared.shipping.input.discountPct', '25'],
			['shared.shipping.output.discountPct', '5']
		]);
		for (const discount of discounts) {
			const hint = document.getElementById(discount.getAttribute('aria-describedby')!);
			expect(hint!.textContent).toBe('e.g. a volume discount from your hauling service');
		}
		expect(field('shared.shipping.output.discountPct')!.disabled).toBe(true);
	});

	it('shows the contract basis only for the contract method', async () => {
		const { field } = await setup();
		expect(field('shared.market.inputContractBasis')).toBeNull();
		expect(field('shared.market.outputContractBasis')).toBeNull();
		await fireEvent.change(field('shared.market.outputMethod')!, {
			target: { value: 'contract' }
		});
		expect(field('shared.market.outputContractBasis')!.value).toBe('split');
		expect(field('shared.market.inputContractBasis')).toBeNull();
	});

	it('renders field errors and keeps the rejected values', async () => {
		const values = Settings.parse({});
		values.shared.facilityTaxPct = 75;
		const { field } = await setup(values, { 'shared.facilityTaxPct': 'Must be at most 50' });
		expect(field('shared.facilityTaxPct')!.value).toBe('75');
		expect(field('shared.facilityTaxPct')!.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Must be at most 50')).toBeTruthy();
		expect(screen.getByRole('alert').textContent).toMatch(/nothing was saved/);
	});

	it('shows a discount error instead of its hint', async () => {
		const values = Settings.parse({ shared: { shipping: { output: { enabled: true } } } });
		values.shared.shipping.output.discountPct = 120;
		const { field } = await setup(values, { 'shared.shipping.output.discountPct': 'Must be at most 100' });
		const discount = field('shared.shipping.output.discountPct')!;
		expect(discount.value).toBe('120');
		expect(discount.getAttribute('aria-invalid')).toBe('true');
		expect(document.getElementById(discount.getAttribute('aria-describedby')!)!.textContent).toBe(
			'Must be at most 100'
		);
		expect(screen.getAllByText('e.g. a volume discount from your hauling service')).toHaveLength(1);
	});
});
