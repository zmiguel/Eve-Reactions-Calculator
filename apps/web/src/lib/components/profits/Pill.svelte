<script lang="ts" module>
	export type PillTone = 'blue' | 'green' | 'red' | 'gray' | 'amber' | 'purple';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A small rounded status label; the tone carries the meaning (same colors on every profits page). */
	let { tone, title, children }: { tone: PillTone; title?: string; children: Snippet } = $props();

	const TONE: Record<PillTone, string> = {
		blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
		green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
		red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
		gray: 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200',
		amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
		purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
	};
</script>

<span
	class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap {TONE[
		tone
	]} {title ? 'cursor-help' : ''}"
	{title}
	data-pill={tone}>{@render children()}</span
>
