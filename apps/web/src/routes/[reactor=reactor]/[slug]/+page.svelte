<script lang="ts">
	import InfoNote from '$lib/components/InfoNote.svelte';
	import ChainFlow from '$lib/components/detail/ChainFlow.svelte';
	import CostSummary from '$lib/components/detail/CostSummary.svelte';
	import MetricsCards from '$lib/components/detail/MetricsCards.svelte';
	import PriceTimingCard from '$lib/components/detail/PriceTimingCard.svelte';
	import ProfitChart from '$lib/components/detail/ProfitChart.svelte';
	import MultibuyButton from '$lib/components/detail/MultibuyButton.svelte';
	import SlotAllocation from '$lib/components/detail/SlotAllocation.svelte';
	import StartupCycles from '$lib/components/detail/StartupCycles.svelte';
	import StepCard from '$lib/components/detail/StepCard.svelte';
	import { MAX_PICKED_LINES, WARNING_TEXT, detailHref } from '$lib/components/detail/links';
	import { productionSteps, replacedReactions } from '$lib/components/detail/steps';
	import SettingsSummary from '$lib/components/listing/SettingsSummary.svelte';
	import { formatIsk, formatPct } from '$lib/format';
	import { multibuyText } from '$lib/multibuy';
	import Seo from '$lib/seo/Seo.svelte';
	import { SLOT_ALLOCATION_OPTIONS } from '$lib/settings/fields';
	import { REACTOR_LABEL, SITE_URL, typeIconUrl } from '$lib/site';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const RANGES = [
		{ value: '30d', label: '30 days' },
		{ value: '90d', label: '90 days' },
		{ value: '1y', label: '1 year' },
		{ value: 'all', label: 'All' }
	];
	const tabClass = (active: boolean) =>
		active
			? 'border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-500'
			: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300';
	const pillClass = (active: boolean) =>
		active
			? 'border-primary-600 bg-primary-600 text-white'
			: 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const h2 = 'text-lg font-semibold text-gray-800 dark:text-gray-200';
</script>

{#if !data.available}
	<Seo
		title="Reaction data not available"
		description="Reaction data is being prepared. Please check back in a few minutes."
		path="/{data.reactor}/{data.slug}"
		noindex
	/>
	<section class="mx-auto max-w-2xl py-16 text-center">
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Data not available yet</h1>
		<p class="mt-3 text-gray-600 dark:text-gray-400">
			Reaction and market data have not been published yet. Please check back in a few minutes.
		</p>
		<a href="/{data.reactor}" class="text-primary-700 dark:text-primary-400 mt-6 inline-block underline">
			Back to {REACTOR_LABEL[data.reactor]} reactions
		</a>
	</section>
{:else}
	{@const r = data.reaction}
	{@const result = data.result}
	{@const path = `/${r.reactor}/${r.slug}`}
	{@const state = {
		...data.query,
		defaultView: data.defaultTabs.view,
		defaultOutput: data.defaultTabs.output
	}}
	{@const steps = productionSteps(data.root, result.inputs)}
	{@const replaced = replacedReactions(data.root)}
	<Seo
		title={r.name}
		description="{r.name} reaction profit: {formatIsk(
			result.totals.profitPerSlotDay
		)} ISK per slot-day, {formatPct(
			result.totals.marginPct
		)} margin, {result.runs} runs per {data.cycleDays}-day cycle at {data.settingsSummary
			.outputHub} prices. Inputs, job cost, full chain and price history."
		{path}
		jsonLd={{
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
				{
					'@type': 'ListItem',
					position: 2,
					name: `${REACTOR_LABEL[r.reactor]} Reactions`,
					item: `${SITE_URL}/${r.reactor}`
				},
				{ '@type': 'ListItem', position: 3, name: r.name, item: `${SITE_URL}${path}` }
			]
		}}
	/>

	<div class="space-y-4 text-gray-900 dark:text-gray-300">
		<nav aria-label="Breadcrumb" class="text-sm text-gray-600 dark:text-gray-400">
			<ol class="flex flex-wrap items-center gap-1">
				<li><a href="/" class="hover:underline">Home</a></li>
				<li aria-hidden="true">/</li>
				<li><a href="/{r.reactor}" class="hover:underline">{REACTOR_LABEL[r.reactor]}</a></li>
				<li aria-hidden="true">/</li>
				<li aria-current="page" class="text-gray-800 dark:text-gray-200">{r.name}</li>
			</ol>
		</nav>

		<header class="flex items-center gap-3">
			<img src={typeIconUrl(r.productTypeId, 64)} alt="" width="48" height="48" class="h-12 w-12 rounded" />
			<div>
				<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">{r.name} Reaction</h1>
				<p class="text-sm text-gray-600 dark:text-gray-400">
					{r.formulaName} · {REACTOR_LABEL[r.reactor]} reactor · prices as of {data.pricesAsOf
						.slice(0, 16)
						.replace('T', ' ')} UTC
				</p>
			</div>
		</header>

		<SettingsSummary settings={data.settingsSummary} warnings={data.profileWarnings} />

		<div class="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 dark:border-gray-600">
			<nav aria-label="Calculation view" class="-mb-px flex gap-2 text-sm font-medium">
				<a
					href={detailHref(path, state, { view: 'single' })}
					class="inline-block border-b-2 px-4 py-2 {tabClass(state.view === 'single')}"
					aria-current={state.view === 'single' ? 'page' : undefined}>Buy inputs</a
				>
				{#if data.chainable}
					<a
						href={detailHref(path, state, { view: 'chain' })}
						class="inline-block border-b-2 px-4 py-2 {tabClass(state.view === 'chain')}"
						aria-current={state.view === 'chain' ? 'page' : undefined}>Full chain</a
					>
				{/if}
				{#if data.unrefinable}
					<a
						href={detailHref(path, state, { view: 'unrefined' })}
						class="inline-block border-b-2 px-4 py-2 {tabClass(state.view === 'unrefined')}"
						aria-current={state.view === 'unrefined' ? 'page' : undefined}>Using unrefined</a
					>
				{/if}
			</nav>
			{#if data.reprocessable}
				<nav aria-label="Output mode" class="mb-1.5 flex gap-1 text-sm">
					<a
						href={detailHref(path, state, { outputMode: 'product' })}
						class="rounded-md border px-3 py-1.5 font-medium {pillClass(state.outputMode === 'product')}"
						aria-current={state.outputMode === 'product' ? 'page' : undefined}>Sell product</a
					>
					<a
						href={detailHref(path, state, { outputMode: 'reprocessed' })}
						class="rounded-md border px-3 py-1.5 font-medium {pillClass(state.outputMode === 'reprocessed')}"
						aria-current={state.outputMode === 'reprocessed' ? 'page' : undefined}>Reprocess</a
					>
				</nav>
			{/if}
			{#if state.view !== 'single'}
				<div class="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
					{#if result.allocation}
						<form method="GET" action={path} class="flex items-center gap-1" data-lines-form>
							{#each Object.entries( { view: state.view, slots: state.slots ?? '', output: state.outputMode === data.defaultTabs.output ? '' : state.outputMode, bought: state.bought === null ? '' : String(state.bought), range: state.range === '30d' ? '' : state.range } ).filter(([, v]) => v) as [name, value] (name)}
								<input type="hidden" {name} {value} />
							{/each}
							<label for="lines-select" class="text-gray-600 dark:text-gray-300">Lines</label>
							<select
								id="lines-select"
								name="lines"
								class="rounded-md border border-gray-200 bg-white py-1 pr-7 pl-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
							>
								<option value="" selected={state.lines === null}
									>Auto ({result.allocation.lines}
									{result.allocation.lines === 1 ? 'line' : 'lines'})</option
								>
								{#each Array.from({ length: MAX_PICKED_LINES }, (_, i) => i + 1) as n (n)}
									<option value={String(n)} selected={state.lines === n}>{n}</option>
								{/each}
							</select>
							<button
								type="submit"
								class="cursor-pointer rounded-md border px-2 py-1.5 font-medium {pillClass(false)}"
								>Set</button
							>
						</form>
					{/if}
					<nav aria-label="Chain slot allocation" class="flex gap-1" data-slot-toggle>
						{#each SLOT_ALLOCATION_OPTIONS as mode (mode.value)}
							<a
								href={detailHref(path, state, {
									slots: mode.value === data.defaultSlotAllocation ? null : mode.value,
									lines: mode.value === 'single' ? null : state.lines
								})}
								class="rounded-md border px-3 py-1.5 font-medium {pillClass(
									data.slotAllocation === mode.value
								)}"
								title={mode.hint}
								aria-current={data.slotAllocation === mode.value ? 'page' : undefined}>{mode.name}</a
							>
						{/each}
					</nav>
				</div>
			{/if}
		</div>

		{#if data.warnings.length > 0 || data.missing.length > 0}
			<ul
				class="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
				role="status"
				data-warnings
			>
				{#if data.missing.length > 0}
					<li>
						No market price for {data.missing.map((m) => m.name).join(', ')}, so profit cannot be computed.
					</li>
				{/if}
				{#each data.warnings as code (code)}
					<li data-warning={code}>
						{code === 'INPUT_VOLUME_SHORT'
							? `${data.inputMarket.name} lists fewer units of some inputs than needed; the rest is priced at ${data.inputMarket.fallbackName}.`
							: (WARNING_TEXT[code] ?? code)}
					</li>
				{/each}
			</ul>
		{/if}

		<MetricsCards {result} />

		{#if replaced.length > 0}
			<InfoNote name="unrefined-note">
				Unrefined reactions replace the {replaced.join(', ')}
				{replaced.length === 1 ? 'reaction' : 'reactions'} here, because that raises the chain's profit/slot/day:
				their product is reprocessed, and the other reprocessed materials replace purchases of later jobs or are
				sold. Compare with Full chain, which uses the regular reactions.
			</InfoNote>
		{:else if state.view === 'unrefined'}
			<InfoNote name="unrefined-note">
				No unrefined reaction raises this chain's profit/slot/day at current prices, so this is the regular
				chain.
			</InfoNote>
		{/if}

		<section class="space-y-2" aria-labelledby="flow-title">
			<h2 id="flow-title" class={h2}>Material flow</h2>
			<ChainFlow root={data.root} />
		</section>

		{#if result.allocation}
			<SlotAllocation allocation={result.allocation} />
			<StartupCycles allocation={result.allocation} />
		{/if}

		<section class="space-y-2" aria-labelledby="steps-title">
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
				<div class="flex flex-wrap items-baseline gap-x-3">
					<h2 id="steps-title" class={h2}>Production steps</h2>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						{steps.length === 1
							? 'One reaction job; every input is bought.'
							: result.allocation
								? `Every cycle from cycle ${result.allocation.phases.at(-1)!.cycle}: ${steps.length} steps, every job in its own slots, side by side; a step's output feeds the next step in the following cycle.`
								: `${steps.length} steps: each step's jobs run side by side and feed the next step.`}
					</p>
				</div>
				<MultibuyButton text={multibuyText(data.root)} />
			</div>
			{#each steps as step (step.number)}
				<StepCard
					{step}
					count={steps.length}
					available={data.inputMarket.showAvailable}
					markets={data.inputMarket.names}
				/>
			{/each}
		</section>

		<section class="space-y-2" aria-labelledby="summary-title">
			<h2 id="summary-title" class={h2}>Summary</h2>
			<CostSummary {result} {steps} />
		</section>

		<PriceTimingCard
			timing={data.timing}
			action={path}
			hidden={Object.fromEntries(
				[
					['view', state.view === data.defaultTabs.view ? '' : state.view],
					['slots', state.slots ?? ''],
					['lines', state.lines === null ? '' : String(state.lines)],
					['output', state.outputMode === data.defaultTabs.output ? '' : state.outputMode],
					['range', state.range === '30d' ? '' : state.range]
				].filter(([, v]) => v)
			)}
		/>

		<section id="history" class="space-y-2" aria-labelledby="history-title">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 id="history-title" class={h2}>Price and volume history</h2>
				<nav aria-label="History range" class="flex gap-1 text-sm">
					{#each RANGES as range (range.value)}
						<a
							href={detailHref(path, state, { range: range.value }, 'history')}
							class="rounded-md border px-3 py-1.5 font-medium {pillClass(state.range === range.value)}"
							aria-current={state.range === range.value ? 'page' : undefined}>{range.label}</a
						>
					{/each}
				</nav>
			</div>
			<ProfitChart
				series={data.series}
				volumes={data.volumeSeries.points}
				regionName={data.volumeSeries.regionName}
			/>
		</section>
	</div>
{/if}
