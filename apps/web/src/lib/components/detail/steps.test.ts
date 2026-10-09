import type { ChainNode } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { bought, node, titaniumCarbide, unrefinedChain } from '../../../test/chain';
import { productionSteps } from './steps';

describe('productionSteps', () => {
	it('groups the Titanium Carbide chain into two steps: both intermediates, then the product', () => {
		const root = titaniumCarbide();
		const steps = productionSteps(root);
		expect(steps.map((s) => [s.number, s.jobs.map((j) => [j.id, j.node.name])])).toEqual([
			[
				1,
				[
					['0-0', 'Titanium Chromide'],
					['0-1', 'Silicon Diborite']
				]
			],
			[2, [['0', 'Titanium Carbide']]]
		]);

		const [first, second] = steps;
		expect(first.purchases.map((p) => [p.name, p.quantity])).toEqual([
			['Oxygen Fuel Block', 586],
			['Titanium', 5856],
			['Chromium', 5856],
			['Evaporite Deposits', 5856],
			['Silicates', 5856]
		]);
		expect(first.purchases[0]).toMatchObject({ unitPrice: 18000, total: 586 * 18000 });
		expect(first.purchases[0].fees).toBeCloseTo(586 * 18000 * 0.015);
		expect(first.intermediates).toEqual([]);
		expect(second.purchases.map((p) => [p.name, p.quantity])).toEqual([['Oxygen Fuel Block', 596]]);
		expect(second.intermediates).toEqual([
			{ typeId: 16654, name: 'Titanium Chromide', quantity: 11908, step: 1, byproduct: false },
			{ typeId: 16658, name: 'Silicon Diborite', quantity: 11908, step: 1, byproduct: false }
		]);
	});

	it("lists a step's purchases in the order of the result's inputs, fuel blocks first", () => {
		// Titanium Chromide's job lists its fuel block last; the second job of the step brings it too.
		const root = titaniumCarbide();
		const chromide = root.children[0];
		chromide.materials = [...chromide.materials.slice(1), chromide.materials[0]];
		const inputs = [4312, 16638, 16641, 1, 2].map((typeId) => ({
			typeId,
			name: `Type ${typeId}`,
			quantity: 1,
			unitPrice: 1,
			total: 1,
			fees: 0,
			shipping: 0,
			volume: 0
		}));
		const [first] = productionSteps(root, inputs);
		expect(first.purchases.slice(0, 3).map((p) => p.name)).toEqual([
			'Oxygen Fuel Block',
			'Titanium',
			'Chromium'
		]);
	});

	it('spreads a split input over the steps in whole units and copies the availability', () => {
		const root = titaniumCarbide();
		const blocks = {
			typeId: 4312,
			name: 'Oxygen Fuel Block',
			quantity: 1182,
			unitPrice: null,
			total: 0,
			fees: 0,
			shipping: 0,
			volume: 0,
			availableAtInputHub: 1000,
			sources: [
				{ hubId: 'local', quantity: 1000, unitPrice: 20000, total: 20_000_000, fees: 300_000 },
				{ hubId: 'jita', quantity: 182, unitPrice: 18000, total: 3_276_000, fees: 49_140 }
			]
		};
		const titanium = {
			...blocks,
			typeId: 16638,
			name: 'Titanium',
			availableAtInputHub: 50000,
			sources: undefined
		};
		const [first, second] = productionSteps(root, [blocks, titanium]);
		const sourcesOf = (step: typeof first) =>
			step.purchases.find((p) => p.typeId === 4312)!.sources!.map((s) => [s.hubId, s.quantity, s.total]);
		// 586 of 1,182 blocks in step 1: round(586 × 1,000 ÷ 1,182) = 496 local, 90 from Jita.
		expect(sourcesOf(first)).toEqual([
			['local', 496, 496 * 20000],
			['jita', 90, 90 * 18000]
		]);
		expect(sourcesOf(second)).toEqual([
			['local', 504, 504 * 20000],
			['jita', 92, 92 * 18000]
		]);
		expect(first.purchases.find((p) => p.typeId === 4312)!.availableAtInputHub).toBe(1000);
		const ti = first.purchases.find((p) => p.typeId === 16638)!;
		expect([ti.availableAtInputHub, ti.sources]).toEqual([50000, undefined]);
		expect(first.purchases.find((p) => p.typeId === 16641)!.availableAtInputHub).toBeUndefined();
	});

	it('sums job costs, subtotals and slot time per step and keeps shared rates', () => {
		const root = titaniumCarbide();
		const [first, second] = productionSteps(root);
		const [a, b] = root.children;
		expect(first.jobCost.total).toBeCloseTo(a.jobCost.total + b.jobCost.total);
		expect(first.jobCost.systemCost).toBeCloseTo(a.jobCost.systemCost + b.jobCost.systemCost);
		expect(first.subtotal.total).toBeCloseTo(a.subtotal.total + b.subtotal.total);
		expect(first.subtotal.purchaseFees).toBeCloseTo(a.subtotal.purchaseFees + b.subtotal.purchaseFees);
		expect(first.slotSeconds).toBeCloseTo(a.slotSeconds + b.slotSeconds);
		expect(first.jobRates).toEqual({ costIndex: 0.0412, facilityTaxPct: 1, sccPct: 4 });
		expect(second.subtotal).toEqual(root.subtotal);
		expect(first.unpriced).toBe(false);
	});

	it('drops the shared rates when the jobs of a step use different profiles', () => {
		const root = titaniumCarbide();
		root.children[1] = { ...root.children[1], jobRates: { costIndex: 0.02, facilityTaxPct: 1, sccPct: 4 } };
		expect(productionSteps(root)[0].jobRates).toBeNull();
	});

	it('marks a step with an unpriced material', () => {
		const steps = productionSteps(titaniumCarbide({ titanium: null }));
		expect(steps.map((s) => s.unpriced)).toEqual([true, false]);
		expect(steps[0].purchases.find((p) => p.name === 'Titanium')!.unitPrice).toBeNull();
	});

	it('builds a three-level chain in three steps, each after the jobs it consumes', () => {
		const job = (id: number, depth: number, children: ChainNode[] = []) =>
			node({
				blueprintTypeId: id,
				name: `R${id}`,
				productTypeId: id + 1,
				runs: 10,
				depth,
				materials: [bought(100, 'Fuel', 5, 10)],
				children
			});
		const improved = job(2, 1, [job(3, 2), job(4, 2)]);
		const root = job(1, 0, [improved, job(5, 1)]);
		root.materials = [
			...root.materials,
			{ source: 'chain', typeId: 3, name: 'R2', quantity: 7, volume: 1, blueprintTypeId: 2 },
			{ source: 'chain', typeId: 6, name: 'R5', quantity: 9, volume: 1, blueprintTypeId: 5 }
		];
		const steps = productionSteps(root);
		expect(steps.map((s) => s.jobs.map((j) => j.node.blueprintTypeId))).toEqual([[3, 4, 5], [2], [1]]);
		expect(steps[0].purchases).toEqual([expect.objectContaining({ name: 'Fuel', quantity: 15 })]);
		expect(steps[2].intermediates.map((m) => [m.name, m.step])).toEqual([
			['R2', 2],
			['R5', 1]
		]);
	});

	it('returns a single job as one step', () => {
		const root = node({
			blueprintTypeId: 1,
			name: 'Solo',
			productTypeId: 2,
			runs: 5,
			depth: 0,
			materials: [bought(100, 'Fuel', 5, 10)]
		});
		const steps = productionSteps(root);
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ number: 1, jobs: [{ id: '0', node: root }], intermediates: [] });
		expect(steps[0].subtotal).toEqual(root.subtotal);
	});

	it('groups a single-line chain by its build steps: a byproduct user runs after the unrefined job', () => {
		const steps = productionSteps(unrefinedChain());
		expect(steps.map((s) => s.jobs.map((j) => j.node.name))).toEqual([
			['Unrefined Prometium'],
			['Caesarium Cadmide'],
			['Fermionic Condensates']
		]);
		expect(steps[0].purchases.find((p) => p.typeId === 16643)!.quantity).toBe(500);
		expect(steps[1].intermediates).toEqual([
			{ typeId: 16643, name: 'Cadmium', quantity: 100, step: 1, byproduct: true }
		]);
		expect(steps[2].intermediates).toEqual([
			{ typeId: 16663, name: 'Caesarium Cadmide', quantity: 200, step: 2, byproduct: false },
			{ typeId: 16681, name: 'Prometium', quantity: 200, step: 1, byproduct: false }
		]);
	});
});
