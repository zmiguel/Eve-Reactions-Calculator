<script lang="ts">
	import { formatNumber, formatPct } from '$lib/format';
	import type { AttentionItem } from '$lib/profits/types';

	/** What needs the user's attention; each item links to where it is fixed. Nothing renders without items. */
	let { items }: { items: AttentionItem[] } = $props();

	const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

	function view(item: AttentionItem): { href: string; text: string; action: string } {
		switch (item.kind) {
			case 'review':
				return {
					href: '/profits/ledger?review=1',
					text: `${plural(item.count, 'price needs', 'prices need')} your review.`,
					action: 'Review on the Ledger tab'
				};
			case 'estimates':
				return {
					href: '/profits/jobs',
					text: `Inputs of ${plural(item.jobs, 'job', 'jobs')} had no purchase record; ${formatPct(item.share * 100, 0)} of their input cost is a market estimate.`,
					action: 'See the jobs'
				};
			case 'streams':
				return {
					href: '/account/connections',
					text: `${plural(item.connections, 'connection has', 'connections have')} tracking data that could not be read.`,
					action: 'Check your connections'
				};
		}
	}
</script>

{#if items.length > 0}
	<section
		aria-label="Needs your attention"
		class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
	>
		<ul class="space-y-1">
			{#each items as item (item.kind)}
				{@const v = view(item)}
				<li
					class="flex flex-wrap items-baseline gap-x-2 text-amber-900 dark:text-amber-200"
					data-attention={item.kind}
				>
					<span>{v.text}</span>
					<a href={v.href} class="font-medium text-amber-800 underline hover:no-underline dark:text-amber-300"
						>{v.action}</a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}
