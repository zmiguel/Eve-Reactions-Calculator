<script lang="ts" module>
	/** Tooltips of the estimated markers, shared with the job page. */
	export const ESTIMATE = {
		inputs:
			'Includes a market estimate: no purchase was found for some inputs, so they are valued at their market price when the job started.',
		unsold: "Unsold output is valued at today's market price with your settings."
	} as const;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import { formatIskFull, formatNumber } from '$lib/format';
	import type { JobRow } from '$lib/jobs/types';
	import type { Paged } from '$lib/paging';
	import { blueprintIconUrl } from '$lib/site';
	import JobMarks from './JobMarks.svelte';
	import JobOutputBar from './JobOutputBar.svelte';
	import JobStatusPill from './JobStatusPill.svelte';

	interface Props {
		data: Paged<JobRow>;
		/** Time of the load (relative dates). */
		now: number;
		/** Shown instead of the table when no job matches. */
		empty?: Snippet;
	}

	let { data, now, empty }: Props = $props();

	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const link = 'font-medium text-primary-700 hover:underline dark:text-primary-400';
	const NO_INPUTS = 'Inputs are not worked out yet: waiting for the results to be recalculated.';
	const NO_OUTPUT = {
		running: 'Still running.',
		cancelled: 'Cancelled: the inputs and the job cost are lost and there is no output.',
		finished: 'Waiting for the results to be recalculated.'
	} as const;
</script>

<PagedTable {data} param="page" endpoint="/profits/data/jobs" label="Jobs" noun="jobs" {empty}>
	{#snippet head()}
		<tr>
			<th class={cell}>Job</th>
			<th class={cell}>Status</th>
			<th class="{cell} text-right">Cost</th>
			<th class={cell}>Output</th>
			<th class="{cell} text-right">Realized</th>
			<th class="{cell} text-right">Expected</th>
			<th class={cell}><span class="sr-only">Notes</span></th>
		</tr>
	{/snippet}
	{#snippet row(job: JobRow)}
		<tr class="border-t border-gray-200 dark:border-gray-700" data-job={job.jobId}>
			<td class={cell}>
				<a href="/profits/jobs/{job.jobId}" class="inline-flex items-center gap-2 {link}" data-job-link>
					<img
						src={blueprintIconUrl(job.formula.blueprintTypeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					<span>{job.formula.name ?? 'Unknown formula'}</span>
				</a>
				<span class="mt-0.5 block whitespace-nowrap {muted}" data-job-facts>
					{formatNumber(job.runs)}
					{job.runs === 1 ? 'run' : 'runs'} · {job.owner} · {job.facility}
				</span>
			</td>
			<td class={cell}>
				<JobStatusPill status={job.status} startDate={job.startDate} endDate={job.endDate} {now} />
			</td>
			<td
				class={num}
				title={job.inputCost === null
					? undefined
					: `Inputs ${formatIskFull(job.inputCost)} + job cost ${formatIskFull(job.jobCost ?? 0)}`}
				data-cost
			>
				{#if job.inputCost === null}
					<Isk value={null} missing={NO_INPUTS} />
				{:else}
					<Isk
						value={job.inputCost + (job.jobCost ?? 0)}
						estimated={job.marks.includes('market_fallback') ? ESTIMATE.inputs : null}
					/>
				{/if}
			</td>
			<td class="{cell} min-w-32" data-output>
				{#if job.output}
					<span class="block text-right text-gray-900 tabular-nums dark:text-gray-100"
						>{formatNumber(job.output.quantity)}</span
					>
					<JobOutputBar
						soldQty={job.output.soldQty}
						usedQty={job.output.usedQty}
						manufacturedQty={job.output.manufacturedQty}
						unsoldQty={job.output.unsoldQty}
					/>
				{:else}
					<span class="cursor-help {muted}" title={NO_OUTPUT[job.status]} data-no-output>–</span>
				{/if}
			</td>
			<td class={num} data-realized>
				<Isk value={job.realizedProfit} profit missing={job.expectedNote} />
			</td>
			<td class={num} data-expected>
				<Isk
					value={job.expectedProfit}
					profit
					missing={job.expectedNote}
					estimated={job.expectedProfit !== null && (job.output?.unsoldQty ?? 0) > 0 ? ESTIMATE.unsold : null}
				/>
			</td>
			<td class={cell}><JobMarks marks={job.marks} /></td>
		</tr>
	{/snippet}
</PagedTable>
