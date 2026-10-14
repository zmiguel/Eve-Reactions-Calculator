<script lang="ts">
	/** Marks a number that is an estimate; `reason` (the tooltip) says what was estimated and how. */
	let { reason }: { reason: string } = $props();
</script>

<span
	class="ml-1 cursor-help align-super text-[10px] font-medium text-amber-700 dark:text-amber-400"
	title={reason}
	aria-label="estimated: {reason}"
	data-estimated>est.</span
>
