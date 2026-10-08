<script lang="ts">
	import { Label, Select } from 'flowbite-svelte';
	import type { Option } from '$lib/settings/fields';

	interface Props {
		/** Form field name = dotted settings path; also the error key. */
		name: string;
		label: string;
		value: string;
		items: Option[];
		error?: string;
		/** Short help text below the field (hidden while an error is shown). */
		hint?: string;
	}

	let { name, label, value = $bindable(), items, error, hint }: Props = $props();

	const id = $props.id();
	const describedBy = $derived(error ? `${id}-error` : hint ? `${id}-hint` : undefined);
</script>

<div>
	<Label for={id} class="mb-1 block text-sm font-medium text-gray-900 dark:text-white">{label}</Label>
	<Select
		{id}
		{name}
		size="sm"
		placeholder=""
		{items}
		bind:value
		aria-invalid={error ? true : undefined}
		aria-describedby={describedBy}
		classes={{
			select: [
				'rounded-md bg-gray-50 pr-8 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-200',
				error ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
			].join(' ')
		}}
	/>
	{#if error}
		<p id={`${id}-error`} class="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
	{:else if hint}
		<p id={`${id}-hint`} class="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
	{/if}
</div>
