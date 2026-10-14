<script lang="ts">
	import SplitBar from '$lib/components/profits/SplitBar.svelte';

	/**
	 * Where a job's output went: sold (green), used by later jobs (blue), used in manufacturing (amber),
	 * unsold (gray).
	 */
	let {
		soldQty,
		usedQty,
		manufacturedQty,
		unsoldQty,
		size = 'sm',
		legend = false
	}: {
		soldQty: number;
		usedQty: number;
		manufacturedQty: number;
		unsoldQty: number;
		size?: 'sm' | 'md';
		legend?: boolean;
	} = $props();
</script>

<SplitBar
	{size}
	{legend}
	segments={[
		{ label: 'sold', value: soldQty, tone: 'green' },
		{ label: 'used by later jobs', value: usedQty, tone: 'blue' },
		{ label: 'used in manufacturing', value: manufacturedQty, tone: 'amber' },
		{ label: 'unsold', value: unsoldQty, tone: 'gray' }
	]}
/>
