<script lang="ts">
	import LedgerFilters from '$lib/components/ledger/LedgerFilters.svelte';
	import LedgerSummary from '$lib/components/ledger/LedgerSummary.svelte';
	import LedgerTable from '$lib/components/ledger/LedgerTable.svelte';
	import { formatRelative, formatUtc } from '$lib/format';
	import type { LedgerActionResult } from '$lib/ledger/types';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const result = $derived(form as LedgerActionResult | null);
	/** Prices with a correction form on this page: their errors show next to the form. */
	const correctionRefs = $derived(
		new Set(
			data.rows.rows.flatMap((r) =>
				r.kind === 'market'
					? [r.price.ref]
					: r.kind === 'contract'
						? r.items.flatMap((i) => (i.price ? [i.price.ref] : []))
						: []
			)
		)
	);
	const pageError = $derived(result?.error && !correctionRefs.has(result.ref) ? result.error : null);
	const now = Date.now();

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const button =
		'inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<Seo
	title="Ledger"
	description="Trades and contracts tracked for your EVE Online Reactions Calculator account, with the price of each."
	path="/profits/ledger"
	noindex
/>

<div class="space-y-4 pb-4">
	<header class="flex flex-wrap items-end justify-between gap-2">
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Ledger</h1>
			<p class="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
				Every purchase, sale and contract of your tracked characters and corporations, plus the purchases you
				entered, with the price used for it. Open a price source to see how it was worked out, and correct it
				when it is wrong.
			</p>
		</div>
		<div class="flex flex-col items-end gap-2">
			<div class="flex flex-wrap justify-end gap-2">
				<a href="/profits/ledger/add" class={button} data-add-purchases>Add purchases</a>
				<a
					href="/profits/ledger/reconcile"
					class="{button} {data.missingCount > 0 ? 'border-amber-300 dark:border-amber-600' : ''}"
					data-missing-prices={data.missingCount}>Missing prices ({data.missingCount})</a
				>
			</div>
			<p class="text-xs {muted}" data-rebuilt>
				{#if data.dirty}
					Waiting to be recalculated
				{:else if data.rebuiltAt}
					Recalculated <span title={formatUtc(data.rebuiltAt)}>{formatRelative(data.rebuiltAt, now)}</span>
				{:else}
					Not calculated yet
				{/if}
			</p>
		</div>
	</header>

	{#if result?.notice || pageError}
		<div
			role={pageError ? 'alert' : 'status'}
			data-notice={pageError ? 'error' : 'ok'}
			class="rounded-md border px-3 py-2 text-sm {pageError
				? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
				: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
		>
			{pageError ?? result?.notice}
		</div>
	{/if}

	{#if !data.tracked}
		<section class="{card} space-y-2" data-empty="none">
			<p class="font-medium text-gray-800 dark:text-gray-200">Nothing tracked yet.</p>
			<p class={muted}>
				Profit tracking syncs your connections every hour. At the first sync, trades and contracts reach back
				30 days, so your recent history shows up here shortly. See how each connection is doing on <a
					href="/account/connections"
					class={link}>Connections</a
				>.
			</p>
		</section>
	{:else}
		<LedgerFilters filters={data.filters} types={data.types} connections={data.connections} />
		<LedgerSummary summary={data.summary} reviewOnly={data.filters.review} />

		<section class="{card} space-y-2">
			<p class="text-xs {muted}">
				Unit prices are net: purchases include broker fees, sales are after sales tax and fees.
			</p>
			{#if data.rows.total > 0}
				<p class="text-xs sm:hidden {muted}" data-scroll-hint>
					Swipe the table sideways to see every column.
				</p>
			{/if}
			<LedgerTable data={data.rows} form={result}>
				{#snippet empty()}
					<p class="py-4 text-center {muted}" data-empty="filtered">
						Nothing matches these filters. <a href="/profits/ledger" class={link}>Clear filters</a>
					</p>
				{/snippet}
			</LedgerTable>
		</section>
	{/if}
</div>
