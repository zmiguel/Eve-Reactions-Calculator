<script lang="ts">
	import type { ChainAllocation } from '@reactions/engine';
	import InfoNote from '$lib/components/InfoNote.svelte';
	import { formatIsk, formatIskFull, formatNumber } from '$lib/format';
	import { lineItemsMultibuy } from '$lib/multibuy';
	import { phaseTitle, startupSummary } from '$lib/startup';
	import LineItemsTable from './LineItemsTable.svelte';
	import MultibuyButton from './MultibuyButton.svelte';

	interface Props {
		allocation: ChainAllocation;
	}

	let { allocation: a }: Props = $props();

	const reactions = $derived(new Map(a.reactions.map((r) => [r.blueprintTypeId, r])));
	const names = $derived(new Map(a.reactions.map((r) => [r.blueprintTypeId, r.name])));
	const oneTime = $derived(a.phases.filter((p) => p.label !== 'steady'));
	const steady = $derived(a.phases.at(-1)!);
	const summary = $derived(startupSummary(a.startup, names));
	const cost = (items: { total: number; fees: number; shipping: number; unitPrice: number | null }[]) =>
		items.some((i) => i.unitPrice === null)
			? null
			: items.reduce((acc, i) => acc + i.total + i.fees + i.shipping, 0);
</script>

{#if oneTime.length > 0}
	<section class="space-y-2" aria-labelledby="startup-title" data-startup>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 id="startup-title" class="text-lg font-semibold text-gray-800 dark:text-gray-200">Start-up</h2>
			<p class="text-xs text-gray-500 dark:text-gray-400">
				One-time {oneTime.length === 1 ? 'cycle' : 'cycles'} before cycle {steady.cycle}, from which every
				cycle runs the production steps below.
			</p>
		</div>
		{#if summary}
			<InfoNote name="startup-choice">{summary}</InfoNote>
		{/if}
		{#each oneTime as phase (phase.cycle)}
			{@const buy = cost(phase.purchases)}
			<article
				class="space-y-2 rounded-lg bg-white p-3 text-sm dark:bg-gray-700"
				aria-labelledby="startup-{phase.cycle}-title"
				data-startup-phase={phase.cycle}
			>
				<h3 id="startup-{phase.cycle}-title" class="font-semibold text-gray-800 dark:text-gray-200">
					{phaseTitle(phase)}
				</h3>
				<p class="text-gray-600 dark:text-gray-300" data-startup-jobs>
					Runs
					{#each phase.blueprintTypeIds as id, i (id)}
						{@const r = reactions.get(id)!}
						{i > 0 ? ', ' : ''}<span class="font-medium text-gray-800 dark:text-gray-200">{r.name}</span>
						<span class="tabular-nums"
							>({r.slots} × {[...new Set(r.runsPerSlot)].map((n) => formatNumber(n)).join(' / ')} runs)</span
						>
					{/each}.
				</p>
				<LineItemsTable
					title="Buy for {phase.label === 'step_0' ? 'step 0' : `cycle ${phase.cycle}`}"
					items={phase.purchases}
					feesLabel="Broker fee"
					volume={false}
					level={4}
					sources={false}
					emptyText="Nothing to buy: earlier reprocessing covers it."
				/>
				<MultibuyButton text={lineItemsMultibuy(phase.purchases)} />
				<p
					class="border-t border-gray-200 pt-2 text-gray-600 dark:border-gray-600 dark:text-gray-300"
					data-startup-cost
				>
					Job cost <strong
						class="text-gray-800 tabular-nums dark:text-gray-200"
						title={formatIskFull(phase.jobCost)}>{formatIsk(phase.jobCost)}</strong
					>
					· with purchases
					<strong
						class="text-gray-900 tabular-nums dark:text-white"
						title={formatIskFull(buy === null ? null : buy + phase.jobCost)}
						>{formatIsk(buy === null ? null : buy + phase.jobCost)}</strong
					>
				</p>
			</article>
		{/each}
	</section>
{/if}
