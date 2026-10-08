<script lang="ts">
	import type { ChainAllocation } from '@reactions/engine';
	import { formatDuration, formatIsk, formatIskFull, formatNumber, formatPct } from '$lib/format';

	interface Props {
		allocation: ChainAllocation;
	}

	let { allocation: a }: Props = $props();

	const names = $derived(new Map(a.reactions.map((r) => [r.blueprintTypeId, r.name])));
	const th = 'px-3 py-1.5 text-right whitespace-nowrap';
	const td = 'px-3 py-1 text-right tabular-nums whitespace-nowrap';
</script>

<section class="space-y-2" aria-labelledby="allocation-title" data-allocation>
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h2 id="allocation-title" class="text-lg font-semibold text-gray-800 dark:text-gray-200">
			Slot allocation
		</h2>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			Optimal slots: {a.lines}
			{a.lines === 1 ? 'line' : 'parallel lines'} sized so every job fits one {a.cycleDays}-day cycle; the
			figures on this page are per steady cycle.
		</p>
	</div>
	<div class="space-y-2 rounded-lg bg-white p-3 text-sm dark:bg-gray-700">
		<div
			class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-gray-600 dark:text-gray-300"
		>
			<p data-allocation-summary>
				<strong class="text-gray-900 tabular-nums dark:text-white">{a.lines}</strong>
				{a.lines === 1 ? 'line' : 'lines'} ·
				<strong class="text-gray-900 tabular-nums dark:text-white">{a.slotsUsed}</strong>
				{a.slotsUsed === 1 ? 'slot' : 'slots'} ·
				<strong
					class="text-gray-900 tabular-nums dark:text-white"
					title="{formatDuration(a.slotSecondsBusy)} busy of {formatDuration(
						a.slotsUsed * a.cycleDays * 86400
					)}">{formatPct(a.utilisation * 100)}</strong
				> utilisation
			</p>
			<p data-allocation-investment>
				Initial investment
				<strong
					class="text-gray-900 tabular-nums dark:text-white"
					title="{formatIskFull(
						a.initialInvestment
					)}: purchases and job costs of the build-up cycles and the first steady cycle"
					>{formatIsk(a.initialInvestment)}</strong
				>
			</p>
		</div>

		<div class="overflow-x-auto">
			<table
				class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
			>
				<caption class="sr-only">Slots per reaction</caption>
				<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
					<tr>
						<th scope="col" class="px-3 py-1.5">Reaction</th>
						<th scope="col" class={th}>Slots</th>
						<th scope="col" class={th}>Runs / slot</th>
						<th scope="col" class={th}>Duration / slot</th>
						<th scope="col" class={th}>First cycle</th>
					</tr>
				</thead>
				<tbody>
					{#each a.reactions as r (r.blueprintTypeId)}
						<tr
							class="border-t border-gray-200 text-gray-900 dark:border-gray-700 dark:text-gray-200"
							data-allocation-reaction={r.blueprintTypeId}
						>
							<td class="px-3 py-1 font-medium whitespace-nowrap" data-field="name">{r.name}</td>
							<td class={td} data-field="slots">{formatNumber(r.slots)}</td>
							<td class={td} data-field="runs"
								>{[...new Set(r.runsPerSlot)].map((n) => formatNumber(n)).join(' / ')}</td
							>
							<td
								class={td}
								title="{formatNumber(r.runsPerSlot[0])} runs × {formatDuration(r.runTimeSeconds)}"
								data-field="duration">{formatDuration(Math.max(...r.slotDurations))}</td
							>
							<td class={td} data-field="firstCycle">{r.firstCycle}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<ol class="flex flex-wrap gap-x-1 text-gray-600 dark:text-gray-300" aria-label="Cycles" data-phases>
			{#each a.phases as phase, i (phase.cycle)}
				<li title={phase.blueprintTypeIds.map((id) => names.get(id)).join(', ')} data-phase={phase.cycle}>
					{i > 0 ? ' · ' : ''}{phase.label === 'step_0'
						? 'Step 0'
						: `Cycle ${phase.cycle}${phase.label === 'steady' ? '+' : ''}`}:
					<span class="font-medium text-gray-800 tabular-nums dark:text-gray-200"
						>{phase.slots} {phase.slots === 1 ? 'slot' : 'slots'}</span
					>
					{phase.label === 'steady'
						? '(steady state)'
						: phase.label === 'step_0'
							? '(once)'
							: '(intermediates)'}
				</li>
			{/each}
		</ol>
	</div>
</section>
