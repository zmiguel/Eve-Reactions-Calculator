<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { FEATURE_LABELS } from '$lib/account/features';
	import ConnectionCard from '$lib/components/account/ConnectionCard.svelte';
	import type { InventoryAllowLink } from '$lib/inventory/types';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const full = $derived(data.sources.length >= data.limit);
	let adding = $state(false);

	/** Seconds between data refreshes while a connection is queued or syncing. */
	const REFRESH_SECONDS = 10;
	$effect(() => {
		if (!data.refreshing) return;
		const timer = setInterval(() => void invalidateAll(), REFRESH_SECONDS * 1000);
		return () => clearInterval(timer);
	});

	const failed = $derived(Boolean(form?.error) || form?.notice?.ok === false);
	// `fail(…, { error, allow })` may be folded into `{ error }` by the inferred action types.
	const allow = $derived((form as { allow?: InventoryAllowLink } | null)?.allow);

	/** Allow links per character (the server lists each character's links together). */
	const allowByCharacter = $derived(
		data.allowLinks.reduce<{ characterId: number; name: string; links: InventoryAllowLink[] }[]>(
			(groups, link) => {
				const last = groups.at(-1);
				if (last?.characterId === link.characterId) last.links.push(link);
				else groups.push({ characterId: link.characterId, name: link.characterName, links: [link] });
				return groups;
			},
			[]
		)
	);

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
	title="Connections"
	description="Characters and corporations your EVE Online Reactions Calculator account reads assets and profit tracking data from."
	path="/account/connections"
	noindex
/>

<div class="space-y-4 pb-4">
	<header class="border-b-2 border-gray-300 pb-3 dark:border-gray-600">
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Connections</h1>
		<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
			Characters and corporations this account reads from ESI. Inventory reads their assets (choose the places
			to use on the
			<a href="/account/inventory" class="text-primary-700 hover:underline dark:text-primary-400">Inventory</a
			> page); Profit tracking reads their industry jobs, blueprints, wallet, market orders and contracts.
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
			{#if allow}
				<a href={allow.href} data-sveltekit-reload class="ml-1 font-semibold underline">Allow</a>
			{/if}
		</div>
	{/if}

	<section class={card}>
		<h2 class="mb-3 {heading}">Add a connection</h2>
		{#if full}
			<p class="mb-3 text-gray-500 dark:text-gray-400" data-limit>
				You have {data.limit} connections, the most an account can add. Remove one to add another.
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
					Connection
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
				A new connection has Inventory on when its character allows (corporation) assets and Profit tracking
				on when it allows (corporation) profit tracking, and starts their first syncs. A character added to a
				corporation already on your list becomes another character that can read it.
			</p>
		{:else if !full && data.sources.length}
			<p class="text-gray-500 dark:text-gray-400" data-all-added>
				Every character and corporation your characters allow reading is already connected.
			</p>
		{:else if !full}
			<p class="text-gray-500 dark:text-gray-400">
				No character allows reading assets or profit tracking data yet.
			</p>
		{/if}
		{#if allowByCharacter.length}
			<ul class="mt-3 space-y-1" data-allow>
				{#each allowByCharacter as character (character.characterId)}
					<li class="flex flex-wrap items-center gap-2" data-allow-character={character.characterId}>
						<span class="font-semibold text-gray-900 dark:text-gray-100">{character.name}</span>
						<span class="text-xs text-gray-600 dark:text-gray-400">Allow:</span>
						{#each character.links as link (link.feature)}
							<a
								href={link.href}
								data-sveltekit-reload
								aria-label="Allow {FEATURE_LABELS[link.feature]} for {character.name}"
								class="{small} text-primary-700 dark:text-primary-400">{FEATURE_LABELS[link.feature]}</a
							>
						{/each}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class={card}>
		<div class="mb-3 flex items-baseline gap-2">
			<h2 class={heading}>
				Your connections <span class="text-gray-500 dark:text-gray-400"
					>({data.sources.length}/{data.limit})</span
				>
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
					<ConnectionCard {source} />
				{/each}
			</div>
		{:else}
			<p class="text-gray-500 dark:text-gray-400">No connections yet.</p>
		{/if}
	</section>
</div>
