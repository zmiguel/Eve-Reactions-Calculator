<script lang="ts">
	import { page } from '$app/state';
	import Seo from '$lib/seo/Seo.svelte';
	import { REACTOR_LABEL } from '$lib/site';

	const notFound = $derived(page.status === 404);
	const heading = $derived(
		notFound ? 'Page not found' : page.status < 500 ? 'Bad request' : 'Something went wrong'
	);
	// SvelteKit's default messages only repeat the heading; a message of our own explains what failed.
	const message = $derived(
		page.error && !['Not Found', 'Bad Request', 'Internal Error'].includes(page.error.message)
			? page.error.message
			: null
	);
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<Seo
	title={heading}
	description="This page of the EVE Online Reactions Calculator could not be shown."
	path={page.url.pathname}
	noindex
/>

<div class="mx-auto max-w-xl space-y-4 py-8">
	<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">{heading}</h1>
	{#if message}
		<p class="rounded-lg bg-white p-4 text-sm dark:bg-gray-700" data-error-message>{message}</p>
	{/if}
	<p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
		<a href="/" class={link}>Home</a>
		{#each Object.entries(REACTOR_LABEL) as [reactor, label] (reactor)}
			<a href="/{reactor}" class={link}>{label} reactions</a>
		{/each}
		<a href="/planner" class={link}>Planner</a>
		<a href="/profits" class={link}>Profits</a>
	</p>
</div>
