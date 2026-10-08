<script lang="ts">
	import { Input, Label } from 'flowbite-svelte';

	interface Props {
		/** Form field name = dotted settings path; also the error key. */
		name: string;
		label: string;
		value: number | null;
		min?: number;
		max?: number;
		step?: number | 'any';
		error?: string;
		/** Short help text below the field (hidden while an error is shown). */
		hint?: string;
		disabled?: boolean;
		placeholder?: string;
	}

	let {
		name,
		label,
		value = $bindable(),
		min,
		max,
		step = 'any',
		error,
		hint,
		disabled = false,
		placeholder
	}: Props = $props();

	const id = $props.id();
	const describedBy = $derived(error ? `${id}-error` : hint ? `${id}-hint` : undefined);
</script>

<div>
	<Label for={id} class="mb-1 block text-sm font-medium text-gray-900 dark:text-white">{label}</Label>
	<Input
		{id}
		{name}
		type="number"
		size="sm"
		{min}
		{max}
		{step}
		{disabled}
		{placeholder}
		bind:value={() => value ?? '', (v) => (value = v == null || v === '' ? null : Number(v))}
		aria-invalid={error ? true : undefined}
		aria-describedby={describedBy}
		class={[
			'rounded-md bg-gray-50 text-sm text-gray-900 tabular-nums disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200',
			error ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
		]}
	/>
	{#if error}
		<p id={`${id}-error`} class="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
	{:else if hint}
		<p id={`${id}-hint`} class="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
	{/if}
</div>
