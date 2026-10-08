<script lang="ts">
	import type { ReactionResult } from '@reactions/engine';
	import { formatDuration, formatIsk, formatIskFull, formatNumber, formatPct } from '$lib/format';
	import LineItemsTable from './LineItemsTable.svelte';
	import type { ProductionStep } from './steps';

	interface Props {
		result: Pick<
			ReactionResult,
			'totals' | 'jobCost' | 'inputs' | 'outputs' | 'surplus' | 'outputMode' | 'runs' | 'allocation'
		>;
		steps: ProductionStep[];
	}

	let { result, steps }: Props = $props();

	interface Row {
		key: string;
		label: string;
		text: string;
		title?: string;
		strong?: boolean;
		tone?: number | null;
	}
	/** The whole calculation in one card: cost build-up, sale and slot time; zero shipping rows are left out. */
	const columns = $derived.by<{ title: string; rows: Row[] }[]>(() => {
		const t = result.totals;
		const j = result.jobCost;
		const unpricedInputs = result.inputs.some((i) => i.unitPrice === null);
		const unpricedOutputs = result.outputs.some((o) => o.unitPrice === null);
		const a = result.allocation;
		// Optimal slots: one job per slot.
		const jobs = steps.reduce(
			(acc, s) => acc + s.jobs.reduce((n, { node }) => n + (node.runsPerSlot?.length ?? 1), 0),
			0
		);
		const isk = (n: number | null) => ({ text: formatIsk(n), title: formatIskFull(n) });
		return [
			{
				title: 'Costs',
				rows: [
					{ key: 'inputCost', label: 'Purchases', ...isk(unpricedInputs ? null : t.inputCost) },
					{ key: 'inputFees', label: 'Broker fees', ...isk(t.inputFees) },
					...(t.inputShipping === 0
						? []
						: [{ key: 'inputShipping', label: 'Input shipping', ...isk(t.inputShipping) }]),
					{
						key: 'jobCost',
						label: 'Job cost',
						text: formatIsk(t.jobCost),
						title: `System ${formatIskFull(j.systemCost)} + facility tax ${formatIskFull(j.facilityTax)} + SCC ${formatIskFull(j.scc)}`
					},
					{ key: 'totalCost', label: 'Total cost', ...isk(unpricedInputs ? null : t.totalCost), strong: true }
				]
			},
			{
				title: 'Sale',
				rows: [
					{ key: 'outputValue', label: 'Output value', ...isk(unpricedOutputs ? null : t.outputValue) },
					{ key: 'outputFees', label: 'Sales tax & broker fees', ...isk(t.outputFees) },
					...(t.outputShipping === 0
						? []
						: [{ key: 'outputShipping', label: 'Output shipping', ...isk(t.outputShipping) }]),
					{ key: 'profit', label: 'Profit', ...isk(t.profit), strong: true, tone: t.profit }
				]
			},
			{
				title: 'Slot time',
				rows: [
					{
						key: 'jobs',
						label: steps.length > 1 ? `Jobs (${steps.length} steps)` : 'Jobs',
						text: formatNumber(jobs)
					},
					a
						? {
								key: 'slotTime',
								label: `Slot time (${a.slotsUsed} slots × ${a.cycleDays} d)`,
								text: formatDuration(a.slotsUsed * a.cycleDays * 86400),
								title: `${formatDuration(t.slotSeconds)} busy (${formatPct(a.utilisation * 100)})`
							}
						: {
								key: 'slotTime',
								label: 'Total slot time',
								text: formatDuration(t.slotSeconds),
								title: `${formatNumber(t.slotSeconds / 86400, 2)} slot-days`
							},
					{
						key: 'profitPerRun',
						label: `Profit / run (${formatNumber(result.runs)} runs)`,
						...isk(t.profitPerRun),
						tone: t.profitPerRun
					},
					{
						key: 'profitPerSlotDay',
						label: 'Profit / slot / day',
						...isk(t.profitPerSlotDay),
						strong: true,
						tone: t.profitPerSlotDay
					}
				]
			}
		];
	});
	const toneClass = (row: Row) =>
		row.tone === undefined || row.tone === null || row.tone === 0
			? row.strong
				? 'text-gray-900 dark:text-white'
				: 'text-gray-800 dark:text-gray-200'
			: row.tone > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-300';
</script>

<div class="space-y-3" data-summary>
	<div
		class="grid grid-cols-1 gap-x-8 gap-y-3 rounded-lg bg-white p-3 text-sm md:grid-cols-3 dark:bg-gray-700"
	>
		{#each columns as column (column.title)}
			<section aria-label={column.title}>
				<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
					{column.title}
				</h3>
				<dl>
					{#each column.rows as row (row.key)}
						<div
							class="flex justify-between gap-4 py-0.5 {row.strong
								? 'mt-0.5 border-t border-gray-200 pt-1 dark:border-gray-600'
								: ''}"
						>
							<dt class="text-gray-600 dark:text-gray-300">{row.label}</dt>
							<dd
								class="font-semibold tabular-nums {toneClass(row)}"
								title={row.title || undefined}
								data-summary-field={row.key}
							>
								{row.text}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>

	<div class="grid grid-cols-1 gap-3 {result.surplus.length > 0 ? 'xl:grid-cols-2' : ''}">
		<LineItemsTable
			title={result.outputMode === 'reprocessed' ? 'Outputs (reprocessed)' : 'Outputs'}
			items={result.outputs}
			feesLabel="Tax & fees"
		/>
		{#if result.surplus.length > 0}
			<LineItemsTable
				title="Surplus intermediates (not counted as profit)"
				items={result.surplus}
				costs={false}
			/>
		{/if}
	</div>
</div>
