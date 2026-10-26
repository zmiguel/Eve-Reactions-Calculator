<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import ItemCombobox from '#lib/components/ledger/ItemCombobox.svelte';
	import ManualEntriesTable from '#lib/components/ledger/ManualEntriesTable.svelte';
	import ManualImport from '#lib/components/ledger/ManualImport.svelte';
	import type { ManualActionResult } from '#lib/ledger/types.js';
	import Seo from '#lib/seo/Seo.svelte';

	let { data, form } = $props();

	const result = $derived(form as ManualActionResult | null);
	/** Errors show next to their form; notices (added, imported, deleted) at the top. */
	const notice = $derived(result?.notice ?? null);
	const values = $derived(result?.action === 'add' && result.error ? (result.values ?? null) : null);

	let adding = $state(false);
	/** The notice at the top: focused after a purchase is added (the form is rebuilt). */
	let noticeEl = $state<HTMLElement | null>(null);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const label = 'flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400';
	const field =
		'w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
	const button =
		'inline-flex cursor-pointer items-center rounded-md bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-wait disabled:opacity-50 dark:bg-primary-600 dark:hover:bg-primary-700';
</script>

<Seo
	title="Add purchases"
	description="Enter purchases your tracked characters and corporations did not record, for your EVE Online Reactions Calculator ledger."
	path="/profits/ledger/add"
	noindex
/>

<div class="space-y-4 pb-4">
	<header>
		<a href="/profits/ledger" class="text-sm {link}" data-back>Back to the ledger</a>
		<h1 class="mt-2 text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Add purchases</h1>
		<p class="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
			Enter what you bought outside your tracked characters and corporations, or before tracking started. Each
			purchase becomes a batch like a market purchase: jobs started after its date use it, oldest batches
			first, instead of a market estimate. Dates are UTC (EVE time).
		</p>
	</header>

	{#if notice}
		<div
			bind:this={noticeEl}
			tabindex="-1"
			role="status"
			data-notice="ok"
			class="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
		>
			{notice}
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<section class="{card} space-y-3" aria-labelledby="add-one">
			<h2 id="add-one" class={heading}>One purchase</h2>
			{#key result}
				<form
					method="POST"
					action="?/add"
					class="space-y-3"
					data-add-form
					use:enhance={({ formElement }) => {
						adding = true;
						const section = formElement.closest('section');
						return async ({ update, result: outcome }) => {
							await update({ navigate: false });
							adding = false;
							// The form is rebuilt: keep the focus on the outcome, not the page.
							await tick();
							if (outcome.type === 'success') noticeEl?.focus();
							else section?.querySelector<HTMLElement>('[data-add-error]')?.focus();
						};
					}}
				>
					<ItemCombobox choices={data.choices} text={values?.item ?? ''} typeId={values?.typeId ?? ''} />
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<label class={label}>
							Date (UTC)
							<input
								name="date"
								type="date"
								required
								min="2003-01-01"
								max={data.today}
								class={field}
								value={values?.date ?? data.today}
							/>
						</label>
						<label class={label}>
							Quantity
							<input
								name="quantity"
								inputmode="numeric"
								required
								autocomplete="off"
								class={field}
								value={values?.quantity ?? ''}
							/>
						</label>
						<label class={label}>
							Unit price (ISK)
							<input
								name="unitPrice"
								inputmode="decimal"
								required
								autocomplete="off"
								class={field}
								value={values?.unitPrice ?? ''}
							/>
						</label>
					</div>
					<label class={label}>
						Note (optional)
						<input name="note" maxlength="200" autocomplete="off" class={field} value={values?.note ?? ''} />
					</label>
					{#if result?.action === 'add' && result.error}
						<p class="text-xs text-red-700 dark:text-red-400" role="alert" tabindex="-1" data-add-error>
							{result.error}
						</p>
					{/if}
					<button type="submit" class={button} disabled={adding}>+ Add</button>
				</form>
			{/key}
		</section>

		<section class="{card} space-y-3" aria-labelledby="add-many">
			<h2 id="add-many" class={heading}>Import a list</h2>
			<ManualImport form={result} />
		</section>
	</div>

	<section class="{card} space-y-2" aria-labelledby="entered">
		<h2 id="entered" class={heading}>Your purchases</h2>
		<p class="text-xs {muted}">
			"Left" is what jobs and sales have not used yet, as of the last recalculation. Deleting a purchase
			recalculates your results without it.
		</p>
		<ManualEntriesTable data={data.entries} form={result} />
	</section>
</div>
