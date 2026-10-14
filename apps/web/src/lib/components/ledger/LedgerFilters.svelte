<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { withoutEmptyParams } from '$lib/ledger/forms';
	import type { LedgerConnectionOption, LedgerFilters, LedgerItemType } from '$lib/ledger/types';

	interface Props {
		filters: LedgerFilters;
		types: LedgerItemType[];
		connections: LedgerConnectionOption[];
	}

	let { filters, types, connections }: Props = $props();

	/** With JS every change applies at once; without it the Apply button submits the form. */
	let enhanced = $state(false);
	onMount(() => (enhanced = true));

	/** Applies the form with JS, leaving its empty fields out of the address. */
	function apply(form: HTMLFormElement) {
		void goto(withoutEmptyParams('/profits/ledger', new FormData(form)), {
			keepFocus: true,
			noScroll: true
		});
	}

	const PERIODS = [
		{ value: '', label: 'All time' },
		{ value: '7', label: '7 days' },
		{ value: '30', label: '30 days' },
		{ value: '90', label: '90 days' },
		{ value: '365', label: '1 year' }
	];
	const DIRECTIONS = [
		{ value: '', label: 'All' },
		{ value: 'in', label: 'Bought' },
		{ value: 'out', label: 'Sold' },
		{ value: 'transfer', label: 'Transfers' }
	];

	const filtered = $derived(
		filters.period !== null ||
			filters.typeId !== null ||
			filters.direction !== null ||
			filters.kind !== null ||
			filters.connection !== null ||
			filters.review
	);

	const field =
		'rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
	const label = 'flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400';
	const chip =
		'cursor-pointer px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 has-[:checked]:bg-primary-600 has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500 dark:text-gray-200 dark:hover:bg-gray-600 dark:has-[:checked]:bg-primary-600';
</script>

<form
	method="GET"
	action="/profits/ledger"
	class="flex flex-wrap items-end gap-3 rounded-lg bg-white p-3 text-sm dark:bg-gray-700"
	onchange={(e) => apply(e.currentTarget)}
	onsubmit={(e) => {
		e.preventDefault();
		apply(e.currentTarget);
	}}
	data-filters
>
	<label class={label}>
		Period
		<select name="period" class={field}>
			{#each PERIODS as p (p.value)}
				<option value={p.value} selected={String(filters.period ?? '') === p.value}>{p.label}</option>
			{/each}
		</select>
	</label>
	<fieldset class={label}>
		<legend class="mb-1">Direction</legend>
		<div
			class="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
		>
			{#each DIRECTIONS as d (d.value)}
				<label class={chip}>
					<input
						type="radio"
						name="direction"
						value={d.value}
						checked={(filters.direction ?? '') === d.value}
						class="sr-only"
					/>
					{d.label}
				</label>
			{/each}
		</div>
	</fieldset>
	<label class={label}>
		Kind
		<select name="kind" class={field}>
			<option value="">All kinds</option>
			<option value="market" selected={filters.kind === 'market'}>Market</option>
			<option value="contract" selected={filters.kind === 'contract'}>Contracts</option>
			<option value="manual" selected={filters.kind === 'manual'}>Entered by you</option>
		</select>
	</label>
	<label class={label}>
		Item
		<select name="type" class="{field} max-w-56">
			<option value="">All items</option>
			{#each types as t (t.typeId)}
				<option value={String(t.typeId)} selected={filters.typeId === t.typeId}>{t.name}</option>
			{/each}
		</select>
	</label>
	{#if connections.length > 1}
		<label class={label}>
			Connection
			<select name="connection" class={field}>
				<option value="">All connections</option>
				{#each connections as c (c.sourceId)}
					<option value={String(c.sourceId)} selected={filters.connection === c.sourceId}>{c.name}</option>
				{/each}
			</select>
		</label>
	{/if}
	<label
		class="flex cursor-pointer items-center gap-2 self-center pt-4 text-sm text-gray-700 dark:text-gray-300"
	>
		<input type="checkbox" name="review" value="1" checked={filters.review} class="peer sr-only" />
		<span
			class="relative h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4 dark:bg-gray-600"
			aria-hidden="true"
		></span>
		Needs review only
	</label>
	{#if !enhanced}
		<button
			type="submit"
			class="inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
			>Apply</button
		>
	{/if}
	{#if filtered}
		<a
			href="/profits/ledger"
			class="self-center pt-4 text-sm text-primary-700 hover:underline dark:text-primary-400"
			data-clear>Clear filters</a
		>
	{/if}
</form>
