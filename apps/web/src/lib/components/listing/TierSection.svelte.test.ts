import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TierSection from './TierSection.svelte';
import type { TierSectionData, VariantSummary } from './types';

const variant = (profitPerSlotDay: number, over: Partial<VariantSummary> = {}): VariantSummary => ({
	profitPerSlotDay,
	profit: profitPerSlotDay * 5,
	marginPct: 10,
	inputCost: 1_000_000,
	outputValue: 2_000_000,
	jobCost: 50_000,
	runs: 122,
	missing: [],
	slots: null,
	...over
});

const section: TierSectionData = {
	tier: 'composite',
	title: 'Composite',
	tabs: [
		{ variant: 'single', label: 'Buy inputs' },
		{ variant: 'chain', label: 'Full chain' }
	],
	rows: [
		{
			blueprintTypeId: 46204,
			slug: 'titanium-carbide',
			name: 'Titanium Carbide',
			productTypeId: 16671,
			single: variant(1_230_000),
			chain: variant(4_560_000),
			unrefined: null,
			reprocessed: null
		}
	]
};

describe('TierSection', () => {
	it('renders the heading and switches the numbers with the chain tab', async () => {
		render(TierSection, { section, reactor: 'composite' });
		expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Composite');
		const buy = screen.getByRole('tab', { name: 'Buy inputs' });
		const chain = screen.getByRole('tab', { name: 'Full chain' });
		expect(buy.getAttribute('aria-selected')).toBe('true');
		expect(screen.getByTitle('1,230,000 ISK').textContent).toBe('1.23M');
		expect(screen.queryByTitle('4,560,000 ISK')).toBeNull();
		expect(screen.getByRole('link').getAttribute('href')).toBe('/composite/titanium-carbide');

		await fireEvent.click(chain);
		expect(chain.getAttribute('aria-selected')).toBe('true');
		expect(buy.getAttribute('aria-selected')).toBe('false');
		expect(screen.getByTitle('4,560,000 ISK').textContent).toBe('4.56M');
		expect(screen.queryByTitle('1,230,000 ISK')).toBeNull();
		expect(screen.getByRole('link').getAttribute('href')).toBe('/composite/titanium-carbide?view=chain');
	});

	it('opens on Full chain when the visitor prefers it; links then need no view, buy inputs does', async () => {
		const plain = { ...section.rows[0], blueprintTypeId: 1, slug: 'plain', name: 'Plain', chain: null };
		render(TierSection, {
			section: { ...section, rows: [...section.rows, plain] },
			reactor: 'composite',
			defaults: { view: 'chain', output: 'product', unrefined: false }
		});
		const chain = screen.getByRole('tab', { name: 'Full chain' });
		expect(chain.getAttribute('aria-selected')).toBe('true');
		expect(screen.getByTitle('4,560,000 ISK')).toBeTruthy();
		const href = (name: string) =>
			screen
				.getAllByRole('link')
				.find((a) => a.textContent?.includes(name))!
				.getAttribute('href');
		expect(href('Titanium Carbide')).toBe('/composite/titanium-carbide');
		// A reaction without a full chain opens on buy inputs anyway.
		expect(href('Plain')).toBe('/composite/plain');

		await fireEvent.click(screen.getByRole('tab', { name: 'Buy inputs' }));
		expect(href('Titanium Carbide')).toBe('/composite/titanium-carbide?view=single');
	});

	it('opens on Using unrefined when the setting builds chains with unrefined routes, keeping Full chain regular', async () => {
		const fermionic = {
			...section.rows[0],
			blueprintTypeId: 46209,
			slug: 'fermionic-condensates',
			name: 'Fermionic Condensates',
			chain: variant(-4_810_000),
			unrefined: variant(2_380_000, { unrefined: ['Fluxed Condensates'] })
		};
		render(TierSection, {
			section: {
				...section,
				tabs: [...section.tabs, { variant: 'unrefined', label: 'Using unrefined' }],
				rows: [fermionic]
			},
			reactor: 'composite',
			defaults: { view: 'single', output: 'product', unrefined: true }
		});
		expect(screen.getByRole('tab', { name: 'Using unrefined' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByTitle('2,380,000 ISK')).toBeTruthy();
		expect(screen.getByRole('link').getAttribute('href')).toBe('/composite/fermionic-condensates');

		await fireEvent.click(screen.getByRole('tab', { name: 'Full chain' }));
		expect(screen.getByTitle('-4,810,000 ISK')).toBeTruthy();
		expect(screen.getByRole('link').getAttribute('href')).toBe('/composite/fermionic-condensates?view=chain');
	});

	it('keeps the first tab when the preferred one does not exist', () => {
		render(TierSection, {
			section: {
				...section,
				tabs: [
					{ variant: 'single', label: 'Sell unrefined' },
					{ variant: 'reprocessed', label: 'Reprocess' }
				]
			},
			reactor: 'composite',
			defaults: { view: 'chain', output: 'product', unrefined: false }
		});
		expect(screen.getByRole('tab', { name: 'Sell unrefined' }).getAttribute('aria-selected')).toBe('true');
	});

	it('opens reprocessing sections on Reprocess when the visitor prefers it', async () => {
		const hexite = {
			...section.rows[0],
			blueprintTypeId: 46200,
			slug: 'unrefined-hexite',
			name: 'Unrefined Hexite',
			chain: null,
			reprocessed: variant(7_890_000)
		};
		render(TierSection, {
			section: {
				...section,
				tabs: [
					{ variant: 'single', label: 'Sell unrefined' },
					{ variant: 'reprocessed', label: 'Reprocess' }
				],
				rows: [hexite]
			},
			reactor: 'composite',
			defaults: { view: 'single', output: 'reprocessed', unrefined: false }
		});
		expect(screen.getByRole('tab', { name: 'Reprocess' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByTitle('7,890,000 ISK')).toBeTruthy();
		expect(screen.getByRole('link').getAttribute('href')).toBe('/composite/unrefined-hexite');

		await fireEvent.click(screen.getByRole('tab', { name: 'Sell unrefined' }));
		expect(screen.getByRole('link').getAttribute('href')).toBe('/composite/unrefined-hexite?output=product');
	});

	it('has no tab bar for single-view sections', () => {
		render(TierSection, {
			section: { ...section, tabs: [{ variant: 'single', label: 'Buy inputs' }] },
			reactor: 'composite'
		});
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.getByTitle('1,230,000 ISK')).toBeTruthy();
	});

	it('counts the reactions in the heading and per tab', () => {
		const plain = { ...section.rows[0], blueprintTypeId: 1, slug: 'plain', name: 'Plain', chain: null };
		render(TierSection, { section: { ...section, rows: [...section.rows, plain] }, reactor: 'composite' });
		const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();
		expect(text(screen.getByRole('heading', { level: 2 }))).toBe('Composite 2 reactions');
		expect(text(screen.getByRole('tab', { name: 'Buy inputs' }))).toBe('Buy inputs 2');
		expect(text(screen.getByRole('tab', { name: 'Full chain' }))).toBe('Full chain 1');
	});

	it('shows the Using unrefined numbers and links to that tab; chains without a route show their chain', async () => {
		const fermionic = {
			...section.rows[0],
			blueprintTypeId: 46209,
			slug: 'fermionic-condensates',
			name: 'Fermionic Condensates',
			unrefined: variant(7_770_000, { unrefined: ['Fluxed Condensates'] })
		};
		render(TierSection, {
			section: {
				...section,
				tabs: [...section.tabs, { variant: 'unrefined', label: 'Using unrefined' }],
				rows: [section.rows[0], fermionic]
			},
			reactor: 'composite'
		});
		const tab = screen.getByRole('tab', { name: /Using unrefined/ });
		expect(tab.textContent?.replace(/\s+/g, ' ').trim()).toBe('Using unrefined 1');
		await fireEvent.click(tab);
		expect(screen.getByTitle('7,770,000 ISK')).toBeTruthy();
		expect(screen.getByTitle('4,560,000 ISK')).toBeTruthy();
		const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(
			expect.arrayContaining([
				'/composite/fermionic-condensates?view=unrefined',
				'/composite/titanium-carbide?view=chain'
			])
		);
	});
});
