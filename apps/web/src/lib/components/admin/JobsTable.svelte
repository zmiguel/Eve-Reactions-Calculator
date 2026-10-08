<script lang="ts">
	import { Modal } from 'flowbite-svelte';
	import { enhance } from '$app/forms';
	import type { UpdaterAction } from '$lib/admin/jobs';
	import JobRunCells from './JobRunCells.svelte';
	import JobStatusTable from './JobStatusTable.svelte';
	import type { JobView } from './job-runs';

	interface Props {
		/** Every job of the registry, in its order, with its recent runs (newest first). */
		jobs: JobView[];
		/** Reference time for relative times (server time, so SSR and hydration agree). */
		now: number;
	}

	let { jobs, now }: Props = $props();

	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-gray-700 hover:bg-gray-100 disabled:cursor-default disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';

	/** Actions whose form submission is in flight (the button is disabled meanwhile). */
	let pending: Partial<Record<UpdaterAction, true>> = $state({});

	let historyOpen = $state(false);
	let historyKind: string | null = $state(null);
	// Derived from the props so the open modal follows the page's periodic refresh.
	const historyJob = $derived(jobs.find((job) => job.kind === historyKind) ?? null);

	/** A run of a job that is still running asks before starting another one. */
	function confirmIfRunning(event: MouseEvent, job: JobView) {
		if (job.runs[0]?.status !== 'running') return;
		if (!confirm(`${job.label} is still running. Start another run anyway?`)) event.preventDefault();
	}
</script>

<div class="overflow-x-auto">
	<table
		class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
	>
		<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
			<tr>
				<th class="px-3 py-2">Job</th>
				<th class="px-3 py-2">Status</th>
				<th class="px-3 py-2">Started</th>
				<th class="px-3 py-2">Duration</th>
				<th class="px-3 py-2">Detail</th>
				<th class="px-3 py-2"><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each jobs as job (job.kind)}
				{@const latest = job.runs[0]}
				<tr class="border-t border-gray-200 align-top dark:border-gray-700" data-kind={job.kind}>
					<td class="max-w-xs px-3 py-2">
						<span class="font-semibold text-gray-900 dark:text-gray-100">{job.label}</span>
						<span class="block text-xs text-gray-500 dark:text-gray-400">{job.description}</span>
					</td>
					{#if latest}
						<JobRunCells run={latest} {now} />
					{:else}
						<td colspan="4" class="px-3 py-2 text-gray-500 dark:text-gray-400" data-never>Never run</td>
					{/if}
					<td class="px-3 py-2">
						<div class="flex flex-wrap justify-end gap-1">
							{#each job.actions as { action, label } (action)}
								<form
									method="POST"
									action="?/{action}"
									use:enhance={() => {
										pending[action] = true;
										return async ({ update }) => {
											await update();
											delete pending[action];
										};
									}}
								>
									<button
										type="submit"
										class={button}
										disabled={pending[action]}
										onclick={(event) => confirmIfRunning(event, job)}>{label}</button
									>
								</form>
							{/each}
							<button
								type="button"
								class={button}
								disabled={job.runs.length === 0}
								onclick={() => {
									historyKind = job.kind;
									historyOpen = true;
								}}>History</button
							>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<Modal title={historyJob ? `${historyJob.label}: recent runs` : ''} bind:open={historyOpen} size="xl">
	{#if historyJob}
		<JobStatusTable runs={historyJob.runs} {now} />
	{/if}
</Modal>
