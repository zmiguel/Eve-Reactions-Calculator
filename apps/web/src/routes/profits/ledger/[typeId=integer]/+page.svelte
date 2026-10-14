<script lang="ts">
	import BatchChart from '$lib/components/ledger/BatchChart.svelte';
	import ItemBatches from '$lib/components/ledger/ItemBatches.svelte';
	import ItemTrades from '$lib/components/ledger/ItemTrades.svelte';
	import Isk from '$lib/components/profits/Isk.svelte';
	import { formatNumber } from '$lib/format';
	import type { LedgerActionResult } from '$lib/ledger/types';
	import Seo from '$lib/seo/Seo.svelte';
	import { blueprintIconUrl, typeIconUrl } from '$lib/site';

	let { data, form } = $props();

	const result = $derived(form as LedgerActionResult | null);
	/** Batches with a correction form on this page: their errors show next to the form. */
	const pageError = $derived(
		result?.error && !data.batches.rows.some((b) => b.correctionRef === result.ref) ? result.error : null
	);
	const empty = $derived(data.batches.total === 0 && data.trades.total === 0);
	const NO_VALUE = 'No market value for this item with your settings.';
	const VALUE_ESTIMATE =
		'What one unit sells for today with your settings (output hub, sell method, fees and taxes).';

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const statTitle = 'text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400';
	const statValue = 'mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white';
	const note = 'mt-1 text-xs text-gray-500 dark:text-gray-400';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<Seo
	title={data.item.name}
	description="What you paid for {data.item
		.name} and where it went, from your tracked trades, contracts and jobs."
	path="/profits/ledger/{data.item.typeId}"
	noindex
/>

<div class="space-y-4 pb-4">
	<header>
		<a href="/profits/ledger" class="text-sm {link}" data-back>Back to the ledger</a>
		<div class="mt-2 flex items-center gap-3">
			<img
				src={data.item.formula ? blueprintIconUrl(data.item.typeId, 64) : typeIconUrl(data.item.typeId, 64)}
				alt=""
				width="40"
				height="40"
				class="h-10 w-10 rounded"
			/>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">{data.item.name}</h1>
		</div>
	</header>

	<section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="What you hold">
		<div class={card} data-card="held">
			<h2 class={statTitle}>Held now</h2>
			<p class={statValue} data-value={data.heldQuantity}>{formatNumber(data.heldQuantity)}</p>
			<p class={note}>Units left in your batches</p>
		</div>
		<div class={card} data-card="average">
			<h2 class={statTitle}>Average paid</h2>
			<p class={statValue}>
				<Isk value={data.averagePaid} missing="You hold none of this item." />
			</p>
			<p class={note}>Per unit of what you hold</p>
		</div>
		<div class={card} data-card="value">
			<h2 class={statTitle}>Value today</h2>
			<p class={statValue}>
				<Isk value={data.unitValue} estimated={VALUE_ESTIMATE} missing={NO_VALUE} />
			</p>
			<p class={note}>Per unit, after fees and taxes</p>
		</div>
		<div class={card} data-card="gain">
			<h2 class={statTitle}>{data.gain !== null && data.gain < 0 ? 'Loss' : 'Gain'} on what you hold</h2>
			<p class={statValue}>
				<Isk
					value={data.gain}
					profit
					estimated={VALUE_ESTIMATE}
					missing={data.heldQuantity === 0 ? 'You hold none of this item.' : NO_VALUE}
				/>
			</p>
			<p class={note}>Value today minus what you paid</p>
		</div>
	</section>

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

	{#if empty}
		<p class="{card} {muted}" data-empty>
			Nothing tracked for this item yet. Purchases, sales and jobs show up here after the next hourly sync of
			your connections. <a href="/profits/ledger" class={link}>See all your trades</a>
		</p>
	{:else}
		<section class={card}>
			<h2 class="mb-2 {heading}">What you paid</h2>
			<BatchChart points={data.points} unitValue={data.unitValue} />
		</section>

		<section class="{card} space-y-2">
			<h2 class={heading}>Batches</h2>
			<p class="text-xs {muted}">
				Every quantity you got, oldest first. Jobs and sales take from the oldest batches first.
			</p>
			<ItemBatches data={data.batches} typeId={data.item.typeId} form={result} />
		</section>

		<section class="{card} space-y-2">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class={heading}>Purchases and sales</h2>
				<a href="/profits/ledger?type={data.item.typeId}" class="text-sm {link}" data-ledger-link
					>Show in the ledger</a
				>
			</div>
			<ItemTrades
				data={data.trades}
				typeId={data.item.typeId}
				origins={data.batches.rows.map((b) => b.origin)}
			/>
		</section>
	{/if}
</div>
