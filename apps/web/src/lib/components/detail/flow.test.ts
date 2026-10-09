import type { ChainNode } from '@reactions/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import { loadDetail, type DetailData } from '$lib/server/detail';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { NOW, defaults, insertSystems, loadSde, putKv } from '../../../test/fixtures';
import { unrefinedChain } from '../../../test/chain';
import { FLOW_GEOMETRY, layoutChainFlow, wrapName, type FlowLayout } from './flow';

beforeEach(() => clearDataMemo());

async function detail(path: string) {
	const env = fakeEnv();
	await putKv(env, await loadSde());
	insertSystems(env.DB);
	const url = new URL(`https://reactions.coalition.space${path}`);
	const [, reactor, slug] = url.pathname.split('/');
	return (await loadDetail(
		asEnv(env),
		{ settings: defaults(), user: null },
		{ reactor: reactor as 'composite', slug },
		url,
		NOW
	)) as DetailData;
}

/** Every job of the tree with the flow id `job:<path>`. */
function jobs(root: ChainNode) {
	const out: { id: string; node: ChainNode }[] = [];
	const visit = (node: ChainNode, path: string) => {
		out.push({ id: `job:${path}`, node });
		node.children.forEach((c, i) => visit(c, `${path}.${i}`));
	};
	visit(root, '0');
	return out;
}

function expectWellFormed(layout: FlowLayout) {
	const ids = new Set(layout.nodes.map((n) => n.id));
	expect(ids.size).toBe(layout.nodes.length);
	for (const e of layout.edges) {
		expect(ids.has(e.from)).toBe(true);
		expect(ids.has(e.to)).toBe(true);
		const from = layout.nodes.find((n) => n.id === e.from)!;
		const to = layout.nodes.find((n) => n.id === e.to)!;
		expect(from.column).toBeLessThan(to.column);
		expect(e.path.startsWith(`M${from.x + from.width} `)).toBe(true);
		expect(e.path).toMatch(new RegExp(` ${to.x} [\\d.]+$`));
	}
	for (let col = 0; col < layout.columns; col++) {
		const column = layout.nodes.filter((n) => n.column === col).sort((a, b) => a.y - b.y);
		expect(column.length).toBeGreaterThan(0);
		expect(new Set(column.map((n) => n.x)).size).toBe(1);
		for (let i = 1; i < column.length; i++)
			expect(column[i].y).toBeGreaterThanOrEqual(column[i - 1].y + column[i - 1].height);
	}
	for (const n of layout.nodes) {
		expect(n.x).toBeGreaterThanOrEqual(0);
		expect(n.y).toBeGreaterThanOrEqual(0);
		expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
		expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
	}
}

describe('layoutChainFlow', () => {
	it('lays the Titanium Carbide chain out in 3 columns: bought → intermediates → product', async () => {
		const data = await detail('/composite/titanium-carbide?view=chain');
		const layout = layoutChainFlow(data.root);
		expect(layout.columns).toBe(3);
		const byColumn = (col: number) => layout.nodes.filter((n) => n.column === col);
		expect(byColumn(0).map((n) => n.kind)).toEqual(Array(5).fill('bought'));
		expect(
			byColumn(0)
				.map((n) => n.typeId)
				.sort()
		).toEqual(data.result.inputs.map((i) => i.typeId).sort());
		expect(byColumn(1).map((n) => [n.kind, n.name, n.runs])).toEqual([
			['intermediate', 'Titanium Chromide', 60],
			['intermediate', 'Silicon Diborite', 60]
		]);
		expect(byColumn(2).map((n) => [n.kind, n.name, n.quantity])).toEqual([
			['final', 'Titanium Carbide', 1_220_000]
		]);
		expect(layout.edges).toHaveLength(9);
		expectWellFormed(layout);
	});

	it('labels every edge with the quantity the consuming step uses', async () => {
		const data = await detail('/composite/titanium-carbide?view=chain');
		const layout = layoutChainFlow(data.root);
		for (const { id, node } of jobs(data.root)) {
			const into = layout.edges.filter((e) => e.to === id);
			expect(into.map((e) => e.quantity)).toEqual(node.materials.map((m) => m.quantity));
			node.materials.forEach((m, i) => {
				const from = layout.nodes.find((n) => n.id === into[i].from)!;
				expect(from.typeId).toBe(m.typeId);
				expect(from.kind).toBe(m.source === 'buy' ? 'bought' : 'intermediate');
			});
		}
	});

	it('shows a material bought by several jobs once, with one edge per consumer', async () => {
		const data = await detail('/composite/titanium-carbide?view=chain');
		const layout = layoutChainFlow(data.root);
		const fuel = data.result.inputs.find((i) => data.root.materials[0].typeId === i.typeId)!;
		const node = layout.nodes.filter((n) => n.typeId === fuel.typeId);
		expect(node).toHaveLength(1);
		expect(node[0].quantity).toBe(fuel.quantity);
		expect(layout.edges.filter((e) => e.from === node[0].id)).toHaveLength(3);
	});

	it('gives the depth-3 booster chain 4 columns with lanes for edges that skip columns', async () => {
		const data = await detail('/biochemical/pure-strong-blue-pill-booster?view=chain');
		expect(data.result.chainDepth).toBe(3);
		const layout = layoutChainFlow(data.root);
		expect(layout.columns).toBe(4);
		expect(layout.nodes.filter((n) => n.column === 3).map((n) => n.kind)).toEqual(['final']);
		expect(layout.nodes.filter((n) => n.kind !== 'bought')).toHaveLength(jobs(data.root).length);
		expectWellFormed(layout);
		const long = layout.edges.filter((e) => {
			const cols = [e.from, e.to].map((id) => layout.nodes.find((n) => n.id === id)!.column);
			return cols[1] - cols[0] > 1;
		});
		for (const e of long) expect(e.path).toContain('L');
	});

	it('lays a single reaction out as bought materials → product', async () => {
		const data = await detail('/composite/caesarium-cadmide');
		const layout = layoutChainFlow(data.root);
		expect(layout.columns).toBe(2);
		expect(layout.nodes.filter((n) => n.kind === 'bought')).toHaveLength(data.result.inputs.length);
		expect(layout.width).toBe(
			2 * FLOW_GEOMETRY.padding + 2 * FLOW_GEOMETRY.nodeWidth + FLOW_GEOMETRY.columnGap
		);
		expectWellFormed(layout);
	});

	it('flags bought materials without a price', async () => {
		const data = await detail('/composite/titanium-carbide?view=chain');
		const root = structuredClone(data.root);
		const material = root.children[0].materials.find((m) => m.source === 'buy')!;
		if (material.source === 'buy') material.unitPrice = null;
		const layout = layoutChainFlow(root);
		expect(layout.nodes.filter((n) => n.unpriced).map((n) => n.typeId)).toEqual([material.typeId]);
	});

	it('places jobs by build step and runs a byproduct from the unrefined job to the later job using it', () => {
		const layout = layoutChainFlow(unrefinedChain());
		expectWellFormed(layout);
		const column = (id: string) => layout.nodes.find((n) => n.id === id)!.column;
		expect([column('job:0.1'), column('job:0.0'), column('job:0'), layout.columns]).toEqual([1, 2, 3, 4]);
		const unrefined = layout.nodes.find((n) => n.id === 'job:0.1')!;
		expect([unrefined.kind, unrefined.name, unrefined.reprocessedInto]).toEqual([
			'intermediate',
			'Unrefined Prometium',
			'Prometium'
		]);
		expect(
			layout.edges.filter((e) => e.from === 'job:0.1').map((e) => [e.to, e.material, e.quantity])
		).toEqual([
			['job:0.0', 'Cadmium', 100],
			['job:0', 'Prometium', 200]
		]);
		expect(layout.nodes.some((n) => n.kind === 'byproduct')).toBe(false);
		expect(layout.nodes.find((n) => n.id === 'buy:16643')!.quantity).toBe(500);
	});

	it("draws a steady cycle's byproduct as reuse: a back edge from the unrefined job to the material node", () => {
		const root = unrefinedChain();
		root.runsPerSlot = [2]; // optimal slots: every job uses the previous cycle's byproducts
		root.children[0].step = 1;
		root.step = 2;
		const layout = layoutChainFlow(root);
		expectWellFormed(layout);
		const cadmium = layout.nodes.find((n) => n.id === 'buy:16643')!;
		// Unrefined Prometium buys 500; Caesarium Cadmide's 100 come from last cycle's reprocessing.
		expect([cadmium.kind, cadmium.column, cadmium.quantity, cadmium.reused]).toEqual(['bought', 0, 600, 100]);
		expect(layout.edges.filter((e) => e.from === cadmium.id).map((e) => [e.to, e.quantity])).toEqual([
			['job:0.0', 100],
			['job:0.1', 500]
		]);
		expect(layout.edges.some((e) => e.from === 'job:0.1' && e.material === 'Cadmium')).toBe(false);
		expect(layout.backEdges.map((e) => [e.from, e.to, e.material, e.quantity])).toEqual([
			['job:0.1', 'buy:16643', 'Cadmium', 100]
		]);
	});

	it('merges a purchase partly covered by reuse into one edge, and marks a material covered in full', () => {
		const root = unrefinedChain();
		root.runsPerSlot = [2];
		const cadmide = root.children[0];
		// Caesarium Cadmide uses 100 reused and still buys 30: one edge of 130.
		cadmide.materials.splice(2, 0, { ...cadmide.materials[0], typeId: 16643, name: 'Cadmium', quantity: 30 });
		const layout = layoutChainFlow(root);
		expect(layout.edges.filter((e) => e.from === 'buy:16643').map((e) => [e.to, e.quantity])).toEqual([
			['job:0.0', 130],
			['job:0.1', 500]
		]);
		// Without any Cadmium purchase left, the node is covered in full by reuse.
		root.children[1].materials = root.children[1].materials.filter((m) => m.typeId !== 16643);
		cadmide.materials = cadmide.materials.filter((m) => !(m.typeId === 16643 && m.source === 'buy'));
		const covered = layoutChainFlow(root).nodes.find((n) => n.id === 'buy:16643')!;
		expect([covered.kind, covered.quantity, covered.reused]).toEqual(['byproduct', 100, 100]);
	});
});

describe('wrapName', () => {
	it('keeps short names and wraps long ones on word boundaries into two lines', () => {
		expect(wrapName('Titanium Carbide')).toEqual(['Titanium Carbide']);
		expect(wrapName('Pure Improved Blue Pill Booster')).toEqual(['Pure Improved Blue Pill', 'Booster']);
		expect(wrapName('Supercalifragilistic Expialidocious Thing', 12)).toEqual([
			'Supercalifr…',
			'Expialidoci…'
		]);
	});
});
