<script lang="ts">
	import { formatIsk, formatIskFull } from '$lib/format';
	import Estimated from './Estimated.svelte';

	interface Props {
		/** null shows a dash (with `missing` as its tooltip). */
		value: number | null;
		/** Color by sign: green above zero, red below, gray at zero. */
		profit?: boolean;
		/** Marks the value as an estimate; the text is the tooltip. */
		estimated?: string | null;
		/** Why the value is missing (tooltip of the dash). */
		missing?: string | null;
	}

	let { value, profit = false, estimated = null, missing = null }: Props = $props();

	const tone = $derived(
		!profit || value === null
			? ''
			: value > 0
				? 'text-green-700 dark:text-green-400'
				: value < 0
					? 'text-red-700 dark:text-red-400'
					: 'text-gray-500 dark:text-gray-400'
	);
</script>

{#if value === null}
	<span
		class="text-gray-500 dark:text-gray-400 {missing ? 'cursor-help' : ''}"
		title={missing ?? undefined}
		data-isk="none">–</span
	>
{:else}
	<span class="tabular-nums {tone}" title={formatIskFull(value)} data-isk={value}>{formatIsk(value)}</span
	>{#if estimated}<Estimated reason={estimated} />{/if}
{/if}
