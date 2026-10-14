<script lang="ts">
	import type { ChartProps } from '@flowbite-svelte-plugins/chart';
	import type { Component } from 'svelte';
	import { containTooltips } from '$lib/charts';
	import { formatIsk, formatIskAxis, formatIskFull, formatNumber, formatUtc } from '$lib/format';
	import type { LedgerItemBatchPoint } from '$lib/ledger/types';
	import { isDark } from '$lib/theme.svelte';

	interface Props {
		/** Every batch, oldest first. */
		points: LedgerItemBatchPoint[];
		/** Value of one unit today (drawn as a line); null without a price. */
		unitValue: number | null;
		/** Test seam: resolves the chart component (defaults to the lazily loaded ApexCharts wrapper). */
		loadChart?: () => Promise<Component<ChartProps>>;
	}

	let {
		points,
		unitValue,
		// Dynamic import: ApexCharts touches `window` at import time, so it must stay out of the SSR bundle.
		loadChart = () => import('@flowbite-svelte-plugins/chart').then((m) => m.Chart as Component<ChartProps>)
	}: Props = $props();

	// Effects never run during SSR, so the chart is rendered client-side only (and only with batches).
	let Chart = $state<Component<ChartProps> | null>(null);
	// Follows the theme toggle: the chart recolours without a reload.
	const dark = $derived(isDark());
	let loading = false;

	$effect(() => {
		if (points.length === 0 || loading) return;
		loading = true;
		loadChart().then((c) => (Chart = c));
	});

	const DAY = 86_400_000;
	// The time axis runs a little past the first and last batch so their points are not cut at the edges.
	// Batches within a few days of each other (often all at the same second) get three days around them:
	// the axis shows dates rather than hours, and the points sit together in the middle.
	const range = $derived.by(() => {
		const first = points[0]?.at ?? 0;
		const span = (points.at(-1)?.at ?? 0) - first;
		const pad = span < 3 * DAY ? (3 * DAY - span) / 2 : span / 20;
		return { min: first - pad, max: first + span + pad };
	});

	const options = $derived.by((): ChartProps['options'] => {
		const text = dark ? '#9ca3af' : '#4b5563';
		return {
			chart: {
				type: 'scatter',
				height: 240,
				fontFamily: 'inherit',
				background: 'transparent',
				toolbar: { show: false },
				zoom: { enabled: false }
			},
			theme: { mode: dark ? 'dark' : 'light' },
			colors: ['#7c3aed'],
			series: [{ name: 'Paid per unit', data: points.map((p) => [p.at, p.unitCost]) }],
			markers: { size: 6 },
			dataLabels: { enabled: false },
			grid: { borderColor: dark ? '#374151' : '#e5e7eb', strokeDashArray: 4 },
			xaxis: {
				type: 'datetime',
				...range,
				// A fixed day format repeated the same day on every hourly tick: let the range pick the unit.
				tickAmount: 6,
				labels: {
					style: { colors: text },
					datetimeUTC: true,
					datetimeFormatter: { year: 'yyyy', month: "MMM 'yy", day: 'dd MMM', hour: 'dd MMM HH:mm' }
				},
				tooltip: { enabled: false }
			},
			yaxis: { min: 0, labels: { style: { colors: text }, formatter: (v: number) => formatIskAxis(v) } },
			annotations: {
				yaxis:
					unitValue === null
						? []
						: [
								{
									y: unitValue,
									borderColor: '#16a34a',
									strokeDashArray: 4,
									label: {
										text: `Value today ${formatIsk(unitValue)}`,
										borderColor: '#16a34a',
										style: { color: '#fff', background: '#16a34a' }
									}
								}
							]
			},
			tooltip: {
				theme: dark ? 'dark' : 'light',
				x: { formatter: (v: number) => formatUtc(v) },
				y: {
					formatter: (v: number, o?: { dataPointIndex: number }) => {
						const p = points[o?.dataPointIndex ?? -1];
						return p ? `${formatIskFull(v)} each, ${formatNumber(p.quantity)} units` : formatIskFull(v);
					}
				}
			}
		};
	});
</script>

{#if points.length === 0}
	<p class="text-sm text-gray-500 dark:text-gray-400" data-empty>
		No batches yet: what you paid shows here once you buy or make this item.
	</p>
{:else}
	<figure data-chart="batches" {@attach containTooltips}>
		<figcaption class="sr-only">Unit price paid per batch over time</figcaption>
		{#if Chart}
			<!-- Recreated on a theme toggle: a live chart switching theme mode takes ApexCharts' own colours. -->
			{#key dark}<Chart {options} />{/key}
		{:else}
			<div class="h-[240px]" aria-hidden="true"></div>
		{/if}
	</figure>
	<p class="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-500 dark:text-gray-400">
		<span
			><span class="mr-1 inline-block h-2 w-2 rounded-full bg-violet-600"></span>Paid per unit, by batch</span
		>
		{#if unitValue !== null}
			<span data-value-line={unitValue}
				><span class="mr-1 inline-block h-0.5 w-3 bg-green-600 align-middle"></span>Value today {formatIsk(
					unitValue
				)} (estimated)</span
			>
		{/if}
	</p>
{/if}
