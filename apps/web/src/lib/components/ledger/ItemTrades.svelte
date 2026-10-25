<script lang="ts">
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import Pill from '$lib/components/profits/Pill.svelte';
	import { formatNumber, formatRelative, formatUtc } from '$lib/format';
	import { DIRECTION_BADGE, UNTRACKED, UNTRACKED_TEXT } from '$lib/ledger/source';
	import type { LedgerItemTrade, LedgerLotOrigin } from '$lib/ledger/types';
	import type { Paged } from '$lib/paging';
	import PriceSource from './PriceSource.svelte';

	interface Props {
		data: Paged<LedgerItemTrade>;
		typeId: number;
		/** Where the item's batches come from (any order, repeats allowed): words the empty state. */
		origins?: readonly LedgerLotOrigin[];
	}

	let { data, typeId, origins = [] }: Props = $props();

	/** Where batches come from, in the order the sentence lists them. */
	const ORIGIN_WORDS: [LedgerLotOrigin, string][] = [
		['job', 'your jobs'],
		['correction', 'your price corrections of job inputs'],
		['market', 'market estimates of job inputs'],
		['manual', 'purchases you entered'],
		['transaction', 'market trades'],
		['contract', 'contracts']
	];

	/** The origins of the item's batches, in the order the sentence lists them. */
	const listed = $derived(ORIGIN_WORDS.filter(([o]) => origins.includes(o)));
	/** "Its batches come from your jobs and your price corrections of job inputs." */
	const batchesFrom = $derived.by(() => {
		const words = listed.map(([, w]) => w);
		if (!words.length) return '';
		const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
		return ` Its batches come from ${list}.`;
	});

	const now = Date.now();
	const KIND = { market: 'Market', contract: 'Contract' } as const;
	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
</script>

<PagedTable
	{data}
	param="trades"
	endpoint="/profits/data/item-trades/{typeId}"
	label="Purchases and sales"
	noun="trades"
>
	{#snippet empty()}
		<p
			class="py-2 text-sm text-gray-500 dark:text-gray-400"
			data-empty="trades"
			data-batches-from={listed.map(([o]) => o).join(' ')}
		>
			No purchases or sales of this item yet.{batchesFrom}
		</p>
	{/snippet}
	{#snippet head()}
		<tr>
			<th class="px-3 py-2">Date</th>
			<th class="px-3 py-2">Direction</th>
			<th class="px-3 py-2">Kind</th>
			<th class="px-3 py-2 text-right">Quantity</th>
			<th class="px-3 py-2 text-right">Unit price</th>
			<th class="px-3 py-2 text-right">Total</th>
			<th class="px-3 py-2">Price source</th>
		</tr>
	{/snippet}
	{#snippet row(trade: LedgerItemTrade)}
		{@const badge = DIRECTION_BADGE[trade.direction]}
		{@const untracked = trade.sourceKind === UNTRACKED}
		<tr
			class="border-t border-gray-200 dark:border-gray-600"
			data-trade={trade.ref}
			data-untracked={untracked || undefined}
		>
			<td class="{cell} whitespace-nowrap">
				<span class="cursor-help text-gray-800 dark:text-gray-200" title={formatUtc(trade.at)}
					>{formatRelative(trade.at, now)}</span
				>
			</td>
			<td class={cell}><Pill tone={badge.tone}>{badge.label}</Pill></td>
			<td class="{cell} text-gray-800 dark:text-gray-200">{KIND[trade.kind]}</td>
			<td class={num}>{formatNumber(trade.quantity)}</td>
			<td class={num}>
				<Isk
					value={untracked ? null : trade.unitPrice}
					missing={untracked
						? UNTRACKED_TEXT
						: 'No price: a transfer between your own characters and corporations'}
					estimated={trade.estimatedFees && !untracked
						? 'Broker fee or sales tax estimated from your settings.'
						: null}
				/>
			</td>
			<td class={num}>
				<Isk
					value={untracked || trade.unitPrice === null ? null : trade.unitPrice * trade.quantity}
					missing={untracked ? UNTRACKED_TEXT : null}
				/>
			</td>
			<td class={cell}>
				{#if trade.sourceKind !== null && trade.sourceText !== null}
					<PriceSource
						kind={trade.sourceKind}
						needsReview={trade.needsReview}
						estimatedFees={trade.estimatedFees}
						text={trade.sourceText}
					/>
				{:else}
					<span class={muted}>Between your own characters and corporations</span>
				{/if}
			</td>
		</tr>
	{/snippet}
</PagedTable>
