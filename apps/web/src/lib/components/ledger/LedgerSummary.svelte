<script lang="ts">
	import { page } from '$app/state';
	import Estimated from '#lib/components/profits/Estimated.svelte';
	import { formatIsk, formatIskFull, formatNumber } from '#lib/format.js';
	import type { LedgerSummary } from '#lib/ledger/types.js';

	interface Props {
		summary: LedgerSummary;
		/** The "Needs review only" filter is on. */
		reviewOnly: boolean;
	}

	let { summary, reviewOnly }: Props = $props();

	/** The current page with the review filter switched on or off (back to the first page). */
	const reviewHref = (on: boolean) => {
		const url = new URL(page.url.href);
		url.searchParams.delete('page');
		for (const key of [...url.searchParams.keys()]) if (key.startsWith('/')) url.searchParams.delete(key);
		if (on) url.searchParams.set('review', '1');
		else url.searchParams.delete('review');
		return url.pathname + url.search;
	};

	const feesSplit = $derived(
		[
			['Broker fees', summary.fees.brokerFees],
			['Sales tax', summary.fees.salesTax],
			['Contract fees', summary.fees.contractFees],
			['Other market fees (not matched to a tracked trade)', summary.fees.otherMarketFees]
		]
			.filter(([, value]) => value !== 0)
			.map(([name, value]) => `${name}: ${formatIskFull(value as number)}`)
	);

	const card = 'rounded-lg bg-white p-4 dark:bg-gray-700';
	const title = 'text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400';
	const value = 'mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white';
	const note = 'mt-1 text-xs text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Totals" data-summary>
	<div class={card} data-card="bought">
		<h2 class={title}>Bought</h2>
		<p class={value} title={formatIskFull(summary.bought)} data-value={summary.bought}>
			{formatIsk(summary.bought)}
		</p>
		<p class={note}>Paid for purchases, broker fees included</p>
	</div>
	<div class={card} data-card="sold">
		<h2 class={title}>Sold</h2>
		<p class={value} title={formatIskFull(summary.sold)} data-value={summary.sold}>
			{formatIsk(summary.sold)}
		</p>
		<p class={note}>Received for sales, after sales tax and broker fees</p>
	</div>
	<div class={card} data-card="fees">
		<h2 class={title}>Fees and taxes paid</h2>
		<p class={value}>
			<span
				class={feesSplit.length ? 'cursor-help' : ''}
				title={feesSplit.length ? feesSplit.join('\n') : formatIskFull(summary.fees.total)}
				data-value={summary.fees.total}>{formatIsk(summary.fees.total)}</span
			>{#if summary.fees.estimated}<Estimated
					reason="Some broker fees or sales tax are estimated from your settings: the wallet journal had no matching row."
				/>{/if}
		</p>
		<p class={note}>
			{#if feesSplit.length}{feesSplit.length === 1
					? feesSplit[0]
					: 'Broker fees, sales tax and contract fees'}{:else}No fees in these rows{/if}
		</p>
		{#if summary.fees.brokerFees !== 0 || summary.fees.salesTax !== 0}
			<p class={note} data-fees-counted>Broker fees and sales tax are already part of Bought and Sold.</p>
		{/if}
	</div>
	<div
		class="{card} {summary.reviewCount > 0 ? 'ring-1 ring-amber-400 dark:ring-amber-500' : ''}"
		data-card="review"
	>
		<h2 class={title}>Needs review</h2>
		<p
			class="{value} {summary.reviewCount > 0 ? 'text-amber-700 dark:text-amber-400' : ''}"
			data-value={summary.reviewCount}
		>
			{formatNumber(summary.reviewCount)}
		</p>
		<p class={note}>
			{#if reviewOnly}
				Showing only these. <a href={reviewHref(false)} class={link} data-review-link>Show everything</a>
			{:else if summary.reviewCount > 0}
				<span class="block">Prices the ledger could not work out reliably.</span>
				<a
					href={reviewHref(true)}
					class="mt-2 inline-flex items-center rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
					data-review-link>Show them</a
				>
			{:else}
				Nothing to check
			{/if}
		</p>
	</div>
</section>
