<script lang="ts">
	import type { Reactor } from '@reactions/engine';
	import { formatIsk, formatIskFull, formatPct } from '$lib/format';
	import ReactorBoard from '$lib/components/home/ReactorBoard.svelte';
	import type { InputMove } from '$lib/components/home/types';
	import RankedList from '$lib/components/listing/RankedList.svelte';
	import type { RankedListItem } from '$lib/components/listing/types';
	import Seo from '$lib/seo/Seo.svelte';
	import { REACTOR_LABEL, SITE_NAME, SITE_URL } from '$lib/site';

	let { data } = $props();

	const TITLE = 'Home';
	const FALLBACK_DESCRIPTION =
		'Live profit for every EVE Online reaction: composite, biochemical and hybrid, single step or full chain, with your own settings.';
	const jsonLd = [
		{ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
		{
			'@context': 'https://schema.org',
			'@type': 'WebApplication',
			name: SITE_NAME,
			url: `${SITE_URL}/`,
			applicationCategory: 'UtilitiesApplication',
			operatingSystem: 'Web',
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
		}
	];

	const BOARD_SUBTITLE: Partial<Record<Reactor, string>> = {
		biochemical: 'Boosters and molecular-forged',
		hybrid: 'Polymers'
	};

	const inputItem = (m: InputMove): RankedListItem => ({
		key: m.typeId,
		name: m.name,
		productTypeId: m.typeId,
		value: `${m.pct > 0 ? '+' : ''}${formatPct(m.pct)}`,
		valueTitle: `30-day average ${formatIskFull(m.price30d)}, last 5 days ${formatIskFull(m.price5d)}`,
		// Dearer inputs cost the visitor: red.
		sign: -m.pct,
		detail: `${formatIsk(m.price5d)} ISK · ${m.reactors.map((r) => REACTOR_LABEL[r]).join(', ')}`
	});
</script>

<Seo title={TITLE} description={data.home?.description ?? FALLBACK_DESCRIPTION} path="/" {jsonLd} />

<section class="border-b-2 border-gray-300 pb-4 dark:border-gray-600">
	<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">
		EVE Online Reactions Profit Calculator
	</h1>
	<p class="mt-1 max-w-4xl text-sm text-gray-600 sm:text-base dark:text-gray-400">
		Live profitability for every composite, biochemical and hybrid reaction: buy the inputs or run the full
		chain, with your own structure, rigs, system, market hubs, fees and shipping.
	</p>
	<div class="mt-3 flex flex-wrap gap-2">
		{#each Object.entries(REACTOR_LABEL) as [reactor, label] (reactor)}
			<a
				href={`/${reactor}`}
				class="rounded-md bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800"
				>{label} reactions</a
			>
		{/each}
		<a
			href="/planner"
			class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
			>Reaction planner</a
		>
	</div>
</section>

{#if data.home}
	{@const home = data.home}
	<dl class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Data status">
		<div class="rounded-lg bg-white px-4 py-3 text-sm dark:bg-gray-700">
			<dt class="text-gray-600 dark:text-gray-300">Prices updated</dt>
			<dd class="mt-0.5 text-base font-semibold text-gray-800 dark:text-white">
				<time datetime={new Date(home.status.pricesUpdatedAt).toISOString()}>{home.status.pricesAge}</time>
			</dd>
		</div>
		<div class="rounded-lg bg-white px-4 py-3 text-sm dark:bg-gray-700">
			<dt class="text-gray-600 dark:text-gray-300">Averages over</dt>
			<dd class="mt-0.5 text-base font-semibold text-gray-800 tabular-nums dark:text-white">
				{#if home.window}
					{home.window.days} days, {home.window.from} to {home.window.to}
				{:else}
					n/a
				{/if}
			</dd>
		</div>
		<div class="rounded-lg bg-white px-4 py-3 text-sm dark:bg-gray-700">
			<dt class="text-gray-600 dark:text-gray-300">Cost index (your system)</dt>
			{#each home.status.systems as system (system.systemName + system.costIndex)}
				<dd class="mt-0.5 text-base font-semibold text-gray-800 tabular-nums dark:text-white">
					{system.systemName}
					{system.costIndexMissing ? 'n/a' : formatPct(system.costIndex * 100, 2)}
				</dd>
			{/each}
		</div>
		<div class="rounded-lg bg-white px-4 py-3 text-sm dark:bg-gray-700">
			<dt class="text-gray-600 dark:text-gray-300">SDE build</dt>
			<dd class="mt-0.5 text-base font-semibold text-gray-800 tabular-nums dark:text-white">
				{home.status.sdeBuild} · {home.status.reactionCount} reactions
			</dd>
		</div>
	</dl>

	<section class="mt-5" aria-labelledby="boards-title">
		<h2 id="boards-title" class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">
			Best to build
		</h2>
		<p class="max-w-4xl text-sm text-gray-600 dark:text-gray-400">
			Final products ranked by their average profit per slot per day over the averaged days, each day priced
			at the daily average prices of your hubs, with your settings and the current cost index. A product is
			listed when it was profitable on at least half of those days and its region trades enough to absorb at
			least one slot ({home.maxSharePct}% of the daily volume).
			{#if home.window?.approximate}
				Where a hub has no daily price, the region's average is used.
			{/if}
		</p>
		<div class="mt-3 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
			{#each home.boards as board (board.reactor)}
				<ReactorBoard
					{board}
					subtitle={BOARD_SUBTITLE[board.reactor]}
					days={home.window?.days ?? 0}
					maxSharePct={home.maxSharePct}
					defaults={data.defaultTabs}
				/>
			{/each}
		</div>
	</section>

	<section class="mt-5" aria-labelledby="inputs-title">
		<h2 id="inputs-title" class="text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200">
			Input prices
		</h2>
		<p class="max-w-4xl text-sm text-gray-600 dark:text-gray-400">
			Materials bought for the full chains of these products: average traded price of the last 5 days against
			the last 30 days, in the region of your input hub.
		</p>
		{#if home.inputs.available}
			<div class="mt-3 grid gap-4 md:grid-cols-2">
				<RankedList
					title="Rising"
					items={home.inputs.up.map(inputItem)}
					empty={`No input rose by ${home.inputs.minPct}% or more.`}
				/>
				<RankedList
					title="Falling"
					items={home.inputs.down.map(inputItem)}
					empty={`No input fell by ${home.inputs.minPct}% or more.`}
				/>
			</div>
		{:else}
			<p class="mt-3 rounded-lg bg-white p-4 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-300">
				Market statistics are not available yet.
			</p>
		{/if}
	</section>
{:else}
	<div
		class="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
		role="status"
	>
		Market data is not available yet. Prices are refreshed every few minutes, please check back shortly.
	</div>
{/if}
