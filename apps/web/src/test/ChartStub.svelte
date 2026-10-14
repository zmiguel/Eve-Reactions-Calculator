<script lang="ts">
	/** Stand-in for the ApexCharts wrapper in jsdom: exposes the options it received as attributes. */
	interface Props {
		options: {
			series?: unknown;
			xaxis?: { categories?: unknown[] };
			labels?: unknown[];
			theme?: { mode?: string };
		};
	}

	let { options }: Props = $props();
	const data = $derived((options.series as { data: unknown[] }[] | undefined)?.[0]?.data ?? []);
</script>

<div
	data-chart-stub
	data-series={JSON.stringify(data)}
	data-series-all={JSON.stringify(options.series ?? [])}
	data-categories={JSON.stringify(options.xaxis?.categories ?? [])}
	data-labels={JSON.stringify(options.labels ?? [])}
	data-theme={options.theme?.mode ?? ''}
></div>
