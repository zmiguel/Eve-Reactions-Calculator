import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildItem, ReactorBoard } from '$lib/components/home/types';
import type { TierSectionData } from '$lib/components/listing/types';
import HomePage from './+page.svelte';
import ReactorPage from './[reactor=reactor]/+page.svelte';

afterEach(() => {
	document.head.innerHTML = '';
});

const build = (id: number, name: string, over: Partial<BuildItem> = {}): BuildItem => ({
	blueprintTypeId: id,
	slug: name.toLowerCase().replace(/ /g, '-'),
	name,
	productTypeId: id,
	variant: 'single',
	unrefined: false,
	unrefinable: false,
	chainable: true,
	average: 3_000_000,
	days: 7,
	profitableDays: 7,
	now: 2_500_000,
	slots: 12,
	perSlotDay: 1000,
	volume: 120_000,
	...over
});

const boards: ReactorBoard[] = [
	{
		reactor: 'composite',
		single: { items: [build(1, 'Fullerides')], thin: 0 },
		chain: {
			items: [
				build(2, 'Sylramic Fibers', { variant: 'chain' }),
				build(5, 'Ferrogel', { variant: 'chain', unrefined: true, unrefinable: true }),
				build(3, 'Odd Composite', { chainable: false })
			],
			thin: 0
		}
	},
	{
		reactor: 'biochemical',
		single: { items: [], thin: 2 },
		chain: { items: [], thin: 0 }
	},
	{
		reactor: 'hybrid',
		single: {
			items: [build(4, 'Methanofullerene', { chainable: false, slots: null, volume: null })],
			thin: 0
		},
		chain: null
	}
];

const move = (typeId: number, name: string, pct: number) => ({
	typeId,
	name,
	price5d: 100 + pct,
	price30d: 100,
	pct,
	reactors: ['composite' as const]
});

const homeData = {
	home: {
		description: 'Profit for all 119 reactions. Best over the last 7 days: Fullerides.',
		status: {
			pricesUpdatedAt: Date.UTC(2026, 9, 6, 12),
			pricesAge: '5 minutes ago',
			systems: [{ systemName: 'Ignoitton', costIndex: 0.0412, costIndexMissing: false }],
			sdeBuild: 3421648,
			reactionCount: 119
		},
		window: { from: '2026-09-29', to: '2026-10-05', days: 7, approximate: false },
		maxSharePct: 10,
		boards,
		inputs: {
			up: [move(16633, 'Hydrocarbons', 13.8)],
			down: [move(1, 'Evaporite Deposits', -13)],
			minPct: 1,
			available: true
		}
	}
};

const board = (reactor: string) => document.querySelector(`[data-board="${reactor}"]`) as HTMLElement;

describe('home page', () => {
	it('renders SEO, status, reactor boards with view tabs and input moves', async () => {
		render(HomePage, { data: homeData } as never);
		expect(document.title).toBe('Home | EVE Reactions Calculator');
		expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
			homeData.home.description
		);
		const ld = JSON.parse(document.head.querySelector('script[type="application/ld+json"]')!.textContent!);
		expect(ld.map((x: { '@type': string }) => x['@type'])).toEqual(['WebSite', 'WebApplication']);
		expect(ld[1]).toMatchObject({
			applicationCategory: 'UtilitiesApplication',
			operatingSystem: 'Web',
			offers: { '@type': 'Offer', price: '0' }
		});
		expect(screen.getByText('5 minutes ago')).toBeTruthy();
		expect(screen.getByText('7 days, 2026-09-29 to 2026-10-05')).toBeTruthy();
		expect(screen.getByText(/Ignoitton\s+4\.12%/)).toBeTruthy();
		expect(screen.getByText(/3421648/)).toBeTruthy();

		const composite = board('composite');
		const row = composite.querySelector('[data-testid="board-row"]')!;
		expect([...row.querySelectorAll('td')].map((td) => td.textContent!.trim())).toEqual([
			'Fullerides',
			'3.00M',
			'7/7',
			'12 slots',
			'2.50M'
		]);
		expect(screen.getByRole('link', { name: 'Fullerides' }).getAttribute('href')).toBe(
			'/composite/fullerides'
		);

		await fireEvent.click(screen.getAllByRole('tab', { name: 'Full chain' })[0]);
		expect(screen.queryByRole('link', { name: 'Fullerides' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Sylramic Fibers' }).getAttribute('href')).toBe(
			'/composite/sylramic-fibers?view=chain'
		);
		// A chain priced with unrefined routes (setting on) opens on the tab that shows them.
		expect(screen.getByRole('link', { name: 'Ferrogel' }).getAttribute('href')).toBe(
			'/composite/ferrogel?view=unrefined'
		);
		// A reaction without a chain is ranked with its buy-inputs numbers and says so.
		const odd = screen.getByRole('link', { name: 'Odd Composite' });
		expect(odd.getAttribute('href')).toBe('/composite/odd-composite');
		expect(odd.parentElement!.textContent).toContain('Buy inputs');

		expect(board('biochemical').textContent).toContain(
			'No product was profitable on most of the last 7 days.'
		);
		expect(board('biochemical').querySelector('[data-thin-note]')!.textContent).toContain(
			'2 more are profitable'
		);
		expect(board('hybrid').querySelector('[role="tablist"]')).toBeNull();
		expect(board('hybrid').textContent).toContain('n/a');

		expect(screen.getByText('+13.8%').className).toContain('text-red-600');
		expect(screen.getByText('-13.0%').className).toContain('text-green-600');
		expect(screen.getByText('Hydrocarbons').tagName).toBe('SPAN');
	});

	it('opens boards on the full chain when that is the default view', () => {
		render(HomePage, { data: { ...homeData, defaultTabs: { view: 'chain', output: 'product' } } } as never);
		expect(screen.getAllByRole('tab', { name: 'Full chain' })[0].getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('link', { name: 'Sylramic Fibers' }).getAttribute('href')).toBe(
			'/composite/sylramic-fibers'
		);
	});

	it('says when there is no price history or market statistics', () => {
		const data = {
			home: {
				...homeData.home,
				window: null,
				inputs: { up: [], down: [], minPct: 1, available: false }
			}
		};
		render(HomePage, { data } as never);
		expect(screen.getAllByText('No daily price history yet.')).toHaveLength(3);
		expect(screen.getByText('Market statistics are not available yet.')).toBeTruthy();
		expect(screen.getByText('n/a')).toBeTruthy();
	});

	it('shows the data-missing state', () => {
		render(HomePage, { data: { home: null } } as never);
		expect(screen.getByRole('status').textContent).toContain('Market data is not available yet');
	});
});

const section: TierSectionData = {
	tier: 'polymer',
	title: 'Polymers',
	tabs: [{ variant: 'single', label: 'Buy inputs' }],
	rows: [
		{
			blueprintTypeId: 46167,
			slug: 'c3-ftm-acid',
			name: 'C3-FTM Acid',
			productTypeId: 30303,
			single: {
				profitPerSlotDay: 1_000_000,
				profit: 7_000_000,
				marginPct: 12,
				inputCost: 1,
				outputValue: 2,
				jobCost: 3,
				runs: 100,
				missing: [],
				slots: null
			},
			chain: null,
			unrefined: null,
			reprocessed: null
		}
	]
};

const reactorData = (date: string | null, approximate: boolean) => ({
	reactor: 'hybrid',
	date,
	bounds: { min: '2025-09-01', max: '2026-10-05' },
	noindex: date !== null,
	listing: {
		description: 'Hybrid reaction profits.',
		sections: [section],
		settings: {
			structure: 'tatara',
			meRig: 't2',
			teRig: 't2',
			systemName: 'Ignoitton',
			securityBand: 'lowsec',
			costIndex: 0.0412,
			costIndexOverridden: false,
			inputHub: 'Jita 4-4',
			outputHub: 'Jita 4-4',
			inputMethod: 'buy_order',
			outputMethod: 'sell_order'
		},
		warnings: [],
		approximate,
		pricesAsOf: date ?? Date.UTC(2026, 9, 6),
		pricesAge: '2 minutes ago'
	}
});

describe('reactor page', () => {
	it('renders title, intro, canonical, settings chip and tier sections', () => {
		render(ReactorPage, { data: reactorData(null, false) } as never);
		expect(document.title).toBe('Hybrids | EVE Reactions Calculator');
		expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
			'https://reactions.coalition.space/hybrid'
		);
		expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hybrid Reactions');
		expect(screen.getByText(/Live prices, updated 2 minutes ago/)).toBeTruthy();
		expect(screen.getByRole('link', { name: /Tatara/ }).getAttribute('href')).toBe('/settings');
		expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Polymers');
		expect(screen.queryByRole('note')).toBeNull();
	});

	it('is noindex with an approximate notice for historical dates', () => {
		render(ReactorPage, { data: reactorData('2026-09-06', true) } as never);
		expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
		expect(screen.getByRole('note').textContent).toContain('Approximate prices');
		expect(screen.getByText('2026-09-06')).toBeTruthy();
	});

	it('shows the data-missing state', () => {
		render(ReactorPage, {
			data: { ...reactorData(null, false), listing: null }
		} as never);
		expect(screen.getByRole('status').textContent).toContain('Market data is not available yet');
	});
});
