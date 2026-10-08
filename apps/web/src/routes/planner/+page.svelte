<script lang="ts">
	import { page } from '$app/state';
	import Planner from '$lib/components/planner/Planner.svelte';
	import Seo from '$lib/seo/Seo.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<Seo
	title="Planner"
	description="Plan EVE Online reaction slots: pick products and lines, see the intermediates to run, build-up cycles, shopping lists with multibuy, initial investment, profit per cycle and market volume share."
	path="/planner"
/>

<div class="space-y-3 text-gray-900 dark:text-gray-300">
	<header class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Reaction planner</h1>
		{#if data.available}
			<p class="text-xs text-gray-500 sm:text-sm dark:text-gray-400">
				Fill your reaction slots: chains, build-up, purchases and profit per cycle · prices as of {data.prices.asOf
					.slice(0, 16)
					.replace('T', ' ')} UTC
			</p>
		{/if}
	</header>

	{#if data.available}
		<Planner {data} share={page.url.searchParams.get('s')} />
	{:else}
		<section class="mx-auto max-w-2xl py-12 text-center">
			<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">Data not available yet</h2>
			<p class="mt-2 text-gray-600 dark:text-gray-400">
				Reaction and market data have not been published yet. Please check back in a few minutes.
			</p>
		</section>
	{/if}
</div>
