<script lang="ts">
	import { Badge } from 'flowbite-svelte';
	import { formatIsk, formatIskFull } from '$lib/format';
	import type { PriceTiming } from '$lib/server/detail';

	interface Props {
		timing: PriceTiming;
		/** Form target (detail page path). */
		action: string;
		/** Other query parameters to keep when the form is submitted. */
		hidden?: Record<string, string>;
	}

	let { timing, action, hidden = {} }: Props = $props();

	const delta = $derived(
		timing.then.profit !== null && timing.now.profit !== null ? timing.then.profit - timing.now.profit : null
	);
	const deltaText = $derived(
		delta === null ? 'n/a' : delta > 0 ? `+${formatIsk(delta)}` : delta < 0 ? formatIsk(delta) : '±0'
	);
	const deltaClass = $derived(
		delta === null || delta === 0
			? 'text-gray-500 dark:text-gray-300'
			: delta > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-300'
	);
	const asOfLabel = $derived(
		timing.asOf.length > 10 ? timing.asOf.slice(0, 16).replace('T', ' ') + ' UTC' : timing.asOf
	);
</script>

<section class="rounded-lg bg-white p-3 text-sm dark:bg-gray-700" aria-labelledby="price-timing-title">
	<h2 id="price-timing-title" class="text-lg font-semibold text-gray-800 dark:text-gray-200">Price timing</h2>
	<form method="GET" {action} class="mt-2 flex flex-wrap items-end gap-2">
		{#each Object.entries(hidden) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<label class="text-sm text-gray-700 dark:text-gray-300">
			Inputs bought
			<input
				type="number"
				name="bought"
				min="0"
				max="60"
				step="1"
				value={timing.days}
				class="focus:border-primary-500 focus:ring-primary-500 mx-1 w-20 rounded-md border border-gray-300 bg-gray-200 p-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
			/>
			days ago
		</label>
		<button
			type="submit"
			class="bg-primary-700 hover:bg-primary-800 dark:bg-primary-600 dark:hover:bg-primary-700 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-white"
		>
			Apply
		</button>
	</form>
	<div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-300">
		<span
			>Default {timing.defaultDays} days (chain depth × cycle length). Input prices as of {asOfLabel}.</span
		>
		{#if timing.approximate}
			<Badge color="yellow" data-approximate>Approximate (daily averages)</Badge>
		{/if}
	</div>
	<dl class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
		<div>
			<dt class="text-xs text-gray-500 dark:text-gray-300">Profit, inputs bought {timing.days} days ago</dt>
			<dd class="text-lg font-semibold tabular-nums" title={formatIskFull(timing.then.profit)} data-then>
				{formatIsk(timing.then.profit)}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-gray-500 dark:text-gray-300">Profit at today's prices</dt>
			<dd class="text-lg font-semibold tabular-nums" title={formatIskFull(timing.now.profit)} data-now>
				{formatIsk(timing.now.profit)}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-gray-500 dark:text-gray-300">Difference</dt>
			<dd class="text-lg font-semibold tabular-nums {deltaClass}" title={formatIskFull(delta)} data-delta>
				{deltaText}
			</dd>
		</div>
	</dl>
</section>
