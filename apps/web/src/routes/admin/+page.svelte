<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import JobsTable from '$lib/components/admin/JobsTable.svelte';
	import { formatNumber, formatRelative, formatUtc } from '$lib/format';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const row = 'flex justify-between gap-4 py-1';
	const label = 'text-gray-600 dark:text-gray-400';
	const value = 'font-semibold text-gray-800 tabular-nums dark:text-gray-200';

	const totalPrices = $derived(data.prices.reduce((sum, p) => sum + p.rows, 0));

	/** Seconds between data refreshes while a loaded run (latest or history) is still running. */
	const REFRESH_SECONDS = 10;
	const anyRunning = $derived(data.jobs.some((job) => job.runs.some((r) => r.status === 'running')));
	$effect(() => {
		if (!anyRunning) return;
		const timer = setInterval(() => void invalidateAll(), REFRESH_SECONDS * 1000);
		return () => clearInterval(timer);
	});
</script>

<Seo title="Admin" description="Site administration." path="/admin" noindex />

<div class="space-y-4 pb-4">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
	>
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Admin</h1>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Updater jobs, data freshness and manual triggers.
			</p>
		</div>
		<a href="/admin/hubs" class="text-sm text-primary-700 hover:underline dark:text-primary-400"
			>Market hubs</a
		>
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
		<div class="mb-3 flex items-baseline gap-2">
			<h2 class="text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200">Jobs</h2>
			{#if anyRunning}
				<span class="text-xs text-gray-500 dark:text-gray-400" data-refresh
					>Updating every {REFRESH_SECONDS} s</span
				>
			{/if}
		</div>
		<JobsTable jobs={data.jobs} now={data.now} />
	</section>

	<div class="grid gap-4 md:grid-cols-3">
		<section class={card}>
			<h2 class={heading}>SDE</h2>
			{#if data.sde}
				<div class={row}>
					<span class={label}>Build</span><span class={value}>{data.sde.buildNumber}</span>
				</div>
				<div class={row}>
					<span class={label}>Released</span><span class={value}>{data.sde.releaseDate}</span>
				</div>
				<div class={row}>
					<span class={label}>Imported</span>
					<span class={value} title={formatUtc(data.sde.importedAt)}
						>{formatRelative(data.sde.importedAt, data.now)}</span
					>
				</div>
			{:else}
				<p class="text-gray-500 dark:text-gray-400">No SDE imported yet.</p>
			{/if}
		</section>

		<section class={card}>
			<h2 class={heading}>Latest prices by source</h2>
			{#each data.prices as source (source.source)}
				<div class={row} data-source={source.source}>
					<span class={label}>{source.source}</span><span class={value}>{formatNumber(source.rows)}</span>
				</div>
			{:else}
				<p class="text-gray-500 dark:text-gray-400">No prices stored.</p>
			{/each}
			{#if data.prices.length > 1}
				<div class="{row} border-t border-gray-200 dark:border-gray-600">
					<span class={label}>Total</span><span class={value}>{formatNumber(totalPrices)}</span>
				</div>
			{/if}
		</section>

		<section class={card}>
			<h2 class={heading}>Structure hubs with errors</h2>
			{#each data.hubErrors as hub (hub.hubId)}
				<div class="py-1">
					<span class="font-semibold text-gray-800 dark:text-gray-200">{hub.name}</span>
					<span class="block text-xs text-red-600 dark:text-red-400">{hub.lastError}</span>
					<span class="block text-xs text-gray-500 dark:text-gray-400"
						>Last success: {hub.lastSuccessAt ? formatUtc(hub.lastSuccessAt) : 'never'}</span
					>
				</div>
			{:else}
				<p class="text-gray-500 dark:text-gray-400">None.</p>
			{/each}
		</section>
	</div>
</div>
