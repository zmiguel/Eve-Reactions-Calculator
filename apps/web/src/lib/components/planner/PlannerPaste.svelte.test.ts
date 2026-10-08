import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import PlannerPaste from './PlannerPaste.svelte';

const props = {
	label: 'Stock',
	hint: 'Paste from your inventory.',
	noun: 'item',
	text: 'Cobalt\t5\nPlutonium\t3\nCadmium\t1,2',
	result: {
		quantities: { 16640: 5 },
		errors: [
			{ line: 2, text: 'Plutonium', reason: 'unknown_name' as const },
			{ line: 3, text: '1,2', reason: 'invalid_quantity' as const }
		]
	}
};

describe('PlannerPaste', () => {
	it('summarises matched entries and lists every unrecognised line', () => {
		const { container } = render(PlannerPaste, { props });
		expect(container.querySelector('summary')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
			'Stock 1 item · 2 not recognised'
		);
		expect((screen.getByRole('textbox', { name: 'Stock' }) as HTMLTextAreaElement).value).toBe(props.text);
		expect(
			[...screen.getByRole('list', { name: 'Stock errors' }).querySelectorAll('li')].map((li) =>
				li.textContent!.trim()
			)
		).toEqual(['Line 2: “Plutonium” is not a known item', 'Line 3: “1,2” is not a quantity']);
	});

	it('pluralises the count and shows no error list when everything matched', () => {
		const { container } = render(PlannerPaste, {
			props: {
				...props,
				noun: 'formula',
				label: 'Owned formulas',
				result: { quantities: { 1: 1, 2: 3 }, errors: [] }
			}
		});
		expect(container.querySelector('summary')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
			'Owned formulas 2 formulas'
		);
		expect(screen.queryByRole('list')).toBeNull();
	});
});
