<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import { formatIsk, formatNumber, formatUtc } from '$lib/format';
	import { actionHref } from '$lib/ledger/forms';
	import type { Paged } from '$lib/paging';
	import type { ReconcileActionResult, ReconcileInputRow } from '$lib/ledger/types';
	import { blueprintIconUrl, typeIconUrl } from '$lib/site';
	import UnitPriceForm from './UnitPriceForm.svelte';

	interface Props {
		data: Paged<ReconcileInputRow>;
		form?: ReconcileActionResult | null;
	}

	let { data, form = null }: Props = $props();

	const COLUMNS = 5;
	/** The form being sent (`ref` of a row or `type:<id>` of an item). */
	let busy = $state<string | null>(null);
	const submit = (key: string) => () => {
		busy = key;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = null;
		};
	};
	const failed = (action: ReconcileActionResult['action'], ref: string) =>
		form?.action === action && form.ref === ref && form.error ? form.error : null;

	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const error = 'text-xs text-red-700 dark:text-red-400';
</script>

<PagedTable
	{data}
	param="inputs"
	endpoint="/profits/data/reconcile-inputs"
	label="Job inputs without a purchase"
	noun="inputs"
>
	{#snippet head()}
		<tr>
			<th class="px-3 py-2">Job</th>
			<th class="px-3 py-2 text-right">Quantity</th>
			<th class="px-3 py-2 text-right">Estimate</th>
			<th class="px-3 py-2">How it was estimated</th>
			<th class="px-3 py-2">Your price</th>
		</tr>
	{/snippet}
	{#snippet row(r: ReconcileInputRow)}
		{#if r.first}
			{@const key = `type:${r.item.typeId}`}
			<tr
				class="border-t border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/60"
				data-item-heading={r.item.typeId}
			>
				<td colspan={COLUMNS} class="px-3 py-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<a
							href="/profits/ledger/{r.item.typeId}"
							class="inline-flex items-center gap-2 font-medium {link}"
							data-item={r.item.typeId}
						>
							<img
								src={typeIconUrl(r.item.typeId)}
								alt=""
								width="24"
								height="24"
								loading="lazy"
								class="h-6 w-6 shrink-0 rounded"
							/>
							{r.item.name}
							<span class={muted}
								>{formatNumber(r.itemRows)}
								{r.itemRows === 1 ? 'job' : 'jobs'}, {formatNumber(r.itemQuantity)} units</span
							>
						</a>
						{#if r.itemConfirmable > 0}
							<form
								method="POST"
								action={actionHref(page.url, 'confirmAll')}
								use:enhance={submit(key)}
								data-confirm-all={r.item.typeId}
							>
								<input type="hidden" name="typeId" value={r.item.typeId} />
								<button type="submit" class={button} disabled={busy === key}
									>Use buy value for all ({formatNumber(r.itemConfirmable)})</button
								>
							</form>
						{/if}
					</div>
					{#if failed('confirmAll', key)}
						<p class={error} role="alert">{failed('confirmAll', key)}</p>
					{/if}
				</td>
			</tr>
		{/if}
		<tr class="border-t border-gray-200 dark:border-gray-700" data-input={r.ref}>
			<td class="{cell} whitespace-nowrap">
				<a
					href="/profits/jobs/{r.jobId}"
					class="inline-flex items-center gap-1 {link}"
					data-job-link={r.jobId}
				>
					{#if r.formula}
						<img
							src={blueprintIconUrl(r.formula.blueprintTypeId)}
							alt=""
							width="16"
							height="16"
							loading="lazy"
							class="h-4 w-4 rounded"
						/>
					{/if}
					{r.formula?.name ?? 'Unknown formula'}</a
				>
				<span class="block {muted}">Started {formatUtc(r.startedAt)}</span>
			</td>
			<td class={num}>{formatNumber(r.quantity)}</td>
			<td class={num}>
				<Isk value={r.estimate} missing="No buy value was known when the job started." />
			</td>
			<td class="{cell} max-w-xs text-xs text-gray-600 dark:text-gray-400" data-estimate-text
				>{r.estimateText}</td
			>
			<td class={cell}>
				{#if r.saved}
					<span class="text-xs text-gray-700 dark:text-gray-300" data-saved
						>Saved, recalculating: {formatIsk(r.saved.unitPrice)} ISK</span
					>
				{:else}
					<div class="flex flex-col items-start gap-1">
						<UnitPriceForm kind="job_input" ref={r.ref} {form} />
						{#if r.estimate !== null}
							<form
								method="POST"
								action={actionHref(page.url, 'confirm')}
								use:enhance={submit(r.ref)}
								data-confirm={r.ref}
							>
								<input type="hidden" name="ref" value={r.ref} />
								<button type="submit" class={button} disabled={busy === r.ref}>Use buy value</button>
							</form>
						{/if}
						{#if failed('confirm', r.ref)}
							<p class={error} role="alert">{failed('confirm', r.ref)}</p>
						{/if}
					</div>
				{/if}
			</td>
		</tr>
	{/snippet}
</PagedTable>
