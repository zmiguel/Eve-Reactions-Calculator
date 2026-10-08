import { describe, expect, it } from 'vitest';
import { reactionSlots } from './slots';

describe('reactionSlots', () => {
	it('is characters × (1 + Mass Reactions + Advanced Mass Reactions)', () => {
		expect(reactionSlots(1, 5, 5)).toBe(11);
		expect(reactionSlots(3, 4, 0)).toBe(15);
		expect(reactionSlots(14, 5, 5)).toBe(154);
		expect(reactionSlots(2, 0, 0)).toBe(2);
	});

	it('clamps skill levels to 0–5 and counts whole characters only', () => {
		expect(reactionSlots(1, 9, 7)).toBe(11);
		expect(reactionSlots(1, -2, 3.7)).toBe(4);
		expect(reactionSlots(2.9, 5, 5)).toBe(22);
		expect(reactionSlots(-1, 5, 5)).toBe(0);
		expect(reactionSlots(Number.NaN, 5, 5)).toBe(0);
		expect(reactionSlots(1, Number.NaN, 5)).toBe(6);
	});
});
