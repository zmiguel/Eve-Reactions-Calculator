<script lang="ts">
	import Pill from '$lib/components/profits/Pill.svelte';
	import { sourceBadge } from '$lib/ledger/source';

	interface Props {
		/** Engine `PriceSourceKind`. */
		kind: string;
		needsReview?: boolean;
		/** A market trade whose broker fee or sales tax was estimated. */
		estimatedFees?: boolean;
		/** The full source text, shown verbatim when opened. */
		text: string;
		/** More lines under the text (fee and tax breakdown). */
		lines?: string[];
	}

	let { kind, needsReview = false, estimatedFees = false, text, lines = [] }: Props = $props();

	const badge = $derived(sourceBadge(kind, needsReview, estimatedFees));
</script>

<details class="group max-w-xs" data-source={kind}>
	<summary class="inline-flex cursor-pointer list-none items-center gap-1" title={text}>
		<Pill tone={badge.tone}>{badge.label}</Pill>
		<span class="text-xs text-gray-400 group-open:rotate-90" aria-hidden="true">›</span>
		<span class="sr-only">Show where this price comes from</span>
	</summary>
	<div class="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
		<p data-source-text>{text}</p>
		{#each lines as line (line)}
			<p class="text-gray-500 dark:text-gray-400" data-source-line>{line}</p>
		{/each}
	</div>
</details>
