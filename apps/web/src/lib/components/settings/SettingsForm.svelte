<script lang="ts">
	import type { ReactionConstants, Reactor, Settings } from '@reactions/engine';
	import { MAX_PARALLEL_LINES } from '@reactions/engine';
	import { Button, Radio } from 'flowbite-svelte';
	import { onMount, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		DEFAULT_OUTPUT_OPTIONS,
		DEFAULT_VIEW_OPTIONS,
		MODE_OPTIONS,
		SLOT_ALLOCATION_OPTIONS,
		UNREFINED_IN_CHAINS_OPTIONS,
		profilePath,
		type ProfileKey,
		type SystemSummary
	} from '$lib/settings/fields';
	import { REACTOR_LABEL } from '$lib/site';
	import NumberField from './NumberField.svelte';
	import ProfileFields from './ProfileFields.svelte';

	interface Props {
		/** Initial values: the saved settings, or the rejected submission after a failed save. */
		settings: Settings;
		hubs: { hubId: string; name: string; private: boolean }[];
		/** Systems referenced by `settings`, keyed by id. */
		systems: Record<number, SystemSummary>;
		/** Field errors keyed by field name (dotted settings path). */
		errors?: Record<string, string>;
		/** Profile path → system text that did not resolve on the last submission. */
		systemText?: Record<string, string>;
		constants: ReactionConstants;
	}

	let { settings, hubs, systems, errors = {}, systemText = {}, constants }: Props = $props();

	const TABS: Reactor[] = ['composite', 'biochemical', 'hybrid'];
	// Tailwind needs literal class names: each panel shows while its tab radio is checked (works without JS).
	const PANEL_CLASS: Record<Reactor, string> = {
		composite: 'hidden group-has-[input[value=composite]:checked]/tabs:block',
		biochemical: 'hidden group-has-[input[value=biochemical]:checked]/tabs:block',
		hybrid: 'hidden group-has-[input[value=hybrid]:checked]/tabs:block'
	};
	const KEYS: ProfileKey[] = ['shared', ...TABS];

	// The form edits a copy of the initial values; the page re-creates this component for new data or a
	// failed submission, so later prop changes are intentionally not tracked here.
	const init = untrack(() => {
		const values = structuredClone($state.snapshot(settings)) as Settings;
		const profileOf = (key: ProfileKey) => (key === 'shared' ? values.shared : values.reactors[key]);
		const selected = {} as Record<ProfileKey, SystemSummary | null>;
		const texts = {} as Record<ProfileKey, string>;
		for (const key of KEYS) {
			const id = profileOf(key).systemId;
			const typed = systemText[profilePath(key)];
			selected[key] = typed === undefined ? (systems[id] ?? null) : null;
			texts[key] = typed ?? systems[id]?.name ?? String(id);
		}
		return { values, selected, texts };
	});
	let draft = $state(init.values);
	let selected = $state(init.selected);
	let texts = $state(init.texts);

	const tabErrors = (r: Reactor) => Object.keys(errors).filter((k) => k.startsWith(`reactors.${r}.`)).length;
	const firstTab = untrack(() => TABS.find((r) => tabErrors(r) > 0) ?? 'composite');

	let enhanced = $state(false);
	onMount(() => (enhanced = true));

	function setMode(mode: Settings['mode']) {
		if (mode === 'per_reactor' && draft.mode === 'shared') {
			// Switching to per-reactor starts every reactor from the shared profile.
			for (const r of TABS) {
				draft.reactors[r] = structuredClone($state.snapshot(draft.shared));
				selected[r] = selected.shared;
				texts[r] = texts.shared;
			}
		}
		draft.mode = mode;
	}

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
</script>

<form method="POST" action="?/save" use:enhance class="space-y-4" data-settings-form>
	<!-- Which profiles this form shows; the server copies shared → reactors when the mode was just switched. -->
	<input type="hidden" name="editing" value={draft.mode} />

	<section class={card} aria-label="General">
		<h2 class={heading}>General</h2>
		<div class="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
			<div class="space-y-3">
				<fieldset>
					<legend class="mb-1 block text-sm font-medium text-gray-900 dark:text-white"
						>Reactor profiles</legend
					>
					<div class="space-y-2">
						{#each MODE_OPTIONS as option (option.value)}
							<Radio
								name="mode"
								value={option.value}
								group={draft.mode}
								onchange={() => setMode(option.value)}
								class="dark:border-gray-500 dark:bg-gray-800"
								classes={{ label: 'text-sm font-normal text-gray-800 dark:text-gray-200' }}
								>{option.name}</Radio
							>
						{/each}
					</div>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Switching to separate settings starts every reactor from the shared settings.
					</p>
				</fieldset>
				<fieldset data-default-view>
					<legend class="mb-1 block text-sm font-medium text-gray-900 dark:text-white"
						>Open reactions on</legend
					>
					<div class="flex gap-4">
						{#each DEFAULT_VIEW_OPTIONS as option (option.value)}
							<Radio
								name="defaultView"
								value={option.value}
								bind:group={draft.defaultView}
								class="dark:border-gray-500 dark:bg-gray-800"
								classes={{ label: 'text-sm font-normal text-gray-800 dark:text-gray-200' }}
								>{option.name}</Radio
							>
						{/each}
					</div>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Tab shown first on reaction lists and pages that have a full chain.
					</p>
					{#if errors.defaultView}
						<p class="mt-1 text-xs text-red-600 dark:text-red-400">{errors.defaultView}</p>
					{/if}
				</fieldset>
				<fieldset data-default-output>
					<legend class="mb-1 block text-sm font-medium text-gray-900 dark:text-white"
						>Open reprocessable reactions on</legend
					>
					<div class="flex gap-4">
						{#each DEFAULT_OUTPUT_OPTIONS as option (option.value)}
							<Radio
								name="defaultOutput"
								value={option.value}
								bind:group={draft.defaultOutput}
								class="dark:border-gray-500 dark:bg-gray-800"
								classes={{ label: 'text-sm font-normal text-gray-800 dark:text-gray-200' }}
								>{option.name}</Radio
							>
						{/each}
					</div>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Tab shown first for unrefined products and Prismaticite formulas.
					</p>
					{#if errors.defaultOutput}
						<p class="mt-1 text-xs text-red-600 dark:text-red-400">{errors.defaultOutput}</p>
					{/if}
				</fieldset>
			</div>
			<div class="space-y-3">
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<NumberField
						name="cycleDays"
						label="Cycle days"
						min={0.25}
						max={30}
						bind:value={draft.cycleDays}
						error={errors.cycleDays}
					/>
					<NumberField
						name="reprocessing.unrefinedYieldPct"
						label="Unrefined yield %"
						min={0}
						max={100}
						bind:value={draft.reprocessing.unrefinedYieldPct}
						error={errors['reprocessing.unrefinedYieldPct']}
					/>
					<NumberField
						name="reprocessing.prismaticiteYieldPct"
						label="Prismaticite yield %"
						min={0}
						max={100}
						bind:value={draft.reprocessing.prismaticiteYieldPct}
						error={errors['reprocessing.prismaticiteYieldPct']}
					/>
					<NumberField
						name="reprocessing.prismaticiteRollPct"
						label="Prismaticite roll %"
						min={0}
						max={100}
						bind:value={draft.reprocessing.prismaticiteRollPct}
						error={errors['reprocessing.prismaticiteRollPct']}
					/>
				</div>
				<fieldset data-slot-allocation>
					<legend class="mb-1 block text-sm font-medium text-gray-900 dark:text-white"
						>Chain slot allocation</legend
					>
					<div class="space-y-1.5">
						{#each SLOT_ALLOCATION_OPTIONS as option (option.value)}
							<Radio
								name="slotAllocation"
								value={option.value}
								bind:group={draft.slotAllocation}
								class="dark:border-gray-500 dark:bg-gray-800"
								classes={{ label: 'text-sm font-normal text-gray-800 dark:text-gray-200' }}
								>{option.name}
								<span class="text-xs text-gray-500 dark:text-gray-400">· {option.hint}</span></Radio
							>
						{/each}
					</div>
					{#if errors.slotAllocation}
						<p class="mt-1 text-xs text-red-600 dark:text-red-400">{errors.slotAllocation}</p>
					{/if}
				</fieldset>
				<div class="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
					<NumberField
						name="maxParallelLines"
						label="Max parallel lines"
						min={1}
						max={MAX_PARALLEL_LINES}
						step={1}
						bind:value={draft.maxParallelLines}
						error={errors.maxParallelLines}
					/>
					<p class="text-xs text-gray-500 sm:col-span-3 dark:text-gray-400">
						Optimal slots tries 1 to this many parallel lines per chain and keeps the highest profit per
						slot-day. More lines can add a few percent but need more slots.
					</p>
				</div>
				<fieldset data-unrefined-in-chains>
					<legend class="mb-1 block text-sm font-medium text-gray-900 dark:text-white"
						>Unrefined reactions in chains</legend
					>
					<div class="flex gap-4">
						{#each UNREFINED_IN_CHAINS_OPTIONS as option (option.value)}
							<Radio
								name="unrefinedInChains"
								value={option.value}
								bind:group={draft.unrefinedInChains}
								class="dark:border-gray-500 dark:bg-gray-800"
								classes={{ label: 'text-sm font-normal text-gray-800 dark:text-gray-200' }}
								>{option.name}</Radio
							>
						{/each}
					</div>
					<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
						Where no tab is picked: the home page, the planner and the API's best view. Never: full chains use
						the regular reactions. When better: an intermediate is built with its unrefined reaction and
						reprocessed where that raises the chain's profit/slot/day, and reaction lists and pages open on
						Using unrefined. Full chain always shows the regular reactions, so the two can be compared.
					</p>
					{#if errors.unrefinedInChains}
						<p class="mt-1 text-xs text-red-600 dark:text-red-400">{errors.unrefinedInChains}</p>
					{/if}
				</fieldset>
			</div>
		</div>
	</section>

	{#if draft.mode === 'shared'}
		<ProfileFields
			prefix="shared"
			bind:profile={draft.shared}
			bind:system={selected.shared}
			bind:systemText={texts.shared}
			{hubs}
			{errors}
			{constants}
			{enhanced}
		/>
	{:else}
		<div class="group/tabs space-y-4" data-reactor-tabs>
			<div
				role="radiogroup"
				aria-label="Reactor profile"
				class="flex flex-wrap border-b border-gray-200 text-sm font-medium dark:border-gray-700"
			>
				{#each TABS as r (r)}
					{@const count = tabErrors(r)}
					<label
						class="-mb-px inline-flex cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-3 py-2 leading-tight text-gray-500 hover:border-gray-300 hover:text-gray-700 has-checked:border-primary-600 has-checked:text-primary-600 has-focus-visible:ring-2 has-focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:text-gray-200 dark:has-checked:border-primary-500 dark:has-checked:text-primary-500"
					>
						<input type="radio" name="_tab" value={r} checked={r === firstTab} class="sr-only" />
						{REACTOR_LABEL[r]}
						{#if count > 0}
							<span
								class="rounded-sm bg-red-100 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-red-800 dark:bg-red-900 dark:text-red-300"
								>{count} {count === 1 ? 'error' : 'errors'}</span
							>
						{/if}
					</label>
				{/each}
			</div>
			{#each TABS as r (r)}
				<div
					class={PANEL_CLASS[r]}
					role="group"
					aria-label={`${REACTOR_LABEL[r]} reactor settings`}
					data-panel={r}
				>
					<ProfileFields
						prefix={`reactors.${r}`}
						bind:profile={draft.reactors[r]}
						bind:system={selected[r]}
						bind:systemText={texts[r]}
						{hubs}
						{errors}
						{constants}
						{enhanced}
					/>
				</div>
			{/each}
		</div>
	{/if}

	<div
		class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-gray-300 bg-gray-100 py-3 dark:border-gray-600 dark:bg-gray-800"
	>
		<Button type="submit" color="primary" size="sm" class="cursor-pointer">Save settings</Button>
		<button
			type="submit"
			formaction="?/reset"
			formnovalidate
			class="cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
		>
			Reset to defaults
		</button>
		{#if Object.keys(errors).length > 0}
			<p role="alert" class="text-sm text-red-600 dark:text-red-400">
				Some values are invalid; nothing was saved. Fix the highlighted fields.
			</p>
		{/if}
	</div>
</form>
