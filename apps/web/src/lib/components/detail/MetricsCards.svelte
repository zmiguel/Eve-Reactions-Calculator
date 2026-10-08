<script lang="ts">
	import type { ReactionResult } from '@reactions/engine';
	import { formatDuration, formatIsk, formatIskFull, formatNumber, formatPct } from '$lib/format';

	interface Props {
		result: Pick<ReactionResult, 'totals' | 'runs' | 'runTimeSeconds' | 'allocation'> &
			Partial<Pick<ReactionResult, 'warnings'>>;
	}

	let { result }: Props = $props();

	type Tone = 'profit' | 'plain';
	const cards = $derived.by(() => {
		const t = result.totals;
		const isk = (n: number | null) => ({ text: formatIsk(n), title: formatIskFull(n) });
		const a = result.allocation;
		// Optimal slots: the top reaction's runs are split across `lines` slots; its job is one slot's share.
		const topRuns = a?.reactions.find((r) => r.depth === 0)?.runsPerSlot[0] ?? result.runs;
		const jobSeconds = topRuns * result.runTimeSeconds;
		const duration = (seconds: number, title: string) => ({
			text: formatDuration(seconds),
			title,
			value: seconds,
			tone: 'plain' as const
		});
		return [
			{ label: 'Profit / slot / day', ...isk(t.profitPerSlotDay), value: t.profitPerSlotDay, tone: 'profit' },
			{ label: 'Profit', ...isk(t.profit), value: t.profit, tone: 'profit' },
			{ label: 'Margin', text: formatPct(t.marginPct), title: '', value: t.marginPct, tone: 'profit' },
			{ label: 'ROI', text: formatPct(t.roiPct), title: '', value: t.roiPct, tone: 'profit' },
			{ label: 'Total cost', ...isk(t.totalCost), value: t.totalCost, tone: 'plain' },
			{ label: 'Output value', ...isk(t.outputValue), value: t.outputValue, tone: 'plain' },
			{
				label: 'Runs',
				// Formulas with a per-job run limit (e.g. Molecular-Forged, 100) can't fill a long cycle.
				text: result.warnings?.includes('MAX_RUNS_PER_JOB')
					? `${formatNumber(topRuns)} max${a ? ` × ${a.lines}` : ''}`
					: formatNumber(result.runs),
				title: [
					a ? `${a.lines} lines × ${formatNumber(topRuns)} runs` : '',
					result.warnings?.includes('MAX_RUNS_PER_JOB')
						? `${formatNumber(topRuns)} runs is this formula's maximum per job`
						: ''
				]
					.filter(Boolean)
					.join('; '),
				value: result.runs,
				tone: 'plain'
			},
			{
				label: 'Time per run',
				...duration(result.runTimeSeconds, `${formatNumber(result.runTimeSeconds, 1)} s per run`)
			},
			{
				label: 'Job duration',
				...duration(
					jobSeconds,
					`${formatNumber(topRuns)} runs × ${formatDuration(result.runTimeSeconds)}${a ? ' per slot' : ''}`
				)
			},
			// Optimal slots: the slots the chain keeps busy. Single slot: a chain also occupies the slot with
			// its intermediate jobs; a single reaction's slot time is its job duration.
			...(a
				? [
						{
							label: 'Slots',
							text: formatNumber(a.slotsUsed),
							title: `${a.slotsUsed} slots × ${a.cycleDays} days, ${formatPct(a.utilisation * 100)} busy`,
							value: a.slotsUsed,
							tone: 'plain' as const
						}
					]
				: Math.abs(t.slotSeconds - jobSeconds) >= 1
					? [
							{
								label: 'Slot time',
								...duration(
									t.slotSeconds,
									`${formatNumber(t.slotSeconds / 86400, 2)} slot-days across all jobs of the chain`
								)
							}
						]
					: [])
		] satisfies { label: string; text: string; title: string; value: number | null; tone: Tone }[];
	});

	const toneClass = (tone: Tone, value: number | null) =>
		tone === 'plain' || value === null || value === 0
			? 'text-gray-900 dark:text-white'
			: value > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-300';
</script>

<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:flex">
	{#each cards as card (card.label)}
		<div class="rounded-lg bg-white px-3 py-2 xl:min-w-0 xl:flex-1 dark:bg-gray-700" data-metric={card.label}>
			<dt class="text-xs font-medium whitespace-nowrap text-gray-600 uppercase dark:text-gray-300">
				{card.label}
			</dt>
			<dd
				class="mt-0.5 text-lg font-bold whitespace-nowrap tabular-nums {toneClass(card.tone, card.value)}"
				title={card.title || undefined}
			>
				{card.text}
			</dd>
		</div>
	{/each}
</dl>
