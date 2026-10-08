<script lang="ts">
	import type { ChainNode } from '@reactions/engine';
	import { formatNumber } from '$lib/format';
	import { typeIconUrl } from '$lib/site';
	import { layoutChainFlow, type FlowNode, type FlowNodeKind } from './flow';

	interface Props {
		/** Job tree: the chain, or the single reaction as one job. */
		root: ChainNode;
	}

	let { root }: Props = $props();
	const uid = $props.id();
	const layout = $derived(layoutChainFlow(root));
	const names = $derived(Object.fromEntries(layout.nodes.map((n) => [n.id, n.name])));
	const boughtCount = $derived(layout.nodes.filter((n) => n.kind === 'bought').length);
	const jobCount = $derived(
		layout.nodes.filter((n) => n.kind === 'intermediate' || n.kind === 'final').length
	);
	const hasByproducts = $derived(layout.nodes.some((n) => n.kind === 'byproduct'));

	const boxClass: Record<FlowNodeKind, string> = {
		bought: 'fill-gray-50 stroke-gray-400 dark:fill-gray-800 dark:stroke-gray-500',
		byproduct: 'fill-emerald-50 stroke-emerald-500 dark:fill-gray-800 dark:stroke-emerald-400',
		intermediate: 'fill-primary-50 stroke-primary-500 dark:fill-primary-900 dark:stroke-primary-400',
		final: 'fill-primary-100 stroke-primary-600 dark:fill-primary-800 dark:stroke-primary-300'
	};
	const LINE = 15;
	const QTY_LINE = 14;
	const detail = (n: FlowNode) => {
		if (n.kind === 'bought') return `${formatNumber(n.quantity)} bought`;
		if (n.kind === 'byproduct') return `${formatNumber(n.quantity)} from last cycle`;
		const slots = n.slots && n.slots > 1 ? ` in ${n.slots} slots` : '';
		return n.reprocessedInto
			? `${formatNumber(n.runs)} runs${slots}, reprocessed`
			: `${formatNumber(n.quantity)} · ${formatNumber(n.runs)} runs${slots}`;
	};
	const role = (n: FlowNode) => {
		if (n.kind === 'final') return ' (final product)';
		if (n.kind === 'byproduct') return " (the previous cycle's reprocessing, used instead of buying it)";
		if (n.reprocessedInto) return ` into ${n.reprocessedInto} (produced in the chain)`;
		if (n.kind === 'intermediate') return ' (produced in the chain)';
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
			<title id="{uid}-title">Material flow for {root.name}</title>
			<desc id="{uid}-desc">
				{boughtCount} bought materials feed {jobCount} reaction jobs ending in {root.name}.
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
				Reprocessing byproduct from last cycle
			</span>
		{/if}
		{#if layout.columns > 2}
			<span class="flex items-center gap-1.5">
				<span class="bg-primary-50 border-primary-500 dark:bg-primary-900 h-3 w-5 rounded-sm border"></span>
				Produced in the chain
			</span>
		{/if}
		<span class="flex items-center gap-1.5">
			<span class="bg-primary-100 border-primary-600 dark:bg-primary-800 h-3 w-5 rounded-sm border-2"></span>
			Final product
		</span>
		<span>Edge labels: quantity each job consumes.</span>
	</figcaption>
</figure>
