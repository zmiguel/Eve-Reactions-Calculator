<script lang="ts">
	import type { LineItem } from '@reactions/engine';
	import { formatIsk, formatIskFull, formatNumber } from '$lib/format';
	import { typeIconUrl } from '$lib/site';

	interface Props {
		title: string;
		items: LineItem[];
		/** Show fee and shipping columns (off for surplus, which is valued but not sold); all-zero ones are hidden. */
		costs?: boolean;
		feesLabel?: string;
		/** Show the volume column. */
		volume?: boolean;
		/** Heading level of the title (4 inside a step card). */
		level?: 3 | 4;
		emptyText?: string;
		/** Show the "Available" column: units listed for sale at the input hub (bought inputs). */
		available?: boolean;
		/** Hub id → name for the per-market split of bought inputs (`sources`). */
		markets?: Record<string, string>;
		/** Show the per-market split under the item name (the planner shows it in its own table). */
		sources?: boolean;
	}

	let {
		title,
		items,
		costs = true,
		feesLabel = 'Fees',
		volume = true,
		level = 3,
		emptyText = 'Nothing to show.',
		available = false,
		markets = {},
		sources = true
	}: Props = $props();

	const totals = $derived({
		total: items.some((i) => i.unitPrice === null) ? null : items.reduce((a, i) => a + i.total, 0),
		fees: items.reduce((a, i) => a + i.fees, 0),
		shipping: items.reduce((a, i) => a + i.shipping, 0),
		volume: items.reduce((a, i) => a + i.volume, 0)
	});
	const showFees = $derived(costs && items.some((i) => i.fees !== 0));
	const showShipping = $derived(costs && items.some((i) => i.shipping !== 0));
	const th = 'px-3 py-1.5 text-right whitespace-nowrap';
	const cell = 'px-3 py-1 text-right tabular-nums whitespace-nowrap';
</script>

<section class="space-y-1" aria-label={title}>
	<svelte:element this={`h${level}`} class="text-sm font-semibold text-gray-800 dark:text-gray-200">
		{title}
	</svelte:element>
	{#if items.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
	{:else}
		<div class="overflow-x-auto">
			<table
				class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
			>
				<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
					<tr>
						<th scope="col" class="px-3 py-1.5">Item</th>
						<th scope="col" class={th}>Quantity</th>
						{#if available}
							<th scope="col" class={th} title="Units listed for sale at the input hub">Available</th>
						{/if}
						<th scope="col" class={th}>Unit price</th>
						<th scope="col" class={th}>Total</th>
						{#if showFees}
							<th scope="col" class={th}>{feesLabel}</th>
						{/if}
						{#if showShipping}
							<th scope="col" class={th}>Shipping</th>
						{/if}
						{#if volume}
							<th scope="col" class={th}>Volume m³</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each items as item (item.typeId)}
						<tr
							class="border-t border-gray-200 text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
							data-type-id={item.typeId}
						>
							<td class="px-3 py-1">
								<span class="flex items-center gap-2 whitespace-nowrap">
									<img
										src={typeIconUrl(item.typeId)}
										alt=""
										width="20"
										height="20"
										loading="lazy"
										class="h-5 w-5 rounded"
									/>
									<span>
										{item.name}
										{#if sources && item.sources}
											<span
												class="block text-xs text-amber-700 tabular-nums dark:text-amber-400"
												title="Bought per market"
												data-sources
												>{item.sources
													.map(
														(s) =>
															`${formatNumber(s.quantity)} ${markets[s.hubId] ?? s.hubId}${s.unitPrice === null ? ' (no price)' : ''}`
													)
													.join(' · ')}</span
											>
										{/if}
									</span>
								</span>
							</td>
							<td class={cell}>{formatNumber(item.quantity)}</td>
							{#if available}
								{@const listed = item.availableAtInputHub ?? null}
								<td
									class="{cell} {listed !== null && listed < item.quantity
										? 'text-amber-700 dark:text-amber-400'
										: ''}"
									title={listed === null ? 'Not known' : undefined}
									data-field="available">{listed === null ? 'n/a' : formatNumber(listed)}</td
								>
							{/if}
							<td class={cell} title={formatIskFull(item.unitPrice)}>
								{#if item.unitPrice === null}
									<span class="text-red-600 dark:text-red-400" title="No market price">n/a</span>
								{:else}
									{formatIsk(item.unitPrice)}
								{/if}
							</td>
							<td class={cell} title={formatIskFull(item.total)}>
								{item.unitPrice === null ? 'n/a' : formatIsk(item.total)}
							</td>
							{#if showFees}
								<td class={cell} title={formatIskFull(item.fees)}>{formatIsk(item.fees)}</td>
							{/if}
							{#if showShipping}
								<td class={cell} title={formatIskFull(item.shipping)}>{formatIsk(item.shipping)}</td>
							{/if}
							{#if volume}
								<td class={cell}>{formatNumber(item.volume, 2)}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
				<tfoot
					class="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
				>
					<tr data-totals>
						<th scope="row" class="px-3 py-1 text-left">Total</th>
						<td class={cell}></td>
						{#if available}
							<td class={cell}></td>
						{/if}
						<td class={cell}></td>
						<td class={cell} title={formatIskFull(totals.total)} data-total>{formatIsk(totals.total)}</td>
						{#if showFees}
							<td class={cell} title={formatIskFull(totals.fees)} data-fees>{formatIsk(totals.fees)}</td>
						{/if}
						{#if showShipping}
							<td class={cell} title={formatIskFull(totals.shipping)} data-shipping>
								{formatIsk(totals.shipping)}
							</td>
						{/if}
						{#if volume}
							<td class={cell}>{formatNumber(totals.volume, 2)}</td>
						{/if}
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
</section>
