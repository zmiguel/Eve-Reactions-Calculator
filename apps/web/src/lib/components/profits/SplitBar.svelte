<script lang="ts" module>
	export type SplitTone = 'green' | 'blue' | 'gray' | 'amber' | 'red';

	export interface SplitSegment {
		label: string;
		value: number;
		tone: SplitTone;
	}
</script>

<script lang="ts">
	import { formatNumber } from '$lib/format';

	/**
	 * A thin stacked bar of parts of a whole (sold / used by later jobs / unsold); segments of 0 are left
	 * out. The tooltip and the screen reader text list every part.
	 */
	let {
		segments,
		size = 'sm',
		legend = false
	}: { segments: SplitSegment[]; size?: 'sm' | 'md'; legend?: boolean } = $props();

	const TONE: Record<SplitTone, string> = {
		green: 'bg-green-500 dark:bg-green-500',
		blue: 'bg-blue-500 dark:bg-blue-400',
		gray: 'bg-gray-400 dark:bg-gray-500',
		amber: 'bg-amber-400 dark:bg-amber-500',
		red: 'bg-red-500 dark:bg-red-400'
	};

	const total = $derived(segments.reduce((s, x) => s + Math.max(0, x.value), 0));
	const shown = $derived(segments.filter((s) => s.value > 0));
	const text = $derived(segments.map((s) => `${formatNumber(s.value)} ${s.label}`).join(', '));
</script>

<span class="block" data-split>
	<span
		class="flex w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600 {size === 'md'
			? 'h-2.5'
			: 'h-1.5'}"
		title={text}
		aria-hidden="true"
	>
		{#each shown as s (s.label)}
			<span
				class={TONE[s.tone]}
				style="width: {total ? (s.value / total) * 100 : 0}%"
				data-segment={s.label}
				data-value={s.value}
			></span>
		{/each}
	</span>
	{#if legend}
		<span class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
			{#each segments as s (s.label)}
				<span class="inline-flex items-center gap-1">
					<span class="inline-block h-2 w-2 rounded-full {TONE[s.tone]}"></span>
					<span class="tabular-nums">{formatNumber(s.value)}</span>
					{s.label}
				</span>
			{/each}
		</span>
	{:else}
		<span class="sr-only">{text}</span>
	{/if}
</span>
