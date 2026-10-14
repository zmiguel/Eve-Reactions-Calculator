<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { actionHref } from '$lib/ledger/forms';
	import type { ReconcileActionResult } from '$lib/ledger/types';

	interface Props {
		/** `correct` form fields: a job input or a contract item price. */
		kind: 'job_input' | 'contract_item';
		ref: string;
		/** Last action result of the page: a rejected price of this `ref` shows its error. */
		form?: ReconcileActionResult | null;
	}

	let { kind, ref, form = null }: Props = $props();

	const failed = $derived(form?.action === 'correct' && form.ref === ref && form.error ? form.error : null);
	let saving = $state(false);

	const field =
		'w-28 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<form
	method="POST"
	action={actionHref(page.url, 'correct')}
	class="flex flex-wrap items-center gap-1"
	data-price-form={ref}
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<input type="hidden" name="kind" value={kind} />
	<input type="hidden" name="ref" value={ref} />
	<label class="sr-only" for="price-{ref}">Unit price (ISK)</label>
	<input
		id="price-{ref}"
		name="unitPrice"
		inputmode="decimal"
		required
		autocomplete="off"
		placeholder="Unit price"
		class={field}
	/>
	<button type="submit" class={button} disabled={saving}>Save</button>
	{#if failed}
		<p class="w-full text-xs text-red-700 dark:text-red-400" role="alert" data-form-error>{failed}</p>
	{/if}
</form>
