<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Isk from '#lib/components/profits/Isk.svelte';
	import PagedTable from '#lib/components/profits/PagedTable.svelte';
	import { formatNumber, formatUtc } from '#lib/format.js';
	import type { ManualActionResult, ManualEntryView } from '#lib/ledger/types.js';
	import { actionHref } from '#lib/ledger/forms.js';
	import type { Paged } from '#lib/paging.js';
	import { typeIconUrl } from '#lib/site.js';

	interface Props {
		data: Paged<ManualEntryView>;
		/** Last action result of the page: a failed delete shows its error on its row. */
		form?: ManualActionResult | null;
	}

	let { data, form = null }: Props = $props();

	let removing = $state<number | null>(null);

	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<PagedTable
	{data}
	param="page"
	endpoint="/profits/data/manual-entries"
	label="Your purchases"
	noun="purchases"
>
	{#snippet empty()}
		<p class="py-2 text-sm text-gray-500 dark:text-gray-400" data-empty="entries">
			You have not entered any purchases yet.
		</p>
	{/snippet}
	{#snippet head()}
		<tr>
			<th class="px-3 py-2">Date</th>
			<th class="px-3 py-2">Item</th>
			<th class="px-3 py-2 text-right">Quantity</th>
			<th class="px-3 py-2 text-right">Unit price</th>
			<th class="px-3 py-2 text-right">Total</th>
			<th class="px-3 py-2 text-right">Left</th>
			<th class="px-3 py-2">Note</th>
			<th class="px-3 py-2"><span class="sr-only">Delete</span></th>
		</tr>
	{/snippet}
	{#snippet row(entry: ManualEntryView)}
		<tr class="border-t border-gray-200 dark:border-gray-600" data-entry={entry.entryId}>
			<td class="{cell} whitespace-nowrap">{formatUtc(entry.at)}</td>
			<td class={cell}>
				<a
					href="/profits/ledger/{entry.typeId}"
					class="inline-flex items-center gap-2 whitespace-nowrap {link}"
					data-item={entry.typeId}
				>
					<img
						src={typeIconUrl(entry.typeId)}
						alt=""
						width="24"
						height="24"
						loading="lazy"
						class="h-6 w-6 shrink-0 rounded"
					/>
					{entry.name}
				</a>
			</td>
			<td class={num}>{formatNumber(entry.quantity)}</td>
			<td class={num}><Isk value={entry.unitPrice} /></td>
			<td class={num}><Isk value={entry.total} /></td>
			<td class={num} data-left>
				{#if entry.remaining === null}
					<span class={muted}>Not calculated yet</span>
				{:else}
					{formatNumber(entry.remaining)}
				{/if}
			</td>
			<td class="{cell} max-w-xs text-xs text-gray-600 dark:text-gray-400">{entry.note ?? ''}</td>
			<td class={cell}>
				<form
					method="POST"
					action={actionHref(page.url, 'remove')}
					use:enhance={() => {
						removing = entry.entryId;
						return async ({ update }) => {
							await update({ navigate: false });
							removing = null;
						};
					}}
				>
					<input type="hidden" name="entryId" value={entry.entryId} />
					<button
						type="submit"
						class={button}
						disabled={removing === entry.entryId}
						data-delete={entry.entryId}>Delete</button
					>
				</form>
				{#if form?.action === 'remove' && form.entryId === entry.entryId && form.error}
					<p class="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">{form.error}</p>
				{/if}
			</td>
		</tr>
	{/snippet}
</PagedTable>
