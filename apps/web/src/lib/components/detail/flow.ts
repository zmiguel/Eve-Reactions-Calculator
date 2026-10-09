import type { ChainNode } from '@reactions/engine';

export type FlowNodeKind = 'bought' | 'byproduct' | 'intermediate' | 'final';

export interface FlowNode {
	/**
	 * `buy:<typeId>` for materials on the left (bought, or reused from the previous cycle's reprocessing),
	 * `job:<id>` for reactions (chains: the tree path, `job:0` = final product; plans: the blueprint id).
	 */
	id: string;
	/** `byproduct`: a material the previous cycle's reprocessing covers in full, so nothing of it is bought. */
	kind: FlowNodeKind;
	typeId: number;
	name: string;
	/** Name wrapped to at most two lines. */
	lines: string[];
	/** Materials: total over every job; reactions: quantity the job produces. */
	quantity: number;
	/**
	 * Materials: units of `quantity` that come from the previous cycle's reprocessing (a back edge from the
	 * unrefined job) instead of being bought; null for reactions.
	 */
	reused: number | null;
	/** Job runs (null for bought materials and byproducts). */
	runs: number | null;
	/** Parallel slots of the job with optimal slots (null for bought materials and single-slot allocation). */
	slots: number | null;
	/** Unrefined job: the material its reprocessed product replaces; null otherwise. */
	reprocessedInto: string | null;
	/** Bought material without a market price. */
	unpriced: boolean;
	/** 0 = bought materials and byproducts; reactions sit at their level (the final product is the last column). */
	column: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FlowEdge {
	id: string;
	from: string;
	to: string;
	/** Quantity the consuming job uses (back edges: units reused). */
	quantity: number;
	/** Material carried (an unrefined job's edges: what its reprocessing yields). */
	material: string;
	/**
	 * SVG path from the source's right side to the consumer's left side; a back edge runs from the
	 * source's right side down to a lane below the diagram and back left into the target's left side.
	 */
	path: string;
	/** Label anchor (right-aligned): above the edge where it enters the consumer, or above a back edge's lane. */
	labelX: number;
	labelY: number;
}

export interface FlowLayout {
	width: number;
	height: number;
	columns: number;
	nodes: FlowNode[];
	edges: FlowEdge[];
	/** Reprocessing byproducts reused next cycle: unrefined job → the bought material they replace. */
	backEdges: FlowEdge[];
}

/** A node before layout. */
export type FlowNodeSpec = Omit<FlowNode, 'x' | 'y' | 'width' | 'height'>;

/** An edge before layout; `order` keeps a consumer's inputs in blueprint order. */
export interface FlowEdgeSpec {
	id: string;
	from: string;
	to: string;
	quantity: number;
	material: string;
	order: number;
}

/**
 * A material flow to lay out: every edge runs from a lower to a higher column; back edges run the other
 * way (drawn below the diagram). The last column keeps the order of `nodes`; `top` nodes (fuel blocks)
 * lead their column, like fuel blocks lead every material list.
 */
export interface FlowGraph {
	nodes: FlowNodeSpec[];
	edges: FlowEdgeSpec[];
	backEdges: FlowEdgeSpec[];
	top?: ReadonlySet<string>;
}

export const FLOW_GEOMETRY = {
	nodeWidth: 220,
	columnGap: 100,
	rowGap: 14,
	padding: 16,
	/** Node heights for a one- and two-line name. */
	nodeHeight: [48, 62],
	/** Minimum distance between edge ports on one side of a node (room for a label). */
	portSpacing: 18,
	/** Height reserved where an edge crosses a column it does not stop in. */
	laneHeight: 6,
	lineChars: 24
} as const;

const G = FLOW_GEOMETRY;

/** Splits a name into at most two lines of `max` characters at word boundaries; overflow ends in `…`. */
export function wrapName(name: string, max: number = G.lineChars): string[] {
	if (name.length <= max) return [name];
	const words = name.split(' ');
	let first = '';
	while (words.length > 0 && (first ? `${first} ${words[0]}` : words[0]).length <= max)
		first = first ? `${first} ${words.shift()}` : words.shift()!;
	if (!first) first = words.shift()!;
	const clip = (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
	const rest = words.join(' ');
	return rest ? [clip(first), clip(rest)] : [clip(first)];
}

interface PendingEdge extends FlowEdgeSpec {
	fromCol: number;
	toCol: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Vertical distance between the lanes of back edges below the diagram (room for a label above each). */
const BACK_LANE = 16;
/** Horizontal distance between the vertical runs of back edges, and their first offset. */
const BACK_STEP = 8;
const BACK_FIRST = 10;
/** Back edges sharing one column gap before their vertical runs would leave it. */
const BACK_PER_GAP = Math.floor((G.columnGap - BACK_FIRST) / BACK_STEP);

/**
 * Column layout of a material flow. Columns are ordered right to left by where their edges lead (the
 * last column keeps the graph's order); edges that skip columns run through a reserved lane in each
 * crossed column, so they never pass under a node. Back edges leave their source's right side, run in
 * their own lane below the diagram and enter their target's left side; the target highest up gets the
 * lowest lane and the outermost vertical runs, so back edges do not cross each other.
 */
export function layoutFlow(graph: FlowGraph): FlowLayout {
	const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
	const columns = Math.max(...graph.nodes.map((n) => n.column)) + 1;
	const lastColumn = columns - 1;
	const edges: PendingEdge[] = graph.edges.map((e) => ({
		...e,
		fromCol: nodes.get(e.from)!.column,
		toCol: nodes.get(e.to)!.column
	}));

	/** Item of an edge in `col`: its source, its target, or the lane it crosses. */
	const hop = (e: PendingEdge, col: number) =>
		col === e.fromCol ? e.from : col === e.toCol ? e.to : `${e.id}@${col}`;
	const outgoing = new Map<string, PendingEdge[]>();
	const incoming = new Map<string, PendingEdge[]>();
	const columnItems: string[][] = Array.from({ length: columns }, () => []);
	for (const node of nodes.values()) columnItems[node.column].push(node.id);
	for (const e of edges) {
		for (let col = e.fromCol; col < e.toCol; col++) {
			const item = hop(e, col);
			const next = hop(e, col + 1);
			if (col > e.fromCol) columnItems[col].push(item);
			outgoing.set(item, [...(outgoing.get(item) ?? []), e]);
			incoming.set(next, [...(incoming.get(next) ?? []), e]);
		}
	}
	const backOut = new Map<string, FlowEdgeSpec[]>();
	const backIn = new Map<string, FlowEdgeSpec[]>();
	for (const e of graph.backEdges) {
		backOut.set(e.from, [...(backOut.get(e.from) ?? []), e]);
		backIn.set(e.to, [...(backIn.get(e.to) ?? []), e]);
	}

	// Order each column by where its edges lead (right to left), siblings in blueprint order, `top` first.
	const top = graph.top ?? new Set<string>();
	const rank = new Map<string, number>(columnItems[lastColumn].map((item, i) => [item, i]));
	for (let col = lastColumn - 1; col >= 0; col--) {
		const key = (item: string) => {
			const outs = outgoing.get(item) ?? [];
			if (outs.length === 0) return Number.MAX_SAFE_INTEGER;
			return outs.reduce((a, e) => a + rank.get(hop(e, col + 1))! + e.order / 1000, 0) / outs.length;
		};
		const keys = new Map(columnItems[col].map((item) => [item, key(item)]));
		columnItems[col].sort(
			(a, b) => Number(top.has(b)) - Number(top.has(a)) || keys.get(a)! - keys.get(b)! || a.localeCompare(b)
		);
		columnItems[col].forEach((item, i) => rank.set(item, i));
	}

	const heightOf = (item: string) => {
		const node = nodes.get(item);
		if (!node) return G.laneHeight;
		const ports = Math.max(
			(outgoing.get(item)?.length ?? 0) + (backOut.get(item)?.length ?? 0),
			(incoming.get(item)?.length ?? 0) + (backIn.get(item)?.length ?? 0)
		);
		return Math.max(G.nodeHeight[node.lines.length - 1], ports * G.portSpacing + 8);
	};
	const columnHeight = (items: string[]) =>
		items.reduce((a, item) => a + heightOf(item), 0) + Math.max(0, items.length - 1) * G.rowGap;
	const innerHeight = Math.max(...columnItems.map(columnHeight));

	const backCount = graph.backEdges.length;
	const leftMargin = backCount > 0 ? BACK_FIRST + 4 + BACK_STEP * backCount : 0;
	const rightMargin = backCount > 0 ? BACK_FIRST + 4 + BACK_STEP * Math.min(backCount, BACK_PER_GAP) : 0;
	const boxes = new Map<string, { x: number; y: number; height: number }>();
	columnItems.forEach((items, col) => {
		let y = G.padding + (innerHeight - columnHeight(items)) / 2;
		const x = G.padding + leftMargin + col * (G.nodeWidth + G.columnGap);
		for (const item of items) {
			const height = heightOf(item);
			boxes.set(item, { x, y, height });
			y += height + G.rowGap;
		}
	});

	// Back edge lanes: the lowest target first, so a back edge to a higher target runs further out.
	const backs = [...graph.backEdges].sort(
		(a, b) => boxes.get(b.to)!.y - boxes.get(a.to)!.y || boxes.get(a.from)!.y - boxes.get(b.from)!.y
	);
	const lane = new Map(backs.map((e, i) => [e, i]));

	/** Port y of `e` on `item`'s side, spreading several edges in the order of their other ends. */
	const portY = (item: string, e: FlowEdgeSpec, side: 'in' | 'out', col: number) => {
		const box = boxes.get(item)!;
		const otherCol = side === 'out' ? col + 1 : col - 1;
		const forward = [...((side === 'out' ? outgoing : incoming).get(item) ?? [])].sort(
			(a, b) => boxes.get(hop(a, otherCol))!.y - boxes.get(hop(b, otherCol))!.y || a.order - b.order
		);
		// Back edges leave below the forward ones (outermost lane on top) and enter above them.
		const back = [...((side === 'out' ? backOut : backIn).get(item) ?? [])].sort(
			(a, b) => lane.get(b)! - lane.get(a)!
		);
		const list: FlowEdgeSpec[] = side === 'out' ? [...forward, ...back] : [...back, ...forward];
		return box.y + (box.height * (list.indexOf(e) + 1)) / (list.length + 1);
	};

	const flowEdges = edges.map((e): FlowEdge => {
		let x = boxes.get(e.from)!.x + G.nodeWidth;
		let y = portY(e.from, e, 'out', e.fromCol);
		const parts = [`M${round(x)} ${round(y)}`];
		for (let col = e.fromCol + 1; col <= e.toCol; col++) {
			const item = hop(e, col);
			const box = boxes.get(item)!;
			const ny = col === e.toCol ? portY(item, e, 'in', col) : box.y + box.height / 2;
			const half = G.columnGap / 2;
			parts.push(
				`C${round(x + half)} ${round(y)} ${round(box.x - half)} ${round(ny)} ${round(box.x)} ${round(ny)}`
			);
			x = box.x;
			y = ny;
			if (col < e.toCol) {
				x += G.nodeWidth;
				parts.push(`L${round(x)} ${round(y)}`);
			}
		}
		return {
			id: e.id,
			from: e.from,
			to: e.to,
			quantity: e.quantity,
			material: e.material,
			path: parts.join(' '),
			labelX: round(x - 6),
			labelY: round(y - 4)
		};
	});

	const lanesTop = G.padding + innerHeight + G.rowGap + BACK_LANE;
	const backEdges = backs.map((e, i): FlowEdge => {
		const from = nodes.get(e.from)!;
		const sx = boxes.get(e.from)!.x + G.nodeWidth;
		const sy = portY(e.from, e, 'out', from.column);
		const tx = boxes.get(e.to)!.x;
		const ty = portY(e.to, e, 'in', nodes.get(e.to)!.column);
		const vx = sx + BACK_FIRST + BACK_STEP * (i % BACK_PER_GAP);
		const ly = lanesTop + BACK_LANE * i;
		const lx = tx - BACK_FIRST - BACK_STEP * i;
		return {
			id: e.id,
			from: e.from,
			to: e.to,
			quantity: e.quantity,
			material: e.material,
			path: `M${round(sx)} ${round(sy)} H${round(vx)} V${round(ly)} H${round(lx)} V${round(ty)} H${round(tx)}`,
			labelX: round(vx - 6),
			labelY: round(ly - 4)
		};
	});

	const flowNodes = columnItems.flatMap((items) =>
		items.flatMap((item) => {
			const node = nodes.get(item);
			if (!node) return [];
			const box = boxes.get(item)!;
			return [{ ...node, x: round(box.x), y: round(box.y), width: G.nodeWidth, height: box.height }];
		})
	);

	const lanesHeight = backCount > 0 ? G.rowGap + BACK_LANE * backCount + 4 : 0;
	return {
		width: G.padding * 2 + leftMargin + rightMargin + columns * G.nodeWidth + (columns - 1) * G.columnGap,
		height: Math.ceil(G.padding * 2 + innerHeight + lanesHeight),
		columns,
		nodes: flowNodes,
		edges: flowEdges,
		backEdges
	};
}

/**
 * Material flow of a reaction: bought materials on the left (fuel blocks first), every reaction in the
 * column of its build step (`ChainNode.step`), the final product on the right. A material bought by several
 * jobs appears once with one edge per consumer. In one line (single slot) a reprocessing byproduct runs
 * from the unrefined job to the later job using it. In a steady cycle of optimal slots every job uses the
 * previous cycle's byproducts (its own included), so, as in the planner, the byproduct joins the material
 * node on the left (`reused`) and a back edge runs from the unrefined job to it.
 */
export function layoutChainFlow(root: ChainNode, fuel: ReadonlySet<number> = new Set()): FlowLayout {
	const nodes = new Map<string, FlowNodeSpec>();
	const edges = new Map<string, FlowEdgeSpec>();
	const backEdges = new Map<string, FlowEdgeSpec>();
	const steady = root.runsPerSlot !== undefined;
	const unrefinedJobs = new Map<number, string>();
	const index = (node: ChainNode, path: string) => {
		if (node.reprocess) unrefinedJobs.set(node.blueprintTypeId, `job:${path}`);
		node.children.forEach((child, i) => index(child, `${path}.${i}`));
	};
	index(root, '0');

	const visit = (node: ChainNode, path: string) => {
		node.children.forEach((child, i) => visit(child, `${path}.${i}`));
		const id = `job:${path}`;
		nodes.set(id, {
			id,
			kind: path === '0' ? 'final' : 'intermediate',
			typeId: node.productTypeId,
			name: node.name,
			lines: wrapName(node.name),
			quantity: node.quantityProduced,
			reused: null,
			runs: node.runs,
			slots: node.runsPerSlot?.length ?? null,
			reprocessedInto: node.reprocess
				? (node.reprocess.outputs.find((o) => o.typeId === node.reprocess!.typeId)?.name ?? null)
				: null,
			unpriced: false,
			column: node.step
		});
		node.materials.forEach((m, order) => {
			let from: string;
			if (m.source === 'chain') {
				const child = node.children.findIndex((c) => (c.reprocess?.typeId ?? c.productTypeId) === m.typeId);
				from = `job:${path}.${child}`;
			} else if (m.source === 'byproduct' && !steady) {
				from = unrefinedJobs.get(m.blueprintTypeId)!;
			} else {
				from = `buy:${m.typeId}`;
				const reused = m.source === 'byproduct' ? m.quantity : 0;
				const unpriced = m.source === 'buy' && m.unitPrice === null;
				const material = nodes.get(from);
				if (material) {
					material.quantity += m.quantity;
					material.reused! += reused;
					material.unpriced ||= unpriced;
				} else {
					nodes.set(from, {
						id: from,
						kind: 'bought',
						typeId: m.typeId,
						name: m.name,
						lines: wrapName(m.name),
						quantity: m.quantity,
						reused,
						runs: null,
						slots: null,
						reprocessedInto: null,
						unpriced,
						column: 0
					});
				}
				if (m.source === 'byproduct') {
					const producer = unrefinedJobs.get(m.blueprintTypeId)!;
					const back = backEdges.get(`${producer}>${from}`);
					if (back) back.quantity += m.quantity;
					else
						backEdges.set(`${producer}>${from}`, {
							id: `${producer}>${from}`,
							from: producer,
							to: from,
							quantity: m.quantity,
							material: m.name,
							order: 0
						});
				}
			}
			// A purchase partly covered by reuse is two rows of one material: one edge.
			const edge = edges.get(`${from}>${id}`);
			if (edge) edge.quantity += m.quantity;
			else
				edges.set(`${from}>${id}`, {
					id: `${from}>${id}#${order}`,
					from,
					to: id,
					quantity: m.quantity,
					material: m.name,
					order
				});
		});
	};
	visit(root, '0');
	for (const n of nodes.values()) if (n.reused !== null && n.reused === n.quantity) n.kind = 'byproduct';
	return layoutFlow({
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		backEdges: [...backEdges.values()],
		top: new Set([...nodes.values()].filter((n) => n.column === 0 && fuel.has(n.typeId)).map((n) => n.id))
	});
}
