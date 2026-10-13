<script lang="ts">
	import type { Dataset, PlanItem, StockPlan } from '@reactions/engine';
	import type { InputMarket } from '$lib/planner/plan';
	import InfoNote from '$lib/components/InfoNote.svelte';
	import LineItemsTable from '$lib/components/detail/LineItemsTable.svelte';
	import MultibuyButton from '$lib/components/detail/MultibuyButton.svelte';
	import { formatIsk, formatIskFull, formatNumber, formatRunsPerSlot, runsPerSlotTitle } from '$lib/format';
	import { lineItemsMultibuy } from '$lib/multibuy';
	import { groupByRole } from '$lib/inventory/groups';
	import { PLAN_WARNING_TEXT } from '$lib/planner/warnings';
	import { blueprintIconUrl } from '$lib/site';
	import GroupedItemsTable from './GroupedItemsTable.svelte';

	interface Props {
		plan: StockPlan;
		/** The search is done (`false` while a better plan may still replace this one). */
		final?: boolean;
		/** Item roles (fuel, raw, intermediate, product) group the item lists. */
		dataset: Dataset;
		totalSlots: number;
		/** "Allow formulas I don't own": formulas to buy are listed. */
		allowUnownedFormulas: boolean;
		/** Profile warnings from the load (`HUB_UNAVAILABLE`, …). */
		profileWarnings?: string[];
		/** Input and fallback hub shared by every profile; `null` when profiles differ. */
		inputMarket?: InputMarket | null;
	}

	let {
		plan,
		final = true,
		dataset,
		totalSlots,
		allowUnownedFormulas,
		profileWarnings = [],
		inputMarket = null
	}: Props = $props();

	const t = $derived(plan.totals);
	const showFormulas = $derived(allowUnownedFormulas && plan.formulasToBuy.length > 0);

	const warnings = $derived.by(() => {
		const list: { code: string; text: string }[] = [];
		for (const code of new Set([...plan.warnings, ...profileWarnings]))
			list.push({
				code,
				text:
					code === 'UNPRICED_STOCK'
						? `No market price (valued at 0, used only when a reaction needs them): ${groupByRole(
								dataset,
								plan.unpricedStock
							)
								.map((g) => `${g.title}: ${g.items.map((i) => i.name).join(', ')}`)
								.join('; ')}.`
						: code === 'INPUT_VOLUME_SHORT'
							? `${inputMarket?.name ?? 'The input hub'} lists fewer fuel blocks than needed; the rest is priced at ${inputMarket?.fallbackName ?? 'the fallback hub'}.`
							: (PLAN_WARNING_TEXT[code] ?? code)
			});
		return list;
	});

	/** Every item of `lists` summed per type, in first-seen order. */
	function sumItems(lists: readonly (readonly PlanItem[])[]): PlanItem[] {
		const items: PlanItem[] = [];
		for (const item of lists.flat()) {
			const seen = items.find((i) => i.typeId === item.typeId);
			if (seen) seen.quantity += item.quantity;
			else items.push({ typeId: item.typeId, name: item.name, quantity: item.quantity });
		}
		return items;
	}
	const consumed = $derived(sumItems(plan.cycles.map((c) => c.consumed)));
	const produced = $derived(sumItems(plan.cycles.map((c) => c.produced)));
	/** Cycles up to the last one with jobs; later ones are not needed and are not shown. */
	const shownCycles = $derived.by(() => {
		let last = plan.cycles.length;
		while (last > 0 && plan.cycles[last - 1].jobs.length === 0) last--;
		return plan.cycles.slice(0, last);
	});

	type Tone = 'profit' | 'plain';
	const cards = $derived.by(() => {
		const isk = (n: number | null) => ({ text: formatIsk(n), title: formatIskFull(n) });
		const list: {
			label: string;
			text: string;
			title: string;
			hint: string;
			value: number | null;
			tone: Tone;
		}[] = [
			{
				label: 'Value consumed',
				...isk(t.valueConsumed),
				hint: 'Net sale value of the stock and products the jobs use',
				value: t.valueConsumed,
				tone: 'plain'
			},
			{
				label: 'Value produced',
				...isk(t.valueProduced),
				hint: 'Net sale value of the products',
				value: t.valueProduced,
				tone: 'plain'
			},
			{
				label: 'Fuel cost',
				...isk(t.fuelCost),
				hint: 'Fuel blocks to buy',
				value: t.fuelCost,
				tone: 'plain'
			},
			{ label: 'Job costs', ...isk(t.jobCost), hint: '', value: t.jobCost, tone: 'plain' }
		];
		if (allowUnownedFormulas)
			list.push({
				label: 'Formula cost',
				...isk(t.formulaCost),
				hint: 'Formulas to buy',
				value: t.formulaCost,
				tone: 'plain'
			});
		list.push(
			{
				label: 'Value added',
				...isk(t.valueAdded),
				hint: 'Value produced minus value consumed, fuel, job costs and formulas',
				value: t.valueAdded,
				tone: 'profit'
			},
			{
				label: 'Profit / slot / day',
				...isk(t.profitPerSlotDay),
				hint: 'Value added ÷ (slots used × cycle days, summed over the cycles)',
				value: t.profitPerSlotDay,
				tone: 'profit'
			}
		);
		return list;
	});

	const toneClass = (tone: Tone, value: number | null) =>
		tone === 'plain' || value === null || value === 0
			? 'text-gray-900 dark:text-white'
			: value > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-300';

	const h3 = 'text-sm font-semibold text-gray-800 dark:text-gray-200';
	const h4 = 'text-sm font-medium text-gray-700 dark:text-gray-300';
	const table =
		'w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
	const row =
		'border-t border-gray-200 text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700';
	const th = 'px-3 py-1.5 text-right whitespace-nowrap';
	const td = 'px-3 py-1 text-right tabular-nums whitespace-nowrap';
</script>

<div class="space-y-4" data-stock-results>
	<dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each cards as card (card.label)}
			<div class="rounded-lg bg-white px-3 py-2 dark:bg-gray-700" data-metric={card.label}>
				<dt
					class="text-xs font-medium whitespace-nowrap text-gray-600 uppercase dark:text-gray-300"
					title={card.hint || undefined}
				>
					{card.label}
				</dt>
				<dd
					class="mt-0.5 text-lg font-bold whitespace-nowrap tabular-nums {toneClass(card.tone, card.value)}"
					title={card.title}
				>
					{card.text}
				</dd>
			</div>
		{/each}
	</dl>

	{#if final && !plan.optimal}
		<InfoNote name="not-optimal">
			This is the best plan found within the search's time limit; a better one may exist.
		</InfoNote>
	{/if}

	{#if warnings.length > 0}
		<ul class="space-y-1 text-sm" aria-label="Warnings">
			{#each warnings as w (w.code)}
				<li
					class="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
					data-warning={w.code}
				>
					{w.text}
				</li>
			{/each}
		</ul>
	{/if}

	<p class="text-sm text-gray-600 dark:text-gray-300" data-stock-note>
		Nothing else is bought: the jobs use your stock and the products of earlier cycles, plus the fuel blocks{showFormulas
			? ' and formulas'
			: ''} listed below. Job costs are paid as each job starts.
	</p>

	<section class="space-y-3" aria-labelledby="stock-jobs">
		<h3 id="stock-jobs" class={h3}>Jobs per cycle</h3>
		{#if shownCycles.length < plan.cycles.length}
			<p class="text-sm text-gray-600 dark:text-gray-300" data-stock-cycles-needed>
				No further cycles are needed: everything is done by cycle {shownCycles.length} of the {plan.cycles
					.length}
				chosen.
			</p>
		{/if}
		{#each shownCycles as cycle (cycle.cycle)}
			<div class="space-y-1" data-stock-cycle={cycle.cycle}>
				<h4 class="{h4} flex flex-wrap items-baseline justify-between gap-x-2">
					<span>Cycle {cycle.cycle}</span>
					<span
						class="text-xs font-normal text-gray-600 tabular-nums dark:text-gray-300"
						data-field="slotsUsed"
						>{cycle.slotsUsed} / {totalSlots} slots · job costs {formatIsk(cycle.jobCost)}</span
					>
				</h4>
				<div class="overflow-x-auto">
					<table class={table}>
						<thead class={thead}>
							<tr>
								<th scope="col" class="px-3 py-1.5">Reaction</th>
								<th scope="col" class={th}>Slots</th>
								<th scope="col" class={th}>Runs / slot</th>
								<th scope="col" class={th}>Runs</th>
								<th scope="col" class={th}>Job cost</th>
							</tr>
						</thead>
						<tbody>
							{#each cycle.jobs as job (job.blueprintTypeId)}
								<tr class={row} data-stock-job={job.blueprintTypeId}>
									<td class="px-3 py-1">
										<span class="flex items-center gap-2 font-medium whitespace-nowrap" data-field="name">
											<img
												src={blueprintIconUrl(job.blueprintTypeId)}
												alt=""
												width="20"
												height="20"
												loading="lazy"
												class="h-5 w-5 rounded"
											/>
											{job.name}
										</span>
									</td>
									<td class={td} data-field="slots">{job.slots}</td>
									<td class={td} title={runsPerSlotTitle(job.runsPerSlot)} data-field="runs"
										>{formatRunsPerSlot(job.runsPerSlot)}</td
									>
									<td class={td}>{formatNumber(job.runs)}</td>
									<td class={td} title={formatIskFull(job.jobCost)}>{formatIsk(job.jobCost)}</td>
								</tr>
							{:else}
								<tr class={row}>
									<td colspan="5" class="px-3 py-1 text-gray-500 dark:text-gray-400">No jobs this cycle.</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
	</section>

	<section class="space-y-2" aria-labelledby="stock-fuel" data-stock-fuel>
		<h3 id="stock-fuel" class={h3}>Fuel blocks to buy</h3>
		{#each shownCycles as cycle (cycle.cycle)}
			<div class="space-y-1" data-stock-fuel-cycle={cycle.cycle}>
				<LineItemsTable
					title="Cycle {cycle.cycle}"
					items={cycle.fuel}
					level={4}
					emptyText="No fuel blocks to buy this cycle."
					sources={false}
				/>
				<MultibuyButton text={lineItemsMultibuy(cycle.fuel)} />
			</div>
		{/each}
		{#if shownCycles.length > 1 && plan.fuelToBuy.length > 0}
			<div class="space-y-1" data-stock-fuel-all>
				<LineItemsTable title="All cycles" items={plan.fuelToBuy} level={4} sources={false} />
				<MultibuyButton text={lineItemsMultibuy(plan.fuelToBuy)} />
			</div>
		{/if}
	</section>

	{#if showFormulas}
		<section class="space-y-1" aria-labelledby="stock-formulas" data-stock-formulas>
			<h3 id="stock-formulas" class={h3}>Formulas to buy</h3>
			<div class="overflow-x-auto">
				<table class={table}>
					<thead class={thead}>
						<tr>
							<th scope="col" class="px-3 py-1.5">Formula</th>
							<th scope="col" class={th}>Count</th>
							<th scope="col" class={th}>Unit price</th>
							<th scope="col" class={th}>Total</th>
						</tr>
					</thead>
					<tbody>
						{#each plan.formulasToBuy as f (f.blueprintTypeId)}
							{@const total = f.unitPrice === null ? null : f.unitPrice * f.count}
							<tr class={row} data-formula={f.blueprintTypeId}>
								<td class="px-3 py-1">
									<span class="flex items-center gap-2 whitespace-nowrap">
										<img
											src={blueprintIconUrl(f.blueprintTypeId)}
											alt=""
											width="20"
											height="20"
											loading="lazy"
											class="h-5 w-5 rounded"
										/>
										{f.name}
									</span>
								</td>
								<td class={td}>{f.count}</td>
								<td class={td} title={formatIskFull(f.unitPrice)}>{formatIsk(f.unitPrice)}</td>
								<td class={td} title={formatIskFull(total)}>{formatIsk(total)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<GroupedItemsTable
		id="stock-consumed"
		title="Consumed"
		items={consumed}
		{dataset}
		marker="stock-consumed"
	/>
	<GroupedItemsTable
		id="stock-produced"
		title="Produced"
		items={produced}
		{dataset}
		marker="stock-produced"
	/>
	{#if plan.leftover.length > 0}
		<GroupedItemsTable
			id="stock-leftover"
			title="Held at the end"
			items={plan.leftover}
			{dataset}
			marker="stock-leftover"
		/>
	{/if}
</div>
