<script lang="ts">
	import { formatIsk, formatIskFull, formatNumber } from '$lib/format';
	import { DEFAULT_TABS, reactionHref, tabsFor, type DefaultTabs } from '$lib/components/listing/links';
	import TabBar from '$lib/components/listing/TabBar.svelte';
	import { REACTOR_LABEL, typeIconUrl } from '$lib/site';
	import type { BuildItem, BuildView, ReactorBoard } from './types';

	interface Props {
		board: ReactorBoard;
		/** Products shown when the reactor name does not say it, e.g. `Polymers`. */
		subtitle?: string;
		/** Days the averages cover; `0` without price history. */
		days: number;
		maxSharePct: number;
		/** The visitor's preferred tabs: the board opens on its view, links to it need no query. */
		defaults?: DefaultTabs;
	}

	let { board, subtitle, days, maxSharePct, defaults = DEFAULT_TABS }: Props = $props();

	const VIEW_LABEL: Record<BuildView, string> = { single: 'Buy inputs', chain: 'Full chain' };

	const panelId = $props.id();
	let picked = $state<BuildView | null>(null);
	const view = $derived<BuildView>(board.chain ? (picked ?? defaults.view) : 'single');
	const list = $derived(view === 'chain' && board.chain ? board.chain : board.single);

	const tone = (n: number | null) =>
		n === null || n === 0
			? ''
			: n > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-300';

	const href = (item: BuildItem) =>
		reactionHref(
			board.reactor,
			item.slug,
			item.unrefined ? 'unrefined' : item.variant,
			tabsFor(defaults, { chain: item.chainable, unrefined: item.unrefinable, reprocessed: false })
		);

	const marketTitle = (item: BuildItem) =>
		item.volume === null
			? 'No trade statistics for this region yet'
			: `One slot makes ${formatNumber(item.perSlotDay)} units per day; the region trades ${formatNumber(item.volume)} per day`;
</script>

<div class="rounded-lg bg-white p-4 text-sm dark:bg-gray-700" data-board={board.reactor}>
	<div
		class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 border-b-2 border-gray-200 pb-2 dark:border-gray-600"
	>
		<h3 class="text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200">
			{REACTOR_LABEL[board.reactor]}
		</h3>
		{#if subtitle}
			<span class="text-xs text-gray-500 dark:text-gray-300">{subtitle}</span>
		{/if}
	</div>
	{#if board.chain}
		<div class="mb-2">
			<TabBar
				tabs={[
					{ id: 'single', label: VIEW_LABEL.single },
					{ id: 'chain', label: VIEW_LABEL.chain }
				]}
				active={view}
				label={`${REACTOR_LABEL[board.reactor]} view`}
				controls={panelId}
				onselect={(id) => (picked = id)}
			/>
		</div>
	{/if}
	<div id={panelId} role={board.chain ? 'tabpanel' : undefined}>
		{#if days === 0}
			<p class="py-2 text-gray-500 dark:text-gray-300">No daily price history yet.</p>
		{:else if list.items.length === 0}
			<p class="py-2 text-gray-500 dark:text-gray-300">
				No product was profitable on most of the last {days} days.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead class="text-xs text-gray-500 uppercase dark:text-gray-400">
						<tr>
							<th scope="col" class="w-full py-1 pr-2 font-medium">Product</th>
							<th
								scope="col"
								class="px-2 py-1 text-right font-medium whitespace-nowrap"
								title={`Average profit per slot per day over the last ${days} days`}>Avg / day</th
							>
							<th
								scope="col"
								class="px-2 py-1 text-right font-medium"
								title="Days with a profit out of the days with complete prices">Days</th
							>
							<th
								scope="col"
								class="px-2 py-1 text-right font-medium"
								title={`Slots the region's daily trade absorbs at ${maxSharePct}% of its volume`}>Market</th
							>
							<th
								scope="col"
								class="hidden py-1 pl-2 text-right font-medium sm:table-cell"
								title="Profit per slot per day at the current prices">Now</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200 text-gray-700 dark:divide-gray-600 dark:text-gray-300">
						{#each list.items as item (item.blueprintTypeId)}
							<tr data-testid="board-row">
								<td class="w-full max-w-0 py-1.5 pr-2">
									<span class="flex items-center gap-2">
										<img
											src={typeIconUrl(item.productTypeId)}
											width="32"
											height="32"
											loading="lazy"
											alt={`${item.name} icon`}
											class="h-8 w-8 shrink-0 rounded"
										/>
										<span class="min-w-0">
											<a
												href={href(item)}
												class="block truncate font-medium text-gray-900 hover:text-primary-700 hover:underline dark:text-white dark:hover:text-primary-300"
												>{item.name}</a
											>
											{#if item.variant !== view}
												<span class="block text-xs text-gray-500 dark:text-gray-300">
													{VIEW_LABEL[item.variant]}
												</span>
											{/if}
										</span>
									</span>
								</td>
								<td
									class="px-2 py-1.5 text-right font-semibold whitespace-nowrap tabular-nums text-green-600 dark:text-green-400"
									title={formatIskFull(item.average)}>{formatIsk(item.average)}</td
								>
								<td class="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
									{item.profitableDays}/{item.days}
								</td>
								<td class="px-2 py-1.5 text-right whitespace-nowrap tabular-nums" title={marketTitle(item)}>
									{item.slots === null
										? 'n/a'
										: `${formatNumber(item.slots)} slot${item.slots === 1 ? '' : 's'}`}
								</td>
								<td
									class={[
										'hidden py-1.5 pl-2 text-right whitespace-nowrap tabular-nums sm:table-cell',
										tone(item.now)
									]}
									title={formatIskFull(item.now)}>{formatIsk(item.now)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		{#if days > 0 && list.thin > 0}
			<p class="mt-2 text-xs text-gray-500 dark:text-gray-300" data-thin-note>
				{list.thin} more {list.thin === 1 ? 'is' : 'are'} profitable, but one slot would sell over {maxSharePct}%
				of the region's daily volume.
			</p>
		{/if}
	</div>
</div>
