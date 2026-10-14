<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { formatIskFull } from '$lib/format';
	import { actionHref } from '$lib/ledger/forms';
	import type { LedgerActionResult, LedgerCorrectionView } from '$lib/ledger/types';

	interface Props {
		/** `correct` / `undo` form fields: what the price is (`transaction`, `contract_item`, `job_input`). */
		kind: 'transaction' | 'contract_item' | 'job_input';
		ref: string;
		/** Offer "Correct" (a form with unit price and note). */
		correctable?: boolean;
		/** The user's stored correction: prefills the form and offers "Undo correction". */
		correction?: LedgerCorrectionView | null;
		/** Offer "Undo correction" without a stored value (job input batches priced by a correction). */
		undo?: boolean;
		/** Last action result of the page: a rejected correction of this price stays open with its error. */
		form?: LedgerActionResult | null;
	}

	let { kind, ref, correctable = true, correction = null, undo = false, form = null }: Props = $props();

	const failed = $derived(form?.ref === ref && Boolean(form.error) ? form : null);
	/** A rejected correction shows what was typed; otherwise the stored correction prefills the form. */
	const typed = $derived(failed?.action === 'correct' ? (failed.values ?? null) : null);

	let saving = $state(false);
	const submit = () => {
		saving = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			saving = false;
		};
	};

	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const field =
		'w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
</script>

<div class="flex flex-col items-start gap-1" data-correction-for={ref}>
	{#if correctable}
		<details open={failed?.action === 'correct'} data-correct={ref}>
			<summary class="cursor-pointer text-xs whitespace-nowrap {link}">Correct</summary>
			<form
				method="POST"
				action={actionHref(page.url, 'correct')}
				class="mt-1 flex w-48 flex-col gap-1"
				use:enhance={submit}
			>
				<input type="hidden" name="kind" value={kind} />
				<input type="hidden" name="ref" value={ref} />
				<label class="flex flex-col gap-0.5 {muted}">
					Unit price (ISK)
					<input
						name="unitPrice"
						inputmode="decimal"
						required
						autocomplete="off"
						class={field}
						value={typed?.unitPrice ?? correction?.unitPrice ?? ''}
					/>
				</label>
				<label class="flex flex-col gap-0.5 {muted}">
					Note (optional)
					<input
						name="note"
						maxlength="200"
						autocomplete="off"
						class={field}
						value={typed?.note ?? correction?.note ?? ''}
					/>
				</label>
				{#if failed?.action === 'correct'}
					<p class="text-xs text-red-700 dark:text-red-400" role="alert" data-form-error>{failed.error}</p>
				{/if}
				<button type="submit" class="self-start {button}" disabled={saving}>Save</button>
			</form>
		</details>
	{/if}
	{#if correction || undo}
		{#if correction}
			<span class={muted} data-correction
				>Your price: {formatIskFull(correction.unitPrice)}{#if correction.note}, "{correction.note}"{/if}</span
			>
		{/if}
		<form method="POST" action={actionHref(page.url, 'undo')} use:enhance={submit} data-undo={ref}>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="ref" value={ref} />
			<button type="submit" class={button} disabled={saving}>Undo correction</button>
		</form>
	{/if}
	{#if failed?.action === 'undo'}
		<p class="text-xs text-red-700 dark:text-red-400" role="alert" data-form-error>{failed.error}</p>
	{/if}
</div>
