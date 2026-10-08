<script lang="ts">
	/** Stand-in for the ApexCharts wrapper in jsdom: exposes the options it received as attributes. */
	interface Props {
		options: { series?: unknown; xaxis?: { categories?: unknown[] } };
	}

	let { options }: Props = $props();
	const data = $derived((options.series as { data: unknown[] }[] | undefined)?.[0]?.data ?? []);
</script>

<div
	data-chart-stub
	data-series={JSON.stringify(data)}
	data-categories={JSON.stringify(options.xaxis?.categories ?? [])}
></div>
