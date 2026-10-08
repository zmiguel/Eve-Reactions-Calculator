<script lang="ts">
	import type { ChartProps } from '@flowbite-svelte-plugins/chart';
	import { onMount, type Component } from 'svelte';
	import { formatIsk, formatIskFull, formatNumber } from '$lib/format';
	import type { SeriesPoint, VolumePoint } from '$lib/server/series';

	interface Props {
		series: SeriesPoint[];
		/** Units of the product traded per day in `regionName`. */
		volumes?: VolumePoint[];
		regionName?: string;
		/** Test seam: resolves the chart component (defaults to the lazily loaded ApexCharts wrapper). */
		loadChart?: () => Promise<Component<ChartProps>>;
	}

	let {
		series,
		volumes = [],
		regionName = 'the region',
		// Dynamic import: ApexCharts touches `window` at import time, so it must stay out of the SSR bundle.
		loadChart = () => import('@flowbite-svelte-plugins/chart').then((m) => m.Chart as Component<ChartProps>)
	}: Props = $props();

	type Metric = 'profitPerSlotDay' | 'outputValue' | 'inputCost';
	const metrics: { key: Metric; title: string; color: string }[] = [
		{ key: 'profitPerSlotDay', title: 'Profit / slot / day', color: '#16a34a' },
		{ key: 'outputValue', title: 'Output value', color: '#2563eb' },
		{ key: 'inputCost', title: 'Input cost', color: '#ea580c' }
	];

	interface Panel {
		key: string;
		title: string;
		color: string;
		dates: string[];
		values: (number | null)[];
		axis: (v: number) => string;
		full: (v: number) => string;
	}

	const approximateDays = $derived(series.filter((p) => p.approximate).length);

	const volumeByDate = $derived(new Map(volumes.map((p) => [p.date, p.volume])));

	const panels = $derived<Panel[]>([
		...(series.length === 0 ? [] : metrics).map((m) => ({
			key: m.key,
			title: m.title,
			color: m.color,
			dates: series.map((p) => p.date),
			values: series.map((p) => p[m.key]),
			axis: (v: number) => formatIsk(v),
			full: (v: number) => formatIskFull(v)
		})),
		...(volumes.length > 0
			? [
					{
						key: 'volume',
						title: `Traded per day, ${regionName}`,
						color: '#7c3aed',
						dates: volumes.map((p) => p.date),
						values: volumes.map((p) => p.volume),
						axis: (v: number) => formatIsk(v),
						full: (v: number) => `${formatNumber(v)} units`
					}
				]
			: [])
	]);

	// onMount never runs during SSR, so the chart is rendered client-side only.
	let Chart = $state<Component<ChartProps> | null>(null);
	let dark = $state(true);

	onMount(() => {
		dark = document.documentElement.classList.contains('dark');
		loadChart().then((c) => (Chart = c));
	});

	function options(panel: Panel): ChartProps['options'] {
		const text = dark ? '#9ca3af' : '#4b5563';
		return {
			chart: {
				type: 'area',
				height: 220,
				fontFamily: 'inherit',
				background: 'transparent',
				toolbar: { show: false },
				zoom: { enabled: false }
			},
			theme: { mode: dark ? 'dark' : 'light' },
			colors: [panel.color],
			series: [{ name: panel.title, data: panel.values }],
			dataLabels: { enabled: false },
			stroke: { curve: 'smooth', width: 2 },
			fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0 } },
			grid: { borderColor: dark ? '#374151' : '#e5e7eb', strokeDashArray: 4 },
			xaxis: {
				// A datetime axis picks readable ticks for any range (category labels overlap on narrow charts).
				type: 'datetime',
				categories: panel.dates,
				labels: { style: { colors: text }, datetimeUTC: true, format: 'dd MMM' },
				tooltip: { enabled: false }
			},
			yaxis: { labels: { style: { colors: text }, formatter: panel.axis } },
			tooltip: {
				theme: dark ? 'dark' : 'light',
				x: {
					formatter: (_: number, o?: { dataPointIndex: number }) => panel.dates[o?.dataPointIndex ?? -1] ?? ''
				},
				y: { formatter: panel.full }
			}
		};
	}
</script>

{#if series.length === 0 && volumes.length === 0}
	<p class="text-sm text-gray-500 dark:text-gray-400" data-empty>
		No price history for this period yet. Daily history builds up as prices are collected.
	</p>
{:else}
	<div
		class="grid grid-cols-1 gap-3 md:grid-cols-2 {panels.length > 3 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}"
	>
		{#each panels as panel (panel.key)}
			<figure class="rounded-lg bg-white p-3 dark:bg-gray-700" data-chart={panel.key}>
				<figcaption class="text-sm font-semibold text-gray-800 dark:text-gray-200">{panel.title}</figcaption>
				{#if Chart}
					<Chart options={options(panel)} />
				{:else}
					<div class="h-[220px]" aria-hidden="true"></div>
				{/if}
			</figure>
		{/each}
	</div>
	{#if approximateDays > 0}
		<p class="mt-2 text-xs text-gray-500 dark:text-gray-400" data-approximate>
			{approximateDays} of {series.length} days (≈ in the table) use the region's average daily trade price where
			no hub prices were collected, for buying and selling alike.
		</p>
	{/if}
	{#if series.length > 0}
		<details class="mt-2 text-sm">
			<summary class="cursor-pointer text-gray-600 dark:text-gray-400"
				>Data table ({series.length} days)</summary
			>
			<div class="mt-2 overflow-x-auto">
				<table class="w-full text-left text-gray-700 dark:text-gray-300">
					<thead class="text-xs text-gray-500 uppercase dark:text-gray-400">
						<tr>
							<th class="px-3 py-1">Date</th>
							{#each metrics as metric (metric.key)}
								<th class="px-3 py-1 text-right">{metric.title}</th>
							{/each}
							{#if volumes.length > 0}
								<th class="px-3 py-1 text-right">Traded</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each series as point (point.date)}
							<tr class="border-t border-gray-200 dark:border-gray-700" data-series-row={point.date}>
								<td class="px-3 py-1" title={point.approximate ? 'Region average prices' : undefined}
									>{point.date}{point.approximate ? ' ≈' : ''}</td
								>
								{#each metrics as metric (metric.key)}
									<td class="px-3 py-1 text-right tabular-nums">{formatIsk(point[metric.key])}</td>
								{/each}
								{#if volumes.length > 0}
									<td class="px-3 py-1 text-right tabular-nums" data-field="volume"
										>{formatNumber(volumeByDate.get(point.date) ?? null)}</td
									>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
{/if}
