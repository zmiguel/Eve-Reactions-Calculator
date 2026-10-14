<script lang="ts" module>
	import type { JobFilters, JobPeriod, JobSort } from '$lib/jobs/types';

	export const PERIODS: readonly [JobPeriod, string][] = [
		['7', '7 days'],
		['30', '30 days'],
		['90', '90 days'],
		['365', '1 year'],
		['all', 'All time']
	];

	export const SORTS: readonly [JobSort, string][] = [
		['newest', 'Newest'],
		['profit_desc', 'Most profitable'],
		['profit_asc', 'Least profitable'],
		['spent', 'Highest total cost'],
		['ending', 'Ending soonest']
	];

	/**
	 * `/profits/jobs` with `filters` as the query string (defaults left out, `defaultPeriod` being the
	 * user's default period; the table goes back to page 1). `overrides` change single filters, e.g. the
	 * "show all periods" link of the empty state.
	 */
	export function jobsHref(
		filters: JobFilters,
		overrides: Partial<JobFilters> = {},
		defaultPeriod: JobPeriod = '30'
	): string {
		const f = { ...filters, ...overrides };
		const params: [string, string][] = [];
		if (f.status) params.push(['status', f.status]);
		if (f.period !== defaultPeriod) params.push(['period', f.period]);
		if (f.formula !== null) params.push(['reaction', String(f.formula)]);
		if (f.connection !== null) params.push(['connection', String(f.connection)]);
		if (f.sort !== 'newest') params.push(['sort', f.sort]);
		const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return query ? `/profits/jobs?${query}` : '/profits/jobs';
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { JobConnectionOption, JobFormula, JobStatus, JobStatusCounts } from '$lib/jobs/types';
	import { formatNumber } from '$lib/format';

	interface Props {
		filters: JobFilters;
		/** The user's default period (left out of the URL). */
		defaultPeriod?: JobPeriod;
		counts: JobStatusCounts;
		formulas: JobFormula[];
		connections: JobConnectionOption[];
	}

	let { filters, defaultPeriod = '30', counts, formulas, connections }: Props = $props();

	/** With JS the form applies itself on every change and the Filter button is hidden. */
	let live = $state(false);
	onMount(() => {
		live = true;
	});

	const STATUSES: readonly [JobStatus | '', string][] = [
		['', 'All'],
		['running', 'Running'],
		['finished', 'Finished'],
		['cancelled', 'Cancelled']
	];

	function apply(event: Event) {
		const form = event.currentTarget as HTMLFormElement;
		const data = new FormData(form);
		const value = (name: string) => {
			const v = data.get(name);
			return typeof v === 'string' && v !== '' ? v : null;
		};
		void goto(
			jobsHref(
				{
					status: value('status') as JobStatus | null,
					period: (value('period') ?? defaultPeriod) as JobPeriod,
					formula: value('reaction') === null ? null : Number(value('reaction')),
					connection: value('connection') === null ? null : Number(value('connection')),
					sort: (value('sort') ?? 'newest') as JobSort
				},
				{},
				defaultPeriod
			),
			{ keepFocus: true, noScroll: true }
		);
	}

	const filtered = $derived(jobsHref(filters, {}, defaultPeriod) !== '/profits/jobs');
	const field =
		'rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
	const label = 'flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<form
	method="GET"
	action="/profits/jobs"
	class="flex flex-wrap items-end gap-3 rounded-lg bg-white p-3 text-sm dark:bg-gray-700"
	onchange={apply}
	onsubmit={(e) => {
		e.preventDefault();
		apply(e);
	}}
	data-filters
>
	<fieldset class="flex flex-col gap-1">
		<legend class="mb-1 text-xs text-gray-600 dark:text-gray-400">Status</legend>
		<div
			class="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600"
			data-status-filter
		>
			{#each STATUSES as [value, text] (value)}
				<label class="relative cursor-pointer" data-status-option={value || 'all'}>
					<input
						type="radio"
						name="status"
						{value}
						checked={(filters.status ?? '') === value}
						class="peer sr-only"
					/>
					<span
						class="flex items-center gap-1.5 border-l border-gray-300 bg-white px-3 py-1.5 text-gray-700 peer-checked:bg-primary-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 hover:bg-gray-100 peer-checked:hover:bg-primary-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600 {value ===
						''
							? 'border-l-0'
							: ''}"
					>
						{text}
						<span class="text-xs tabular-nums opacity-75" data-count
							>{formatNumber(counts[(value || 'all') as keyof JobStatusCounts])}</span
						>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>
	<label class={label}>
		Period
		<select name="period" class={field}>
			{#each PERIODS as [value, text] (value)}
				<option {value} selected={filters.period === value}>{text}</option>
			{/each}
		</select>
	</label>
	<label class={label}>
		Reaction
		<select name="reaction" class="{field} max-w-60">
			<option value="">All reactions</option>
			{#each formulas as f (f.blueprintTypeId)}
				<option value={String(f.blueprintTypeId)} selected={filters.formula === f.blueprintTypeId}
					>{f.name ?? 'Unknown formula'}</option
				>
			{/each}
		</select>
	</label>
	{#if connections.length > 1 || filters.connection !== null}
		<label class={label}>
			Character or corporation
			<select name="connection" class={field}>
				<option value="">All</option>
				{#each connections as c (c.sourceId)}
					<option value={String(c.sourceId)} selected={filters.connection === c.sourceId}>{c.name}</option>
				{/each}
			</select>
		</label>
	{/if}
	<label class={label}>
		Sort
		<select name="sort" class={field}>
			{#each SORTS as [value, text] (value)}
				<option {value} selected={filters.sort === value}>{text}</option>
			{/each}
		</select>
	</label>
	{#if !live}
		<button
			type="submit"
			class="inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
			data-filter-submit>Filter</button
		>
	{/if}
	{#if filtered}<a href="/profits/jobs" class="self-center text-sm {link}" data-clear>Clear filters</a>{/if}
</form>
