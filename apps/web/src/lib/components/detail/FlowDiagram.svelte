<script lang="ts">
	import { formatNumber } from '$lib/format';
	import { typeIconUrl } from '$lib/site';
	import type { FlowLayout, FlowNode, FlowNodeKind } from './flow';

	interface Props {
		layout: FlowLayout;
		/** Accessible title, e.g. "Material flow for Titanium Carbide". */
		title: string;
		/** A reaction's chain (reaction page) or a whole plan's steady cycle (planner): sets the wording. */
		scope: 'chain' | 'plan';
	}

	let { layout, title, scope }: Props = $props();
	const uid = $props.id();
	const names = $derived(Object.fromEntries(layout.nodes.map((n) => [n.id, n.name])));
	const boughtCount = $derived(layout.nodes.filter((n) => n.kind === 'bought').length);
	const jobCount = $derived(
		layout.nodes.filter((n) => n.kind === 'intermediate' || n.kind === 'final').length
	);
	const finals = $derived(
		layout.nodes
			.filter((n) => n.kind === 'final')
			.map((n) => n.name)
			.join(', ')
	);
	const hasByproducts = $derived(layout.nodes.some((n) => n.kind === 'byproduct'));
	const made = $derived(scope === 'plan' ? 'Made in the plan' : 'Produced in the chain');

	const boxClass: Record<FlowNodeKind, string> = {
		bought: 'fill-gray-50 stroke-gray-400 dark:fill-gray-800 dark:stroke-gray-500',
		byproduct: 'fill-emerald-50 stroke-emerald-500 dark:fill-gray-800 dark:stroke-emerald-400',
		intermediate: 'fill-primary-50 stroke-primary-500 dark:fill-primary-900 dark:stroke-primary-400',
		final: 'fill-primary-100 stroke-primary-600 dark:fill-primary-800 dark:stroke-primary-300'
	};
	const LINE = 15;
	const QTY_LINE = 14;
	const detail = (n: FlowNode) => {
		if (n.reused !== null) {
			const bought = n.quantity - n.reused;
			if (n.reused === 0) return `${formatNumber(n.quantity)} bought`;
			if (bought === 0) return `${formatNumber(n.reused)} reused`;
			return `${formatNumber(bought)} bought · ${formatNumber(n.reused)} reused`;
		}
		const slots = n.slots && n.slots > 1 ? ` in ${n.slots} slots` : '';
		return n.reprocessedInto
			? `${formatNumber(n.runs)} runs${slots}, reprocessed`
			: `${formatNumber(n.quantity)} · ${formatNumber(n.runs)} runs${slots}`;
	};
	const role = (n: FlowNode) => {
		const where = scope === 'plan' ? 'made in the plan' : 'produced in the chain';
		if (n.kind === 'final') return scope === 'plan' ? ' (target product)' : ' (final product)';
		if (n.reused !== null && n.reused > 0)
			return " (partly or fully the previous cycle's reprocessing byproducts, used instead of buying them)";
		if (n.reprocessedInto) return ` into ${n.reprocessedInto} (${where})`;
		if (n.kind === 'intermediate') return ` (${where})`;
		return n.unpriced ? ' (no market price)' : '';
	};
	const textTop = (n: FlowNode) => n.y + (n.height - (n.lines.length * LINE + QTY_LINE)) / 2;
</script>

<figure class="space-y-2" data-chain-flow>
	<div class="overflow-x-auto rounded-lg bg-white p-2 dark:bg-gray-700">
		<svg
			width={layout.width}
			height={layout.height}
			viewBox="0 0 {layout.width} {layout.height}"
			role="img"
			aria-labelledby="{uid}-title {uid}-desc"
			class="block max-w-none"
			font-family="inherit"
		>
			<title id="{uid}-title">{title}</title>
			<desc id="{uid}-desc">
				{boughtCount} bought materials feed {jobCount} reaction jobs ending in {finals}.{layout.backEdges
					.length > 0
					? ` ${layout.backEdges.length} reprocessing byproducts go back to replace purchases in the next cycle.`
					: ''}
			</desc>
			<defs>
				<marker
					id="{uid}-arrow"
					viewBox="0 0 8 8"
					refX="7"
					refY="4"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0 0 L8 4 L0 8 z" class="fill-gray-400 dark:fill-gray-500" />
				</marker>
				<marker
					id="{uid}-back"
					viewBox="0 0 8 8"
					refX="7"
					refY="4"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0 0 L8 4 L0 8 z" class="fill-emerald-500 dark:fill-emerald-400" />
				</marker>
			</defs>
			{#each layout.edges as edge (edge.id)}
				<g data-flow-edge={edge.id} data-from={edge.from} data-to={edge.to}>
					<title>{`${formatNumber(edge.quantity)} ${edge.material} → ${names[edge.to]}`}</title>
					<path
						d={edge.path}
						fill="none"
						stroke-width="1.5"
						marker-end="url(#{uid}-arrow)"
						class="stroke-gray-400 dark:stroke-gray-500"
					/>
					<text
						x={edge.labelX}
						y={edge.labelY}
						text-anchor="end"
						font-size="11"
						stroke-width="3"
						paint-order="stroke"
						class="fill-gray-700 stroke-white tabular-nums dark:fill-gray-200 dark:stroke-gray-700"
						data-edge-label>{formatNumber(edge.quantity)}</text
					>
				</g>
			{/each}
			{#each layout.backEdges as edge (edge.id)}
				<g data-flow-back-edge={edge.id} data-from={edge.from} data-to={edge.to}>
					<title
						>{`${formatNumber(edge.quantity)} ${edge.material} from reprocessing ${names[edge.from]}, used next cycle instead of buying it`}</title
					>
					<path
						d={edge.path}
						fill="none"
						stroke-width="1.5"
						stroke-dasharray="5 3"
						stroke-linejoin="round"
						marker-end="url(#{uid}-back)"
						class="stroke-emerald-500 dark:stroke-emerald-400"
					/>
					<text
						x={edge.labelX}
						y={edge.labelY}
						text-anchor="end"
						font-size="11"
						stroke-width="3"
						paint-order="stroke"
						class="fill-emerald-700 stroke-white tabular-nums dark:fill-emerald-300 dark:stroke-gray-700"
						data-edge-label>{formatNumber(edge.quantity)} {edge.material} reused next cycle</text
					>
				</g>
			{/each}
			{#each layout.nodes as node (node.id)}
				<g data-flow-node={node.id} data-kind={node.kind}>
					<title>{node.name}: {detail(node)}{role(node)}</title>
					<rect
						x={node.x}
						y={node.y}
						width={node.width}
						height={node.height}
						rx="6"
						stroke-width={node.kind === 'final' ? 2 : 1}
						stroke-dasharray={node.kind === 'bought' || node.kind === 'byproduct' ? '4 3' : undefined}
						class={node.unpriced
							? 'fill-amber-50 stroke-amber-500 dark:fill-gray-800 dark:stroke-amber-400'
							: boxClass[node.kind]}
					/>
					<image
						href={typeIconUrl(node.typeId, 32)}
						x={node.x + 8}
						y={node.y + (node.height - 32) / 2}
						width="32"
						height="32"
					/>
					{#each node.lines as line, i (i)}
						<text
							x={node.x + 48}
							y={textTop(node) + 12 + i * LINE}
							font-size="12"
							font-weight="600"
							class="fill-gray-900 dark:fill-gray-100"
							data-node-name>{line}</text
						>
					{/each}
					<text
						x={node.x + 48}
						y={textTop(node) + node.lines.length * LINE + 11}
						font-size="11"
						class="tabular-nums {node.unpriced
							? 'fill-amber-700 dark:fill-amber-300'
							: 'fill-gray-600 dark:fill-gray-300'}"
						data-node-detail>{detail(node)}{node.unpriced ? ' · no price' : ''}</text
					>
				</g>
			{/each}
		</svg>
	</div>
	<figcaption class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
		<span class="flex items-center gap-1.5">
			<span class="h-3 w-5 rounded-sm border border-dashed border-gray-400 bg-gray-50 dark:bg-gray-800"
			></span>
			Bought
		</span>
		{#if hasByproducts}
			<span class="flex items-center gap-1.5">
				<span
					class="h-3 w-5 rounded-sm border border-dashed border-emerald-500 bg-emerald-50 dark:bg-gray-800"
				></span>
				Covered in full by last cycle's reprocessing
			</span>
		{/if}
		{#if layout.columns > 2}
			<span class="flex items-center gap-1.5">
				<span class="bg-primary-50 border-primary-500 dark:bg-primary-900 h-3 w-5 rounded-sm border"></span>
				{made}
			</span>
		{/if}
		<span class="flex items-center gap-1.5">
			<span class="bg-primary-100 border-primary-600 dark:bg-primary-800 h-3 w-5 rounded-sm border-2"></span>
			{scope === 'plan' ? 'Target product' : 'Final product'}
		</span>
		{#if layout.backEdges.length > 0}
			<span class="flex items-center gap-1.5">
				<svg width="20" height="6" aria-hidden="true"
					><line
						x1="0"
						y1="3"
						x2="20"
						y2="3"
						stroke-width="1.5"
						stroke-dasharray="5 3"
						class="stroke-emerald-500 dark:stroke-emerald-400"
					/></svg
				>
				Reprocessing byproduct reused next cycle
			</span>
		{/if}
		<span>Edge labels: quantity each job consumes{scope === 'plan' ? ' per cycle' : ''}.</span>
	</figcaption>
</figure>
