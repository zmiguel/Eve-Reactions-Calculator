<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { sourceStatusText } from '#lib/components/account/ConnectionCard.svelte';
	import InventoryPlaces from '#lib/components/account/InventoryPlaces.svelte';
	import InventorySummary from '#lib/components/account/InventorySummary.svelte';
	import { formatUtc } from '#lib/format.js';
	import Seo from '#lib/seo/Seo.svelte';

	let { data, form } = $props();

	/** Seconds between data refreshes while a connection is queued or syncing. */
	const REFRESH_SECONDS = 10;
	$effect(() => {
		if (!data.refreshing) return;
		const timer = setInterval(() => void refreshAll(), REFRESH_SECONDS * 1000);
		return () => clearInterval(timer);
	});

	const failed = $derived(Boolean(form?.error) || form?.notice?.ok === false);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<Seo
	title="Inventory"
	description="Assets of your characters and corporations, synced for your EVE Online Reactions Calculator account."
	path="/account/inventory"
	noindex
/>

<div class="space-y-4 pb-4">
	<header class="border-b-2 border-gray-300 pb-3 dark:border-gray-600">
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Inventory</h1>
		<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
			Formulas and materials your characters and corporations already have, read from ESI.
		</p>
	</header>

	{#if form?.notice || form?.error}
		<div
			role={failed ? 'alert' : 'status'}
			data-notice={failed ? 'error' : 'ok'}
			class="rounded-md border px-3 py-2 text-sm {failed
				? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
				: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
		>
			{form?.error ?? form?.notice?.text}
		</div>
	{/if}

	<section class={card}>
		<div class="mb-3 flex items-baseline gap-2">
			<h2 class={heading}>Places</h2>
			{#if data.refreshing}
				<span class="text-xs text-gray-500 dark:text-gray-400" data-refresh
					>Updating every {REFRESH_SECONDS} s</span
				>
			{/if}
		</div>
		{#if data.sources.length}
			<div class="space-y-3">
				{#each data.sources as source (source.sourceId)}
					<article
						class="rounded-lg border border-gray-200 p-3 dark:border-gray-600"
						data-source={source.sourceId}
						aria-label={source.ownerName}
					>
						<div class="mb-3">
							<h3 class="font-semibold text-gray-900 dark:text-gray-100">
								{source.ownerName}
								<span class="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400"
									>{source.kind === 'corporation' ? 'Corporation assets' : 'Personal assets'}</span
								>
							</h3>
							<p class="text-xs text-gray-500 dark:text-gray-400" data-status>
								{sourceStatusText(source)} ·
								{source.lastSyncedAt ? `Synced ${formatUtc(source.lastSyncedAt)}` : 'Not synced yet'}
							</p>
						</div>
						{#if source.places.length || source.lastSyncedAt}
							<InventoryPlaces
								sourceId={source.sourceId}
								characterName={source.characterName}
								places={source.places}
							/>
						{/if}
					</article>
				{/each}
			</div>
			<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
				Sync, switches, readers and removing: <a href="/account/connections" class={link}>Connections</a>.
			</p>
		{:else}
			<p class="text-gray-500 dark:text-gray-400" data-no-connections>
				No connection has Inventory on. Add a connection or switch Inventory on for one on
				<a href="/account/connections" class={link}>Connections</a>.
			</p>
		{/if}
	</section>

	<section class={card}>
		<h2 class="mb-3 {heading}">What you have</h2>
		<InventorySummary summary={data.summary} />
	</section>
</div>
