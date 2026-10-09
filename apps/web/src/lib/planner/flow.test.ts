import type { PlanReaction, PlanResult } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { layoutPlanFlow } from './flow';

// Final (depth 0) takes 100 Xite from Unrefined Xite plus D and fuel; Unrefined Xite (depth 1) buys C and
// D, and its reprocessing yields Xite and 150 D, of which 110 replace next cycle's D purchases.
const FUEL = 4312;
const C = 1003;
const D = 1004;
const X = 2001;
const reaction = (r: Partial<PlanReaction> & Pick<PlanReaction, 'blueprintTypeId' | 'name' | 'depth'>) =>
	({
		totalRuns: 10,
		slots: 1,
		runsPerSlot: [10],
		firstCycle: 1,
		runTimeSeconds: 3600,
		jobCost: 0,
		product: { typeId: r.blueprintTypeId + 10_000, name: r.name, quantity: 10 },
		materials: [],
		...r
	}) satisfies PlanReaction;
const FINAL = reaction({
	blueprintTypeId: 5003,
	name: 'Final',
	depth: 0,
	materials: [
		{ typeId: FUEL, name: 'Oxygen Fuel Block', quantity: 50, producer: null },
		{ typeId: X, name: 'Xite', quantity: 1000, producer: 5002 },
		{ typeId: D, name: 'D', quantity: 20, producer: null }
	]
});
const UNREFINED = reaction({
	blueprintTypeId: 5002,
	name: 'Unrefined Xite',
	depth: 1,
	materials: [
		{ typeId: C, name: 'C', quantity: 1000, producer: null },
		{ typeId: D, name: 'D', quantity: 100, producer: null }
	],
	reprocess: {
		replaces: [{ typeId: X, name: 'Xite', quantity: 1000, regularName: 'Xite' }],
		byproducts: [
			{
				typeId: D,
				name: 'D',
				quantity: 150,
				used: 110,
				sold: 40,
				usedBy: [
					{ blueprintTypeId: 5003, fromCycle: 2 },
					{ blueprintTypeId: 5002, fromCycle: 2 }
				]
			}
		]
	}
});
const plan = (
	reactions: PlanReaction[]
): Pick<PlanResult, 'reactions' | 'maxDepth' | 'purchasesPerCycle'> => ({
	reactions,
	maxDepth: Math.max(...reactions.map((r) => r.depth)),
	purchasesPerCycle: []
});

describe('layoutPlanFlow', () => {
	it('lays every material and reaction of a steady cycle out by depth, targets last', () => {
		const layout = layoutPlanFlow(plan([FINAL, UNREFINED]));
		const node = (id: string) => layout.nodes.find((n) => n.id === id)!;
		expect(layout.columns).toBe(3);
		expect([node('buy:4312').column, node('job:5002').column, node('job:5003').column]).toEqual([0, 1, 2]);
		expect([node('job:5003').kind, node('job:5002').kind]).toEqual(['final', 'intermediate']);
		expect(node('job:5002').reprocessedInto).toBe('Xite');
		expect(
			layout.edges.filter((e) => e.to === 'job:5003').map((e) => [e.from, e.material, e.quantity])
		).toEqual([
			['buy:4312', 'Oxygen Fuel Block', 50],
			['job:5002', 'Xite', 1000],
			['buy:1004', 'D', 20]
		]);
		// D is needed by both jobs once: 120, of which the previous cycle's reprocessing covers 110.
		expect([node('buy:1004').quantity, node('buy:1004').reused, node('buy:1004').kind]).toEqual([
			120,
			110,
			'bought'
		]);
		expect([node('buy:1003').reused, node('buy:1003').kind]).toEqual([0, 'bought']);
	});

	it('draws fuel blocks at the top of the bought materials', () => {
		// The final job lists its fuel block last, as 4 SDE blueprints do.
		const final = { ...FINAL, materials: [...FINAL.materials.slice(1), FINAL.materials[0]] };
		const column0 = (fuel?: ReadonlySet<number>) =>
			layoutPlanFlow(plan([final, UNREFINED]), fuel)
				.nodes.filter((n) => n.column === 0)
				.sort((a, b) => a.y - b.y)
				.map((n) => n.typeId);
		expect(column0()[0]).not.toBe(FUEL);
		expect(column0(new Set([FUEL]))[0]).toBe(FUEL);
	});

	it('draws a back edge from the unrefined job’s right side under the diagram into the material’s left side', () => {
		const layout = layoutPlanFlow(plan([FINAL, UNREFINED]));
		const [back] = layout.backEdges;
		expect(layout.backEdges).toHaveLength(1);
		expect([back.from, back.to, back.material, back.quantity]).toEqual(['job:5002', 'buy:1004', 'D', 110]);
		const from = layout.nodes.find((n) => n.id === 'job:5002')!;
		const to = layout.nodes.find((n) => n.id === 'buy:1004')!;
		expect(back.path.startsWith(`M${from.x + from.width} `)).toBe(true);
		expect(back.path.endsWith(` H${to.x}`)).toBe(true);
		const lane = Number(/ V([\d.]+) H/.exec(back.path)![1]);
		const bottom = Math.max(...layout.nodes.map((n) => n.y + n.height));
		expect(lane).toBeGreaterThan(bottom);
		expect(lane).toBeLessThanOrEqual(layout.height);
		// The run back left passes left of every node, inside the diagram.
		const left = Number(/ H([\d.]+) V/.exec(back.path.slice(back.path.indexOf(` V${lane}`)))![1]);
		expect(left).toBeGreaterThan(0);
		expect(left).toBeLessThan(Math.min(...layout.nodes.map((n) => n.x)));
	});

	it('marks a material the reprocessing covers in full as reused, not bought', () => {
		const covered = {
			...UNREFINED,
			reprocess: {
				...UNREFINED.reprocess!,
				byproducts: [{ ...UNREFINED.reprocess!.byproducts[0], used: 120, sold: 30 }]
			}
		};
		const d = layoutPlanFlow(plan([FINAL, covered])).nodes.find((n) => n.id === 'buy:1004')!;
		expect([d.kind, d.reused]).toEqual(['byproduct', 120]);
	});

	it('lays a plan without unrefined jobs out without back edges or extra margins', () => {
		const regular = reaction({
			blueprintTypeId: 5001,
			name: 'Xite',
			depth: 1,
			materials: [{ typeId: C, name: 'C', quantity: 1000, producer: null }]
		});
		const final = {
			...FINAL,
			materials: FINAL.materials.map((m) => (m.typeId === X ? { ...m, producer: 5001 } : m))
		};
		const layout = layoutPlanFlow(plan([final, regular]));
		expect(layout.backEdges).toEqual([]);
		expect(Math.min(...layout.nodes.map((n) => n.x))).toBe(16);
	});
});
