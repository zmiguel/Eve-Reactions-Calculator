<script lang="ts">
	import { enhance } from '$app/forms';
	import Isk from '$lib/components/profits/Isk.svelte';
	import { formatNumber, formatUtc } from '$lib/format';
	import type { ManualActionResult } from '$lib/ledger/types';

	interface Props {
		/** Last action result of the page: `check` carries the preview, a failed `import` its errors. */
		form?: ManualActionResult | null;
	}

	let { form = null }: Props = $props();

	const mine = $derived(form?.action === 'check' || form?.action === 'import' ? form : null);
	const preview = $derived(mine?.preview ?? null);
	const count = $derived(preview?.rows.length ?? 0);

	let busy = $state(false);
	const submit = (reset: boolean) => () => {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset });
			busy = false;
		};
	};

	const EXAMPLE = ['2026-10-01 Neodymium 10,000 1,250.50', '2026-10-02 14:30 Hydrogen Fuel Block 500 17500'];

	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const cell = 'px-3 py-1.5 align-top';
	const num = `${cell} text-right tabular-nums whitespace-nowrap`;
	const button =
		'inline-flex cursor-pointer items-center rounded-md bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-600 dark:hover:bg-primary-700';
	const secondary =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<div class="space-y-3" data-import>
	<form method="POST" action="?/check" class="space-y-2" use:enhance={submit(false)}>
		<label class="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
			Purchases, one per line
			<!-- No value until an action answers: hydration then keeps what was typed before JS loaded. -->
			<textarea
				name="text"
				rows="6"
				spellcheck="false"
				class="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
				value={mine?.text}
			></textarea>
		</label>
		<div class="space-y-1 {muted}">
			<p>
				Each line: date, item, quantity, unit price. Dates are UTC (EVE time) as YYYY-MM-DD, optionally
				followed by HH:MM. The item is the exact name, as in game. Numbers may use commas between thousands
				and a dot for decimals. Fields can be separated by spaces or tabs, so rows copied from a spreadsheet
				work too. At most 500 lines at a time.
			</p>
			<p>Example:</p>
			<pre class="rounded bg-gray-100 px-2 py-1 font-mono dark:bg-gray-800" data-example>{EXAMPLE.join(
					'\n'
				)}</pre>
		</div>
		{#if mine?.error}
			<p class="text-xs text-red-700 dark:text-red-400" role="alert" data-import-error>{mine.error}</p>
		{/if}
		<button type="submit" class={secondary} disabled={busy}>Check</button>
	</form>

	{#if preview}
		<section class="space-y-2" data-preview>
			<p class="text-sm text-gray-800 dark:text-gray-200" data-preview-summary>
				{formatNumber(count)}
				{count === 1 ? 'purchase' : 'purchases'} can be added{#if preview.errors.length},
					{formatNumber(preview.errors.length)}
					{preview.errors.length === 1 ? 'line has' : 'lines have'} a problem and will be left out{/if}.
			</p>
			{#if preview.errors.length}
				<ul class="space-y-0.5 text-xs text-red-700 dark:text-red-400" data-preview-errors>
					{#each preview.errors as e (e.line)}
						<li data-error-line={e.line}>Line {e.line}: {e.message}</li>
					{/each}
				</ul>
			{/if}
			{#if count}
				<div class="max-h-72 overflow-auto">
					<table class="w-full text-left text-sm" aria-label="Purchases to add">
						<thead class="text-xs text-gray-600 dark:text-gray-400">
							<tr>
								<th class="px-3 py-1">Line</th>
								<th class="px-3 py-1">Date</th>
								<th class="px-3 py-1">Item</th>
								<th class="px-3 py-1 text-right">Quantity</th>
								<th class="px-3 py-1 text-right">Unit price</th>
								<th class="px-3 py-1 text-right">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each preview.rows as row (row.line)}
								<tr class="border-t border-gray-200 dark:border-gray-700" data-preview-row={row.line}>
									<td class="{cell} {muted}">{row.line}</td>
									<td class="{cell} whitespace-nowrap">{formatUtc(row.at)}</td>
									<td class={cell}>{row.name}</td>
									<td class={num}>{formatNumber(row.quantity)}</td>
									<td class={num}><Isk value={row.unitPrice} /></td>
									<td class={num}><Isk value={row.unitPrice * row.quantity} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<form method="POST" action="?/import" use:enhance={submit(true)}>
				<input type="hidden" name="text" value={mine?.text ?? ''} />
				<button type="submit" class={button} disabled={busy || count === 0} data-import-submit
					>Add {formatNumber(count)} {count === 1 ? 'purchase' : 'purchases'}</button
				>
			</form>
		</section>
	{/if}
</div>
