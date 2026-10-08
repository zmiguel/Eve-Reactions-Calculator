import { describe, expect, it } from 'vitest';
import { WARNING_TEXT, detailHref, type DetailLinkState } from './links';

const base: DetailLinkState = {
	view: 'single',
	outputMode: 'product',
	bought: null,
	range: '30d',
	slots: null,
	lines: null
};

describe('detailHref', () => {
	it('omits defaults', () => {
		expect(detailHref('/composite/titanium-carbide', base)).toBe('/composite/titanium-carbide');
	});

	it('keeps the current state and applies overrides and a hash', () => {
		const state: DetailLinkState = {
			view: 'chain',
			outputMode: 'reprocessed',
			bought: 5,
			range: '90d',
			slots: null,
			lines: null
		};
		expect(detailHref('/c/x', state)).toBe('/c/x?view=chain&output=reprocessed&bought=5&range=90d');
		expect(detailHref('/c/x', state, { view: 'single', range: '30d' }, 'history')).toBe(
			'/c/x?output=reprocessed&bought=5#history'
		);
		expect(detailHref('/c/x', base, { bought: 0 })).toBe('/c/x?bought=0');
	});

	it('keeps an explicit slot allocation on the chain view only', () => {
		const chain: DetailLinkState = { ...base, view: 'chain', slots: 'optimal' };
		expect(detailHref('/c/x', chain)).toBe('/c/x?view=chain&slots=optimal');
		expect(detailHref('/c/x', chain, { range: '1y' })).toBe('/c/x?view=chain&slots=optimal&range=1y');
		expect(detailHref('/c/x', chain, { slots: null })).toBe('/c/x?view=chain');
		expect(detailHref('/c/x', chain, { lines: 3 })).toBe('/c/x?view=chain&slots=optimal&lines=3');
		expect(detailHref('/c/x', { ...chain, lines: 3 }, { view: 'single' })).toBe('/c/x');
		expect(detailHref('/c/x', chain, { view: 'single' })).toBe('/c/x');
	});

	it('leaves out the visitor default view and spells out the other one', () => {
		const chainDefault: DetailLinkState = { ...base, view: 'chain', defaultView: 'chain' };
		expect(detailHref('/c/x', chainDefault)).toBe('/c/x');
		expect(detailHref('/c/x', chainDefault, { slots: 'optimal' })).toBe('/c/x?slots=optimal');
		expect(detailHref('/c/x', chainDefault, { view: 'single' })).toBe('/c/x?view=single');
	});

	it('leaves out the default output and spells out the other one', () => {
		const reprocessDefault: DetailLinkState = {
			...base,
			outputMode: 'reprocessed',
			defaultOutput: 'reprocessed'
		};
		expect(detailHref('/c/x', reprocessDefault)).toBe('/c/x');
		expect(detailHref('/c/x', reprocessDefault, { outputMode: 'product' })).toBe('/c/x?output=product');
	});
});

describe('WARNING_TEXT', () => {
	it('explains every reaction-level engine warning shown on the page', () => {
		for (const code of [
			'SKILL_TOO_LOW',
			'MISSING_ADJUSTED_PRICE',
			'CYCLE_SHORTER_THAN_RUN',
			'NO_REPROCESS_DATA'
		]) {
			expect(WARNING_TEXT[code]).toMatch(/\w+/);
		}
	});
});
