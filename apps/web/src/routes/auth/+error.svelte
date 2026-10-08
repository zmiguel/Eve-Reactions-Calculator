<script lang="ts">
	import { page } from '$app/state';
	import Seo from '$lib/seo/Seo.svelte';

	const loggedIn = $derived(Boolean(page.data.user));
</script>

<Seo
	title="Login problem"
	description="The EVE Online login could not be completed."
	path={page.url.pathname}
	noindex
/>

<div class="mx-auto max-w-xl space-y-4 py-8">
	<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">
		{page.status === 404 ? 'Not found' : 'Login problem'}
	</h1>
	<p class="rounded-lg bg-white p-4 text-sm dark:bg-gray-700" data-auth-error>
		{page.error?.message ?? 'Something went wrong.'}
	</p>
	<p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
		{#if page.status !== 404}
			<a
				href={loggedIn ? '/account' : '/auth/login?purpose=login'}
				data-sveltekit-reload
				class="text-primary-700 hover:underline dark:text-primary-400"
				>{loggedIn ? 'Back to your account' : 'Log in again'}</a
			>
		{/if}
		<a href="/" class="text-primary-700 hover:underline dark:text-primary-400">Home</a>
	</p>
</div>
