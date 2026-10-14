<script lang="ts">
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import Pill from '$lib/components/profits/Pill.svelte';
	import { formatIskFull, formatNumber, formatUtc } from '$lib/format';
	import { DIRECTION_BADGE } from '$lib/ledger/source';
	import type { Paged } from '$lib/paging';
	import type { ReconcileActionResult, ReconcileContractRow } from '$lib/ledger/types';
	import { typeIconUrl } from '$lib/site';
	import UnitPriceForm from './UnitPriceForm.svelte';

	interface Props {
		data: Paged<ReconcileContractRow>;
		form?: ReconcileActionResult | null;
	}

	let { data, form = null }: Props = $props();

	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<PagedTable
	{data}
	param="contracts"
	endpoint="/profits/data/reconcile-contracts"
	label="Contract items to check"
	noun="items"
>
	{#snippet head()}
		<tr>
			<th class="px-3 py-2">Contract</th>
			<th class="px-3 py-2">Item</th>
			<th class="px-3 py-2 text-right">Quantity</th>
			<th class="px-3 py-2 text-right">Unit price now</th>
			<th class="px-3 py-2">Why it needs a check</th>
			<th class="px-3 py-2">Your price</th>
		</tr>
	{/snippet}
	{#snippet row(r: ReconcileContractRow)}
		{@const badge = DIRECTION_BADGE[r.incoming ? 'in' : 'out']}
		<tr class="border-t border-gray-200 dark:border-gray-700" data-contract-item={r.ref}>
			<td class="{cell} whitespace-nowrap" data-contract-label>
				<span class="text-gray-900 dark:text-gray-100">Contract of {formatUtc(r.at)}</span>
				{#if r.title}<span class="block max-w-xs truncate {muted}" title={r.title}>{r.title}</span>{/if}
			</td>
			<td class={cell}>
				<a
					href="/profits/ledger/{r.item.typeId}"
					class="inline-flex items-center gap-2 whitespace-nowrap {link}"
					data-item={r.item.typeId}
				>
					<img
						src={typeIconUrl(r.item.typeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					{r.item.name}
				</a>
				<span class="mt-1 block"><Pill tone={badge.tone}>{badge.label}</Pill></span>
			</td>
			<td class={num}>{formatNumber(r.quantity)}</td>
			<td class={num}><Isk value={r.unitPrice} /></td>
			<td class="{cell} max-w-xs text-xs text-gray-600 dark:text-gray-400">{r.sourceText}</td>
			<td class={cell}>
				{#if r.saved}
					<span class="text-xs text-gray-700 dark:text-gray-300" data-saved
						>Saved, recalculating: {formatIskFull(r.saved.unitPrice)}</span
					>
				{:else}
					<UnitPriceForm kind="contract_item" ref={r.ref} {form} />
				{/if}
			</td>
		</tr>
	{/snippet}
</PagedTable>
