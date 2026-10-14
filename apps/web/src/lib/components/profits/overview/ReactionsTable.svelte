<script lang="ts">
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import { formatNumber, formatPct } from '$lib/format';
	import type { Paged } from '$lib/paging';
	import type { ProfitPeriod, ReactionTableRow } from '$lib/profits/types';
	import { blueprintIconUrl } from '$lib/site';

	let {
		data,
		period,
		defaultPeriod = '30'
	}: { data: Paged<ReactionTableRow>; period: ProfitPeriod; defaultPeriod?: ProfitPeriod } = $props();

	const UNSOLD = "Includes unsold output valued at today's market price with your settings.";
	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const link = 'font-medium text-primary-700 hover:underline dark:text-primary-400';
</script>

<PagedTable {data} param="reactions" endpoint="/profits/data/reactions" label="Reactions" noun="reactions">
	{#snippet head()}
		<tr>
			<th class={cell}>Reaction</th>
			<th class="{cell} text-right">Jobs</th>
			<th class="{cell} text-right">Runs</th>
			<th class="{cell} text-right" title="Input cost plus job cost of the jobs">Total cost</th>
			<th class="{cell} text-right">Realized</th>
			<th class="{cell} text-right">Expected</th>
			<th class="{cell} text-right" title="Expected profit as a share of the total cost">Margin</th>
			<th class="{cell} text-right" title="Expected profit divided by the slot-days the jobs used"
				>Profit / slot / day</th
			>
		</tr>
	{/snippet}
	{#snippet row(r: ReactionTableRow)}
		<tr class="border-t border-gray-200 dark:border-gray-700" data-reaction={r.blueprintTypeId}>
			<td class={cell}>
				<a
					href="/profits/jobs?reaction={r.blueprintTypeId}{period === defaultPeriod
						? ''
						: `&period=${period}`}"
					class="inline-flex items-center gap-2 {link}"
				>
					<img
						src={blueprintIconUrl(r.blueprintTypeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					<span>{r.name}</span>
				</a>
			</td>
			<td class={num}>{formatNumber(r.jobs)}</td>
			<td class={num}>{formatNumber(r.runs)}</td>
			<td class={num} data-total-cost><Isk value={r.spent} /></td>
			<td class={num}><Isk value={r.realized} profit /></td>
			<td class={num}>
				<Isk value={r.expected} profit estimated={r.expected !== r.realized ? UNSOLD : null} />
				{#if r.unvalued > 0}
					<span class="block text-xs text-amber-700 dark:text-amber-400"
						>{formatNumber(r.unvalued)} not valued</span
					>
				{/if}
			</td>
			<td class={num}>{formatPct(r.marginPct)}</td>
			<td class={num}
				><Isk value={r.profitPerSlotDay} profit missing="No finished job of this reaction." /></td
			>
		</tr>
	{/snippet}
	{#snippet empty()}
		<p class="text-sm text-gray-500 dark:text-gray-400" data-empty>
			No job ended in this period. Pick a longer period above, or see what is running below.
		</p>
	{/snippet}
</PagedTable>
