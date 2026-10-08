<script lang="ts">
	import { typeIconUrl } from '$lib/site';
	import type { RankedListItem } from './types';

	interface Props {
		title: string;
		items: RankedListItem[];
		empty: string;
	}

	let { title, items, empty }: Props = $props();
</script>

<div class="rounded-lg bg-white p-4 text-sm dark:bg-gray-700">
	<h3
		class="mb-2 border-b-2 border-gray-200 pb-2 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:border-gray-600 dark:text-gray-200"
	>
		{title}
	</h3>
	{#if items.length === 0}
		<p class="py-2 text-gray-500 dark:text-gray-300">{empty}</p>
	{:else}
		<ol class="divide-y divide-gray-200 dark:divide-gray-600">
			{#each items as item, index (item.key)}
				<li class="flex items-center gap-3 py-1.5">
					<span class="w-5 text-right text-xs text-gray-500 tabular-nums dark:text-gray-300">{index + 1}</span
					>
					<img
						src={typeIconUrl(item.productTypeId)}
						width="32"
						height="32"
						loading="lazy"
						alt={`${item.name} icon`}
						class="h-8 w-8 rounded"
					/>
					<span class="min-w-0 flex-1">
						{#if item.href}
							<a
								href={item.href}
								class="block truncate font-medium text-gray-900 hover:text-primary-700 hover:underline dark:text-white dark:hover:text-primary-300"
								>{item.name}</a
							>
						{:else}
							<span class="block truncate font-medium text-gray-900 dark:text-white">{item.name}</span>
						{/if}
						{#if item.detail}
							<span class="block truncate text-xs text-gray-500 dark:text-gray-300">{item.detail}</span>
						{/if}
					</span>
					<span
						title={item.valueTitle}
						class={[
							'font-semibold whitespace-nowrap tabular-nums',
							item.sign && item.sign > 0 && 'text-green-600 dark:text-green-400',
							item.sign && item.sign < 0 && 'text-red-600 dark:text-red-300'
						]}>{item.value}</span
					>
				</li>
			{/each}
		</ol>
	{/if}
</div>
