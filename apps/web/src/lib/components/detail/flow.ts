import type { ChainNode } from '@reactions/engine';

export type FlowNodeKind = 'bought' | 'byproduct' | 'intermediate' | 'final';

export interface FlowNode {
	/**
	 * `buy:<typeId>` for bought materials, `byproduct:<typeId>` for reprocessing byproducts the chain uses,
	 * `job:<tree path>` for reactions (`job:0` = final product).
	 */
	id: string;
	kind: FlowNodeKind;
	typeId: number;
	name: string;
	/** Name wrapped to at most two lines. */
	lines: string[];
	/** Bought / byproduct: total over every job; produced: quantity the job produces. */
	quantity: number;
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
	/** Quantity the consuming job uses. */
	quantity: number;
	/** Material carried (an unrefined job's edges: what its reprocessing yields). */
	material: string;
	/** SVG path from the source's right side to the consumer's left side. */
	path: string;
	/** Label anchor (right-aligned) just above the edge where it enters the consumer. */
	labelX: number;
	labelY: number;
}

export interface FlowLayout {
	width: number;
	height: number;
	columns: number;
	nodes: FlowNode[];
	edges: FlowEdge[];
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

interface PendingEdge {
	id: string;
	from: string;
	to: string;
	quantity: number;
	material: string;
	/** Material index in the consumer (keeps sibling inputs in blueprint order). */
	order: number;
	fromCol: number;
	toCol: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Column layout of a reaction's material flow: bought materials on the left, every reaction in the
 * column of its build step (`ChainNode.step`), the final product on the right. A material bought by
 * several jobs appears once with one edge per consumer. A reprocessing byproduct runs from the
 * unrefined job to the later job using it; in a steady cycle of optimal slots, where a job may use the
 * previous cycle's byproducts (its own included), it starts at a byproduct node on the left instead.
 * Edges that skip columns run through a reserved lane in each crossed column, so they never pass under
 * a node.
 */
export function layoutChainFlow(root: ChainNode): FlowLayout {
	const nodes = new Map<string, Omit<FlowNode, 'x' | 'y' | 'width' | 'height'>>();
	const edges: PendingEdge[] = [];
	const unrefinedJobs = new Map<number, { id: string; column: number }>();
	const index = (node: ChainNode, path: string) => {
		if (node.reprocess) unrefinedJobs.set(node.blueprintTypeId, { id: `job:${path}`, column: node.step });
		node.children.forEach((child, i) => index(child, `${path}.${i}`));
	};
	index(root, '0');

	const visit = (node: ChainNode, path: string) => {
		node.children.forEach((child, i) => visit(child, `${path}.${i}`));
		const column = node.step;
		const id = `job:${path}`;
		nodes.set(id, {
			id,
			kind: path === '0' ? 'final' : 'intermediate',
			typeId: node.productTypeId,
			name: node.name,
			lines: wrapName(node.name),
			quantity: node.quantityProduced,
			runs: node.runs,
			slots: node.runsPerSlot?.length ?? null,
			reprocessedInto: node.reprocess
				? (node.reprocess.outputs.find((o) => o.typeId === node.reprocess!.typeId)?.name ?? null)
				: null,
			unpriced: false,
			column
		});
		node.materials.forEach((m, order) => {
			let from: string;
			let fromCol = 0;
			const producer = m.source === 'byproduct' ? unrefinedJobs.get(m.blueprintTypeId) : undefined;
			if (m.source === 'chain') {
				const child = node.children.findIndex((c) => (c.reprocess?.typeId ?? c.productTypeId) === m.typeId);
				from = `job:${path}.${child}`;
				fromCol = node.children[child].step;
			} else if (producer && producer.column < column) {
				from = producer.id;
				fromCol = producer.column;
			} else {
				from = `${m.source}:${m.typeId}`;
				const unpriced = m.source === 'buy' && m.unitPrice === null;
				const source = nodes.get(from);
				if (source) {
					source.quantity += m.quantity;
					source.unpriced ||= unpriced;
				} else {
					nodes.set(from, {
						id: from,
						kind: m.source === 'buy' ? 'bought' : 'byproduct',
						typeId: m.typeId,
						name: m.name,
						lines: wrapName(m.name),
						quantity: m.quantity,
						runs: null,
						slots: null,
						reprocessedInto: null,
						unpriced,
						column: 0
					});
				}
			}
			edges.push({
				id: `${from}>${id}#${order}`,
				from,
				to: id,
				quantity: m.quantity,
				material: m.name,
				order,
				fromCol,
				toCol: column
			});
		});
	};
	visit(root, '0');
	const lastColumn = root.step;
	const columns = lastColumn + 1;

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

	// Order each column by where its edges lead (right to left), siblings in blueprint order.
	const rank = new Map<string, number>([['job:0', 0]]);
	for (let col = lastColumn - 1; col >= 0; col--) {
		const key = (item: string) => {
			const outs = outgoing.get(item) ?? [];
			return outs.reduce((a, e) => a + rank.get(hop(e, col + 1))! + e.order / 1000, 0) / outs.length;
		};
		const keys = new Map(columnItems[col].map((item) => [item, key(item)]));
		columnItems[col].sort((a, b) => keys.get(a)! - keys.get(b)! || a.localeCompare(b));
		columnItems[col].forEach((item, i) => rank.set(item, i));
	}

	const heightOf = (item: string) => {
		const node = nodes.get(item);
		if (!node) return G.laneHeight;
		const ports = Math.max(outgoing.get(item)?.length ?? 0, incoming.get(item)?.length ?? 0);
		return Math.max(G.nodeHeight[node.lines.length - 1], ports * G.portSpacing + 8);
	};
	const columnHeight = (items: string[]) =>
		items.reduce((a, item) => a + heightOf(item), 0) + Math.max(0, items.length - 1) * G.rowGap;
	const innerHeight = Math.max(...columnItems.map(columnHeight));

	const boxes = new Map<string, { x: number; y: number; height: number }>();
	columnItems.forEach((items, col) => {
		let y = G.padding + (innerHeight - columnHeight(items)) / 2;
		const x = G.padding + col * (G.nodeWidth + G.columnGap);
		for (const item of items) {
			const height = heightOf(item);
			boxes.set(item, { x, y, height });
			y += height + G.rowGap;
		}
	});

	/** Port y of `e` on `item`'s side, spreading several edges in the order of their other ends. */
	const portY = (item: string, e: PendingEdge, side: 'in' | 'out', col: number) => {
		const box = boxes.get(item)!;
		const list = (side === 'out' ? outgoing : incoming).get(item) ?? [e];
		const otherCol = side === 'out' ? col + 1 : col - 1;
		const sorted = [...list].sort(
			(a, b) => boxes.get(hop(a, otherCol))!.y - boxes.get(hop(b, otherCol))!.y || a.order - b.order
		);
		return box.y + (box.height * (sorted.indexOf(e) + 1)) / (sorted.length + 1);
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

	const flowNodes = columnItems.flatMap((items) =>
		items.flatMap((item) => {
			const node = nodes.get(item);
			if (!node) return [];
			const box = boxes.get(item)!;
			return [{ ...node, x: round(box.x), y: round(box.y), width: G.nodeWidth, height: box.height }];
		})
	);

	return {
		width: G.padding * 2 + columns * G.nodeWidth + (columns - 1) * G.columnGap,
		height: Math.ceil(G.padding * 2 + innerHeight),
		columns,
		nodes: flowNodes,
		edges: flowEdges
	};
}
