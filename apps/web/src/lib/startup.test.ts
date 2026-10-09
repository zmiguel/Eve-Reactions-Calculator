import type { PlanStartup } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { startupSummary } from './startup';

const HYPERFLURITE = 46196;
const PROMETIUM = 46198;
const names = new Map([
	[HYPERFLURITE, 'Unrefined Hyperflurite'],
	[PROMETIUM, 'Unrefined Prometium']
]);
const reused = [
	{ typeId: 16642, name: 'Vanadium', quantity: 174505 },
	{ typeId: 16643, name: 'Cadmium', quantity: 174505 },
	{ typeId: 16649, name: 'Hafnium', quantity: 203525 },
	{ typeId: 16646, name: 'Mercury', quantity: 203525 }
];
const step0 = {
	initialInvestment: 19_350_000_000,
	cycles: 3,
	blueprintTypeIds: [HYPERFLURITE],
	saves: [reused[0]],
	stock: [{ typeId: 16666, name: 'Hyperflurite', quantity: 73635 }]
};
const buyFirst: PlanStartup = {
	mode: 'buy',
	reused,
	buy: { initialInvestment: 18_110_000_000, cycles: 2 },
	step0
};
const EVERY_CYCLE = 'Every unrefined reaction runs each cycle, like the other reactions.';
const REUSE =
	'From the cycle after their first run, their reprocessing byproducts replace purchases: 174,505 Vanadium, 174,505 Cadmium, 203,525 Hafnium, 203,525 Mercury per cycle. Until then, the start-up buys these.';

describe('startupSummary', () => {
	it('heads with "No step 0", lists every reused byproduct, then why step 0 lost', () => {
		expect(startupSummary(buyFirst, names)).toEqual({
			title: 'No step 0',
			points: [
				EVERY_CYCLE,
				REUSE,
				'A step 0 would run Unrefined Hyperflurite once before cycle 1, so cycle 1 already has 174,505 Vanadium. Not used: it would raise the initial investment from 18.11B to 19.35B and add a cycle.'
			]
		});
	});

	it('says why step 0 was not compared when a start-up purchase has no price', () => {
		const unpriced = { ...buyFirst, buy: { initialInvestment: null, cycles: 2 } };
		expect(startupSummary(unpriced, names)!.points.at(-1)).toMatch(
			/Not compared: some start-up purchases have no price\.$/
		);
	});

	it('names every job of a chosen step 0 and what it saves, costs and leaves in stock', () => {
		const chosen: PlanStartup = {
			...buyFirst,
			mode: 'step0',
			buy: { initialInvestment: 19_000_000_000, cycles: 2 },
			step0: { ...step0, initialInvestment: 18_500_000_000, blueprintTypeIds: [HYPERFLURITE, PROMETIUM] }
		};
		expect(startupSummary(chosen, names)).toEqual({
			title: 'Step 0, once before cycle 1',
			points: [
				'Unrefined Hyperflurite and Unrefined Prometium run one extra time before cycle 1, so cycle 1 already has 174,505 Vanadium from reprocessing instead of buying it.',
				'Initial investment 18.50B instead of 19.00B, but one more cycle.',
				'Step 0 also leaves 73,635 Hyperflurite in stock.',
				'From cycle 1, every unrefined reaction runs each cycle, like the other reactions.',
				REUSE
			]
		});
	});

	it('has no heading when no step 0 was possible, and is null without reuse', () => {
		expect(startupSummary({ ...buyFirst, step0: null }, names)).toEqual({
			title: null,
			points: [EVERY_CYCLE, REUSE]
		});
		expect(startupSummary({ ...buyFirst, step0: null, reused: [] }, names)).toBeNull();
	});
});
