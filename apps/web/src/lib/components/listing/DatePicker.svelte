<script lang="ts">
	import { Input, Label } from 'flowbite-svelte';
	import { goto } from '$app/navigation';

	interface Props {
		/** Selected `YYYY-MM-DD`, or `null` for live prices. */
		value: string | null;
		min: string;
		max: string;
		/** Page path; navigates to `path?date=…`, or to `path` when cleared. */
		path: string;
	}

	let { value, min, max, path }: Props = $props();

	const inputId = $props.id();
	let invalid = $state(false);

	function apply(date: string) {
		if (date === '') {
			invalid = false;
			if (value !== null) goto(path);
			return;
		}
		invalid = !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < min || date > max;
		if (!invalid && date !== value) goto(`${path}?date=${date}`);
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<Label for={inputId} class="text-sm font-medium whitespace-nowrap text-gray-700 dark:text-gray-300"
		>Prices as of</Label
	>
	<div class="w-40">
		<Input
			id={inputId}
			type="date"
			size="sm"
			{min}
			{max}
			value={value ?? ''}
			onchange={(e: Event) => apply((e.currentTarget as HTMLInputElement).value)}
			aria-invalid={invalid}
			class="rounded-md border-gray-300 bg-white py-1.5 text-sm text-gray-900 tabular-nums dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
		/>
	</div>
	{#if value !== null}
		<button
			type="button"
			class="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
			onclick={() => apply('')}
		>
			Live prices
		</button>
	{/if}
	{#if invalid}
		<p class="w-full text-sm text-red-600 dark:text-red-400">Pick a date between {min} and {max}.</p>
	{/if}
</div>
