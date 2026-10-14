<script lang="ts">
	import { SSO_BUTTON } from '../AccountMenu.svelte';

	let { access, loginHref }: { access: 'login' | 'enable'; loginHref: string } = $props();

	const card = 'rounded-lg bg-white p-6 text-sm dark:bg-gray-700';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<section class="{card} max-w-2xl space-y-4" data-profits-gate={access}>
	{#if access === 'login'}
		<h2 class="text-lg font-semibold text-gray-900 dark:text-white">Log in to see your profits</h2>
		<p class="text-gray-700 dark:text-gray-300">
			Profits follows the reaction jobs, trades and contracts of your characters and corporations, works out
			what each job cost and what its output earned, and shows where every price comes from.
		</p>
		<a href={loginHref} data-sveltekit-reload class="inline-block">
			<img src={SSO_BUTTON.black} alt="Log in with EVE Online" class="dark:hidden" />
			<img src={SSO_BUTTON.white} alt="Log in with EVE Online" class="hidden dark:inline" />
		</a>
	{:else}
		<h2 class="text-lg font-semibold text-gray-900 dark:text-white">Switch on profit tracking</h2>
		<p class="text-gray-700 dark:text-gray-300">
			None of your connections has Profit tracking on yet. Once it is on, your reaction jobs, wallet trades
			and contracts are read from EVE every hour and their profit shows up here.
		</p>
		<ol class="list-decimal space-y-1 ps-5 text-gray-700 dark:text-gray-300">
			<li>
				On <a href="/account/connections" class={link}>Connections</a>, allow "Profit tracking" for a
				character (or "Corporation profit tracking" for a corporation you have the roles in).
			</li>
			<li>Switch Profit tracking on for that connection.</li>
			<li>
				Optionally, check the contract prices and facilities on
				<a href="/account/tracking" class={link}>Profit tracking settings</a>.
			</li>
		</ol>
	{/if}
</section>
