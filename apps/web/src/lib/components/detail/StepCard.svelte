<script lang="ts">
	import type { ChainReprocess, ReprocessedOutput } from '@reactions/engine';
	import {
		formatDuration,
		formatIsk,
		formatIskFull,
		formatNumber,
		formatPct,
		formatRunsPerSlot,
		runsPerSlotTitle
	} from '$lib/format';
	import { typeIconUrl } from '$lib/site';
	import LineItemsTable from './LineItemsTable.svelte';
	import type { ProductionStep } from './steps';

	interface Props {
		step: ProductionStep;
		/** Number of steps on the page. */
		count: number;
		/** Show the units listed at the input hub in the purchase table. */
		available?: boolean;
		/** Hub id → name for split purchases. */
		markets?: Record<string, string>;
	}

	let { step, count, available = false, markets = {} }: Props = $props();
	const anchor = $derived(`step-${step.number}`);
	const kind = $derived(
		count === 1
			? 'single reaction'
			: step.number === count
				? 'final product'
				: step.jobs.length === 1
					? 'intermediate'
					: `${step.jobs.length} intermediates in parallel`
	);
	const showSurplus = $derived(step.jobs.some(({ node }) => node.surplus > 0));
	/** Optimal slots: jobs are split across slots, so runs and duration are per slot. */
	const slotted = $derived(step.jobs.some(({ node }) => node.runsPerSlot !== undefined));
	/** Job cost components; rates only when every job of the step shares them. */
	const jobParts = $derived.by(() => {
		const r = step.jobRates;
		return [
			{
				key: 'systemCost',
				label: 'system',
				value: step.jobCost.systemCost,
				pct: r ? r.costIndex * 100 : null
			},
			{
				key: 'facilityTax',
				label: 'facility tax',
				value: step.jobCost.facilityTax,
				pct: r ? r.facilityTaxPct : null
			},
			{ key: 'scc', label: 'SCC', value: step.jobCost.scc, pct: r ? r.sccPct : null }
		];
	});
	/** Where a reprocessed material goes: the replaced one to its consumer, byproducts to purchases or sale. */
	const outputNote = (rp: ChainReprocess, o: ReprocessedOutput) =>
		o.typeId === rp.typeId
			? `${formatNumber(o.used)} used${rp.surplus > 0 ? `, ${formatNumber(rp.surplus)} surplus` : ''}`
			: [
					o.used > 0 ? `${formatNumber(o.used)} replace purchases` : '',
					o.sold > 0 ? `${formatNumber(o.sold)} sold` : ''
				]
					.filter(Boolean)
					.join(', ');
	const th = 'px-3 py-1.5 text-right whitespace-nowrap';
	const td = 'px-3 py-1 text-right tabular-nums whitespace-nowrap';
</script>

<article
	id={anchor}
	class="scroll-mt-16 space-y-2 rounded-lg bg-white p-3 text-sm dark:bg-gray-700"
	aria-labelledby="{anchor}-title"
	data-step={step.number}
>
	<h3 id="{anchor}-title" class="font-semibold text-gray-800 dark:text-gray-200">
		Step {step.number}{count > 1 ? ` of ${count}` : ''}
		<span class="font-normal text-gray-500 dark:text-gray-400">· {kind}</span>
	</h3>

	<div class="overflow-x-auto">
		<table
			class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<caption class="sr-only">Reaction jobs of step {step.number}</caption>
			<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
				<tr>
					<th scope="col" class="px-3 py-1.5">Job</th>
					{#if slotted}
						<th scope="col" class={th}>Slots</th>
					{/if}
					<th scope="col" class={th}>{slotted ? 'Runs / slot' : 'Runs'}</th>
					<th scope="col" class={th}>Per run</th>
					<th scope="col" class={th}>{slotted ? 'Duration / slot' : 'Duration'}</th>
					<th scope="col" class={th}>Produced</th>
					<th scope="col" class={th}>Used</th>
					{#if showSurplus}
						<th scope="col" class={th}>Surplus</th>
					{/if}
					<th scope="col" class={th}>Job cost</th>
				</tr>
			</thead>
			<tbody>
				{#each step.jobs as { id, node } (id)}
					{@const slotRuns = node.runsPerSlot ?? [node.runs]}
					<tr
						class="border-t border-gray-200 text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
						data-job={id}
					>
						<td class="px-3 py-1">
							<span class="flex items-center gap-2 font-medium whitespace-nowrap">
								<img
									src={typeIconUrl(node.productTypeId)}
									alt=""
									width="20"
									height="20"
									loading="lazy"
									class="h-5 w-5 rounded"
								/>
								<span data-field="name">{node.name}</span>
							</span>
						</td>
						{#if slotted}
							<td class={td} data-field="slots">{formatNumber(slotRuns.length)}</td>
						{/if}
						<td class={td} title={slotted ? runsPerSlotTitle(slotRuns) : undefined} data-field="runs"
							>{slotted ? formatRunsPerSlot(slotRuns) : formatNumber(node.runs)}</td
						>
						<td class={td} title="{formatNumber(node.runTimeSeconds, 1)} s per run" data-field="runTime"
							>{formatDuration(node.runTimeSeconds)}</td
						>
						<td
							class={td}
							title="{formatNumber(Math.max(...slotRuns))} runs × {formatDuration(node.runTimeSeconds)}"
							data-field="duration">{formatDuration(Math.max(...slotRuns) * node.runTimeSeconds)}</td
						>
						<td class={td} data-field="produced">{formatNumber(node.quantityProduced)}</td>
						<td class={td} data-field="used">{formatNumber(node.quantityUsed)}</td>
						{#if showSurplus}
							<td
								class="{td} {node.surplus > 0 ? 'text-amber-600 dark:text-amber-400' : ''}"
								data-field="surplus">{node.surplus > 0 ? formatNumber(node.surplus) : ''}</td
							>
						{/if}
						<td class={td} title={formatIskFull(node.jobCost.total)} data-field="jobCost"
							>{formatIsk(node.jobCost.total)}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#each step.jobs as { id, node } (id)}
		{#if node.reprocess}
			{@const rp = node.reprocess}
			<p class="text-gray-600 dark:text-gray-300" data-reprocess={id}>
				<span class="font-medium text-gray-800 dark:text-gray-200">{node.name}</span>
				replaces the {rp.replacesName} reaction: {formatNumber(node.quantityProduced)} units reprocessed at
				{rp.yieldPct}% yield give
				{#each rp.outputs.filter((o) => o.quantity > 0) as o, i (o.typeId)}
					{i > 0 ? ', ' : ''}<span data-reprocess-output={o.typeId}
						><span class="font-medium text-gray-800 tabular-nums dark:text-gray-200"
							>{formatNumber(o.quantity)} {o.name}</span
						>
						({outputNote(rp, o)})</span
					>
				{/each}.
			</p>
		{/if}
	{/each}

	{#if step.intermediates.length > 0}
		<p class="text-gray-600 dark:text-gray-300" data-intermediates>
			Uses
			{#each step.intermediates as m, i (`${m.byproduct}:${m.typeId}`)}
				{i > 0 ? ' ' : ''}<span data-intermediate={m.typeId} data-byproduct={m.byproduct ? '' : undefined}
					><span class="font-medium text-gray-800 tabular-nums dark:text-gray-200"
						>{formatNumber(m.quantity)} {m.name}</span
					>
					{m.byproduct
						? m.step >= step.number
							? "from the previous cycle's reprocessing in"
							: 'reprocessed in'
						: 'from'}
					<a href="#step-{m.step}" class="text-primary-700 dark:text-primary-400 hover:underline"
						>step {m.step}</a
					>{i < step.intermediates.length - 1 ? ',' : '.'}</span
				>
			{/each}
		</p>
	{/if}

	{#if step.purchases.length > 0}
		<LineItemsTable
			title="Buy for step {step.number}"
			items={step.purchases}
			feesLabel="Broker fee"
			volume={false}
			level={4}
			{available}
			{markets}
		/>
	{/if}

	<div
		class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-gray-200 pt-2 text-gray-600 dark:border-gray-600 dark:text-gray-300"
	>
		<p data-step-job-cost>
			Job cost
			<strong class="text-gray-800 tabular-nums dark:text-gray-200" title={formatIskFull(step.jobCost.total)}
				>{formatIsk(step.jobCost.total)}</strong
			>
			=
			{#each jobParts as part, i (part.key)}
				<span class="tabular-nums" title={formatIskFull(part.value)} data-cost={part.key}
					>{i > 0 ? ' + ' : ''}{part.label}
					{formatIsk(part.value)}{part.pct === null ? '' : ` (${formatPct(part.pct, 2)})`}</span
				>
			{/each}
		</p>
		<p>
			Step subtotal
			<strong
				class="text-gray-900 tabular-nums dark:text-white"
				title="{formatIskFull(
					step.unpriced ? null : step.subtotal.total
				)}: purchases, broker fees, shipping and job cost"
				data-step-subtotal>{formatIsk(step.unpriced ? null : step.subtotal.total)}</strong
			>
		</p>
	</div>
</article>
