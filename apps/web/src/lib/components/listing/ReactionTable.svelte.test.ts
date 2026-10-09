import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ReactionTable from './ReactionTable.svelte';
import type { RowSummary, VariantSummary } from './types';

const variant = (profitPerSlotDay: number | null, over: Partial<VariantSummary> = {}): VariantSummary => ({
	profitPerSlotDay,
	profit: profitPerSlotDay === null ? null : profitPerSlotDay * 5,
	marginPct: profitPerSlotDay === null ? null : profitPerSlotDay / 1e6,
	inputCost: 1_000_000,
	outputValue: 2_000_000,
	jobCost: 50_000,
	runs: 122,
	missing: profitPerSlotDay === null ? ['Hydrocarbons'] : [],
	slots: null,
	...over
});

const row = (
	id: number,
	name: string,
	single: VariantSummary,
	chain: VariantSummary | null = null,
	unrefined: VariantSummary | null = null
): RowSummary => ({
	blueprintTypeId: id,
	slug: name.toLowerCase().replace(/ /g, '-'),
	name,
	productTypeId: id + 1000,
	single,
	chain,
	unrefined,
	reprocessed: null
});

const rows: RowSummary[] = [
	row(1, 'Alpha', variant(2_000_000, { inputCost: 5_000_000 })),
	row(2, 'Bravo', variant(null, { inputCost: 9_000_000 })),
	row(3, 'Charlie', variant(-1_500_000, { inputCost: 1_000 }), variant(3_000_000)),
	row(4, 'Delta', variant(7_250_000, { inputCost: 2_000_000 })),
	row(5, 'Echo', variant(500_000, { inputCost: 3_000_000 }))
];

const names = () =>
	screen.getAllByTestId('reaction-row').map((tr) => tr.querySelector('a span')?.textContent?.trim());

describe('ReactionTable', () => {
	it('sorts by profit/slot/day descending by default with unpriced rows last', () => {
		render(ReactionTable, { rows, reactor: 'composite' });
		expect(names()).toEqual(['Delta', 'Alpha', 'Echo', 'Charlie', 'Bravo']);
		const header = screen.getByRole('button', { name: /Profit \/ slot \/ day/ });
		expect(header.closest('th')?.getAttribute('aria-sort')).toBe('descending');
	});

	it('toggles ascending/descending on header clicks and keeps unpriced rows last', async () => {
		render(ReactionTable, { rows, reactor: 'composite' });
		const header = screen.getByRole('button', { name: /Profit \/ slot \/ day/ });
		await fireEvent.click(header);
		expect(names()).toEqual(['Charlie', 'Echo', 'Alpha', 'Delta', 'Bravo']);
		expect(header.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
		await fireEvent.click(header);
		expect(names()).toEqual(['Delta', 'Alpha', 'Echo', 'Charlie', 'Bravo']);

		await fireEvent.click(screen.getByRole('button', { name: /Input cost/ }));
		expect(names()).toEqual(['Alpha', 'Echo', 'Delta', 'Charlie', 'Bravo']);
		await fireEvent.click(screen.getByRole('button', { name: /^Reaction/ }));
		expect(names()).toEqual(['Alpha', 'Charlie', 'Delta', 'Echo', 'Bravo']);
	});

	it('badges the top three by profit/slot/day', () => {
		render(ReactionTable, { rows, reactor: 'composite' });
		const trs = screen.getAllByTestId('reaction-row');
		expect(trs.map((tr) => tr.textContent?.match(/#\d/)?.[0] ?? null)).toEqual([
			'#1',
			'#2',
			'#3',
			null,
			null
		]);
		expect(screen.getByLabelText('Rank 1').closest('tr')?.textContent).toContain('Delta');
	});

	it('shows n/a with the missing prices for unpriced rows', () => {
		render(ReactionTable, { rows, reactor: 'composite' });
		const last = screen.getAllByTestId('reaction-row').at(-1)!;
		expect(last.textContent).toContain('n/a');
		expect(last.textContent).toContain('Missing prices: Hydrocarbons');
	});

	it('formats money with full-value titles, colours signs and renders lazy icons', () => {
		render(ReactionTable, { rows, reactor: 'composite' });
		const delta = screen.getAllByTestId('reaction-row')[0];
		const profit = screen.getByTitle('7,250,000 ISK');
		expect(profit.textContent).toBe('7.25M');
		expect(profit.className).toContain('text-green-600');
		expect(screen.getByTitle('-1,500,000 ISK').className).toContain('text-red-600');
		const img = delta.querySelector('img')!;
		expect(img.getAttribute('src')).toBe('https://images.evetech.net/types/1004/icon?size=32');
		expect(img.getAttribute('loading')).toBe('lazy');
		expect(img.getAttribute('width')).toBe('32');
		expect(img.getAttribute('alt')).toBe('Delta icon');
		expect(delta.querySelector('a')?.getAttribute('href')).toBe('/composite/delta');
	});

	it('shows the chain variant where available and links to it', () => {
		render(ReactionTable, { rows, reactor: 'composite', variant: 'chain' });
		expect(names()).toEqual(['Delta', 'Charlie', 'Alpha', 'Echo', 'Bravo']);
		const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
		expect(links).toContain('/composite/charlie?view=chain');
		expect(links).toContain('/composite/delta');
	});

	it('adds a Slots column for optimal full chains with per-reaction slots in the tooltip', async () => {
		const slots = {
			lines: 2,
			total: 5,
			levels: [2, 3],
			reactions: [
				{ name: 'Charlie', runsPerSlot: [122, 122] },
				{ name: 'Intermediate', runsPerSlot: [61, 62, 62] }
			]
		};
		const optimal = [
			...rows.slice(0, 2),
			row(3, 'Charlie', variant(-1_500_000), variant(3_000_000, { slots }))
		];
		render(ReactionTable, { rows: optimal, reactor: 'composite', variant: 'chain' });
		expect(screen.getByRole('button', { name: /^Slots/ })).toBeTruthy();
		const cells = screen
			.getAllByTestId('reaction-row')
			.map((tr) => tr.querySelector('[data-field="slots"]')!);
		const charlie = cells.find((td) => td.closest('tr')!.textContent!.includes('Charlie'))!;
		expect(charlie.textContent!.trim()).toBe('2+3');
		expect(charlie.getAttribute('title')).toBe(
			'2 lines: Charlie 2 × 122 runs, Intermediate 2 × 62 + 1 × 61 runs'
		);
		expect(cells.filter((td) => td !== charlie).map((td) => td.textContent!.trim())).toEqual(['1', '1']);

		await fireEvent.click(screen.getByRole('button', { name: /^Slots/ }));
		expect(names()[0]).toBe('Charlie');
	});

	it('has no Slots column without an optimal allocation', () => {
		render(ReactionTable, { rows, reactor: 'composite', variant: 'chain' });
		expect(screen.queryByRole('button', { name: /^Slots/ })).toBeNull();
	});

	it('marks Using unrefined rows whose chain uses unrefined reactions', () => {
		const withUnrefined = [
			row(
				3,
				'Charlie',
				variant(-1_500_000),
				variant(1_000_000),
				variant(3_000_000, { unrefined: ['Fluxed Condensates'] })
			),
			row(4, 'Delta', variant(7_250_000), variant(1_000_000), variant(1_000_000))
		];
		const { container } = render(ReactionTable, {
			rows: withUnrefined,
			reactor: 'composite',
			variant: 'unrefined'
		});
		const marks = [...container.querySelectorAll('[data-unrefined]')];
		expect(marks).toHaveLength(1);
		expect(marks[0].closest('tr')!.textContent).toContain('Charlie');
		expect(marks[0].getAttribute('title')).toContain('Fluxed Condensates');
	});

	it('shows the Using unrefined variant, falling back to the full chain, then to buying inputs', () => {
		const mixed = [
			row(
				3,
				'Charlie',
				variant(1_000_000),
				variant(2_000_000),
				variant(5_000_000, { unrefined: ['Prometium'] })
			),
			row(4, 'Delta', variant(1_500_000), variant(3_000_000)),
			row(5, 'Echo', variant(500_000))
		];
		render(ReactionTable, { rows: mixed, reactor: 'composite', variant: 'unrefined' });
		expect(names()).toEqual(['Charlie', 'Delta', 'Echo']);
		const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
		expect(links).toEqual([
			'/composite/charlie?view=unrefined',
			'/composite/delta?view=chain',
			'/composite/echo'
		]);
	});
});
