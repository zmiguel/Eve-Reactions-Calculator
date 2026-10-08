<script lang="ts">
	import JobRunCells from './JobRunCells.svelte';
	import type { JobRunView } from './job-runs';

	interface Props {
		/** Runs in display order (the page loads them newest `started_at` first). */
		runs: JobRunView[];
		/** Reference time for relative times (server time, so SSR and hydration agree). */
		now: number;
	}

	let { runs, now }: Props = $props();
</script>

<div class="overflow-x-auto">
	<table
		class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
	>
		<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
			<tr>
				<th class="px-3 py-2">Run</th>
				<th class="px-3 py-2">Status</th>
				<th class="px-3 py-2">Started</th>
				<th class="px-3 py-2">Duration</th>
				<th class="px-3 py-2">Detail</th>
			</tr>
		</thead>
		<tbody>
			{#each runs as run (run.runId)}
				<tr class="border-t border-gray-200 dark:border-gray-700" data-run={run.runId}>
					<td class="px-3 py-2 font-mono text-xs whitespace-nowrap text-gray-600 dark:text-gray-400"
						>{run.runId}</td
					>
					<JobRunCells {run} {now} />
				</tr>
			{:else}
				<tr class="border-t border-gray-200 dark:border-gray-700">
					<td colspan="5" class="px-3 py-2 text-gray-500 dark:text-gray-400">No runs yet.</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
