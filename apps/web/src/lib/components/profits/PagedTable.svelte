<script lang="ts" module>
	/**
	 * The URL after the last in-place page change. `replaceState` leaves `page.url` at the URL the page
	 * loaded with, so the tables share this one: paging one keeps the pages of the others.
	 */
	let current = $state.raw<URL | null>(null);
</script>

<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { formatNumber } from '$lib/format';
	import { PAGE_SIZE, withPage, type Paged } from '$lib/paging';

	interface Props {
		/** The page the server rendered. */
		data: Paged<T>;
		/** Query parameter of this table's page (several tables on one page each have their own). */
		param: string;
		/**
		 * JSON endpoint answering `Paged<T>` for the current query string with `param` set: Next and
		 * Previous fetch it and swap the rows in place. Without JS they are plain links to the page.
		 */
		endpoint: string;
		/** Accessible name of the table. */
		label: string;
		/** `<tr>` with the header cells. */
		head: Snippet;
		/** One `<tr>` per row. */
		row: Snippet<[T]>;
		/** Shown instead of the table when there are no rows at all. */
		empty?: Snippet;
		/** Unit for "N jobs" in the pager (plural). */
		noun?: string;
	}

	let { data, param, endpoint, label, head, row, empty, noun = 'rows' }: Props = $props();

	/** Rows loaded by Next / Previous; reset when the server sends new data (filters, navigation). */
	let loaded = $state<Paged<T> | null>(null);
	let loading = $state(false);
	$effect(() => {
		void data;
		loaded = null;
		current = null;
	});
	const view = $derived(loaded ?? data);

	const href = (p: number) => withPage(current ?? page.url, param, p);

	async function go(event: MouseEvent, target: number) {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
			return;
		event.preventDefault();
		const next = href(target);
		loading = true;
		try {
			const query = next.includes('?') ? next.slice(next.indexOf('?')) : '';
			const response = await fetch(`${endpoint}${query}`, { headers: { accept: 'application/json' } });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			loaded = (await response.json()) as Paged<T>;
			replaceState(next, page.state);
			current = new URL(next, page.url);
		} catch {
			// Fall back to loading the whole page.
			window.location.href = next;
		} finally {
			loading = false;
		}
	}

	const first = $derived(view.total === 0 ? 0 : (view.page - 1) * PAGE_SIZE + 1);
	const last = $derived(Math.min(view.page * PAGE_SIZE, view.total));
	const pagerLink =
		'inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const pagerOff =
		'inline-flex cursor-default items-center rounded-md border border-gray-200 px-3 py-1 text-sm font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500';
</script>

{#if view.total === 0 && empty}
	{@render empty()}
{:else}
	<div class="relative overflow-x-auto" aria-busy={loading}>
		<table
			class="w-full text-left text-sm transition-opacity {loading ? 'opacity-50' : ''}"
			aria-label={label}
			data-paged={param}
		>
			<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
				{@render head()}
			</thead>
			<tbody>
				{#each view.rows as item, i (i)}
					{@render row(item)}
				{/each}
			</tbody>
		</table>
	</div>
	{#if view.pageCount > 1}
		<nav
			class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400"
			aria-label="{label} pages"
			data-pager={param}
		>
			<span data-range
				>{formatNumber(first)} to {formatNumber(last)} of {formatNumber(view.total)} {noun}</span
			>
			<span class="flex gap-2">
				{#if view.page > 1}
					<a href={href(view.page - 1)} rel="prev" class={pagerLink} onclick={(e) => go(e, view.page - 1)}
						>Previous</a
					>
				{:else}
					<span class={pagerOff} aria-disabled="true">Previous</span>
				{/if}
				{#if view.page < view.pageCount}
					<a href={href(view.page + 1)} rel="next" class={pagerLink} onclick={(e) => go(e, view.page + 1)}
						>Next</a
					>
				{:else}
					<span class={pagerOff} aria-disabled="true">Next</span>
				{/if}
			</span>
		</nav>
	{/if}
{/if}
