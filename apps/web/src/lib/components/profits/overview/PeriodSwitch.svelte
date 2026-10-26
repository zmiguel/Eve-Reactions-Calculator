<script lang="ts" module>
	import type { ProfitPeriod } from '#lib/profits/types.js';

	/** Periods of the overview in switch order: short label and the words used in sentences. */
	export const PERIODS: readonly { value: ProfitPeriod; short: string; words: string }[] = [
		{ value: '7', short: '7 days', words: 'the last 7 days' },
		{ value: '30', short: '30 days', words: 'the last 30 days' },
		{ value: '90', short: '90 days', words: 'the last 90 days' },
		{ value: '365', short: '1 year', words: 'the last 365 days' },
		{ value: 'all', short: 'All time', words: 'all time' }
	];

	export const periodWords = (period: ProfitPeriod) => PERIODS.find((p) => p.value === period)!.words;
</script>

<script lang="ts">
	/**
	 * Segmented control of links (`?period=…`; the user's `defaultPeriod` is the bare `path`); changing
	 * the period starts every table on page 1.
	 */
	let {
		period,
		defaultPeriod = '30',
		path = '/profits'
	}: { period: ProfitPeriod; defaultPeriod?: ProfitPeriod; path?: string } = $props();
</script>

<nav
	aria-label="Period"
	class="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600"
>
	{#each PERIODS as p, i (p.value)}
		<a
			href={p.value === defaultPeriod ? path : `${path}?period=${p.value}`}
			aria-current={p.value === period ? 'page' : undefined}
			data-period={p.value}
			class="px-3 py-1.5 text-sm font-medium whitespace-nowrap {i > 0
				? 'border-l border-gray-200 dark:border-gray-600'
				: ''} {p.value === period
				? 'bg-primary-700 text-white dark:bg-primary-600'
				: 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}"
			>{p.short}</a
		>
	{/each}
</nav>
