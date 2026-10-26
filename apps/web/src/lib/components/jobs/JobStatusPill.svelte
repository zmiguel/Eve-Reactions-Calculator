<script lang="ts">
	import Pill, { type PillTone } from '#lib/components/profits/Pill.svelte';
	import { formatRelative, formatSpan, formatUtc } from '#lib/format.js';
	import type { JobStatus } from '#lib/jobs/types.js';

	/**
	 * A job's status: Running (blue) with a progress bar and "ends in 1d 4h"; Finished (green) with
	 * "ended 2 d ago"; Cancelled (red). Dates in the tooltips.
	 */
	let {
		status,
		startDate,
		endDate,
		now
	}: { status: JobStatus; startDate: number; endDate: number; now: number } = $props();

	const PILL: Record<JobStatus, [PillTone, string]> = {
		running: ['blue', 'Running'],
		finished: ['green', 'Finished'],
		cancelled: ['red', 'Cancelled']
	};
	const progress = $derived(
		endDate > startDate ? Math.min(100, Math.max(0, ((now - startDate) / (endDate - startDate)) * 100)) : 100
	);
	const dates = $derived(`Started ${formatUtc(startDate)}, ends ${formatUtc(endDate)}`);
</script>

<span class="inline-flex min-w-28 flex-col gap-1" data-status={status}>
	<span><Pill tone={PILL[status][0]} title={dates}>{PILL[status][1]}</Pill></span>
	{#if status === 'running'}
		<span
			class="block h-1.5 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950"
			role="progressbar"
			aria-label="Job progress"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress)}
			data-progress={Math.round(progress)}
		>
			<span class="block h-full rounded-full bg-blue-500 dark:bg-blue-400" style="width: {progress}%"></span>
		</span>
		<span class="text-xs whitespace-nowrap text-gray-500 dark:text-gray-400" title={formatUtc(endDate)}
			>ends in {formatSpan(endDate - now)}</span
		>
	{:else if status === 'finished'}
		<span class="text-xs whitespace-nowrap text-gray-500 dark:text-gray-400" title={formatUtc(endDate)}
			>ended {formatRelative(endDate, now)}</span
		>
	{:else}
		<span class="text-xs whitespace-nowrap text-gray-500 dark:text-gray-400" title={formatUtc(startDate)}
			>started {formatRelative(startDate, now)}</span
		>
	{/if}
</span>
