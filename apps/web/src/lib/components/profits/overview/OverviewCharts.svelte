<script lang="ts" module>
	import type { InputSourceKind } from '#lib/profits/types.js';

	/** Donut slice names and colors, in the order the slices are listed. */
	export const INPUT_SOURCE: Record<InputSourceKind, { label: string; color: string }> = {
		transaction: { label: 'Market purchases', color: '#2563eb' },
		contract: { label: 'Contracts', color: '#7c3aed' },
		manual: { label: 'Entered purchases', color: '#0891b2' },
		job: { label: 'Made by your jobs', color: '#16a34a' },
		market: { label: 'Market estimate (no purchase record)', color: '#d97706' },
		correction: { label: 'Your corrections', color: '#6b7280' }
	};
</script>

<script lang="ts">
	import type { ChartProps } from '@flowbite-svelte-plugins/chart';
	import { onMount, type Component } from 'svelte';
	import { containTooltips } from '#lib/charts.js';
	import { formatIsk, formatIskAxis, formatIskFull, formatPct } from '#lib/format.js';
	import type { OverviewCharts } from '#lib/profits/types.js';
	import { isDark } from '#lib/theme.svelte.js';

	interface Props {
		charts: OverviewCharts;
		/** Test seam: resolves the chart component (defaults to the lazily loaded ApexCharts wrapper). */
		loadChart?: () => Promise<Component<ChartProps>>;
	}

	let {
		charts,
		// Dynamic import: ApexCharts touches `window` at import time, so it must stay out of the SSR bundle.
		loadChart = () => import('@flowbite-svelte-plugins/chart').then((m) => m.Chart as Component<ChartProps>)
	}: Props = $props();

	// onMount never runs during SSR, so the charts are rendered client-side only.
	let Chart = $state<Component<ChartProps> | null>(null);
	// Follows the theme toggle: the charts recolour without a reload.
	const dark = $derived(isDark());

	onMount(() => {
		loadChart().then((c) => (Chart = c));
	});

	const GREEN = '#16a34a';
	const RED = '#dc2626';
	const BLUE = '#2563eb';
	const ORANGE = '#ea580c';
	const PURPLE = '#7c3aed';

	const BUCKET_WORD = { day: 'day', week: 'week', month: 'month' } as const;
	const timeline = $derived(charts.timeline);
	const labels = $derived(timeline.map((p) => p.label));
	const hasProfit = $derived(timeline.some((p) => p.realized !== 0));
	const hasMoney = $derived(
		timeline.some((p) => p.salesIncome !== 0 || p.purchases !== 0 || p.jobCosts !== 0)
	);
	const inputTotal = $derived(charts.inputSources.reduce((s, x) => s + x.cost, 0));

	/** Width of a chart panel (all are as wide): the axes label as many ticks as fit. */
	let width = $state(0);
	const narrow = $derived(width < 480);

	function base(type: 'line' | 'bar' | 'donut', height = 260, stacked = false): ChartProps['options'] {
		const text = dark ? '#9ca3af' : '#4b5563';
		return {
			chart: {
				type,
				height,
				stacked,
				fontFamily: 'inherit',
				background: 'transparent',
				toolbar: { show: false },
				zoom: { enabled: false },
				foreColor: text
			},
			theme: { mode: dark ? 'dark' : 'light' },
			dataLabels: { enabled: false },
			grid: { borderColor: dark ? '#374151' : '#e5e7eb', strokeDashArray: 4 },
			// One row of legend items, not a column per stacked group.
			legend: { position: 'bottom', labels: { colors: text }, clusterGroupedSeries: false },
			tooltip: { theme: dark ? 'dark' : 'light', y: { formatter: (v: number) => formatIskFull(v) } }
		};
	}

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	/** Axis label of a bucket (`YYYY-MM-DD` for days and weeks, `YYYY-MM`): `8 Oct`, or `Oct 2026`. */
	function tickLabel(label: string): string {
		const [year, month, day] = label.split('-').map(Number);
		return day === undefined ? `${MONTHS[month - 1]} ${year}` : `${day} ${MONTHS[month - 1]}`;
	}
	/** Tooltip title of a bucket: `8 Oct 2026`, `Week of 6 Oct 2026`, `Oct 2026`. */
	function bucketTitle(label: string): string {
		const year = label.slice(0, 4);
		if (charts.bucket === 'month') return tickLabel(label);
		return `${charts.bucket === 'week' ? 'Week of ' : ''}${tickLabel(label)} ${year}`;
	}

	// Every n-th bucket is labelled, as many as fit beside the value axis (about 80px with padding): about
	// 56px a label (`28 Sep`), 76px for months (`Sep 2026`).
	const labelStep = $derived(
		Math.ceil(labels.length / Math.max(2, Math.floor((width - 80) / (charts.bucket === 'month' ? 76 : 56))))
	);
	const timeAxis = $derived({
		type: 'category' as const,
		categories: labels,
		labels: {
			rotate: 0,
			// ApexCharts also calls it with values that are no bucket (undefined while sizing the axis).
			formatter: (label: string) => {
				const i = labels.indexOf(label);
				return i >= 0 && i % labelStep === 0 ? tickLabel(label) : '';
			}
		},
		tooltip: { enabled: false }
	});
	const timeTooltip = $derived({
		...base('line').tooltip,
		x: {
			formatter: (_: unknown, o?: { dataPointIndex: number }) => bucketTitle(labels[o?.dataPointIndex ?? 0])
		}
	});
	const iskAxis = { labels: { formatter: (v: number) => formatIskAxis(v) } };

	const profitOptions = $derived<ChartProps['options']>({
		...base('line'),
		series: [
			{
				name: `Realized profit per ${BUCKET_WORD[charts.bucket]}`,
				type: 'column',
				data: timeline.map((p) => p.realized)
			},
			{ name: 'Cumulative', type: 'line', data: timeline.map((p) => p.cumulative) }
		],
		colors: [GREEN, BLUE],
		stroke: { width: [0, 2], curve: 'smooth' },
		// Over a few buckets the line is short (over one, a single point): markers show where it is.
		markers: { size: [0, timeline.length < 8 ? 5 : 0], strokeWidth: 0 },
		plotOptions: {
			bar: { columnWidth: '70%', colors: { ranges: [{ from: -1e18, to: -1e-9, color: RED }] } }
		},
		xaxis: timeAxis,
		yaxis: iskAxis,
		tooltip: timeTooltip
	});

	const moneyOptions = $derived<ChartProps['options']>({
		...base('bar', 260, true),
		series: [
			{ name: 'Sales income', group: 'in', data: timeline.map((p) => p.salesIncome) },
			{ name: 'Purchases', group: 'out', data: timeline.map((p) => p.purchases) },
			{ name: 'Job costs', group: 'out', data: timeline.map((p) => p.jobCosts) }
		],
		colors: [GREEN, ORANGE, PURPLE],
		plotOptions: { bar: { columnWidth: '70%' } },
		xaxis: timeAxis,
		yaxis: iskAxis,
		tooltip: timeTooltip
	});

	// Product names beside the bars get up to 120px on a phone, 180px otherwise; value ticks about 70px apart.
	const nameWidth = $derived(narrow ? 120 : 180);
	const valueTicks = $derived(Math.min(6, Math.max(2, Math.floor((width - nameWidth - 40) / 70))));
	const reactionOptions = $derived<ChartProps['options']>({
		// One bar per formula: the chart grows with them.
		...base('bar', Math.max(180, 48 + charts.reactions.length * 34), true),
		series: [
			{ name: 'Realized', data: charts.reactions.map((r) => r.realized) },
			{ name: "Not yet realized (unsold at today's value)", data: charts.reactions.map((r) => r.unrealized) }
		],
		colors: [GREEN, '#86efac'],
		plotOptions: { bar: { horizontal: true, barHeight: '65%' } },
		xaxis: {
			categories: charts.reactions.map((r) => r.name),
			tickAmount: valueTicks,
			labels: { formatter: (v: string) => formatIskAxis(Number(v)) }
		},
		yaxis: { labels: { maxWidth: nameWidth } }
	});

	const donutOptions = $derived<ChartProps['options']>({
		...base('donut'),
		series: charts.inputSources.map((s) => s.cost),
		labels: charts.inputSources.map((s) => INPUT_SOURCE[s.kind].label),
		colors: charts.inputSources.map((s) => INPUT_SOURCE[s.kind].color),
		stroke: { width: 0 },
		// The list under the chart names every source with its cost and share.
		legend: { show: false },
		// In the corner, beside the ring: over the slice it would hide the centre label.
		tooltip: { ...base('donut').tooltip, fixed: { enabled: true, position: 'topRight' } },
		plotOptions: {
			pie: {
				donut: {
					labels: {
						show: true,
						total: { show: true, label: 'Input cost', formatter: () => formatIsk(inputTotal) },
						value: { formatter: (v: string) => formatIsk(Number(v)) }
					}
				}
			}
		}
	});

	const panels = $derived([
		{
			key: 'profit',
			title: 'Profit over time',
			hint: 'Realized profit by sale date; the line adds it up over the period.',
			options: profitOptions,
			empty: hasProfit
				? null
				: 'No profit realized in this period yet. It shows here once you sell what your jobs made.'
		},
		{
			key: 'money',
			title: 'Money in and out',
			hint: 'Sales income next to what you paid for purchases and job costs.',
			options: moneyOptions,
			empty: hasMoney ? null : 'No sales, purchases or job costs in this period.'
		},
		{
			key: 'reactions',
			title: 'Profit by reaction',
			hint: 'Formulas with the highest expected profit among jobs that ended in this period.',
			options: reactionOptions,
			empty: charts.reactions.length > 0 ? null : 'No job ended in this period.'
		},
		{
			key: 'inputs',
			title: 'Where input costs come from',
			hint: 'Input cost of the jobs started in this period, by where the materials came from.',
			options: donutOptions,
			empty: charts.inputSources.length > 0 ? null : 'No job started in this period.'
		}
	]);
</script>

<div class="grid grid-cols-1 gap-3 lg:grid-cols-2" {@attach containTooltips}>
	{#each panels as panel (panel.key)}
		<!-- Every panel is as wide: each reports the same width. -->
		<figure
			class="flex flex-col rounded-lg bg-white p-3 dark:bg-gray-700"
			data-chart={panel.key}
			bind:clientWidth={width}
		>
			<figcaption>
				<span class="block text-sm font-semibold text-gray-800 dark:text-gray-200">{panel.title}</span>
				<span class="block text-xs text-gray-500 dark:text-gray-400">{panel.hint}</span>
			</figcaption>
			{#if panel.empty}
				<p
					class="flex min-h-40 flex-1 items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-gray-400"
					data-empty
				>
					{panel.empty}
				</p>
			{:else if Chart}
				<!-- Recreated on a theme toggle: a live chart switching theme mode takes ApexCharts' own colours. -->
				{#key dark}<Chart options={panel.options} />{/key}
			{:else}
				<div class="h-[260px]" aria-hidden="true"></div>
			{/if}
			{#if panel.key === 'inputs' && !panel.empty}
				<ul class="mx-auto mt-2 grid w-full max-w-sm gap-y-1 text-xs text-gray-600 dark:text-gray-300">
					{#each charts.inputSources as slice (slice.kind)}
						<li class="flex items-center gap-2" data-slice={slice.kind}>
							<span
								class="inline-block size-2.5 shrink-0 rounded-full"
								style="background: {INPUT_SOURCE[slice.kind].color}"
							></span>
							<span class="flex-1">{INPUT_SOURCE[slice.kind].label}</span>
							<span class="tabular-nums whitespace-nowrap" title={formatIskFull(slice.cost)}
								>{formatIsk(slice.cost)} ({formatPct((slice.cost / inputTotal) * 100, 0)})</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</figure>
	{/each}
</div>
