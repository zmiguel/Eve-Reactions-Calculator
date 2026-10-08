<script lang="ts">
	import HubsAdminTable from '$lib/components/admin/HubsAdminTable.svelte';
	import PendingHubsTable from '$lib/components/admin/PendingHubsTable.svelte';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const pending = $derived(data.hubs.filter((h) => h.kind === 'structure' && h.shareStatus === 'pending'));
	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
</script>

<Seo title="Market hubs" description="Market hub administration." path="/admin/hubs" noindex />

<div class="space-y-4 pb-4">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
	>
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Market hubs</h1>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Order and availability of public hubs, and review of shared structure markets.
			</p>
		</div>
		<a href="/admin" class="text-sm text-primary-700 hover:underline dark:text-primary-400">Admin</a>
	</header>

	{#if form?.notice}
		<p
			role="status"
			data-notice={form.notice.ok ? 'ok' : 'error'}
			class="rounded-md border px-3 py-2 text-sm {form.notice.ok
				? 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'
				: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'}"
		>
			{form.notice.text}
		</p>
	{/if}

	<section class={card}>
		<h2 class={heading}>
			Waiting for review <span class="text-gray-500 dark:text-gray-400">({pending.length})</span>
		</h2>
		<PendingHubsTable hubs={pending} />
	</section>

	<section class={card}>
		<h2 class={heading}>
			All hubs <span class="text-gray-500 dark:text-gray-400">({data.hubs.length})</span>
		</h2>
		<HubsAdminTable hubs={data.hubs} now={data.now} />
	</section>
</div>
