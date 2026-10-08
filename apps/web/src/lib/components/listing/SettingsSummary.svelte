<script lang="ts">
	import { CogOutline } from 'flowbite-svelte-icons';
	import { formatPct } from '$lib/format';
	import type { SettingsSummaryData } from './types';

	interface Props {
		settings: SettingsSummaryData;
		/** Profile warnings, e.g. `HUB_UNAVAILABLE`, `COST_INDEX_MISSING`. */
		warnings?: string[];
	}

	let { settings, warnings = [] }: Props = $props();

	const STRUCTURE: Record<SettingsSummaryData['structure'], string> = {
		athanor: 'Athanor',
		tatara: 'Tatara'
	};
	const RIG: Record<SettingsSummaryData['meRig'], string> = { none: 'No', t1: 'T1', t2: 'T2' };
	const METHOD: Record<SettingsSummaryData['inputMethod'] | SettingsSummaryData['outputMethod'], string> = {
		buy_order: 'buy orders',
		sell_order: 'sell orders',
		instant: 'instant',
		contract: 'contract'
	};

	const warningText = $derived(
		warnings.map((w) =>
			w === 'HUB_UNAVAILABLE'
				? 'A market hub in your settings is not available to you; Jita 4-4 prices are used instead.'
				: w === 'COST_INDEX_MISSING'
					? `No reaction cost index is known for ${settings.systemName}; job costs assume 0%.`
					: w
		)
	);
</script>

<div class="space-y-2">
	<a
		href="/settings"
		class="group inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-primary-500 sm:text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:border-primary-400"
		title="Change your settings"
	>
		<CogOutline class="h-4 w-4 text-gray-500 dark:text-gray-300" />
		<span>{STRUCTURE[settings.structure]}</span>
		<span aria-hidden="true" class="text-gray-400">·</span>
		<span>{RIG[settings.meRig]} ME / {RIG[settings.teRig]} TE rigs</span>
		<span aria-hidden="true" class="text-gray-400">·</span>
		<span>{settings.systemName} ({settings.securityBand})</span>
		<span aria-hidden="true" class="text-gray-400">·</span>
		<span class="tabular-nums">
			Cost index {formatPct(settings.costIndex * 100, 2)}{settings.costIndexOverridden ? ' (override)' : ''}
		</span>
		<span aria-hidden="true" class="text-gray-400">·</span>
		<span>Inputs: {settings.inputHub} {METHOD[settings.inputMethod]}</span>
		<span aria-hidden="true" class="text-gray-400">·</span>
		<span>Outputs: {settings.outputHub} {METHOD[settings.outputMethod]}</span>
		<span class="ms-1 font-medium text-primary-700 group-hover:underline dark:text-primary-400">Edit</span>
	</a>
	{#each warningText as text (text)}
		<p
			role="alert"
			class="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
		>
			{text}
		</p>
	{/each}
</div>
