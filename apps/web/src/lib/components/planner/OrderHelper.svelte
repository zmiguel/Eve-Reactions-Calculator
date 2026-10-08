<script lang="ts">
	import { formatNumber } from '$lib/format';
	import { parseQuantity } from '$lib/planner/parsePaste';

	interface Props {
		/** Accessible-name suffix, e.g. `target 1`. */
		label: string;
		/** Receives the quantity per cycle. */
		onapply: (quantity: number) => void;
	}

	let { label, onapply }: Props = $props();

	let total = $state('');
	let cycles = $state(1);
	const perCycle = $derived.by(() => {
		const units = parseQuantity(total);
		const n = Math.floor(cycles);
		return units && n >= 1 ? Math.ceil(units / n) : null;
	});

	const field =
		'h-7 rounded-md border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-900 tabular-nums focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';
</script>

<details class="text-xs text-gray-600 dark:text-gray-300" data-order-helper>
	<summary class="cursor-pointer hover:underline">From an order total</summary>
	<div class="mt-1 flex flex-wrap items-center gap-1.5">
		<input
			type="text"
			inputmode="numeric"
			class="{field} w-28"
			placeholder="Total units"
			aria-label="Total needed for {label}"
			bind:value={total}
		/>
		<span>over</span>
		<input
			type="number"
			min="1"
			step="1"
			class="{field} w-12"
			aria-label="Cycles for {label}"
			bind:value={cycles}
		/>
		<span>cycles =</span>
		<span class="font-medium text-gray-900 tabular-nums dark:text-gray-100" data-field="perCycle"
			>{perCycle === null ? '–' : formatNumber(perCycle)}</span
		>
		<span>/cycle</span>
		<button
			type="button"
			class="rounded-md border border-gray-200 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
			disabled={perCycle === null}
			onclick={() => perCycle !== null && onapply(perCycle)}>Use</button
		>
	</div>
</details>
