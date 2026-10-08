<script lang="ts">
	import type { Reactor } from '@reactions/engine';
	import { Badge, Tooltip } from 'flowbite-svelte';
	import { formatIsk, formatIskFull, formatNumber, formatPct } from '$lib/format';
	import { typeIconUrl } from '$lib/site';
	import { DEFAULT_TABS, reactionHref, tabsFor, type DefaultTabs } from './links';
	import type { RowSummary, Variant, VariantSummary } from './types';

	interface Props {
		rows: RowSummary[];
		/**
		 * Variant to show; rows without it fall back to their full chain (Using unrefined) or buy-inputs
		 * numbers (e.g. not chainable).
		 */
		variant?: Variant;
		reactor: Reactor;
		caption?: string;
		/** The visitor's preferred tabs (links to them need no query). */
		defaults?: DefaultTabs;
	}

	let { rows, variant = 'single', reactor, caption, defaults = DEFAULT_TABS }: Props = $props();

	type NumericKey =
		'profitPerSlotDay' | 'profit' | 'marginPct' | 'inputCost' | 'outputValue' | 'jobCost' | 'runs' | 'slots';
	type SortKey = 'name' | NumericKey;

	const COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
		{ key: 'name', label: 'Reaction' },
		{ key: 'profitPerSlotDay', label: 'Profit / slot / day', hint: 'Profit per reaction slot per day' },
		{ key: 'profit', label: 'Profit / cycle', hint: 'Profit of one full cycle of runs' },
		{ key: 'marginPct', label: 'Margin', hint: 'Profit as % of output value' },
		{ key: 'inputCost', label: 'Input cost', hint: 'Inputs incl. broker fees and shipping' },
		{ key: 'outputValue', label: 'Output value', hint: 'Outputs after fees, sales tax and shipping' },
		{ key: 'jobCost', label: 'Job cost', hint: 'Installation cost incl. facility tax and SCC' },
		{ key: 'runs', label: 'Runs / cycle' },
		{ key: 'slots', label: 'Slots', hint: 'Optimal slots per cycle: final product + intermediates' }
	];

	/** The Slots column appears only for full chains computed with the optimal slot allocation. */
	const showSlots = $derived(
		(variant === 'chain' || variant === 'unrefined') && rows.some((r) => (r.unrefined ?? r.chain)?.slots)
	);
	const columns = $derived(COLUMNS.filter((c) => c.key !== 'slots' || showSlots));
	/** A row without a slot plan (single reaction) occupies one slot. */
	const numeric = (v: VariantSummary, key: NumericKey) => (key === 'slots' ? (v.slots?.total ?? 1) : v[key]);

	const tableId = $props.id();
	let sortKey = $state<SortKey>('profitPerSlotDay');
	let sortDir = $state<'asc' | 'desc'>('desc');

	const items = $derived(
		rows.map((row) => {
			const shown: Variant | null =
				row[variant] !== null ? variant : variant === 'unrefined' && row.chain !== null ? 'chain' : null;
			return {
				row,
				values: shown ? row[shown]! : row.single,
				href: reactionHref(
					reactor,
					row.slug,
					shown ?? 'single',
					tabsFor(defaults, {
						chain: row.chain !== null,
						unrefined: row.unrefined !== null,
						reprocessed: row.reprocessed !== null
					})
				)
			};
		})
	);

	/** Rank 1–3 by profit/slot/day, independent of the current sort. */
	const ranks = $derived(
		new Map(
			items
				.filter((i) => i.values.profitPerSlotDay !== null)
				.sort((a, b) => b.values.profitPerSlotDay! - a.values.profitPerSlotDay!)
				.slice(0, 3)
				.map((i, index) => [i.row.blueprintTypeId, index + 1])
		)
	);

	const sorted = $derived.by(() => {
		const dir = sortDir === 'asc' ? 1 : -1;
		const key = sortKey;
		const compare = (a: (typeof items)[number], b: (typeof items)[number]) => {
			if (key === 'name') return dir * a.row.name.localeCompare(b.row.name);
			const av = numeric(a.values, key);
			const bv = numeric(b.values, key);
			if (av === null && bv === null) return 0;
			if (av === null) return 1;
			if (bv === null) return -1;
			return dir * (av - bv);
		};
		// Rows without a profit always stay at the bottom, whatever the sort.
		const priced = items.filter((i) => i.values.profit !== null).sort(compare);
		const unpriced = items.filter((i) => i.values.profit === null).sort(compare);
		return [...priced, ...unpriced];
	});

	function sortBy(key: SortKey) {
		if (key === sortKey) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = key === 'name' ? 'asc' : 'desc';
		}
	}

	const tone = (n: number | null) =>
		n === null || n === 0
			? ''
			: n > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-400';

	const numCell = 'px-3 py-2 text-right whitespace-nowrap tabular-nums';

	const missingText = (v: VariantSummary) =>
		v.missing.length ? `Missing prices: ${v.missing.join(', ')}` : 'Missing prices';
</script>

{#snippet money(value: number | null, signed: boolean)}
	<span title={formatIskFull(value)} class={signed ? tone(value) : ''}>{formatIsk(value)}</span>
{/snippet}

<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
	<table class="w-full bg-white text-left text-sm dark:bg-gray-800">
		{#if caption}
			<caption class="sr-only">{caption}</caption>
		{/if}
		<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
			<tr>
				{#each columns as col (col.key)}
					<th
						scope="col"
						class={['px-3 py-2 whitespace-nowrap', col.key !== 'name' && 'text-right']}
						aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
					>
						<button
							type="button"
							class={[
								'inline-flex cursor-pointer items-center gap-1 font-semibold uppercase hover:text-gray-900 dark:hover:text-white',
								col.key !== 'name' && 'flex-row-reverse'
							]}
							title={col.hint}
							onclick={() => sortBy(col.key)}
						>
							{col.label}
							<span aria-hidden="true" class="w-2.5 text-[10px] text-primary-600 dark:text-primary-400">
								{sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
							</span>
						</button>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody class="text-gray-700 dark:text-gray-300">
			{#each sorted as item (item.row.blueprintTypeId)}
				{@const v = item.values}
				{@const rank = ranks.get(item.row.blueprintTypeId)}
				<tr
					data-testid="reaction-row"
					class="border-t border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
				>
					<td class="px-3 py-1.5 font-medium whitespace-nowrap">
						<div class="flex items-center gap-2">
							<a
								href={item.href}
								class="flex shrink-0 items-center gap-2 text-gray-900 hover:text-primary-700 hover:underline dark:text-gray-200 dark:hover:text-primary-400"
							>
								<img
									src={typeIconUrl(item.row.productTypeId)}
									width="32"
									height="32"
									loading="lazy"
									alt={`${item.row.name} icon`}
									class="h-7 w-7 shrink-0 rounded"
								/>
								<span>{item.row.name}</span>
							</a>
							{#if rank}
								<Badge color="green" class="px-1.5 text-[11px] font-semibold" aria-label={`Rank ${rank}`}
									>#{rank}</Badge
								>
							{/if}
							{#if v.unrefined}
								<span
									class="rounded border border-emerald-500/60 px-1 text-[10px] leading-4 text-emerald-700 dark:text-emerald-400"
									title="Unrefined reactions, reprocessed, build {v.unrefined.join(', ')}"
									data-unrefined>unrefined</span
								>
							{/if}
						</div>
					</td>
					<td class="px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums">
						{#if v.profitPerSlotDay === null}
							<span
								id={`${tableId}-na-${item.row.blueprintTypeId}`}
								class="cursor-help font-normal text-gray-500 dark:text-gray-400"
							>
								n/a<span class="sr-only"> ({missingText(v)})</span>
							</span>
							<Tooltip triggeredBy={`#${tableId}-na-${item.row.blueprintTypeId}`}>{missingText(v)}</Tooltip>
						{:else}
							{@render money(v.profitPerSlotDay, true)}
						{/if}
					</td>
					<td class={numCell}>{@render money(v.profit, true)}</td>
					<td class={numCell}><span class={tone(v.marginPct)}>{formatPct(v.marginPct)}</span></td>
					<td class={numCell}>{@render money(v.inputCost, false)}</td>
					<td class={numCell}>{@render money(v.outputValue, false)}</td>
					<td class={numCell}>{@render money(v.jobCost, false)}</td>
					<td class={numCell}>{formatNumber(v.runs)}</td>
					{#if showSlots}
						<td
							class={numCell}
							title={v.slots
								? `${v.slots.lines} ${v.slots.lines === 1 ? 'line' : 'lines'}: ${v.slots.reactions
										.map((r) => `${r.name} ${r.slots} × ${formatNumber(r.runsPerSlot)} runs`)
										.join(', ')}`
								: 'One reaction in one slot'}
							data-field="slots">{v.slots ? v.slots.levels.join('+') : '1'}</td
						>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
