<script lang="ts">
	import { enhance } from '$app/forms';
	import StructureRow from '$lib/components/account/StructureRow.svelte';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const ready = $derived(data.characters.filter((c) => c.ready));
	const full = $derived(data.links.length >= data.limit);
	let searching = $state(false);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const small =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600';
	const field =
		'rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500';
	const table =
		'w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
</script>

<Seo
	title="Structure markets"
	description="Player structure markets linked to your EVE Online Reactions Calculator account."
	path="/account/structures"
	noindex
/>

<div class="space-y-4 pb-4">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
	>
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Structure markets</h1>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Price reactions with the markets of structures your characters can dock at.
			</p>
		</div>
		<a href="/account" class="text-sm text-primary-700 hover:underline dark:text-primary-400">Your account</a>
	</header>

	{#if form?.notice || form?.error}
		<p
			role="status"
			class="rounded-md border px-3 py-2 text-sm {form?.error
				? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
				: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
		>
			{form?.error ?? form?.notice}
		</p>
	{/if}

	<section class={card}>
		<h2 class="mb-3 {heading}">
			Your markets <span class="text-gray-500 dark:text-gray-400">({data.links.length}/{data.limit})</span>
		</h2>
		{#if data.links.length}
			<div class="overflow-x-auto">
				<table class={table}>
					<thead class={thead}>
						<tr>
							<th class="px-3 py-2">Market</th>
							<th class="px-3 py-2">Status</th>
							<th class="px-3 py-2">Visibility</th>
							<th class="px-3 py-2">Sharing</th>
							<th class="px-3 py-2">Character</th>
							<th class="px-3 py-2 text-right"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.links as link (link.structureId)}
							<StructureRow {link} now={data.now} />
						{/each}
					</tbody>
				</table>
			</div>
			<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
				Shared markets become public once an admin approves them.
			</p>
		{:else}
			<p class="text-gray-500 dark:text-gray-400">No markets yet.</p>
		{/if}
	</section>

	<section class={card}>
		<h2 class="mb-3 {heading}">Add a market</h2>
		{#if ready.length === 0}
			<p class="mb-2 text-gray-700 dark:text-gray-300">Searching needs a character with structure markets.</p>
			<ul class="space-y-1">
				{#each data.characters as character (character.characterId)}
					<li class="flex items-center gap-2">
						<span class="font-semibold text-gray-900 dark:text-gray-100">{character.name}</span>
						<a
							href="/auth/login?purpose=feature&feature=structures&characterId={character.characterId}&returnTo=%2Faccount%2Fstructures"
							data-sveltekit-reload
							class="{small} text-primary-700 dark:text-primary-400">Enable structure markets</a
						>
					</li>
				{/each}
			</ul>
		{:else if full}
			<p class="text-gray-500 dark:text-gray-400">
				You have {data.limit} markets, the most an account can link. Remove one to add another.
			</p>
		{:else}
			<form
				method="POST"
				action="?/search"
				class="flex flex-wrap items-end gap-2"
				use:enhance={() => {
					searching = true;
					return async ({ update }) => {
						await update({ reset: false });
						searching = false;
					};
				}}
			>
				<label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
					Character
					<select name="characterId" class="{field} max-w-full pr-8">
						{#each ready as character (character.characterId)}
							<option
								value={character.characterId}
								selected={form?.search?.characterId === character.characterId}>{character.name}</option
							>
						{/each}
					</select>
				</label>
				<label class="flex grow flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
					Structure name
					<input
						type="search"
						name="q"
						required
						minlength="3"
						value={form?.search?.query ?? ''}
						placeholder="At least 3 characters"
						class={field}
					/>
				</label>
				<button type="submit" class={button} disabled={searching}>Search</button>
			</form>

			{#if form?.search}
				<div class="mt-3" data-search-results>
					{#if form.search.error}
						<p class="text-red-700 dark:text-red-400">{form.search.error}</p>
					{:else if !form.search.results?.length}
						<p class="text-gray-500 dark:text-gray-400">No structures found</p>
					{:else}
						<div class="overflow-x-auto">
							<table class={table}>
								<thead class={thead}>
									<tr>
										<th class="px-3 py-2">Structure</th>
										<th class="px-3 py-2">System</th>
										<th class="px-3 py-2">Region</th>
										<th class="px-3 py-2 text-right"><span class="sr-only">Actions</span></th>
									</tr>
								</thead>
								<tbody>
									{#each form.search.results as result (result.structureId)}
										<tr class="border-t border-gray-200 dark:border-gray-700">
											<td class="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">{result.name}</td>
											<td class="px-3 py-2 text-gray-700 dark:text-gray-300">{result.systemName ?? 'n/a'}</td>
											<td class="px-3 py-2 text-gray-700 dark:text-gray-300">{result.regionName ?? 'n/a'}</td>
											<td class="px-3 py-2 text-right">
												{#if result.linked}
													<span class="text-xs text-gray-500 dark:text-gray-400">Added</span>
												{:else}
													<form method="POST" action="?/add" use:enhance>
														<input type="hidden" name="structureId" value={result.structureId} />
														<input type="hidden" name="characterId" value={form.search.characterId} />
														<button type="submit" class="{small} text-primary-700 dark:text-primary-400"
															>Add</button
														>
													</form>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</div>
