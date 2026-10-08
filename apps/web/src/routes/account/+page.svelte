<script lang="ts">
	import { enhance } from '$app/forms';
	import CharacterRow from '$lib/components/account/CharacterRow.svelte';
	import { formatUtc } from '$lib/format';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	// Feature/token columns only mean something once a feature can be enabled or one is granted.
	const showAccess = $derived(
		data.offeredFeatures.length > 0 ||
			data.characters.some((c) => c.features.length > 0 || c.tokenStatus !== 'none')
	);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<Seo
	title="Account"
	description="Characters and settings sync of your EVE Online Reactions Calculator account."
	path="/account"
	noindex
/>

<div class="space-y-4 pb-4">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
	>
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Your account</h1>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				You can log in with any of these characters.
			</p>
		</div>
		{#if data.createdAt}
			<p class="text-xs text-gray-500 dark:text-gray-400">Account created {formatUtc(data.createdAt)}</p>
		{/if}
	</header>

	{#if data.notice || form?.error}
		<p
			role="status"
			class="rounded-md border px-3 py-2 text-sm {form?.error
				? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
				: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
		>
			{form?.error ?? data.notice}
		</p>
	{/if}

	<section class={card}>
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200">
				Characters <span class="text-gray-500 dark:text-gray-400">({data.characters.length})</span>
			</h2>
			<a href="/auth/login?purpose=add_character&returnTo=%2Faccount" data-sveltekit-reload class={button}
				>Add character</a
			>
		</div>
		<div class="overflow-x-auto">
			<table
				class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
			>
				<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
					<tr>
						<th class="px-3 py-2">Character</th>
						{#if showAccess}
							<th class="px-3 py-2">Features</th>
							<th class="px-3 py-2">Token</th>
							<th class="px-3 py-2">Last refresh</th>
						{/if}
						<th class="px-3 py-2 text-right"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.characters as character (character.characterId)}
						<CharacterRow
							{character}
							offeredFeatures={data.offeredFeatures}
							onlyCharacter={data.characters.length === 1}
							{showAccess}
						/>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<div class="grid gap-4 md:grid-cols-2">
		<section class={card}>
			<h2 class={heading}>Settings sync</h2>
			<p class="text-gray-700 dark:text-gray-300">
				Your calculator settings are stored on this account and follow you to every device you log in on.
			</p>
			<p class="mt-2 text-xs text-gray-600 dark:text-gray-400" data-settings-sync>
				{data.settingsUpdatedAt ? `Last saved ${formatUtc(data.settingsUpdatedAt)}` : 'Not saved yet'} ·
				<a href="/settings" class="text-primary-700 hover:underline dark:text-primary-400">Edit settings</a>
			</p>
		</section>

		<section class={card}>
			<h2 class={heading}>Delete account</h2>
			<p class="text-gray-700 dark:text-gray-300">
				Deletes your account, its characters and its synced settings. Settings saved in this browser stay.
			</p>
			<details class="mt-3">
				<summary class="{button} list-none text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
					>Delete account…</summary
				>
				<form method="POST" action="?/deleteAccount" use:enhance class="mt-2 space-y-2">
					<p class="text-xs font-semibold text-red-700 dark:text-red-400">
						This cannot be undone. Delete the account now?
					</p>
					<button
						type="submit"
						class="cursor-pointer rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
						>Yes, delete my account</button
					>
				</form>
			</details>
		</section>
	</div>
</div>
