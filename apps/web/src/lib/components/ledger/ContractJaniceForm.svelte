<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { actionHref } from '$lib/ledger/forms';
	import type { LedgerActionResult, LedgerContractRow } from '$lib/ledger/types';

	interface Props {
		contract: LedgerContractRow;
		/** Last action result of the page: a rejected link stays in the form with its error. */
		form?: LedgerActionResult | null;
	}

	let { contract, form = null }: Props = $props();

	const ref = $derived(`contract:${contract.contractId}`);
	const failed = $derived(form?.ref === ref && Boolean(form.error) ? form : null);

	let saving = $state(false);
	const submit = () => {
		saving = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			saving = false;
		};
	};

	const muted = 'text-xs text-gray-500 dark:text-gray-400';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const field =
		'w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
</script>

<!-- The cell spans the whole table, wider than a phone: the box keeps to a width that fits on screen. -->
<div
	class="border-t border-gray-200 px-2 py-2 dark:border-gray-600"
	data-contract-janice={contract.contractId}
>
	<div class="flex w-72 flex-col items-start gap-2 sm:w-xl">
		<form
			method="POST"
			action={actionHref(page.url, 'contractJanice')}
			class="flex w-full flex-wrap items-end gap-2"
			use:enhance={submit}
			data-janice-apply
		>
			<input type="hidden" name="ref" value={ref} />
			<label class="flex min-w-0 flex-1 flex-col gap-0.5 {muted}">
				Price with a Janice appraisal
				<input
					name="link"
					inputmode="url"
					required
					autocomplete="off"
					placeholder="https://janice.e-351.com/a/…"
					class={field}
					value={failed?.action === 'contractJanice' ? (failed.link ?? '') : ''}
				/>
			</label>
			<button type="submit" class={button} disabled={saving}>Apply</button>
		</form>
		{#if contract.janiceOwn}
			<form
				method="POST"
				action={actionHref(page.url, 'removeContractJanice')}
				class="flex flex-wrap items-center gap-2"
				use:enhance={submit}
				data-janice-remove
			>
				<input type="hidden" name="ref" value={ref} />
				<span class={muted}>
					You chose appraisal {contract.janiceCode}. Removing it prices this contract by {contract.titleJanice
						? 'the Janice link in its title'
						: 'your contract price rule'} again.
				</span>
				<button type="submit" class={button} disabled={saving}>Remove your appraisal</button>
			</form>
		{/if}
		{#if failed}
			<p class="text-xs text-red-700 dark:text-red-400" role="alert" data-form-error>{failed.error}</p>
		{/if}
	</div>
</div>
