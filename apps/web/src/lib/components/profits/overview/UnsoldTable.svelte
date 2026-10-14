<script lang="ts">
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import { formatNumber } from '$lib/format';
	import type { Paged } from '$lib/paging';
	import type { UnsoldTableRow } from '$lib/profits/types';
	import { typeIconUrl } from '$lib/site';

	let { data }: { data: Paged<UnsoldTableRow> } = $props();

	const TODAY = "Today's market price with your calculator settings, after the fees of selling it.";
	const NO_PRICE = 'No market price today with your settings.';
	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const link = 'font-medium text-primary-700 hover:underline dark:text-primary-400';
</script>

<PagedTable {data} param="unsold" endpoint="/profits/data/unsold" label="Unsold output" noun="items">
	{#snippet head()}
		<tr>
			<th class={cell}>Item</th>
			<th class="{cell} text-right">Quantity</th>
			<th class="{cell} text-right" title="Average cost of the units you hold">Your unit cost</th>
			<th class="{cell} text-right">Value today (unit)</th>
			<th class="{cell} text-right">Value today (total)</th>
			<th class="{cell} text-right" title="Value today minus what the units cost you">Expected gain</th>
		</tr>
	{/snippet}
	{#snippet row(u: UnsoldTableRow)}
		<tr class="border-t border-gray-200 dark:border-gray-700" data-unsold={u.typeId}>
			<td class={cell}>
				<a href="/profits/ledger/{u.typeId}" class="inline-flex items-center gap-2 {link}">
					<img
						src={typeIconUrl(u.typeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					<span>{u.name}</span>
				</a>
			</td>
			<td class={num}>{formatNumber(u.quantity)}</td>
			<td class={num}><Isk value={u.unitCost} /></td>
			<td class={num}><Isk value={u.unitValue} estimated={TODAY} missing={NO_PRICE} /></td>
			<td class={num}><Isk value={u.value} estimated={TODAY} missing={NO_PRICE} /></td>
			<td class={num}><Isk value={u.gain} profit missing={NO_PRICE} /></td>
		</tr>
	{/snippet}
	{#snippet empty()}
		<p class="text-sm text-gray-500 dark:text-gray-400" data-empty>
			You hold nothing your jobs made: everything was sold or used by later jobs.
		</p>
	{/snippet}
</PagedTable>
