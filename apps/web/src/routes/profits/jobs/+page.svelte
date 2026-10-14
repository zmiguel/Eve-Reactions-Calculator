<script lang="ts">
	import JobFilters, { PERIODS, jobsHref } from '$lib/components/jobs/JobFilters.svelte';
	import JobOutputBar from '$lib/components/jobs/JobOutputBar.svelte';
	import JobTable, { ESTIMATE } from '$lib/components/jobs/JobTable.svelte';
	import Isk from '$lib/components/profits/Isk.svelte';
	import { formatNumber, formatRelative, formatUtc } from '$lib/format';
	import Seo from '$lib/seo/Seo.svelte';

	let { data } = $props();

	const totals = $derived(data.totals);
	/** The period after "in the last": "30 days", "year". */
	const periodText = $derived(
		data.filters.period === '365'
			? 'year'
			: (PERIODS.find(([value]) => value === data.filters.period)?.[1] ?? '')
	);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const stat = 'text-lg font-semibold text-gray-900 tabular-nums dark:text-gray-100';
</script>

<Seo
	title="Jobs"
	description="Your tracked EVE Online reaction jobs with what they cost and what they earned."
	path="/profits/jobs"
	noindex
/>

<div class="space-y-4 pb-4">
	<header class="flex flex-wrap items-baseline justify-between gap-2">
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Jobs</h1>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Every reaction job of your tracked characters and corporations: what it cost and what its output
				earned.
			</p>
		</div>
		<p class="flex flex-wrap gap-x-4 gap-y-1 text-xs {muted}" data-state>
			<span data-rebuilt>
				{#if data.dirty}
					Updating the numbers with your latest changes.
				{:else if data.rebuiltAt}
					<span title={formatUtc(data.rebuiltAt)}
						>Numbers updated {formatRelative(data.rebuiltAt, data.now)}</span
					>
				{:else}
					Numbers not worked out yet.
				{/if}
			</span>
			{#if data.reviewCount > 0}
				<a href="/profits/ledger?review=1" class={link} data-review
					><span data-review-count>{formatNumber(data.reviewCount)}</span>
					{data.reviewCount === 1 ? 'price needs' : 'prices need'} your review</a
				>
			{/if}
		</p>
	</header>

	{#if !data.hasJobs}
		<section class="{card} space-y-2" data-empty="no_jobs">
			<h2 class="font-semibold text-gray-900 dark:text-white">No jobs yet</h2>
			<p class="text-gray-700 dark:text-gray-300">
				When you switch Profit tracking on for a character or corporation, the reaction jobs of the last 90
				days are read, and new jobs are picked up every hour. Jobs show up here after the first sync.
			</p>
			<p>
				<a href="/account/connections" class={link}>Check your connections</a>
			</p>
		</section>
	{:else}
		<JobFilters
			filters={data.filters}
			defaultPeriod={data.defaultPeriod}
			counts={data.counts}
			formulas={data.formulas}
			connections={data.connections}
		/>

		{#if totals.jobs > 0}
			<section class={card} aria-label="Summary of these jobs" data-totals>
				<dl class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
					<div>
						<dt class={muted}>Jobs</dt>
						<dd class={stat} data-total="jobs">{formatNumber(totals.jobs)}</dd>
					</div>
					<div>
						<dt class={muted}>Total cost</dt>
						<dd class={stat} data-total="spent"><Isk value={totals.spent} /></dd>
						<dd class="text-xs {muted}">inputs at their cost and job costs</dd>
					</div>
					<div>
						<dt class={muted}>Realized profit</dt>
						<dd class="text-lg font-semibold" data-total="realized">
							<Isk value={totals.realizedProfit} profit />
						</dd>
						<dd class="text-xs {muted}">
							{totals.manufacturedQty > 0 ? 'from output sold or used in manufacturing' : 'from output sold'}
						</dd>
					</div>
					<div>
						<dt class={muted}>Expected profit</dt>
						<dd class="text-lg font-semibold" data-total="expected">
							<Isk
								value={totals.expectedProfit}
								profit
								estimated={totals.unsoldQty > 0 ? ESTIMATE.unsold : null}
							/>
						</dd>
						{#if totals.unvalued > 0}
							<dd class="text-xs text-amber-700 dark:text-amber-400" data-unvalued>
								{formatNumber(totals.unvalued)}
								{totals.unvalued === 1 ? 'job' : 'jobs'} left out: no market price today
							</dd>
						{:else}
							<dd class="text-xs {muted}">if unsold output sells at today's price</dd>
						{/if}
					</div>
					<div class="col-span-2 sm:col-span-4 lg:col-span-1">
						<dt class={muted}>Output</dt>
						<dd class="mt-1" data-total="output">
							<JobOutputBar
								soldQty={totals.soldQty}
								usedQty={totals.usedQty}
								manufacturedQty={totals.manufacturedQty}
								unsoldQty={totals.unsoldQty}
								size="md"
								legend
							/>
						</dd>
					</div>
				</dl>
			</section>
		{/if}

		<section class="rounded-lg bg-white p-2 text-sm dark:bg-gray-700">
			{#if data.jobs.total > 0}
				<p class="px-2 pb-1 text-xs sm:hidden {muted}" data-scroll-hint>
					Swipe the table sideways to see every column.
				</p>
			{/if}
			<JobTable data={data.jobs} now={data.now}>
				{#snippet empty()}
					<div class="space-y-2 p-4" data-empty={data.filters.period === 'all' ? 'filtered' : 'period'}>
						{#if data.filters.period !== 'all'}
							<p class="text-gray-700 dark:text-gray-300">
								No jobs match these filters in the last {periodText}. Running jobs always show; the others
								show by the date they ended.
							</p>
							<a
								href={jobsHref(data.filters, { period: 'all' }, data.defaultPeriod)}
								class={link}
								data-show-all>Show jobs of every period</a
							>
						{:else}
							<p class="text-gray-700 dark:text-gray-300">No jobs match these filters.</p>
							<a href="/profits/jobs" class={link}>Clear filters</a>
						{/if}
					</div>
				{/snippet}
			</JobTable>
		</section>
	{/if}
</div>
