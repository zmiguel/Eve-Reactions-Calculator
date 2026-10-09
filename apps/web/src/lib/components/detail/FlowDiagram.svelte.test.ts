import type { ChainNode } from '@reactions/engine';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { titaniumCarbide, unrefinedChain } from '../../../test/chain';
import FlowDiagram from './FlowDiagram.svelte';
import { layoutChainFlow } from './flow';

const chain = (root: ChainNode) =>
	render(FlowDiagram, {
		layout: layoutChainFlow(root),
		title: `Material flow for ${root.name}`,
		scope: 'chain'
	});

describe('FlowDiagram of a chain', () => {
	it('renders an accessible SVG with bought, intermediate and final nodes', () => {
		const { container } = chain(titaniumCarbide());
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
		const { container } = chain(titaniumCarbide());
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
		const { container } = chain(titaniumCarbide({ titanium: null }));
		const titanium = container.querySelector('[data-flow-node="buy:16638"]')!;
		expect(titanium.querySelector('[data-node-detail]')!.textContent).toContain('no price');
		expect(titanium.querySelector('title')!.textContent).toContain('no market price');
	});

	it('shows an unrefined job as reprocessed, with edges for its material and its byproduct', () => {
		const { container } = chain(unrefinedChain());
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

	it("draws a steady cycle's byproduct as a green back edge to the material it replaces", () => {
		const root = unrefinedChain();
		root.runsPerSlot = [2];
		root.children[0].step = 1;
		root.step = 2;
		const { container } = chain(root);
		const cadmium = container.querySelector('[data-flow-node="buy:16643"]')!;
		expect(cadmium.querySelector('[data-node-detail]')!.textContent).toBe('500 bought · 100 reused');
		const back = container.querySelector('[data-flow-back-edge]')!;
		expect([back.getAttribute('data-from'), back.getAttribute('data-to')]).toEqual(['job:0.1', 'buy:16643']);
		expect(back.querySelector('[data-edge-label]')!.textContent).toBe('100 Cadmium reused next cycle');
		expect(container.querySelector('figcaption')!.textContent).toContain(
			'Reprocessing byproduct reused next cycle'
		);
	});
});

describe('FlowDiagram of a plan', () => {
	it('labels a back edge as reused next cycle and the bought material with its bought and reused parts', () => {
		const layout = {
			...layoutChainFlow(unrefinedChain()),
			backEdges: [
				{
					id: 'job:0.1>buy:16643',
					from: 'job:0.1',
					to: 'buy:16643',
					quantity: 300,
					material: 'Cadmium',
					path: 'M0 0 H1',
					labelX: 1,
					labelY: 1
				}
			]
		};
		layout.nodes = layout.nodes.map((n) => (n.id === 'buy:16643' ? { ...n, reused: 300 } : n));
		const { container } = render(FlowDiagram, { layout, title: 'Material flow of the plan', scope: 'plan' });
		const back = container.querySelector('[data-flow-back-edge]')!;
		expect(back.querySelector('[data-edge-label]')!.textContent).toBe('300 Cadmium reused next cycle');
		expect(back.querySelector('title')!.textContent).toBe(
			'300 Cadmium from reprocessing Unrefined Prometium, used next cycle instead of buying it'
		);
		expect(container.querySelector('[data-flow-node="buy:16643"] [data-node-detail]')!.textContent).toBe(
			'200 bought · 300 reused'
		);
		const caption = container.querySelector('figcaption')!.textContent!;
		expect(caption).toContain('Reprocessing byproduct reused next cycle');
		expect(caption).toContain('Target product');
		expect(caption).toContain('quantity each job consumes per cycle');
	});
});
