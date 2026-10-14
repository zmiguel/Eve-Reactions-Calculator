<script lang="ts">
	import type { Snippet } from 'svelte';
	import Estimated from '$lib/components/profits/Estimated.svelte';
	import Isk from '$lib/components/profits/Isk.svelte';
	import PagedTable from '$lib/components/profits/PagedTable.svelte';
	import Pill from '$lib/components/profits/Pill.svelte';
	import { formatIsk, formatIskFull, formatNumber, formatRelative, formatUtc } from '$lib/format';
	import { DIRECTION_BADGE } from '$lib/ledger/source';
	import type {
		LedgerActionResult,
		LedgerContractRow,
		LedgerFeeSource,
		LedgerItemType,
		LedgerManualRow,
		LedgerOwnerView,
		LedgerRow,
		LedgerTradeRow
	} from '$lib/ledger/types';
	import type { Paged } from '$lib/paging';
	import { blueprintIconUrl, typeIconUrl } from '$lib/site';
	import CorrectionForm from './CorrectionForm.svelte';
	import PriceSource from './PriceSource.svelte';

	interface Props {
		data: Paged<LedgerRow>;
		/** Last `correct`/`undo` result: keeps the form of a rejected price open with its error. */
		form?: LedgerActionResult | null;
		/** Shown instead of the table when no row matches. */
		empty?: Snippet;
	}

	let { data, form = null, empty }: Props = $props();

	const now = Date.now();
	const COLUMNS = 8;

	const FEE_SOURCE: Record<Exclude<LedgerFeeSource, 'none'>, string> = {
		journal: 'from the wallet journal',
		estimated: 'estimated from your settings'
	};

	/** Broker fee and sales tax of a trade, in words (no sales tax line on purchases). */
	function feeLines(row: LedgerTradeRow): string[] {
		if (row.direction === 'transfer') return [];
		const line = (name: string, amount: number | null, source: LedgerFeeSource | null) =>
			source === null
				? []
				: source === 'none'
					? [`${name}: none`]
					: [`${name}: ${formatIskFull(amount)}, ${FEE_SOURCE[source]}`];
		return [
			...line('Broker fee', row.brokerFee, row.brokerFeeSource),
			...(row.direction === 'sold' ? line('Sales tax', row.tax, row.taxSource) : [])
		];
	}

	/** The badge of a contract: the first price needing review, else its first price. */
	function contractSource(row: LedgerContractRow) {
		const prices = row.items.flatMap((i) => (i.price ? [i.price] : []));
		return prices.find((p) => p.needsReview) ?? prices[0] ?? null;
	}

	const cell = 'px-3 py-2 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const rowClass = 'border-t border-gray-200 dark:border-gray-700';
</script>

{#snippet item(t: LedgerItemType)}
	<a
		href="/profits/ledger/{t.typeId}"
		class="inline-flex items-center gap-2 whitespace-nowrap {link}"
		data-item={t.typeId}
	>
		<img
			src={t.formula ? blueprintIconUrl(t.typeId) : typeIconUrl(t.typeId)}
			alt=""
			width="24"
			height="24"
			loading="lazy"
			class="h-6 w-6 shrink-0 rounded"
		/>
		{t.name}
	</a>
{/snippet}

{#snippet date(at: number, owner: LedgerOwnerView)}
	<td class="{cell} whitespace-nowrap">
		<span class="cursor-help text-gray-800 dark:text-gray-200" title={formatUtc(at)} data-date={at}
			>{formatRelative(at, now)}</span
		>
		<span class="block {muted}">{owner.division ? `${owner.name} · ${owner.division}` : owner.name}</span>
	</td>
{/snippet}

{#snippet direction(key: string)}
	{@const badge = DIRECTION_BADGE[key]}
	<td class={cell} data-direction={key}><Pill tone={badge.tone}>{badge.label}</Pill></td>
{/snippet}

{#snippet trade(row: LedgerTradeRow)}
	{@const estimated =
		row.direction !== 'transfer' && (row.taxSource === 'estimated' || row.brokerFeeSource === 'estimated')}
	<tr class={rowClass} data-trade={row.transactionId}>
		{@render date(row.at, row.owner)}
		<td class={cell}>{@render item(row)}</td>
		{@render direction(row.direction)}
		<td class={num}>{formatNumber(row.quantity)}</td>
		<td class={num}>
			<span
				class="cursor-help"
				title={[`Before tax and fees: ${formatIskFull(row.grossUnitPrice)}`, ...feeLines(row)].join('\n')}
				data-unit-price>{formatIsk(row.price.unitPrice)}</span
			>{#if estimated}<Estimated
					reason="Broker fee or sales tax estimated from your settings: no matching wallet journal row."
				/>{/if}
		</td>
		<td class={num}><Isk value={row.price.total} /></td>
		<td class={cell}>
			<PriceSource
				kind={row.price.sourceKind}
				needsReview={row.price.needsReview}
				estimatedFees={estimated}
				text={row.price.sourceText}
				lines={feeLines(row)}
			/>
		</td>
		<td class={cell}>
			{#if row.direction !== 'transfer' || row.price.correction}
				<CorrectionForm
					kind="transaction"
					ref={row.price.ref}
					correctable={row.direction !== 'transfer'}
					correction={row.price.correction}
					{form}
				/>
			{/if}
		</td>
	</tr>
{/snippet}

{#snippet contract(row: LedgerContractRow)}
	{@const source = contractSource(row)}
	<tr class={rowClass} data-contract={row.contractId}>
		{@render date(row.at, row.owner)}
		<td class={cell}>
			<span class="font-medium whitespace-nowrap text-gray-900 dark:text-gray-100" data-contract-label
				>Contract · {formatNumber(row.itemCount)} {row.itemCount === 1 ? 'item' : 'items'}</span
			>
			{#if row.title}<span class="block max-w-xs truncate {muted}" title={row.title} data-title
					>{row.title}</span
				>{/if}
			{#if row.janiceCode}
				<a
					href="https://janice.e-351.com/a/{row.janiceCode}"
					class="block text-xs {link}"
					rel="noopener noreferrer"
					target="_blank"
					data-janice>Janice appraisal {row.janiceCode}</a
				>
			{/if}
		</td>
		{@render direction(row.direction)}
		<td class={num}><span class={muted}>–</span></td>
		<td class={num}><span class={muted}>–</span></td>
		<td class={num}><Isk value={row.total} /></td>
		<td class={cell}>
			{#if source}
				<PriceSource
					kind={source.sourceKind}
					needsReview={row.needsReview}
					text={row.needsReview
						? 'At least one item of this contract needs review: open the items below.'
						: source.sourceText}
				/>
			{:else}
				<span class={muted}>Between your own characters and corporations: no purchase or sale</span>
			{/if}
		</td>
		<td class={cell}></td>
	</tr>
	<tr data-contract-items={row.contractId}>
		<td colspan={COLUMNS} class="px-3 pb-2">
			<details
				open={row.items.some((i) => i.price && form?.ref === i.price.ref && Boolean(form.error))}
				class="rounded-md bg-gray-50 dark:bg-gray-900/40"
				data-items
			>
				<summary class="cursor-pointer px-2 py-1 text-xs {link}"
					>Items of this contract ({formatNumber(row.itemCount)})</summary
				>
				<div class="relative overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-xs text-gray-600 dark:text-gray-400">
							<tr>
								<th class="px-3 py-1">Item</th>
								<th class="px-3 py-1">Direction</th>
								<th class="px-3 py-1 text-right">Quantity</th>
								<th class="px-3 py-1 text-right">Unit price</th>
								<th class="px-3 py-1 text-right">Total</th>
								<th class="px-3 py-1">Price source</th>
								<th class="px-3 py-1"><span class="sr-only">Correction</span></th>
							</tr>
						</thead>
						<tbody>
							{#each row.items as line (`${line.typeId}:${line.incoming}`)}
								<tr class={rowClass} data-contract-item={line.typeId}>
									<td class={cell}>{@render item(line)}</td>
									{@render direction(line.incoming === null ? 'transfer' : line.incoming ? 'in' : 'out')}
									<td class={num}>{formatNumber(line.quantity)}</td>
									{#if line.price}
										<td class={num}><Isk value={line.price.unitPrice} /></td>
										<td class={num}><Isk value={line.price.total} /></td>
										<td class={cell}>
											<PriceSource
												kind={line.price.sourceKind}
												needsReview={line.price.needsReview}
												text={line.price.sourceText}
											/>
										</td>
										<td class={cell}>
											<CorrectionForm
												kind="contract_item"
												ref={line.price.ref}
												correction={line.price.correction}
												{form}
											/>
										</td>
									{:else}
										<td class={num}><span class={muted}>–</span></td>
										<td class={num}><span class={muted}>–</span></td>
										<td class={cell}><span class={muted}>No price: a transfer</span></td>
										<td class={cell}></td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</td>
	</tr>
{/snippet}

{#snippet manual(row: LedgerManualRow)}
	<tr class={rowClass} data-manual={row.entryId}>
		{@render date(row.at, { name: 'Entered by you', division: null })}
		<td class={cell}>{@render item(row)}</td>
		{@render direction('bought')}
		<td class={num}>{formatNumber(row.quantity)}</td>
		<td class={num}><Isk value={row.unitPrice} /></td>
		<td class={num}><Isk value={row.total} /></td>
		<td class={cell}>
			<PriceSource
				kind="manual"
				text={row.note
					? `The price you entered. Your note: "${row.note}"`
					: 'The price you entered on Add purchases.'}
			/>
		</td>
		<td class={cell}>
			<a href="/profits/ledger/add" class="text-xs whitespace-nowrap {link}" data-manual-manage
				>Manage on Add purchases</a
			>
		</td>
	</tr>
{/snippet}

<PagedTable {data} param="page" endpoint="/profits/data/ledger" label="Ledger" noun="rows" {empty}>
	{#snippet head()}
		<tr>
			<th class="px-3 py-2">Date</th>
			<th class="px-3 py-2">Item</th>
			<th class="px-3 py-2">Direction</th>
			<th class="px-3 py-2 text-right">Quantity</th>
			<th class="px-3 py-2 text-right">Unit price</th>
			<th class="px-3 py-2 text-right">Total</th>
			<th class="px-3 py-2">Price source</th>
			<th class="px-3 py-2"><span class="sr-only">Correction</span></th>
		</tr>
	{/snippet}
	{#snippet row(entry: LedgerRow)}
		{#if entry.kind === 'market'}
			{@render trade(entry)}
		{:else if entry.kind === 'contract'}
			{@render contract(entry)}
		{:else}
			{@render manual(entry)}
		{/if}
	{/snippet}
</PagedTable>
