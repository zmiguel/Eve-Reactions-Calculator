import { describe, expect, it } from 'vitest';
import { reactionHref, tabsFor } from './links';

describe('reactionHref', () => {
	it('adds the query matching the variant', () => {
		expect(reactionHref('composite', 'titanium-carbide')).toBe('/composite/titanium-carbide');
		expect(reactionHref('composite', 'titanium-carbide', 'chain')).toBe(
			'/composite/titanium-carbide?view=chain'
		);
		expect(reactionHref('composite', 'unrefined-hexite', 'reprocessed')).toBe(
			'/composite/unrefined-hexite?output=reprocessed'
		);
	});

	it('leaves out the tabs the page opens on by itself and spells out the others', () => {
		const chainFirst = { view: 'chain', output: 'product' } as const;
		expect(reactionHref('composite', 'titanium-carbide', 'chain', chainFirst)).toBe(
			'/composite/titanium-carbide'
		);
		expect(reactionHref('composite', 'titanium-carbide', 'single', chainFirst)).toBe(
			'/composite/titanium-carbide?view=single'
		);
		const reprocessFirst = { view: 'single', output: 'reprocessed' } as const;
		expect(reactionHref('composite', 'unrefined-hexite', 'reprocessed', reprocessFirst)).toBe(
			'/composite/unrefined-hexite'
		);
		expect(reactionHref('composite', 'unrefined-hexite', 'single', reprocessFirst)).toBe(
			'/composite/unrefined-hexite?output=product'
		);
	});
});

describe('tabsFor', () => {
	it('applies a preference only where the reaction has that tab', () => {
		const prefs = { view: 'chain', output: 'reprocessed', unrefined: false } as const;
		expect(tabsFor(prefs, { chain: true, unrefined: false, reprocessed: false })).toEqual({
			view: 'chain',
			output: 'product'
		});
		expect(tabsFor(prefs, { chain: false, unrefined: false, reprocessed: true })).toEqual({
			view: 'single',
			output: 'reprocessed'
		});
		expect(tabsFor(prefs, { chain: false, unrefined: false, reprocessed: false })).toEqual({
			view: 'single',
			output: 'product'
		});
	});

	it('opens on Using unrefined where the reaction has it and the setting uses unrefined routes', () => {
		const prefs = { view: 'chain', output: 'product', unrefined: true } as const;
		expect(tabsFor(prefs, { chain: true, unrefined: true, reprocessed: false }).view).toBe('unrefined');
		expect(tabsFor(prefs, { chain: true, unrefined: false, reprocessed: false }).view).toBe('chain');
		expect(
			tabsFor({ ...prefs, unrefined: false }, { chain: true, unrefined: true, reprocessed: false }).view
		).toBe('chain');
	});
});
