import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { titaniumCarbide, unrefinedChain } from '../../../test/chain';
import ChainFlow from './ChainFlow.svelte';

describe('ChainFlow', () => {
	it('renders an accessible SVG with bought, intermediate and final nodes', () => {
		const { container } = render(ChainFlow, { root: titaniumCarbide() });
		const svg = container.querySelector('svg')!;
		expect(svg.getAttribute('role')).toBe('img');
		const labelledBy = svg.getAttribute('aria-labelledby')!.split(' ');
		expect(container.querySelector(`[id="${labelledBy[0]}"]`)!.textContent).toBe(
			'Material flow for Titanium Carbide'
		);
		expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);

		const nodes = [...container.querySelectorAll('[data-flow-node]')];
		const kinds = nodes.map((n) => n.getAttribute('data-kind'));
		expect(kinds.filter((k) => k === 'bought')).toHaveLength(5);
		expect(kinds.filter((k) => k === 'intermediate')).toHaveLength(2);
		expect(kinds.filter((k) => k === 'final')).toHaveLength(1);

		const final = container.querySelector('[data-kind="final"]')!;
		expect(final.querySelector('[data-node-name]')!.textContent).toBe('Titanium Carbide');
		expect(final.querySelector('[data-node-detail]')!.textContent).toBe('12,200 · 122 runs');
		expect(final.querySelector('title')!.textContent).toContain('final product');
		expect(final.querySelector('image')!.getAttribute('href')).toContain('/types/16671/');

		const fuel = container.querySelector('[data-flow-node="buy:4312"]')!;
		expect(fuel.querySelector('[data-node-detail]')!.textContent).toBe(
			`${(596 + 293 + 293).toLocaleString('en-US')} bought`
		);
		expect(fuel.querySelector('rect')!.getAttribute('stroke-dasharray')).toBe('4 3');
	});

	it('labels every edge with its quantity', () => {
		const { container } = render(ChainFlow, { root: titaniumCarbide() });
		const edges = [...container.querySelectorAll('[data-flow-edge]')];
		expect(edges).toHaveLength(9);
		const intoTop = edges.filter((e) => e.getAttribute('data-to') === 'job:0');
		expect(intoTop.map((e) => e.querySelector('[data-edge-label]')!.textContent)).toEqual([
			'596',
			'11,908',
			'11,908'
		]);
		expect(intoTop[1].querySelector('title')!.textContent).toBe(
			'11,908 Titanium Chromide → Titanium Carbide'
		);
	});

	it('marks a bought material without a price', () => {
		const { container } = render(ChainFlow, { root: titaniumCarbide({ titanium: null }) });
		const titanium = container.querySelector('[data-flow-node="buy:16638"]')!;
		expect(titanium.querySelector('[data-node-detail]')!.textContent).toContain('no price');
		expect(titanium.querySelector('title')!.textContent).toContain('no market price');
	});

	it('shows an unrefined job as reprocessed, with edges for its material and its byproduct', () => {
		const { container } = render(ChainFlow, { root: unrefinedChain() });
		const job = container.querySelector('[data-flow-node="job:0.1"]')!;
		expect(job.querySelector('[data-node-detail]')!.textContent).toBe('5 runs, reprocessed');
		expect(job.querySelector('title')!.textContent).toContain('into Prometium');
		const titles = [...container.querySelectorAll('[data-flow-edge][data-from="job:0.1"] title')].map(
			(t) => t.textContent
		);
		expect(titles).toEqual(['100 Cadmium → Caesarium Cadmide', '200 Prometium → Fermionic Condensates']);
		expect(container.querySelector('[data-kind="byproduct"]')).toBeNull();
		expect(container.querySelector('figcaption')!.textContent).not.toContain('Reprocessing byproduct');
	});

	it("shows a steady cycle's byproduct from last cycle as its own source", () => {
		const root = unrefinedChain();
		root.children[0].step = 1;
		root.step = 2;
		const { container } = render(ChainFlow, { root });
		const cadmium = container.querySelector('[data-flow-node="byproduct:16643"]')!;
		expect(cadmium.getAttribute('data-kind')).toBe('byproduct');
		expect(cadmium.querySelector('[data-node-detail]')!.textContent).toBe('100 from last cycle');
		expect(container.querySelector('figcaption')!.textContent).toContain(
			'Reprocessing byproduct from last cycle'
		);
	});
});
