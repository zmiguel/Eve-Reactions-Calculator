<script lang="ts">
	import { formatIsk, formatIskFull, formatNumber } from '$lib/format';
	import { MATERIAL_GROUPS } from '$lib/inventory/groups';
	import type { InventorySummaryView } from '$lib/inventory/types';
	import { blueprintIconUrl, typeIconUrl } from '$lib/site';

	let { summary }: { summary: InventorySummaryView } = $props();

	const groups = $derived(MATERIAL_GROUPS.filter((g) => summary.materials[g.role].length > 0));

	const table =
		'w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
	const subheading = 'mb-1 text-xs font-semibold tracking-wide text-gray-700 uppercase dark:text-gray-300';
</script>

{#if summary.empty === 'no_sources'}
	<p class="text-gray-500 dark:text-gray-400" data-empty="no_sources">
		No inventory yet. Switch Inventory on for a connection on Connections; once synced, choose the places to
		use above and their items show up here.
	</p>
{:else if summary.empty === 'no_selection'}
	<p class="text-gray-500 dark:text-gray-400" data-empty="no_selection">
		Nothing in the selected places. Tick the hangars to use under each connection and press Save.
	</p>
{:else}
	<div class="space-y-4">
		{#if summary.formulas.length}
			<div data-group="formulas">
				<h3 class={subheading}>Formulas</h3>
				<div class="overflow-x-auto">
					<table class={table}>
						<thead class={thead}>
							<tr>
								<th class="px-3 py-2">Formula</th>
								<th class="px-3 py-2 text-right">Count</th>
								<th class="px-3 py-2">Places</th>
							</tr>
						</thead>
						<tbody>
							{#each summary.formulas as formula (formula.blueprintTypeId)}
								<tr class="border-t border-gray-200 dark:border-gray-700" data-type={formula.blueprintTypeId}>
									<td class="px-3 py-2">
										<span
											class="inline-flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"
										>
											<img
												src={blueprintIconUrl(formula.blueprintTypeId)}
												alt=""
												width="20"
												height="20"
												loading="lazy"
												class="h-5 w-5 rounded"
											/>
											{formula.name}
										</span>
									</td>
									<td class="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200"
										>{formatNumber(formula.count)}</td
									>
									<td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
										{#each formula.places as place (place)}
											<span class="block">{place}</span>
										{/each}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		{#each groups as group (group.role)}
			<div data-group={group.role}>
				<h3 class={subheading}>
					{group.title}
					<span class="ml-1 font-normal tracking-normal text-gray-500 normal-case dark:text-gray-400"
						>{group.hint}</span
					>
				</h3>
				<div class="overflow-x-auto">
					<table class={table}>
						<thead class={thead}>
							<tr>
								<th class="px-3 py-2">Item</th>
								<th class="px-3 py-2 text-right">Quantity</th>
								<th class="px-3 py-2 text-right">Value</th>
								{#if summary.showPaid}
									<th class="px-3 py-2 text-right">Paid</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each summary.materials[group.role] as item (item.typeId)}
								<tr class="border-t border-gray-200 dark:border-gray-700" data-type={item.typeId}>
									<td class="px-3 py-2">
										<span class="inline-flex items-center gap-2 text-gray-900 dark:text-gray-100">
											<img
												src={typeIconUrl(item.typeId)}
												alt=""
												width="20"
												height="20"
												loading="lazy"
												class="h-5 w-5 rounded"
											/>
											{item.name}
										</span>
									</td>
									<td class="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200" data-quantity
										>{formatNumber(item.quantity)}</td
									>
									<td
										class="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200"
										title={formatIskFull(item.value)}
										data-value>{formatIsk(item.value)}</td
									>
									{#if summary.showPaid}
										<td class="px-3 py-2 text-right tabular-nums" data-paid>
											{#if item.paid}
												<a
													href="/profits/ledger/{item.typeId}"
													class="text-primary-700 hover:underline dark:text-primary-400"
													title={formatIskFull(item.paid.unitCost)}>{formatIsk(item.paid.unitCost)}</a
												>
												{#if item.paid.covered < item.quantity}
													<span class="block text-xs text-gray-500 dark:text-gray-400" data-paid-covered
														>for {formatNumber(item.paid.covered)}, rest unknown</span
													>
												{/if}
											{:else}
												<span class="text-gray-500 dark:text-gray-400">unknown</span>
											{/if}
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}

		{#if groups.length}
			<p class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
				<span class="text-xs text-gray-500 dark:text-gray-400">
					Values are what the items sell for at the market used by the reaction that makes them, or else the
					first reaction that uses them, after fees, tax and shipping. n/a means no price.
					{#if summary.showPaid}
						Paid is the average unit cost of what your profit tracking ledger still holds, oldest units used
						first.
					{/if}
				</span>
				<span class="font-semibold text-gray-800 dark:text-gray-200" title={formatIskFull(summary.totalValue)}
					>Total value <span class="tabular-nums" data-total>{formatIsk(summary.totalValue)}</span></span
				>
			</p>
		{/if}
	</div>
{/if}
