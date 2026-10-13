<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { FEATURE_LABELS } from '$lib/account/features';
	import InventorySourceCard from '$lib/components/account/InventorySourceCard.svelte';
	import InventorySummary from '$lib/components/account/InventorySummary.svelte';
	import type { InventoryAllowLink } from '$lib/inventory/types';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const full = $derived(data.sources.length >= data.limit);
	let adding = $state(false);

	/** Seconds between data refreshes while a source is queued or syncing. */
	const REFRESH_SECONDS = 10;
	$effect(() => {
		if (!data.refreshing) return;
		const timer = setInterval(() => void invalidateAll(), REFRESH_SECONDS * 1000);
		return () => clearInterval(timer);
	});

	const failed = $derived(Boolean(form?.error) || form?.notice?.ok === false);
	// `fail(…, { error, allow })` may be folded into `{ error }` by the inferred action types.
	const allow = $derived((form as { allow?: InventoryAllowLink } | null)?.allow);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const small =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600';
	const field =
		'rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
</script>

<Seo
	title="Inventory"
	description="Assets of your characters and corporations, synced for your EVE Online Reactions Calculator account."
	path="/account/inventory"
	noindex
/>

<div class="space-y-4 pb-4">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
	>
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Inventory</h1>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Formulas and materials your characters and corporations already have, read from ESI.
			</p>
		</div>
		<a href="/account" class="text-sm text-primary-700 hover:underline dark:text-primary-400">Your account</a>
	</header>

	{#if form?.notice || form?.error}
		<div
			role="status"
			data-notice={failed ? 'error' : 'ok'}
			class="rounded-md border px-3 py-2 text-sm {failed
				? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
				: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
		>
			{form?.error ?? form?.notice?.text}
			{#if allow}
				<a href={allow.href} data-sveltekit-reload class="ml-1 font-semibold underline">Allow</a>
			{/if}
		</div>
	{/if}

	<section class={card}>
		<h2 class="mb-3 {heading}">Add inventory</h2>
		{#if full}
			<p class="mb-3 text-gray-500 dark:text-gray-400" data-limit>
				You have {data.limit} sources, the most an account can add. Remove one to add another.
			</p>
		{/if}
		{#if data.addGroups.length}
			<form
				method="POST"
				action="?/add"
				class="flex flex-wrap items-end gap-2"
				use:enhance={() => {
					adding = true;
					return async ({ update }) => {
						await update();
						adding = false;
					};
				}}
			>
				<label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
					Assets
					<select name="source" class="{field} max-w-full pr-8">
						{#each data.addGroups as group (group.label)}
							<optgroup label={group.label}>
								{#each group.options as option (option.value)}
									<option value={option.value} disabled={option.disabled}>{option.label}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				</label>
				<button type="submit" class={button} disabled={adding}>Add</button>
			</form>
			<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
				Adding a source starts its first sync. A character added to a corporation already on your list becomes
				another character that can read it.
			</p>
		{:else if !full && data.sources.length}
			<p class="text-gray-500 dark:text-gray-400" data-all-added>
				Every inventory your characters allow reading is already added.
			</p>
		{:else if !full}
			<p class="text-gray-500 dark:text-gray-400">No character allows reading assets yet.</p>
		{/if}
		{#if data.allowLinks.length}
			<ul class="mt-3 space-y-1" data-allow>
				{#each data.allowLinks as link (`${link.characterId}:${link.feature}`)}
					<li class="flex flex-wrap items-center gap-2">
						<span class="font-semibold text-gray-900 dark:text-gray-100">{link.characterName}</span>
						<span class="text-xs text-gray-600 dark:text-gray-400">{FEATURE_LABELS[link.feature]}</span>
						<a href={link.href} data-sveltekit-reload class="{small} text-primary-700 dark:text-primary-400"
							>Allow</a
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class={card}>
		<div class="mb-3 flex items-baseline gap-2">
			<h2 class={heading}>
				Sources <span class="text-gray-500 dark:text-gray-400">({data.sources.length}/{data.limit})</span>
			</h2>
			{#if data.refreshing}
				<span class="text-xs text-gray-500 dark:text-gray-400" data-refresh
					>Updating every {REFRESH_SECONDS} s</span
				>
			{/if}
		</div>
		{#if data.sources.length}
			<div class="space-y-3">
				{#each data.sources as source (source.sourceId)}
					<InventorySourceCard {source} />
				{/each}
			</div>
		{:else}
			<p class="text-gray-500 dark:text-gray-400">No sources yet.</p>
		{/if}
	</section>

	<section class={card}>
		<h2 class="mb-3 {heading}">What you have</h2>
		<InventorySummary summary={data.summary} />
	</section>
</div>
