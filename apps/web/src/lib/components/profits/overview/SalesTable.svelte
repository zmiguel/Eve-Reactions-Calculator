<script lang="ts">
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import Pill from '$lib/components/profits/Pill.svelte';
	import { formatNumber, formatRelative, formatUtc } from '$lib/format';
	import type { Paged } from '$lib/paging';
	import type { SaleTableRow } from '$lib/profits/types';
	import { typeIconUrl } from '$lib/site';

	let { data, now }: { data: Paged<SaleTableRow>; now: number } = $props();

	const NO_BATCH = 'No tracked batch: these units were bought or made before tracking started.';
	const ORIGIN = {
		made: ['green', 'Made', 'Made by your jobs'],
		bought: ['purple', 'Resold', 'Items you bought, sold again'],
		mixed: ['blue', 'Made and resold', 'Partly made by your jobs, partly bought']
	} as const;
	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'block text-xs text-gray-500 dark:text-gray-400';
	const link = 'font-medium text-primary-700 hover:underline dark:text-primary-400';
</script>

<PagedTable {data} param="sales" endpoint="/profits/data/sales" label="Recent sales" noun="sales">
	{#snippet head()}
		<tr>
			<th class={cell}>Date</th>
			<th class={cell}>Item</th>
			<th class="{cell} text-right">Quantity</th>
			<th class="{cell} text-right" title="Sale price after tax and broker fees">Net unit price</th>
			<th class="{cell} text-right" title="What the units cost you (oldest batches first)">Your unit cost</th>
			<th class="{cell} text-right">Profit</th>
			<th class={cell}>Where</th>
		</tr>
	{/snippet}
	{#snippet row(s: SaleTableRow)}
		<tr class="border-t border-gray-200 dark:border-gray-600" data-sale={s.ref}>
			<td class="{cell} whitespace-nowrap">
				{formatUtc(s.at)}
				<span class={muted}>{formatRelative(s.at, now)}</span>
			</td>
			<td class={cell}>
				<a href="/profits/ledger/{s.typeId}" class="inline-flex items-center gap-2 {link}">
					<img
						src={typeIconUrl(s.typeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					<span>{s.name}</span>
				</a>
				{#if s.origin}
					<span class="mt-1 block">
						<Pill tone={ORIGIN[s.origin][0]} title={ORIGIN[s.origin][2]}>{ORIGIN[s.origin][1]}</Pill>
					</span>
				{/if}
			</td>
			<td class={num}>{formatNumber(s.quantity)}</td>
			<td class={num}><Isk value={s.netUnitPrice} /></td>
			<td class={num}><Isk value={s.unitCost} missing={NO_BATCH} /></td>
			<td class={num}>
				<Isk value={s.profit} profit missing={NO_BATCH} />
				{#if s.profit !== null && s.untrackedQty > 0}
					<span class={muted} title={NO_BATCH} data-untracked
						>for {formatNumber(s.quantity - s.untrackedQty)} of {formatNumber(s.quantity)}</span
					>
				{/if}
			</td>
			<td class={cell}>
				<Pill tone="gray">{s.kind === 'market' ? 'Market' : 'Contract'}</Pill>
			</td>
		</tr>
	{/snippet}
	{#snippet empty()}
		<p class="text-sm text-gray-500 dark:text-gray-400" data-empty>
			No sales in this period. Sales show here after the next sync of your wallets and contracts.
		</p>
	{/snippet}
</PagedTable>
