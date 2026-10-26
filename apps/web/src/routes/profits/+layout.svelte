<script lang="ts" module>
	/** The profits pages, in tab order. */
	export const PROFITS_TABS = [
		{ href: '/profits', label: 'Overview' },
		{ href: '/profits/jobs', label: 'Jobs' },
		{ href: '/profits/ledger', label: 'Ledger' }
	] as const;
</script>

<script lang="ts">
	import TabNav from '#lib/components/TabNav.svelte';
	import ProfitsGate from '#lib/components/profits/ProfitsGate.svelte';
	import Seo from '#lib/seo/Seo.svelte';

	let { data, children } = $props();
</script>

{#if data.access === 'ok'}
	<TabNav label="Profits pages" tabs={PROFITS_TABS} />
	{@render children()}
{:else}
	<Seo
		title="Profits"
		description="Profit of your EVE Online reaction jobs, trades and contracts."
		path="/profits"
		noindex
	/>
	<div class="space-y-4 pb-4">
		<header class="border-b-2 border-gray-300 pb-3 dark:border-gray-600">
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Profits</h1>
		</header>
		<ProfitsGate access={data.access} loginHref={data.loginHref} />
	</div>
{/if}
