<script lang="ts">
	import AttentionBar from '$lib/components/profits/overview/AttentionBar.svelte';
	import KpiCards from '$lib/components/profits/overview/KpiCards.svelte';
	import OverviewCharts from '$lib/components/profits/overview/OverviewCharts.svelte';
	import PeriodSwitch, { periodWords } from '$lib/components/profits/overview/PeriodSwitch.svelte';
	import ReactionsTable from '$lib/components/profits/overview/ReactionsTable.svelte';
	import RunningTable from '$lib/components/profits/overview/RunningTable.svelte';
	import SalesTable from '$lib/components/profits/overview/SalesTable.svelte';
	import UnsoldTable from '$lib/components/profits/overview/UnsoldTable.svelte';
	import { formatRelative, formatUtc } from '$lib/format';
	import Seo from '$lib/seo/Seo.svelte';

	let { data } = $props();

	const section = 'space-y-2';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const note = 'text-xs text-gray-500 dark:text-gray-400';
</script>

<Seo
	title="Profits"
	description="Profit of your EVE Online reaction jobs, trades and contracts."
	path="/profits"
	noindex
/>

{#if data.overview}
	{@const o = data.overview}
	<div class="space-y-6 pb-6">
		<header
			class="flex flex-wrap items-end justify-between gap-3 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
		>
			<div>
				<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Profits</h1>
				<p class="text-sm text-gray-500 dark:text-gray-400" data-recalculated>
					{#if o.dirty || o.rebuiltAt === null}
						Waiting to be recalculated
					{:else}
						Results recalculated <span title={formatUtc(o.rebuiltAt)}
							>{formatRelative(o.rebuiltAt, o.now)}</span
						>
					{/if}
				</p>
			</div>
			<PeriodSwitch period={o.period} defaultPeriod={o.defaultPeriod} />
		</header>

		<AttentionBar items={o.attention} />

		<section class={section} aria-labelledby="kpis-heading">
			<h2 id="kpis-heading" class={heading}>Summary of {periodWords(o.period)}</h2>
			<KpiCards kpis={o.kpis} period={o.period} />
		</section>

		<section class={section} aria-labelledby="charts-heading">
			<h2 id="charts-heading" class={heading}>Charts</h2>
			<OverviewCharts charts={o.charts} />
		</section>

		<section class={section} aria-labelledby="reactions-heading">
			<h2 id="reactions-heading" class={heading}>Reactions</h2>
			<p class={note}>
				Jobs that ended in {periodWords(o.period)}, by formula, the most expected profit first.
			</p>
			<ReactionsTable data={o.reactions} period={o.period} defaultPeriod={o.defaultPeriod} />
		</section>

		<section class={section} aria-labelledby="sales-heading">
			<h2 id="sales-heading" class={heading}>Recent sales</h2>
			<p class={note}>Everything you sold in {periodWords(o.period)}, newest first.</p>
			<SalesTable data={o.sales} now={o.now} />
		</section>

		<section class={section} aria-labelledby="unsold-heading">
			<h2 id="unsold-heading" class={heading}>Unsold output</h2>
			<p class={note}>What your jobs made that you still hold, whenever it was made.</p>
			<UnsoldTable data={o.unsold} />
		</section>

		<section class={section} aria-labelledby="running-heading">
			<h2 id="running-heading" class={heading}>Running jobs</h2>
			<RunningTable data={o.running} now={o.now} />
		</section>

		<details class="rounded-lg bg-white p-4 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-300">
			<summary class="cursor-pointer font-semibold text-gray-800 dark:text-gray-200"
				>How these numbers work</summary
			>
			<ul class="mt-2 list-disc space-y-1 pl-5">
				<li>
					<strong>Realized profit</strong> counts what your jobs made and you sold: the sale price after tax
					and broker fees minus what those units cost you, on the day of the sale. Output your manufacturing
					jobs used counts on the day the manufacturing job started, at its buy value or at what it cost you
					(your choice in
					<a href="/account/tracking" class="text-primary-700 hover:underline dark:text-primary-400"
						>Profit tracking settings</a
					>). A cancelled job counts as a loss of its inputs and job cost on the day it ended.
				</li>
				<li>
					<strong>Expected profit</strong> adds the output you still hold, valued at today's market price with your
					calculator settings. Output used by your later jobs is counted by those jobs.
				</li>
				<li>
					What a unit cost you comes from your batches, oldest first: the purchase, contract or job it came
					from, plus the job cost for what your jobs made.
				</li>
				<li>
					When no purchase was recorded for a job's inputs (for example items bought before tracking started),
					they are valued at their buy price when the job started. These are estimates and are marked as such.
				</li>
				<li>
					You can correct any price on the <a
						href="/profits/ledger"
						class="text-primary-700 hover:underline dark:text-primary-400">Ledger tab</a
					>; the results are recalculated afterwards.
				</li>
			</ul>
		</details>
	</div>
{/if}
