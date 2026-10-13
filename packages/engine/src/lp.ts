/**
 * Small dense linear and integer programs (the planner's "Use what I have" mode): a two-phase tableau
 * simplex and depth-first branch and bound. Every variable is ≥ 0. Pricing takes the most negative
 * reduced cost and switches to Bland's rule (lowest index) after every degenerate pivot, so a degenerate
 * program cannot cycle; the ratio test breaks ties by the lowest basic variable (Bland's leaving rule).
 * Rows are scaled to a largest coefficient of 1 and the objective to a largest coefficient of 1 before
 * solving, so ISK-sized coefficients next to unit ones stay stable; values and solutions are reported
 * unscaled.
 */

export type Relation = '<=' | '>=' | '=';

export interface LinearConstraint {
	/** Coefficient per variable index; entries beyond the array are 0. */
	coefficients: readonly number[];
	relation: Relation;
	rhs: number;
}

export interface LinearProgram {
	/** Coefficient per variable of the objective, which is maximised. */
	objective: readonly number[];
	constraints: readonly LinearConstraint[];
	/** Upper bound per variable; missing or `Infinity` = none. */
	upper?: readonly number[];
}

export type LpResult =
	| { status: 'optimal'; value: number; solution: number[] }
	| { status: 'infeasible' }
	| { status: 'unbounded' };

export interface MipOptions {
	/** Relaxations to solve at most; default {@link DEFAULT_NODE_CAP}. */
	nodeCap?: number;
	/** `performance.now()` time after which the search stops with the best solution found. */
	deadline?: number;
	/**
	 * Nodes whose relaxation beats the incumbent by at most this share of its value are not explored:
	 * the result is optimal within that share. Default 0.
	 */
	relativeGap?: number;
	/** Integer variables whose lower child (≤ ⌊v⌋) is explored first; the others go up first. */
	downFirst?: readonly number[];
	/**
	 * Roundings of the root relaxation: for each, the integer variables are fixed to its values and the
	 * others re-solved; the best feasible one is the first incumbent. Default: every integer variable
	 * rounded down.
	 */
	round?: (relaxation: readonly number[]) => readonly (readonly number[])[];
	/** Called with every better integer solution, as it is found. */
	onIncumbent?: (solution: readonly number[], value: number) => void;
}

export interface MipResult {
	/**
	 * `optimal`: the search finished with `solution` (within `relativeGap`); `stopped`: the node cap or
	 * the deadline was reached, or a relaxation failed numerically, and `solution` is the best integer
	 * solution found (null when none); `infeasible`: no integer solution exists; `unbounded`: the
	 * relaxation is unbounded.
	 */
	status: 'optimal' | 'stopped' | 'infeasible' | 'unbounded';
	solution: number[] | null;
	value: number | null;
	/** Solution of the root relaxation; null when it was not solved. */
	relaxation: number[] | null;
	/** Relaxations solved by the search (the root rounding not counted). */
	nodes: number;
}

/** Reduced cost tolerance (rows and objective are scaled to a largest coefficient of 1). */
const EPS = 1e-9;
/**
 * Pivot elements must exceed this share of the entering column's largest entry (and `EPS`): smaller
 * ones are cancellation noise and would blow up the tableau.
 */
const PIVOT_TOLERANCE = 1e-7;
/** Infeasibility a ratio test step may leave (Harris), so it can prefer a larger pivot element. */
const HARRIS = 1e-9;
/** Entries below this after a pivot are cancellation noise, set to 0 (keeps the tableau sparse). */
const ROUNDOFF = 1e-11;
/** Distance from an integer under which a value counts as integral. */
const INTEGRALITY = 1e-6;
/** Phase 1 residual (relative to the largest scaled right-hand side) above which a program is infeasible. */
const FEASIBILITY = 1e-7;
export const DEFAULT_NODE_CAP = 5000;

/** Pivots the tableau (rows `0..m`, objective row `m`, right-hand side at column `width`) on `T[r][j]`. */
function pivot(T: Float64Array[], m: number, width: number, r: number, j: number) {
	const pr = T[r];
	const p = pr[j];
	const nonZero: number[] = [];
	for (let k = 0; k <= width; k++) {
		if (pr[k] === 0) continue;
		pr[k] /= p;
		nonZero.push(k);
	}
	pr[j] = 1;
	for (let i = 0; i <= m; i++) {
		if (i === r) continue;
		const row = T[i];
		const f = row[j];
		if (f === 0) continue;
		for (const k of nonZero) {
			const v = row[k] - f * pr[k];
			row[k] = Math.abs(v) < ROUNDOFF ? 0 : v;
		}
		row[j] = 0;
		if (i < m && Math.abs(row[width]) < EPS) row[width] = 0;
	}
}

/** Thrown by {@link iterate} when the deadline passes or the iteration limit is reached. */
class SimplexStop extends Error {}

/**
 * Simplex iterations on columns below `enterable`. Pivot elements below {@link PIVOT_TOLERANCE} of the
 * entering column's largest entry count as 0. After a degenerate pivot, Bland's rule: the lowest-index
 * column with a negative reduced cost enters, the minimum ratio leaves with ties to the lowest basic
 * variable, so degenerate pivots cannot cycle. Otherwise the most negative reduced cost enters and a
 * two-pass (Harris) ratio test picks, among the rows within the smallest ratio relaxed by
 * {@link HARRIS}, the largest pivot element. False when unbounded; throws {@link SimplexStop} after
 * `deadline` (`performance.now()` time).
 */
function iterate(
	T: Float64Array[],
	basis: number[],
	m: number,
	width: number,
	enterable: number,
	deadline: number
): boolean {
	const obj = T[m];
	// Cannot cycle; the limit only guards against floating-point pathologies.
	const limit = 1000 + 100 * (m + width);
	let bland = false;
	for (let iteration = 0; iteration < limit; iteration++) {
		if (iteration % 32 === 31 && performance.now() > deadline) throw new SimplexStop('deadline');
		let enter = -1;
		let most = -EPS;
		for (let j = 0; j < enterable; j++) {
			if (obj[j] >= most) continue;
			enter = j;
			if (bland) break;
			most = obj[j];
		}
		if (enter < 0) return true;
		let colMax = 0;
		for (let i = 0; i < m; i++) colMax = Math.max(colMax, Math.abs(T[i][enter]));
		// Round-off can leave a right-hand side slightly negative: it counts as 0, never as a step back.
		const ratio = (i: number) => Math.max(0, T[i][width]) / T[i][enter];
		const leaving = (tolerance: number) => {
			let leave = -1;
			if (bland) {
				let best = Infinity;
				for (let i = 0; i < m; i++) {
					if (T[i][enter] <= tolerance) continue;
					const r = ratio(i);
					if (r < best - EPS || (r <= best + EPS && basis[i] < basis[leave])) {
						best = Math.min(best, r);
						leave = i;
					}
				}
				return leave;
			}
			let step = Infinity;
			for (let i = 0; i < m; i++) {
				const a = T[i][enter];
				if (a > tolerance) step = Math.min(step, (Math.max(0, T[i][width]) + HARRIS) / a);
			}
			for (let i = 0; i < m; i++) {
				const a = T[i][enter];
				if (a > tolerance && ratio(i) <= step && (leave < 0 || a > T[leave][enter])) leave = i;
			}
			return leave;
		};
		// Only small positive entries (next to large negative ones): those are real, not noise.
		let leave = leaving(Math.max(EPS, PIVOT_TOLERANCE * colMax));
		if (leave < 0) leave = leaving(EPS);
		if (leave < 0) return false;
		bland = ratio(leave) <= EPS;
		pivot(T, m, width, leave, enter);
		basis[leave] = enter;
	}
	throw new SimplexStop('simplex iteration limit reached');
}

/** Solves `lp` with every variable `j` in `[lower[j], upper[j]]` (shifted to `x' = x − lower ≥ 0`). */
function solveBounded(
	lp: LinearProgram,
	lower: ArrayLike<number>,
	upper: ArrayLike<number>,
	deadline = Infinity
): LpResult {
	const n = lp.objective.length;
	interface Row {
		a: Float64Array;
		relation: Relation;
		rhs: number;
	}
	const rows: Row[] = [];
	for (let j = 0; j < n; j++) if (upper[j] < lower[j] - INTEGRALITY) return { status: 'infeasible' };
	for (const c of lp.constraints) {
		const a = new Float64Array(n);
		let rhs = c.rhs;
		const len = Math.min(n, c.coefficients.length);
		for (let j = 0; j < len; j++) {
			const v = c.coefficients[j];
			a[j] = v;
			rhs -= v * lower[j];
		}
		rows.push({ a, relation: c.relation, rhs });
	}
	for (let j = 0; j < n; j++) {
		if (!Number.isFinite(upper[j])) continue;
		const a = new Float64Array(n);
		a[j] = 1;
		rows.push({ a, relation: '<=', rhs: Math.max(0, upper[j] - lower[j]) });
	}

	// Scale every row to a largest coefficient of 1 and make its right-hand side non-negative.
	const kept: Row[] = [];
	let maxRhs = 0;
	for (const row of rows) {
		let s = 0;
		for (let j = 0; j < n; j++) s = Math.max(s, Math.abs(row.a[j]));
		if (s < EPS) {
			const tol = FEASIBILITY * Math.max(1, Math.abs(row.rhs));
			const ok =
				row.relation === '<='
					? row.rhs >= -tol
					: row.relation === '>='
						? row.rhs <= tol
						: Math.abs(row.rhs) <= tol;
			if (!ok) return { status: 'infeasible' };
			continue;
		}
		const sign = row.rhs < 0 ? -1 : 1;
		const f = sign / s;
		for (let j = 0; j < n; j++) row.a[j] *= f;
		row.rhs *= f;
		if (sign < 0 && row.relation !== '=') row.relation = row.relation === '<=' ? '>=' : '<=';
		maxRhs = Math.max(maxRhs, row.rhs);
		kept.push(row);
	}

	const m = kept.length;
	const slacks = kept.filter((r) => r.relation !== '=').length;
	const artificials = kept.filter((r) => r.relation !== '<=').length;
	const artStart = n + slacks;
	const width = artStart + artificials;
	const T = Array.from({ length: m + 1 }, () => new Float64Array(width + 1));
	const basis: number[] = [];
	let slack = n;
	let art = artStart;
	kept.forEach((row, i) => {
		T[i].set(row.a);
		T[i][width] = row.rhs;
		if (row.relation === '<=') {
			T[i][slack] = 1;
			basis.push(slack++);
			return;
		}
		if (row.relation === '>=') T[i][slack++] = -1;
		T[i][art] = 1;
		basis.push(art++);
	});

	const obj = T[m];
	if (artificials > 0) {
		// Phase 1: maximise −Σ artificials; the objective row holds z_j − c_j.
		for (let i = 0; i < m; i++) {
			if (basis[i] < artStart) continue;
			const row = T[i];
			for (let k = 0; k < artStart; k++) obj[k] -= row[k];
			obj[width] -= row[width];
		}
		iterate(T, basis, m, width, artStart, deadline);
		if (obj[width] < -FEASIBILITY * Math.max(1, maxRhs)) return { status: 'infeasible' };
		// Artificials still basic sit at 0: pivot them out where the row has another usable entry.
		for (let i = 0; i < m; i++) {
			if (basis[i] < artStart) continue;
			for (let j = 0; j < artStart; j++)
				if (Math.abs(T[i][j]) > PIVOT_TOLERANCE) {
					pivot(T, m, width, i, j);
					basis[i] = j;
					break;
				}
		}
	}

	// Phase 2 with the scaled objective.
	let cScale = 0;
	for (let j = 0; j < n; j++) cScale = Math.max(cScale, Math.abs(lp.objective[j]));
	const c = new Float64Array(width);
	if (cScale > 0) for (let j = 0; j < n; j++) c[j] = lp.objective[j] / cScale;
	obj.fill(0);
	for (let j = 0; j < artStart; j++) obj[j] = -c[j];
	for (let i = 0; i < m; i++) {
		const cb = c[basis[i]];
		if (cb === 0) continue;
		const row = T[i];
		for (let k = 0; k <= width; k++) obj[k] += cb * row[k];
	}
	if (!iterate(T, basis, m, width, artStart, deadline)) return { status: 'unbounded' };

	const solution = Array.from({ length: n }, (_, j) => lower[j]);
	for (let i = 0; i < m; i++) if (basis[i] < n) solution[basis[i]] += Math.max(0, T[i][width]);
	const value = lp.objective.reduce((acc, cj, j) => acc + cj * solution[j], 0);
	return { status: 'optimal', value, solution };
}

/** Maximises `lp` (every variable ≥ 0) with the two-phase simplex. */
export function solveLp(lp: LinearProgram): LpResult {
	const n = lp.objective.length;
	return solveBounded(
		lp,
		new Float64Array(n),
		Array.from({ length: n }, (_, j) => lp.upper?.[j] ?? Infinity)
	);
}

/**
 * Maximises `lp` with the variables in `integer` restricted to integers: depth-first branch and bound
 * on the first fractional variable in `integer` order (the branching priority), its upper child first
 * unless listed in `downFirst`. Nodes whose relaxation cannot beat the incumbent by more than
 * `relativeGap` are not explored. At the root, `round` (default: every integer variable rounded down)
 * with the other variables re-solved gives a first incumbent when feasible. Stops after `nodeCap`
 * relaxations or at `deadline` with the best solution found (`status: 'stopped'`); never throws.
 */
export function solveMip(lp: LinearProgram, integer: readonly number[], opts: MipOptions = {}): MipResult {
	const n = lp.objective.length;
	const nodeCap = opts.nodeCap ?? DEFAULT_NODE_CAP;
	const deadline = opts.deadline ?? Infinity;
	const gap = Math.max(EPS, opts.relativeGap ?? 0);
	const isInteger = new Uint8Array(n);
	for (const j of integer) isInteger[j] = 1;
	const downFirst = new Set(opts.downFirst);
	const rootUpper = Array.from({ length: n }, (_, j) => {
		const u = lp.upper?.[j] ?? Infinity;
		return isInteger[j] && Number.isFinite(u) ? Math.floor(u + INTEGRALITY) : u;
	});
	const incumbent: { solution: number[] | null; value: number } = { solution: null, value: -Infinity };
	/** Whether `value` beats the incumbent by more than `share` of it (objective values can be ISK-sized). */
	const beats = (value: number, share: number) =>
		incumbent.solution === null || value > incumbent.value + share * Math.max(1, Math.abs(incumbent.value));
	const accept = (solution: number[]) => {
		const rounded = solution.map((v, j) => (isInteger[j] ? Math.round(v) : v));
		const value = lp.objective.reduce((acc, cj, j) => acc + cj * rounded[j], 0);
		if (beats(value, EPS)) {
			incumbent.solution = rounded;
			incumbent.value = value;
			opts.onIncumbent?.(rounded, value);
		}
	};
	let relaxation: number[] | null = null;
	let nodes = 0;
	const result = (status: MipResult['status']): MipResult => {
		const { solution, value } = incumbent;
		if (status === 'optimal' && !solution) status = 'infeasible';
		return { status, solution, value: solution ? value : null, relaxation, nodes };
	};

	/** `bound`: the parent's relaxation value, which no node below it can beat. */
	const stack: { lower: Float64Array; upper: number[]; bound: number }[] = [
		{ lower: new Float64Array(n), upper: rootUpper, bound: Infinity }
	];
	try {
		while (stack.length > 0) {
			const node = stack.pop()!;
			// An incumbent found since the node was pushed may already beat its bound.
			if (!beats(node.bound, gap)) continue;
			if (nodes >= nodeCap || performance.now() > deadline) return result('stopped');
			nodes++;
			const relaxed = solveBounded(lp, node.lower, node.upper, deadline);
			if (relaxed.status === 'unbounded') {
				incumbent.solution = null;
				return result('unbounded');
			}
			if (relaxed.status !== 'optimal' || !beats(relaxed.value, EPS)) continue;
			if (nodes === 1) relaxation = relaxed.solution;
			const j =
				integer.find((k) => {
					const frac = relaxed.solution[k] - Math.floor(relaxed.solution[k]);
					return Math.min(frac, 1 - frac) > INTEGRALITY;
				}) ?? -1;
			if (j < 0) {
				accept(relaxed.solution);
				continue;
			}
			if (nodes === 1) {
				const roundings = opts.round?.(relaxed.solution) ?? [
					relaxed.solution.map((v) => Math.floor(v + INTEGRALITY))
				];
				for (const rounding of roundings) {
					// The rounding caps the integer variables; the relaxation re-solved under the caps is
					// rounded up (still within them) and fixed, the other variables re-solved once more.
					const caps = node.upper.map((u, k) => (isInteger[k] ? Math.min(u, Math.max(0, rounding[k])) : u));
					const capped = solveBounded(lp, new Float64Array(n), caps, deadline);
					if (capped.status !== 'optimal') continue;
					const fixed = capped.solution.map((v, k) =>
						isInteger[k] ? Math.min(caps[k], Math.ceil(v - INTEGRALITY)) : 0
					);
					const tried = solveBounded(
						lp,
						Float64Array.from(fixed),
						caps.map((u, k) => (isInteger[k] ? fixed[k] : u)),
						deadline
					);
					if (tried.status === 'optimal') accept(tried.solution);
				}
			}
			if (!beats(relaxed.value, gap)) continue;
			const v = relaxed.solution[j];
			const bound = relaxed.value;
			const down = { lower: node.lower, upper: node.upper.slice(), bound };
			down.upper[j] = Math.floor(v);
			const up = { lower: node.lower.slice(), upper: node.upper, bound };
			up.lower[j] = Math.ceil(v);
			// Depth first: the child pushed last is explored first.
			if (downFirst.has(j)) stack.push(up, down);
			else stack.push(down, up);
		}
	} catch (error) {
		if (error instanceof SimplexStop) return result('stopped');
		throw error;
	}
	return result('optimal');
}
