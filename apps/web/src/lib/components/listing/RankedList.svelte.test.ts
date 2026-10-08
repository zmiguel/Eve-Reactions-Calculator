import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RankedList from './RankedList.svelte';
import TabBar from './TabBar.svelte';

describe('RankedList', () => {
	it('renders numbered items with links, icons and sign colours', () => {
		render(RankedList, {
			title: 'Profit leaders',
			empty: 'Nothing',
			items: [
				{
					key: 1,
					name: 'Up',
					href: '/a/up',
					productTypeId: 11,
					value: '+1.00M',
					valueTitle: 'full',
					sign: 1
				},
				{
					key: 2,
					name: 'Down',
					href: '/a/down',
					productTypeId: 12,
					value: '-2.00M',
					sign: -1,
					detail: 'Jita'
				}
			]
		});
		expect(screen.getByRole('heading').textContent).toBe('Profit leaders');
		const items = screen.getAllByRole('listitem');
		expect(items.map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
			'1 Up +1.00M',
			'2 Down Jita -2.00M'
		]);
		expect(screen.getByText('+1.00M').className).toContain('text-green-600');
		expect(screen.getByText('+1.00M').getAttribute('title')).toBe('full');
		expect(screen.getByText('-2.00M').className).toContain('text-red-600');
		expect(screen.getByRole('link', { name: 'Down' }).getAttribute('href')).toBe('/a/down');
		expect(screen.getByAltText('Up icon').getAttribute('loading')).toBe('lazy');
	});

	it('shows the empty text without items', () => {
		render(RankedList, { title: 'Movers', items: [], empty: 'No movers yet.' });
		expect(screen.getByText('No movers yet.')).toBeTruthy();
		expect(screen.queryByRole('list')).toBeNull();
	});

	it('shows the name as plain text without a link', () => {
		render(RankedList, {
			title: 'Rising',
			empty: 'Nothing',
			items: [{ key: 1, name: 'Hydrocarbons', productTypeId: 16633, value: '+13.8%', sign: -13.8 }]
		});
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText('Hydrocarbons')).toBeTruthy();
		expect(screen.getByText('+13.8%').className).toContain('text-red-600');
	});
});

describe('TabBar', () => {
	it('marks the active tab and reports selections', async () => {
		const selected: string[] = [];
		render(TabBar, {
			tabs: [
				{ id: '24h', label: '24 hours' },
				{ id: '7d', label: '7 days' }
			],
			active: '24h',
			label: 'Period',
			controls: 'panel',
			onselect: (id: string) => selected.push(id)
		});
		expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Period');
		expect(screen.getByRole('tab', { name: '24 hours' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tab', { name: '7 days' }).getAttribute('aria-selected')).toBe('false');
		await fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
		expect(selected).toEqual(['7d']);
	});

	it('shows count badges without changing the tab names', () => {
		render(TabBar, {
			tabs: [
				{ id: 'single', label: 'Buy inputs', count: 12 },
				{ id: 'chain', label: 'Full chain', count: 4 }
			],
			active: 'single',
			label: 'View',
			controls: 'panel',
			onselect: () => {}
		});
		expect(screen.getByRole('tab', { name: 'Buy inputs' }).textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Buy inputs 12'
		);
		expect(screen.getByRole('tab', { name: 'Full chain' }).textContent).toContain('4');
	});
});
