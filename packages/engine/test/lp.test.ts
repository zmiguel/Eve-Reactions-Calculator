import { describe, expect, it } from 'vitest';
import { solveLp, solveMip, type LinearConstraint, type LinearProgram, type Relation } from '../src/lp.ts';

const row = (coefficients: number[], relation: Relation, rhs: number): LinearConstraint => ({
	coefficients,
	relation,
	rhs
});

function optimum(lp: LinearProgram) {
	const result = solveLp(lp);
	if (result.status !== 'optimal') throw new Error(`expected an optimum, got ${result.status}`);
	return result;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const satisfies = (lp: LinearProgram, x: number[]) =>
	lp.constraints.every((c) => {
		const lhs = c.coefficients.reduce((acc, a, j) => acc + a * x[j], 0);
		return c.relation === '<='
			? lhs <= c.rhs + 1e-9
			: c.relation === '>='
				? lhs >= c.rhs - 1e-9
				: Math.abs(lhs - c.rhs) <= 1e-9;
	}) && x.every((v, j) => v >= -1e-9 && v <= (lp.upper?.[j] ?? Infinity) + 1e-9);

describe('solveLp', () => {
	it('finds the optimum and solution of a textbook LP', () => {
		// Hillier & Lieberman, Wyndor Glass: max 3x + 5y.
		const result = optimum({
			objective: [3, 5],
			constraints: [row([1, 0], '<=', 4), row([0, 2], '<=', 12), row([3, 2], '<=', 18)]
		});
		expect(result.value).toBeCloseTo(36, 9);
		expect(result.solution[0]).toBeCloseTo(2, 9);
		expect(result.solution[1]).toBeCloseTo(6, 9);
	});

	it('handles ≥ and = rows (phase 1)', () => {
		// Hillier & Lieberman, radiation therapy: min 0.4x + 0.5y, maximised as its negative.
		const result = optimum({
			objective: [-0.4, -0.5],
			constraints: [row([0.3, 0.1], '<=', 2.7), row([0.5, 0.5], '=', 6), row([0.6, 0.4], '>=', 6)]
		});
		expect(result.value).toBeCloseTo(-5.25, 9);
		expect(result.solution[0]).toBeCloseTo(7.5, 9);
		expect(result.solution[1]).toBeCloseTo(4.5, 9);
	});

	it('keeps ISK-sized coefficients next to unit ones stable', () => {
		// Runs x (16.5 M ISK each) need slots b (22 M ISK each, 126 runs per slot) and 97.36 units of a
		// held material per run plus one per slot; z is worth almost nothing.
		const result = optimum({
			objective: [16_500_000, -22_000_000, 0.5],
			constraints: [row([1, -126, 0], '<=', 0), row([97.36, 1, 1], '<=', 24_000)],
			upper: [Infinity, 2, Infinity]
		});
		const runs = 24_000 / (97.36 + 1 / 126);
		expect(result.solution[0]).toBeCloseTo(runs, 6);
		expect(result.solution[1]).toBeCloseTo(runs / 126, 9);
		expect(result.solution[2]).toBeCloseTo(0, 9);
		const value = 16_500_000 * runs - (22_000_000 * runs) / 126;
		expect(Math.abs(result.value - value) / value).toBeLessThan(1e-12);
	});

	it('honours upper bounds', () => {
		const result = optimum({ objective: [1, 1], constraints: [row([1, 2], '<=', 4)], upper: [3] });
		expect(result.value).toBeCloseTo(3.5, 9);
		expect(result.solution).toEqual([expect.closeTo(3, 9), expect.closeTo(0.5, 9)]);
	});

	it('detects an infeasible program', () => {
		expect(
			solveLp({ objective: [1, 1], constraints: [row([1, 1], '<=', 1), row([1, 1], '>=', 2)] }).status
		).toBe('infeasible');
	});

	it('detects an unbounded program', () => {
		expect(solveLp({ objective: [1, 0], constraints: [row([1, -1], '<=', 1)] }).status).toBe('unbounded');
	});

	it("solves Beale's degenerate example, which cycles with the largest-coefficient rule alone", () => {
		const result = optimum({
			objective: [0.75, -20, 0.5, -6],
			constraints: [
				row([0.25, -8, -1, 9], '<=', 0),
				row([0.5, -12, -0.5, 3], '<=', 0),
				row([0, 0, 1, 0], '<=', 1)
			]
		});
		expect(result.value).toBeCloseTo(1.25, 9);
		expect(result.solution).toEqual([1, 0, 1, 0].map((v) => expect.closeTo(v, 9)));
	});
});

describe('solveMip', () => {
	/** Every integer point of the box `0..upper`; the best objective value, null when none is feasible. */
	function bruteForce(lp: LinearProgram): number | null {
		let best: number | null = null;
		const visit = (x: number[]) => {
			if (x.length === lp.objective.length) {
				if (!satisfies(lp, x)) return;
				const value = lp.objective.reduce((acc, c, j) => acc + c * x[j], 0);
				if (best === null || value > best) best = value;
				return;
			}
			for (let v = 0; v <= lp.upper![x.length]; v++) visit([...x, v]);
		};
		visit([]);
		return best;
	}

	function randomProgram(seed: number): LinearProgram {
		const rng = mulberry32(seed);
		const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
		const n = int(2, 4);
		const constraints = Array.from({ length: int(1, 3) }, () => {
			const pick = rng();
			const relation: Relation = pick < 0.7 ? '<=' : pick < 0.9 ? '>=' : '=';
			const coefficients = Array.from({ length: n }, () => int(-2, 6));
			return row(coefficients, relation, relation === '<=' ? int(2, 16) : int(1, 8));
		});
		return {
			objective: Array.from({ length: n }, () => Math.round((rng() * 12 - 3) * 100) / 100),
			constraints,
			upper: Array.from({ length: n }, () => int(1, 5))
		};
	}

	it.each(Array.from({ length: 50 }, (_, i) => i))(
		'equals brute-force enumeration on random integer program %i',
		(i) => {
			const lp = randomProgram(1000 + i);
			const expected = bruteForce(lp);
			const result = solveMip(
				lp,
				lp.objective.map((_, j) => j)
			);
			if (expected === null) {
				expect(result.status).toBe('infeasible');
				return;
			}
			expect(result.status).toBe('optimal');
			expect(result.value).toBeCloseTo(expected, 9);
			expect(result.solution!.every(Number.isInteger)).toBe(true);
			expect(satisfies(lp, result.solution!)).toBe(true);
		}
	);

	it('covers infeasible and feasible programs', () => {
		const outcomes = Array.from({ length: 50 }, (_, i) => bruteForce(randomProgram(1000 + i)) === null);
		expect(outcomes).toContain(true);
		expect(outcomes).toContain(false);
	});

	// Relaxation (3, 1.5) = 21; integer optimum (4, 0) = 20.
	const knapsack: LinearProgram = {
		objective: [5, 4],
		constraints: [row([6, 4], '<=', 24), row([1, 2], '<=', 6)]
	};

	it('returns the best solution found at the node cap', () => {
		expect(solveMip(knapsack, [0, 1])).toMatchObject({ status: 'optimal', value: 20, solution: [4, 0] });
		const capped = solveMip(knapsack, [0, 1], { nodeCap: 1 });
		expect(capped.status).toBe('stopped');
		expect(capped.nodes).toBe(1);
		expect(capped.relaxation).toEqual([expect.closeTo(3, 9), expect.closeTo(1.5, 9)]);
		expect(capped.solution!.every(Number.isInteger)).toBe(true);
		expect(satisfies(knapsack, capped.solution!)).toBe(true);
		expect(capped.value).toBeLessThanOrEqual(20);
	});

	it('stops at the deadline without throwing', () => {
		const stopped = solveMip(knapsack, [0, 1], { deadline: performance.now() - 1 });
		expect(stopped).toMatchObject({ status: 'stopped', solution: null, relaxation: null, nodes: 0 });
	});

	it('tries the given roundings of the root relaxation as first incumbents', () => {
		const capped = solveMip(knapsack, [0, 1], {
			nodeCap: 1,
			round: () => [
				[2, 2],
				[4, 0]
			]
		});
		expect(capped).toMatchObject({ status: 'stopped', value: 20, solution: [4, 0] });
	});

	it('stops within the relative gap', () => {
		// The rounding (3, 1) = 19 is within 15 % of the relaxation (21): nothing is branched.
		const result = solveMip(knapsack, [0, 1], { relativeGap: 0.15, round: () => [[3, 1]] });
		expect(result).toMatchObject({ status: 'optimal', value: 19, nodes: 1 });
	});
});
