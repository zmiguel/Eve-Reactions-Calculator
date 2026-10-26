<script lang="ts">
	import { onMount } from 'svelte';
	import Pill from '#lib/components/profits/Pill.svelte';
	import {
		BAND_NAMES,
		NO_RIG,
		NO_STRUCTURE,
		RIG_NOT_SET,
		activitiesOf,
		rigChoicesFor,
		type FacilityRigChoice,
		type FacilityView
	} from '#lib/account/facilities.js';
	import { formatNumber, formatPct, formatUtc } from '#lib/format.js';

	/**
	 * One facility of the Facilities form on `/account/tracking`: what EVE told (plain text) and selects
	 * for what it could not tell. Posts `structure-<id>`, one `rig-<id>` per rig slot and `rigsFor-<id>`
	 * (the structure the rig selects are for). Without JS, the rig selects stay those of the saved
	 * structure; the server drops rigs picked for another one.
	 */
	let {
		facility,
		rigs,
		industryAvailable
	}: { facility: FacilityView; rigs: FacilityRigChoice[]; industryAvailable: boolean } = $props();

	let interactive = $state(false);
	onMount(() => {
		interactive = true;
	});

	/** Structure select value picked in this visit; null = the stored one. */
	let picked = $state<string | null>(null);
	const structureValue = $derived(
		picked ?? (facility.setting.structureTypeId === null ? '' : String(facility.setting.structureTypeId))
	);
	/** Rig slot values picked in this visit (slot index → value); reset when the structure changes. */
	let slotPicks = $state<Record<number, string>>({});
	/** The structure the rigs are for: EVE's, else the selected one (null = not set). */
	const structureTypeId = $derived(
		facility.detectedStructure?.typeId ?? (structureValue === '' ? null : Number(structureValue))
	);
	const structure = $derived(facility.structures.find((s) => s.typeId === structureTypeId));
	const activities = $derived(activitiesOf(facility.jobs));
	const choices = $derived(rigChoicesFor(rigs, structure, activities));
	const showRigSelects = $derived(
		industryAvailable && !facility.detectedRigs && structure !== undefined && structure.rigSlots > 0
	);
	/**
	 * Slot `i`'s value: no rigs stored for this structure = "Not set" on every slot; else the stored rig
	 * when it is one of the choices, else "No rig".
	 */
	const storedRig = (i: number) => {
		const stored = facility.setting.rigs;
		const storedFor = facility.detectedStructure?.typeId ?? facility.setting.structureTypeId;
		if (stored === null || structureTypeId !== storedFor) return RIG_NOT_SET;
		const typeId = stored[i];
		return typeId !== undefined && choices.some((r) => r.typeId === typeId) ? String(typeId) : NO_RIG;
	};
	const slotValue = (i: number) => slotPicks[i] ?? storedRig(i);
	const groupOf = (value: string) => choices.find((r) => String(r.typeId) === value)?.groupId;
	/** A rig whose kind another slot already holds (a structure fits one rig of each kind). */
	const takenElsewhere = (i: number, groupId: number) =>
		Array.from({ length: structure?.rigSlots ?? 0 }, (_, j) => j).some(
			(j) => j !== i && groupOf(slotValue(j)) === groupId
		);
	const RIG_LEVELS = { none: 'no ME rig', t1: 'T1 ME rig', t2: 'T2 ME rig' } as const;
	/** What the reactor settings give this facility (null parts: the reactors' settings differ). */
	const defaultStructure = $derived(facility.reactorDefault?.structure ?? 'as set per reactor');
	const defaultRig = $derived(
		facility.reactorDefault?.meRig ? RIG_LEVELS[facility.reactorDefault.meRig] : 'ME rig as set per reactor'
	);
	const notSetLabel = $derived(facility.reactorDefault ? 'Reactor settings' : 'Not set');

	const jobsText = $derived(
		[
			[facility.jobs.reaction, 'reaction job'],
			[facility.jobs.manufacturing, 'manufacturing job']
		]
			.filter(([n]) => (n as number) > 0)
			.map(([n, word]) => `${formatNumber(n as number)} ${word}${n === 1 ? '' : 's'}`)
			.join(', ')
	);

	const field =
		'rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
	const label = 'flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400';
	const muted = 'text-gray-500 dark:text-gray-400';
	const strong = 'font-medium text-gray-900 dark:text-gray-100';
</script>

<li
	class="space-y-2 border-t border-gray-200 pt-3 first:border-t-0 first:pt-0 dark:border-gray-600"
	data-facility={facility.facilityId}
>
	<div class="flex flex-wrap items-baseline gap-2">
		<span class="font-semibold text-gray-900 dark:text-gray-100">{facility.name ?? 'Unknown structure'}</span>
		<span class="text-xs {muted}">
			{facility.systemName ?? 'Unknown system'}{facility.band ? ` (${BAND_NAMES[facility.band]})` : ''}, {jobsText}
		</span>
		{#if facility.needs.structure || facility.needs.rigs}
			<span data-needs-input><Pill tone="amber">Needs your input</Pill></span>
		{/if}
	</div>

	<div class="grid items-start gap-x-6 gap-y-2 md:grid-cols-[13rem_minmax(0,1fr)]">
		<div data-structure>
			{#if facility.detectedStructure}
				<div class="text-xs {muted}">Structure</div>
				<div class={strong} data-detected-structure>{facility.detectedStructure.name}</div>
				<div class="text-xs {muted}">From EVE</div>
			{:else}
				<label class={label}>
					Structure
					<select
						name="structure-{facility.facilityId}"
						class="{field} w-full pr-8"
						onchange={(e) => {
							picked = e.currentTarget.value;
							slotPicks = {};
						}}
					>
						<option value="" selected={structureValue === ''}
							>{facility.reactorDefault ? `Reactor settings (${defaultStructure})` : 'Not set'}</option
						>
						{#each facility.structures as s (s.typeId)}
							<option value={String(s.typeId)} selected={structureValue === String(s.typeId)}>{s.name}</option
							>
						{/each}
						<option value={String(NO_STRUCTURE)} selected={structureValue === String(NO_STRUCTURE)}
							>NPC station or other (no bonus)</option
						>
					</select>
				</label>
			{/if}
		</div>

		{#if industryAvailable}
			<div data-rigs class="min-w-0">
				{#if facility.detectedRigs}
					<div class="text-xs {muted}">Rigs</div>
					<div class={strong} data-detected-rigs>
						{facility.detectedRigs.names.length
							? facility.detectedRigs.names.join(', ')
							: 'No rig with a material bonus'}
					</div>
					<div class="text-xs {muted}">
						Read from corporation assets{facility.detectedRigs.readAt
							? ` ${formatUtc(facility.detectedRigs.readAt)}`
							: ''}{facility.detectedRigs.others > 0
							? `, plus ${formatNumber(facility.detectedRigs.others)} ${facility.detectedRigs.others === 1 ? 'rig' : 'rigs'} without a material bonus`
							: ''}
					</div>
				{:else if showRigSelects && structure}
					<input type="hidden" name="rigsFor-{facility.facilityId}" value={String(structure.typeId)} />
					{#if choices.length}
						<div
							class="grid gap-2 sm:grid-cols-[repeat(var(--slots),minmax(0,1fr))]"
							style:--slots={structure.rigSlots}
						>
							{#each Array.from({ length: structure.rigSlots }, (_, i) => `${structure.typeId}-${i}`) as key, i (key)}
								<label class="{label} min-w-0">
									Rig {i + 1}
									<select
										name="rig-{facility.facilityId}"
										class="{field} w-full truncate pr-8"
										data-rig-select
										onchange={(e) => (slotPicks = { ...slotPicks, [i]: e.currentTarget.value })}
									>
										<option value={RIG_NOT_SET} selected={slotValue(i) === RIG_NOT_SET}>{notSetLabel}</option>
										<option value={NO_RIG} selected={slotValue(i) === NO_RIG}>No rig</option>
										{#each choices as r (r.typeId)}
											<option
												value={String(r.typeId)}
												selected={slotValue(i) === String(r.typeId)}
												disabled={takenElsewhere(i, r.groupId)}>{r.name}</option
											>
										{/each}
									</select>
								</label>
							{/each}
						</div>
					{:else}
						<p class="text-xs {muted}" data-no-rig-choices>
							No rig with a material bonus for these jobs fits a {structure.name}.
						</p>
					{/if}
					<p class="mt-1 text-xs {muted}">
						The rigs of this structure could not be read from corporation assets: pick the installed ones (one
						of each kind).
						{#if facility.reactorDefault}Until you do, reactions here use your reactor settings ({defaultRig}),
							as this structure is in their system.{/if}
						{#if !interactive}After changing the structure, save to pick its rigs.{/if}
					</p>
				{:else if !facility.detectedStructure && structureTypeId === null && facility.reactorDefault}
					<div class="text-xs {muted}">Rigs</div>
					<div class={strong} data-default-rigs>Reactor settings ({defaultRig})</div>
					<div class="text-xs {muted}">This structure is in your reactor settings' system.</div>
				{:else if !facility.detectedStructure && structureTypeId === null}
					<p class="text-xs {muted}" data-rigs-after-structure>Pick the structure to choose its rigs.</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if facility.bonus.length || facility.reactionProfile}
		<ul class="space-y-0.5 text-xs text-gray-700 dark:text-gray-300" data-bonus>
			{#each facility.bonus as line (`${line.activity}:${line.label}:${line.reduction}`)}
				<li>
					{line.label}: {line.reduction > 0
						? `${formatPct(line.reduction * 100, 2)} fewer materials`
						: 'no material bonus'}{line.fromReactorSettings ? ' (your reactor settings)' : ''}
				</li>
			{/each}
			{#if facility.reactionProfile}
				<li data-reaction-profile>
					Reactions: the ME rig of your reactor settings is used{industryAvailable
						? ' until the structure and its rigs are known'
						: ''}.
				</li>
			{/if}
		</ul>
	{/if}
</li>
