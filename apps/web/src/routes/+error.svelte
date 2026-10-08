<script lang="ts">
	import { page } from '$app/state';
	import Seo from '$lib/seo/Seo.svelte';
	import { REACTOR_LABEL } from '$lib/site';

	const notFound = $derived(page.status === 404);
	const heading = $derived(
		notFound ? 'Page not found' : page.status < 500 ? 'Bad request' : 'Something went wrong'
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
	<p class="rounded-lg bg-white p-4 text-sm dark:bg-gray-700" data-error-message>
		{page.error?.message ?? 'Something went wrong.'}
	</p>
	<p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
		<a href="/" class={link}>Home</a>
		{#each Object.entries(REACTOR_LABEL) as [reactor, label] (reactor)}
			<a href="/{reactor}" class={link}>{label} reactions</a>
		{/each}
		<a href="/planner" class={link}>Planner</a>
	</p>
</div>
