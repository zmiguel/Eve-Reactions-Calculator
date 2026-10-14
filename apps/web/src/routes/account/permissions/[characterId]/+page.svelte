<script lang="ts">
	import PermissionsForm from '$lib/components/account/PermissionsForm.svelte';
	import Seo from '$lib/seo/Seo.svelte';

	let { data } = $props();
</script>

<Seo
	title="Permissions of {data.character.name}"
	description="Choose what this site may read for one of your EVE Online characters."
	path="/account/permissions/{data.character.characterId}"
	noindex
/>

<div class="space-y-4 pb-4">
	<header class="border-b-2 border-gray-300 pb-3 dark:border-gray-600">
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">
			Permissions of {data.character.name}
		</h1>
	</header>
	<section class="max-w-2xl rounded-lg bg-white p-4 dark:bg-gray-700">
		<PermissionsForm character={data.character} offeredFeatures={data.offeredFeatures}>
			{#snippet actions()}
				<a
					href="/account"
					class="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
					>Cancel</a
				>
			{/snippet}
		</PermissionsForm>
	</section>
</div>
