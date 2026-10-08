<script lang="ts">
	interface Props {
		/** Absolute `/settings?import=…` URL. */
		url: string;
	}

	let { url }: Props = $props();
	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let input: HTMLInputElement | undefined = $state();

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			status = 'copied';
		} catch {
			// No clipboard permission (or no secure context): select the link for manual copying.
			status = 'failed';
			input?.select();
		}
	}

	$effect(() => {
		if (status !== 'copied') return;
		const timer = setTimeout(() => (status = 'idle'), 2000);
		return () => clearTimeout(timer);
	});
</script>

<div class="flex flex-wrap items-center gap-2">
	<input
		bind:this={input}
		readonly
		value={url}
		aria-label="Share link"
		class="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
		onfocus={(event) => event.currentTarget.select()}
	/>
	<button
		type="button"
		class="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
		onclick={copy}
	>
		{status === 'copied' ? 'Copied' : 'Copy share link'}
	</button>
	<span role="status" class="text-xs text-gray-500 dark:text-gray-400">
		{#if status === 'copied'}
			Link copied to the clipboard
		{:else if status === 'failed'}
			Clipboard unavailable: copy the selected link
		{/if}
	</span>
</div>
