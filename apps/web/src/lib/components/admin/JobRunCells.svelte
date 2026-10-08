<script lang="ts">
	import { formatDuration, formatRelative, formatUtc } from '$lib/format';
	import {
		ENDED_WORKFLOW,
		isPossiblyStuck,
		parseProgress,
		QUIET_WORKFLOW,
		STATUS_CLASSES,
		summarizeDetail,
		triggerOf,
		type JobRunView
	} from './job-runs';

	interface Props {
		run: JobRunView;
		/** Reference time for relative times (server time, so SSR and hydration agree). */
		now: number;
	}

	let { run, now }: Props = $props();

	const running = $derived(run.status === 'running');
	const progress = $derived(running ? parseProgress(run.progressJson) : null);
	const detail = $derived(summarizeDetail(run.detailJson));
	const trigger = $derived(triggerOf(run.runId));
</script>

<td class="px-3 py-2 whitespace-nowrap">
	<span
		class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {STATUS_CLASSES[run.status] ??
			'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200'}"
		data-status={run.status}>{run.status}</span
	>
	<span class="ml-1 text-xs text-gray-500 dark:text-gray-400" data-trigger={trigger}>{trigger}</span>
	{#if isPossiblyStuck(run, now)}
		<span
			class="mt-1 block w-max rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-300"
			data-stuck>Possibly stuck</span
		>
	{/if}
</td>
<td class="px-3 py-2 whitespace-nowrap" title={formatUtc(run.startedAt)}
	>{formatRelative(run.startedAt, now)}</td
>
<td class="px-3 py-2 whitespace-nowrap tabular-nums">
	{run.finishedAt === null
		? `running ${formatDuration((now - run.startedAt) / 1000)}`
		: formatDuration((run.finishedAt - run.startedAt) / 1000)}
</td>
{#if running}
	<td class="max-w-md px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
		{#if progress}
			{@const label =
				progress.total === null
					? `Step ${progress.done + 1}: ${progress.step}`
					: `Step ${progress.done + 1} of ${progress.total}: ${progress.step}`}
			<span class="block truncate" title={label} data-progress>{label}</span>
			{#if progress.total !== null && progress.total > 0}
				<div
					class="mt-1 h-1 w-full max-w-48 overflow-hidden rounded bg-gray-200 dark:bg-gray-600"
					role="progressbar"
					aria-label="Steps done"
					aria-valuemin={0}
					aria-valuemax={progress.total}
					aria-valuenow={progress.done}
				>
					<div
						class="h-full bg-sky-500"
						style:width="{Math.min(100, (progress.done / progress.total) * 100)}%"
					></div>
				</div>
			{/if}
		{/if}
		{#if run.progressAt !== null}
			<span class="mt-1 block" title={formatUtc(run.progressAt)}
				>last activity {formatRelative(run.progressAt, now)}</span
			>
		{/if}
		{#if run.workflow && !QUIET_WORKFLOW[run.workflow.status]}
			{@const line = `Workflow ${run.workflow.status}${run.workflow.error ? `: ${run.workflow.error}` : ''}`}
			<span
				class="mt-1 block truncate {ENDED_WORKFLOW[run.workflow.status]
					? 'text-red-600 dark:text-red-400'
					: 'text-amber-700 dark:text-amber-400'}"
				title={line}
				data-workflow={run.workflow.status}>{line}</span
			>
		{/if}
	</td>
{:else}
	<!-- Wraps onto further lines inside the same width (long values such as release dates stay readable). -->
	<td class="max-w-md px-3 py-2 text-xs break-words text-gray-600 dark:text-gray-400" data-detail>{detail}</td
	>
{/if}
