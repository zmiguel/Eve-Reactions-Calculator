<script lang="ts">
	import Isk from '$lib/components/profits/Isk.svelte';
	import { formatIsk, formatIskFull, formatNumber } from '$lib/format';
	import type { OverviewKpis, ProfitPeriod } from '$lib/profits/types';
	import { periodWords } from './PeriodSwitch.svelte';

	let { kpis, period }: { kpis: OverviewKpis; period: ProfitPeriod } = $props();

	const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
	const signed = (n: number) => `${n > 0 ? '+' : ''}${formatIsk(n)}`;
	const tone = (n: number) =>
		n > 0
			? 'text-green-700 dark:text-green-400'
			: n < 0
				? 'text-red-700 dark:text-red-400'
				: 'text-gray-500 dark:text-gray-400';

	const change = $derived(kpis.realizedPrevious === null ? null : kpis.realized - kpis.realizedPrevious);
	const TODAY = "Valued at today's market price with your calculator settings (output side).";

	const card = 'flex flex-col gap-1 rounded-lg bg-white p-4 dark:bg-gray-700';
	const title = 'cursor-help text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400';
	const big = 'text-2xl font-semibold text-gray-900 dark:text-white';
	const sub = 'text-xs text-gray-500 dark:text-gray-400';
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
	<div class={card} data-kpi="realized">
		<span
			class={title}
			title="Profit of what your jobs made and you sold in this period, counted on the day of the sale: sale price after tax and fees minus what the units cost you. Output used by your manufacturing jobs counts on the day the manufacturing job started. Cancelled jobs count as a loss on the day they were cancelled."
			>Realized profit</span
		>
		<span class={big}><Isk value={kpis.realized} profit /></span>
		{#if change === null}
			<span class={sub}>All time</span>
		{:else}
			<span class={sub} data-change={change}>
				<span class={tone(change)} title={formatIskFull(change)}>{signed(change)}</span>
				vs the {periodWords(period).replace('the last', 'previous')}
			</span>
		{/if}
		{#if kpis.manufacturedQty > 0}
			<span class={sub} data-manufactured
				>Includes {plural(kpis.manufacturedQty, 'unit')} used in manufacturing</span
			>
		{/if}
	</div>

	<div class={card} data-kpi="expected">
		<span
			class={title}
			title="Jobs that ended in this period: their realized profit plus their unsold output at today's value, the same as the Jobs tab."
			>Expected profit</span
		>
		<span class={big}
			><Isk
				value={kpis.expected}
				profit
				estimated={kpis.expectedHasUnsold ? `Includes unsold output. ${TODAY}` : null}
			/></span
		>
		<span class={sub}>
			{plural(kpis.endedJobs, 'job')} ended{#if kpis.unvaluedJobs > 0}
				<span class="text-amber-700 dark:text-amber-400" data-unvalued
					>({formatNumber(kpis.unvaluedJobs)} without a value today, left out)</span
				>
			{/if}
		</span>
	</div>

	<div class={card} data-kpi="sales">
		<span class={title} title="Everything you sold in this period, after sales tax and broker fees."
			>Sales income</span
		>
		<span class={big}><Isk value={kpis.salesIncome} /></span>
		<span class={sub}>{plural(kpis.sales, 'sale')}, after tax and fees</span>
	</div>

	<div class={card} data-kpi="spent">
		<span
			class={title}
			title="Purchases and job costs paid in this period: market, contract and entered purchases (fees included) plus the job costs of reaction and fuel block jobs started in it."
			>Paid out</span
		>
		<span class={big}><Isk value={kpis.spent} /></span>
		<span class={sub}
			>Purchases <span title={formatIskFull(kpis.purchases)}>{formatIsk(kpis.purchases)}</span>, job costs
			<span title={formatIskFull(kpis.jobCosts)}>{formatIsk(kpis.jobCosts)}</span></span
		>
	</div>

	<div class={card} data-kpi="per-slot-day">
		<span
			class={title}
			title="Expected profit of the jobs that ended in this period divided by the slot-days they used (one slot per job, for as long as it ran). The same measure as the calculator's profit per slot per day."
			>Profit / slot / day</span
		>
		{#if kpis.profitPerSlotDay === null}
			<span class="text-sm text-gray-600 dark:text-gray-300" data-empty>
				{kpis.endedJobs === 0
					? 'No job ended in this period yet.'
					: 'None of the jobs that ended in this period has a value today.'}
			</span>
		{:else}
			<span class={big}
				><Isk
					value={kpis.profitPerSlotDay}
					profit
					estimated={kpis.expectedHasUnsold ? `From expected profit. ${TODAY}` : null}
				/></span
			>
			<span class={sub}>Over {formatNumber(kpis.slotDays, 1)} slot-days</span>
		{/if}
	</div>

	<div class={card} data-kpi="unsold">
		<span
			class={title}
			title="What your jobs made that you still hold (any period): its value today and the gain or loss on what it cost you."
			>Unsold output today</span
		>
		<span class={big}
			><Isk value={kpis.unsold.value} estimated={kpis.unsold.quantity > 0 ? TODAY : null} /></span
		>
		<span class={sub}>
			{#if kpis.unsold.quantity === 0}
				Nothing unsold
			{:else}
				{kpis.unsold.gain < 0 ? 'Loss' : 'Gain'} on what you hold
				<span
					class={tone(kpis.unsold.gain)}
					title={formatIskFull(kpis.unsold.gain)}
					data-gain={kpis.unsold.gain < 0 ? 'loss' : 'gain'}>{signed(kpis.unsold.gain)}</span
				>{#if kpis.unsold.unvaluedTypes > 0}
					<span class="text-amber-700 dark:text-amber-400"
						>({plural(kpis.unsold.unvaluedTypes, 'item')} without a price today, left out)</span
					>
				{/if}
			{/if}
		</span>
	</div>
</div>

{#if kpis.reselling}
	<p class="mt-2 text-sm text-gray-600 dark:text-gray-300" data-reselling>
		Reselling:
		<Isk value={kpis.reselling.profit} profit />
		from {plural(kpis.reselling.sales, 'sale')} of items you bought rather than made (not in realized profit).
	</p>
{/if}
