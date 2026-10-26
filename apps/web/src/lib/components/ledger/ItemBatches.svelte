<script lang="ts">
	import Isk from '#lib/components/profits/Isk.svelte';
	import PagedTable from '#lib/components/profits/PagedTable.svelte';
	import { formatNumber, formatRelative, formatUtc } from '#lib/format.js';
	import { ORIGIN_TEXT } from '#lib/ledger/source.js';
	import type { LedgerActionResult, LedgerItemLot } from '#lib/ledger/types.js';
	import type { Paged } from '#lib/paging.js';
	import { blueprintIconUrl } from '#lib/site.js';
	import CorrectionForm from './CorrectionForm.svelte';

	interface Props {
		data: Paged<LedgerItemLot>;
		typeId: number;
		/** Last `correct`/`undo` result of the page. */
		form?: LedgerActionResult | null;
	}

	let { data, typeId, form = null }: Props = $props();

	const now = Date.now();
	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
</script>

<PagedTable
	{data}
	param="batches"
	endpoint="/profits/data/item-batches/{typeId}"
	label="Batches"
	noun="batches"
>
	{#snippet empty()}
		<p class="py-2 text-sm text-gray-500 dark:text-gray-400" data-empty="batches">
			No batches: nothing of this item was bought or made by your tracked characters and corporations.
		</p>
	{/snippet}
	{#snippet head()}
		<tr>
			<th class="px-3 py-2">Acquired</th>
			<th class="px-3 py-2">Where from</th>
			<th class="px-3 py-2">Price source</th>
			<th class="px-3 py-2 text-right">Quantity</th>
			<th class="px-3 py-2 text-right">Remaining</th>
			<th class="px-3 py-2 text-right">Unit cost</th>
			<th class="px-3 py-2">Where it went</th>
			<th class="px-3 py-2"><span class="sr-only">Correction</span></th>
		</tr>
	{/snippet}
	{#snippet row(lot: LedgerItemLot)}
		{@const used = lot.quantity - lot.remaining}
		<tr class="border-t border-gray-200 dark:border-gray-600" data-lot={lot.lotId}>
			<td class="{cell} whitespace-nowrap">
				<span class="cursor-help text-gray-800 dark:text-gray-200" title={formatUtc(lot.acquiredAt)}
					>{formatRelative(lot.acquiredAt, now)}</span
				>
			</td>
			<td
				class="{cell} whitespace-nowrap text-gray-900 dark:text-gray-100"
				data-origin={lot.origin}
				data-fuel-block-job={lot.fuelBlockJob ? '' : undefined}
			>
				{lot.fuelBlockJob ? 'Built in a fuel block job' : ORIGIN_TEXT[lot.origin]}
				{#if lot.jobId !== null}
					<span class="block {muted}"
						>{lot.origin === 'job' ? '' : 'for '}<a
							href="/profits/jobs/{lot.jobId}"
							class={link}
							data-job-link={lot.jobId}>{lot.jobFormula ?? 'Unknown formula'}</a
						></span
					>
				{/if}
			</td>
			<td class="{cell} max-w-xs text-xs text-gray-600 dark:text-gray-400">{lot.priceSource}</td>
			<td class={num}>{formatNumber(lot.quantity)}</td>
			<td class={num}>
				<span data-remaining>{formatNumber(lot.remaining)}</span>
				<span
					class="mt-1 ml-auto block h-1 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
					title="{formatNumber(lot.remaining)} of {formatNumber(lot.quantity)} left"
					aria-hidden="true"
				>
					<span
						class="block h-full rounded-full bg-primary-600"
						style="width: {lot.quantity > 0 ? (lot.remaining / lot.quantity) * 100 : 0}%"
					></span>
				</span>
			</td>
			<td class={num}>
				<Isk
					value={lot.unitCost}
					estimated={lot.origin === 'market'
						? 'No purchase found: valued at the buy price when the job started. Correct it if you know what you paid, or add the purchase.'
						: null}
				/>
			</td>
			<td class={cell}>
				{#if lot.uses.length}
					<details data-uses={lot.lotId}>
						<summary class="cursor-pointer text-xs whitespace-nowrap {link}"
							>{formatNumber(used)} used or sold</summary
						>
						<ul class="mt-1 space-y-1 text-xs text-gray-700 dark:text-gray-300">
							{#each lot.uses as use (use.ref)}
								<li class="whitespace-nowrap" data-use={use.ref}>
									{#if use.kind === 'job' && use.jobId !== null}
										<a href="/profits/jobs/{use.jobId}" class="inline-flex items-center gap-1 {link}">
											{#if use.formula}
												<img
													src={blueprintIconUrl(use.formula.blueprintTypeId)}
													alt=""
													width="16"
													height="16"
													loading="lazy"
													class="h-4 w-4 rounded"
												/>
											{/if}
											{use.formula?.name ?? 'Unknown formula'}</a
										>
										{#if use.at !== null}<span class={muted} title={formatUtc(use.at)}
												>started {formatRelative(use.at, now)}</span
											>{/if}
										<span class={muted}>{formatNumber(use.quantity)} units</span>
									{:else if use.kind === 'manufacturing' && use.jobId !== null}
										<span data-manufacturing={use.jobId}
											>{use.product
												? `Used to manufacture ${use.product.name}`
												: 'Used in manufacturing'}</span
										>
										{#if use.at !== null}<span class={muted} title={formatUtc(use.at)}
												>{formatRelative(use.at, now)}</span
											>{/if}
										<span class={muted}>{formatNumber(use.quantity)} units</span>
										{#if use.unitValue !== null}
											<span class={muted}>counted at <Isk value={use.unitValue} /> each</span>
										{/if}
									{:else if use.kind === 'consumed' && use.jobId !== null}
										<span data-consumed={use.jobId}
											>{use.product
												? `Used in manufacturing: ${use.product.name}`
												: 'Used in a manufacturing job'}</span
										>
										{#if use.at !== null}<span class={muted} title={formatUtc(use.at)}
												>{formatRelative(use.at, now)}</span
											>{/if}
										<span class={muted}>{formatNumber(use.quantity)} units</span>
									{:else}
										<span>Sold</span>
										{#if use.at !== null}<span class={muted} title={formatUtc(use.at)}
												>{formatRelative(use.at, now)}</span
											>{/if}:
										<span>{formatNumber(use.quantity)} units</span>
										{#if use.saleUnitPrice !== null}
											<span class={muted}>at <Isk value={use.saleUnitPrice} /> each</span>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					</details>
				{:else}
					<span class={muted}>{lot.remaining > 0 ? 'Still held' : 'Not recorded'}</span>
				{/if}
			</td>
			<td class={cell}>
				{#if lot.correctionRef}
					<CorrectionForm kind="job_input" ref={lot.correctionRef} undo={lot.corrected} {form} />
				{/if}
			</td>
		</tr>
	{/snippet}
</PagedTable>
