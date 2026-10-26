<script lang="ts">
	import type { Dataset, PlanItem } from '@reactions/engine';
	import { formatNumber } from '#lib/format.js';
	import { groupByRole } from '#lib/inventory/groups.js';
	import { typeIconUrl } from '#lib/site.js';

	interface Props {
		/** Heading id (the section is labelled by it). */
		id: string;
		title: string;
		items: readonly PlanItem[];
		dataset: Dataset;
		/** Marker attribute of the section (`data-<marker>`) for tests and styling hooks. */
		marker: string;
	}

	let { id, title, items, dataset, marker }: Props = $props();

	const groups = $derived(groupByRole(dataset, items));

	const table =
		'w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
	const row =
		'border-t border-gray-200 text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700';
</script>

<section class="space-y-1" aria-labelledby={id} {...{ [`data-${marker}`]: '' }}>
	<h3 {id} class="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
	<div class="overflow-x-auto">
		<table class={table}>
			<thead class={thead}>
				<tr>
					<th scope="col" class="px-3 py-1.5">Item</th>
					<th scope="col" class="px-3 py-1.5 text-right whitespace-nowrap">Quantity</th>
				</tr>
			</thead>
			{#each groups as group (group.role)}
				<tbody data-group={group.role}>
					<tr class="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
						<th
							scope="colgroup"
							colspan="2"
							class="px-3 py-1 text-xs font-semibold tracking-wide text-gray-600 uppercase dark:text-gray-300"
							>{group.title}</th
						>
					</tr>
					{#each group.items as item (item.typeId)}
						<tr class={row} data-type-id={item.typeId}>
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
									{item.name}
								</span>
							</td>
							<td class="px-3 py-1 text-right whitespace-nowrap tabular-nums"
								>{formatNumber(item.quantity)}</td
							>
						</tr>
					{/each}
				</tbody>
			{/each}
		</table>
	</div>
</section>
