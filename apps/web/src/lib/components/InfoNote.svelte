<script lang="ts">
	import { InfoCircleSolid } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		/** Marker attribute for tests and styling hooks (`data-<name>`). */
		name?: string;
	}

	let { children, name }: Props = $props();
</script>

<div
	role="note"
	class="flex items-start gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
	{...name ? { [`data-${name}`]: '' } : {}}
>
	<InfoCircleSolid class="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" aria-hidden="true" />
	<div class="min-w-0 flex-1">{@render children()}</div>
</div>
