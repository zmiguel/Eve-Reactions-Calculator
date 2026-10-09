import { describe, expect, it } from 'vitest';
import { calculateReaction } from '../src/calculate.ts';
import { planReactions } from '../src/planner.ts';
import { byId, makeCtx } from './fixtures/context.ts';
import { dataset } from './fixtures/dataset.ts';

const HYDROGEN = 4246;
const OXYGEN = 4312;

describe('fuel blocks first in every material list', () => {
	it('puts the fuel block first in a reaction whose blueprint lists it later', () => {
		// 4 SDE reactions list their fuel block second (blueprints 57495, 57500, 57501, 57502).
		// The order shown must not depend on that.
		const methanofullerene = byId(46157);
		const late = {
			...methanofullerene,
			materials: [...methanofullerene.materials.slice(1), methanofullerene.materials[0]]
		};
		const ctx = { ...makeCtx(), dataset: { ...dataset, reactions: [late] } };
		const r = calculateReaction(late, ctx, { view: 'single', outputMode: 'product' });
		expect(r.inputs.map((i) => i.typeId)).toEqual([HYDROGEN, 30372, 30373, 37]);
	});

	it('lists both fuel blocks of a plan first, before every other purchase', () => {
		// Methanofullerene (Hydrogen) sorts before the Titanium Carbide chain (Oxygen): without the rule the
		// Oxygen Fuel Block would come after Methanofullerene's gases and minerals.
		const plan = planReactions({
			ctx: makeCtx(),
			totalSlots: 150,
			targets: [
				{ blueprintTypeId: 46157, lines: 1 },
				{ blueprintTypeId: 46204, lines: 1 }
			],
			buyInsteadOfBuild: [],
			stock: {},
			ownedFormulas: {},
			dailyVolumes: {}
		});
		const firstTwo = (items: { typeId: number }[]) => items.slice(0, 2).map((i) => i.typeId);
		expect(firstTwo(plan.purchasesPerCycle)).toEqual([HYDROGEN, OXYGEN]);
		expect(firstTwo(plan.initialPurchases)).toEqual([HYDROGEN, OXYGEN]);
		expect(plan.phases[0].purchases[0].typeId).toBe(OXYGEN); // cycle 1: only the Oxygen intermediates
		expect(firstTwo(plan.phases.at(-1)!.purchases)).toEqual([HYDROGEN, OXYGEN]);
		for (const r of plan.reactions) expect([HYDROGEN, OXYGEN]).toContain(r.materials[0].typeId);
	});
});
