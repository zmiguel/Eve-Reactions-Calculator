<script lang="ts">
	import type { Reactor } from '@reactions/engine';
	import DatePicker from '$lib/components/listing/DatePicker.svelte';
	import SettingsSummary from '$lib/components/listing/SettingsSummary.svelte';
	import TierSection from '$lib/components/listing/TierSection.svelte';
	import Seo from '$lib/seo/Seo.svelte';
	import { REACTOR_LABEL } from '$lib/site';

	let { data } = $props();

	const INTRO: Record<Reactor, string> = {
		composite:
			'Composite reactions turn moon materials into the intermediate and advanced composites behind Tech II ships and modules. Compare buying intermediates with running the full chain, and selling unrefined ores with reprocessing them.',
		biochemical:
			'Biochemical reactions turn harvested gas into booster ingredients, from Synth through Standard, Improved and Strong boosters to Molecular-Forged materials. Chain tabs show the profit of reacting every intermediate step yourself.',
		hybrid:
			'Hybrid reactions turn fullerene gas into the polymers used to build Tactical Destroyers and Strategic Cruisers.'
	};

	const label = $derived(REACTOR_LABEL[data.reactor]);
	const path = $derived(`/${data.reactor}`);
</script>

<Seo
	title={`${label}s`}
	description={data.listing?.description ??
		`${label} reaction profits for EVE Online. ${INTRO[data.reactor]}`}
	{path}
	noindex={data.noindex}
/>

<header class="border-b-2 border-gray-300 pb-3 dark:border-gray-600">
	<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">{label} Reactions</h1>
	<p class="mt-1 max-w-4xl text-sm text-gray-600 dark:text-gray-400">{INTRO[data.reactor]}</p>
</header>

{#if data.listing}
	{@const listing = data.listing}
	<div class="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<SettingsSummary settings={listing.settings} warnings={listing.warnings} />
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{#if data.date}
					Daily average prices of <strong class="font-semibold text-gray-800 dark:text-gray-200"
						>{data.date}</strong
					>
				{:else}
					Live prices, updated {listing.pricesAge}
				{/if}
			</p>
			<DatePicker value={data.date} min={data.bounds.min} max={data.bounds.max} {path} />
		</div>
	</div>
	{#if listing.approximate}
		<p
			role="note"
			class="mt-3 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
		>
			Approximate prices: no hub prices were recorded for some items on {data.date}, so the region's daily
			average from EVE market history is used as both buy and sell price.
		</p>
	{/if}
	{#if listing.sections.length > 1}
		<nav class="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Tiers">
			<span class="text-xs font-semibold tracking-wide text-gray-600 uppercase dark:text-gray-400"
				>Jump to</span
			>
			{#each listing.sections as section (section.tier)}
				<a
					href={`#${section.tier}`}
					class="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
					>{section.title}
					<span class="text-xs text-gray-600 tabular-nums dark:text-gray-400">{section.rows.length}</span></a
				>
			{/each}
		</nav>
	{/if}
	{#each listing.sections as section (section.tier)}
		<TierSection {section} reactor={data.reactor} defaults={data.defaultTabs} />
	{/each}
{:else}
	<div
		class="mt-6 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
		role="status"
	>
		Market data is not available yet. Prices are refreshed every few minutes, please check back shortly.
	</div>
{/if}
