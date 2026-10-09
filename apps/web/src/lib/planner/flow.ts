import type { PlanResult } from '@reactions/engine';
import {
	layoutFlow,
	wrapName,
	type FlowEdgeSpec,
	type FlowLayout,
	type FlowNodeSpec
} from '$lib/components/detail/flow';

/**
 * Material flow of one steady cycle of a plan: every bought material on the left (fuel blocks first), every
 * reaction in the column of its depth (the targets last), one edge per material a reaction consumes, and
 * a back edge from each unrefined job to the bought material its reprocessing byproduct replaces next cycle.
 */
export function layoutPlanFlow(
	plan: Pick<PlanResult, 'reactions' | 'maxDepth' | 'purchasesPerCycle'>,
	fuel: ReadonlySet<number> = new Set()
): FlowLayout {
	const nodes = new Map<string, FlowNodeSpec>();
	const edges: FlowEdgeSpec[] = [];
	const backEdges: FlowEdgeSpec[] = [];
	const job = (blueprintTypeId: number) => `job:${blueprintTypeId}`;
	const unpriced = new Set(plan.purchasesPerCycle.filter((p) => p.unitPrice === null).map((p) => p.typeId));

	// Targets (depth 0) first: the last column keeps this order.
	for (const r of [...plan.reactions].sort((a, b) => a.depth - b.depth)) {
		nodes.set(job(r.blueprintTypeId), {
			id: job(r.blueprintTypeId),
			kind: r.depth === 0 ? 'final' : 'intermediate',
			typeId: r.product.typeId,
			name: r.name,
			lines: wrapName(r.name),
			quantity: r.product.quantity,
			reused: null,
			runs: r.totalRuns,
			slots: r.slots,
			reprocessedInto: r.reprocess ? r.reprocess.replaces.map((x) => x.name).join(', ') : null,
			unpriced: false,
			column: plan.maxDepth - r.depth + 1
		});
	}
	for (const r of plan.reactions) {
		r.materials.forEach((m, order) => {
			const from = m.producer === null ? `buy:${m.typeId}` : job(m.producer);
			if (m.producer === null) {
				const bought = nodes.get(from);
				if (bought) bought.quantity += m.quantity;
				else
					nodes.set(from, {
						id: from,
						kind: 'bought',
						typeId: m.typeId,
						name: m.name,
						lines: wrapName(m.name),
						quantity: m.quantity,
						reused: 0,
						runs: null,
						slots: null,
						reprocessedInto: null,
						unpriced: unpriced.has(m.typeId),
						column: 0
					});
			}
			edges.push({
				id: `${from}>${job(r.blueprintTypeId)}#${order}`,
				from,
				to: job(r.blueprintTypeId),
				quantity: m.quantity,
				material: m.name,
				order
			});
		});
	}
	for (const r of plan.reactions)
		for (const b of r.reprocess?.byproducts ?? []) {
			const material = nodes.get(`buy:${b.typeId}`);
			if (b.used === 0 || !material) continue;
			material.reused! += b.used;
			// Covered in full by the previous cycle's reprocessing: nothing of it is bought.
			if (material.reused === material.quantity) material.kind = 'byproduct';
			backEdges.push({
				id: `${job(r.blueprintTypeId)}>${material.id}`,
				from: job(r.blueprintTypeId),
				to: material.id,
				quantity: b.used,
				material: b.name,
				order: 0
			});
		}
	return layoutFlow({
		nodes: [...nodes.values()],
		edges,
		backEdges,
		top: new Set([...nodes.values()].filter((n) => n.column === 0 && fuel.has(n.typeId)).map((n) => n.id))
	});
}
