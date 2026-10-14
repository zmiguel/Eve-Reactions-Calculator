<script lang="ts">
	import ReconcileContracts from '$lib/components/ledger/ReconcileContracts.svelte';
	import ReconcileInputs from '$lib/components/ledger/ReconcileInputs.svelte';
	import { formatNumber } from '$lib/format';
	import type { ReconcileActionResult } from '$lib/ledger/types';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const result = $derived(form as ReconcileActionResult | null);
	const counts = $derived(data.counts);
	const nothing = $derived(data.inputs.total === 0 && data.contracts.total === 0);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const statTitle = 'text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400';
	const statValue = 'mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white';
	const note = 'mt-1 text-xs text-gray-500 dark:text-gray-400';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<Seo
	title="Missing prices"
	description="Prices your EVE Online Reactions Calculator ledger had to estimate or could not set, to confirm or correct."
	path="/profits/ledger/reconcile"
	noindex
/>

<div class="space-y-4 pb-4">
	<header>
		<a href="/profits/ledger" class="text-sm {link}" data-back>Back to the ledger</a>
		<h1 class="mt-2 text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Missing prices</h1>
		<p class="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
			Every price the ledger had to estimate or could not set. Enter what you paid, or use the buy value at
			job start to keep the estimate as your price. Each saved price leaves this list once your results are
			recalculated. If you know where the items came from, <a href="/profits/ledger/add" class={link}
				>add the purchase</a
			> instead: jobs started after it use it.
		</p>
		{#if data.dirty}
			<p class="mt-1 text-xs {muted}" data-dirty>Waiting to be recalculated</p>
		{/if}
	</header>

	{#if result?.notice}
		<div
			role="status"
			data-notice="ok"
			class="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
		>
			{result.notice}
		</div>
	{/if}

	{#if nothing}
		<section class="{card} space-y-1" data-empty="reconcile">
			<p class="font-medium text-gray-800 dark:text-gray-200">Nothing to reconcile</p>
			<p class={muted}>Every job input has a purchase or your price, and no contract item needs a check.</p>
		</section>
	{:else}
		<section class="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="What is missing">
			<div class={card} data-count="estimated">
				<h2 class={statTitle}>Buy value estimates</h2>
				<p class={statValue}>{formatNumber(counts.estimated)}</p>
				<p class={note}>
					Job inputs with no purchase found, across {formatNumber(counts.items)}
					{counts.items === 1 ? 'item' : 'items'}
				</p>
			</div>
			<div class={card} data-count="unpriced">
				<h2 class={statTitle}>No price at all</h2>
				<p class={statValue}>{formatNumber(counts.unpriced)}</p>
				<p class={note}>Job inputs counted at 0 ISK: no buy value was known</p>
			</div>
			<div class={card} data-count="contracts">
				<h2 class={statTitle}>Contract items</h2>
				<p class={statValue}>{formatNumber(counts.contracts)}</p>
				<p class={note}>Prices that need a check</p>
			</div>
		</section>

		<section class="{card} space-y-2" aria-labelledby="inputs">
			<h2 id="inputs" class={heading}>Job inputs without a purchase</h2>
			{#if data.inputs.total}
				<ReconcileInputs data={data.inputs} form={result} />
			{:else}
				<p class="py-2 {muted}" data-empty="inputs">Every job input has a purchase or your price.</p>
			{/if}
		</section>

		<section class="{card} space-y-2" aria-labelledby="contracts">
			<h2 id="contracts" class={heading}>Contract items to check</h2>
			{#if data.contracts.total}
				<p class="text-xs {muted}">
					Your price for one item of a contract splits the rest of the contract total over its other items.
				</p>
				<ReconcileContracts data={data.contracts} form={result} />
			{:else}
				<p class="py-2 {muted}" data-empty="contracts">No contract item needs a check.</p>
			{/if}
		</section>
	{/if}
</div>
