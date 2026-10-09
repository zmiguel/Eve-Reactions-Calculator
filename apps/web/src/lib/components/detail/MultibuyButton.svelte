<script lang="ts">
	interface Props {
		/** Multibuy text (`Name<TAB>Quantity` lines) from `lineItemsMultibuy()`. */
		text: string;
	}

	let { text }: Props = $props();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let open = $state(false);
	const count = $derived(text === '' ? 0 : text.split('\n').length);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			status = 'copied';
		} catch {
			// No clipboard permission (or no secure context): fall back to the selectable list.
			status = 'failed';
			open = true;
		}
	}

	$effect(() => {
		if (status !== 'copied') return;
		const timer = setTimeout(() => (status = 'idle'), 2000);
		return () => clearTimeout(timer);
	});
</script>

{#if count > 0}
	<div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm" data-multibuy>
		<button
			type="button"
			class="rounded-md border border-gray-200 bg-white px-3 py-1 font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
			onclick={copy}
			data-rybbit-event="multibuy_copy"
			data-rybbit-prop-items={count}
		>
			{status === 'copied' ? 'Copied' : 'Copy multibuy'}
		</button>
		<span role="status" class="text-xs text-gray-500 dark:text-gray-400">
			{#if status === 'copied'}
				{count} items copied for the in-game multibuy window
			{:else if status === 'failed'}
				Clipboard unavailable: copy the list below
			{/if}
		</span>
		<details class="text-xs open:basis-full" bind:open>
			<summary class="cursor-pointer text-gray-600 hover:underline dark:text-gray-300">
				Multibuy list ({count} items)
			</summary>
			<textarea
				readonly
				rows={Math.min(count, 12)}
				class="mt-1 block w-full rounded-md border border-gray-200 bg-white p-2 font-mono text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
				aria-label="Multibuy list"
				value={text}
				onfocus={(event) => event.currentTarget.select()}
			></textarea>
		</details>
	</div>
{/if}
