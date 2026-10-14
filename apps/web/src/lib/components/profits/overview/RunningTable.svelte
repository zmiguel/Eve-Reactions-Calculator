<script lang="ts">
	import JobStatusPill from '$lib/components/jobs/JobStatusPill.svelte';
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import { formatNumber } from '$lib/format';
	import type { Paged } from '$lib/paging';
	import type { RunningTableRow } from '$lib/profits/types';
	import { blueprintIconUrl } from '$lib/site';

	let { data, now }: { data: Paged<RunningTableRow>; now: number } = $props();

	const TODAY =
		"The output at today's market price with your calculator settings, after the fees of selling it.";
	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'mt-0.5 block text-xs text-gray-500 dark:text-gray-400';
	const link = 'font-medium text-primary-700 hover:underline dark:text-primary-400';
</script>

<PagedTable {data} param="running" endpoint="/profits/data/running" label="Running jobs" noun="jobs">
	{#snippet head()}
		<tr>
			<th class={cell}>Reaction</th>
			<th class="{cell} text-right">Runs</th>
			<th class={cell}>Owner</th>
			<th class={cell}>Progress</th>
			<th class="{cell} text-right">Output value today</th>
		</tr>
	{/snippet}
	{#snippet row(j: RunningTableRow)}
		<tr class="border-t border-gray-200 dark:border-gray-700" data-running={j.jobId}>
			<td class={cell}>
				<a href="/profits/jobs/{j.jobId}" class="inline-flex items-center gap-2 {link}">
					<img
						src={blueprintIconUrl(j.blueprintTypeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					<span>{j.name}</span>
				</a>
				{#if j.output}
					<span class={muted}>Makes {formatNumber(j.output.quantity)} {j.output.name}</span>
				{/if}
			</td>
			<td class={num}>{formatNumber(j.runs)}</td>
			<td class={cell}>{j.owner}</td>
			<td class={cell}>
				<JobStatusPill status="running" startDate={j.startDate} endDate={j.endDate} {now} />
			</td>
			<td class={num}>
				<Isk value={j.outputValue} estimated={TODAY} missing="No market price today with your settings." />
			</td>
		</tr>
	{/snippet}
	{#snippet empty()}
		<p class="text-sm text-gray-500 dark:text-gray-400" data-empty>
			No job is running right now. Jobs show here after the next sync once you start them in game.
		</p>
	{/snippet}
</PagedTable>
