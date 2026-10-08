<script lang="ts">
	import type { PasteResult } from '$lib/planner/parsePaste';

	interface Props {
		label: string;
		/** One-line help below the textarea. */
		hint: string;
		text: string;
		result: PasteResult;
		/** Word for a matched entry (`item`, `formula`). */
		noun: string;
		placeholder?: string;
	}

	let { label, hint, text = $bindable(), result, noun, placeholder }: Props = $props();

	const id = $props.id();
	const count = $derived(Object.keys(result.quantities).length);
</script>

<details class="rounded-md border border-gray-200 dark:border-gray-600" data-paste={noun}>
	<summary
		class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium text-gray-800 dark:text-gray-200"
	>
		<span>{label}</span>
		<span class="text-xs font-normal text-gray-500 tabular-nums dark:text-gray-400">
			{count}
			{count === 1 ? noun : `${noun}s`}
			{#if result.errors.length > 0}
				· <span class="text-red-600 dark:text-red-400">{result.errors.length} not recognised</span>
			{/if}
		</span>
	</summary>
	<div class="space-y-1 px-3 pb-2">
		<textarea
			{id}
			rows="4"
			class="block w-full rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-xs text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
			aria-label={label}
			aria-describedby="{id}-hint"
			spellcheck="false"
			{placeholder}
			bind:value={text}
		></textarea>
		<p id="{id}-hint" class="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
		{#if result.errors.length > 0}
			<ul class="space-y-0.5 text-xs text-red-600 dark:text-red-400" aria-label="{label} errors">
				{#each result.errors as e (e.line)}
					<li>
						Line {e.line}: {e.reason === 'unknown_name'
							? `“${e.text}” is not a known ${noun}`
							: `“${e.text}” is not a quantity`}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</details>
