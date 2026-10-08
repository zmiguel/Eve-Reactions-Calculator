<script lang="ts">
	import {
		materialModifier,
		timeModifier,
		type ReactionConstants,
		type ReactorProfile,
		type SecurityBand
	} from '@reactions/engine';
	import { Checkbox } from 'flowbite-svelte';
	import { formatPct } from '$lib/format';
	import {
		BASIS_OPTIONS,
		INPUT_METHOD_OPTIONS,
		OUTPUT_METHOD_OPTIONS,
		RIG_OPTIONS,
		STRUCTURE_OPTIONS,
		type Option,
		type SystemSummary
	} from '$lib/settings/fields';
	import NumberField from './NumberField.svelte';
	import SelectField from './SelectField.svelte';
	import SystemAutocomplete from './SystemAutocomplete.svelte';

	interface Props {
		/** Field-name prefix: `shared` or `reactors.<reactor>`. */
		prefix: string;
		profile: ReactorProfile;
		system: SystemSummary | null;
		systemText: string;
		hubs: { hubId: string; name: string; private: boolean }[];
		errors: Record<string, string>;
		constants: ReactionConstants;
		/** True once hydrated: dependent fields are then toggled by script instead of CSS. */
		enhanced: boolean;
	}

	let {
		prefix,
		profile = $bindable(),
		system = $bindable(),
		systemText = $bindable(),
		hubs,
		errors,
		constants,
		enhanced
	}: Props = $props();

	const SKILL_OPTIONS: Option[] = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), name: `Level ${n}` }));
	const ENGINE_BANDS: readonly string[] = ['lowsec', 'nullsec', 'wormhole'];

	const hubItems = $derived.by(() => {
		const items: Option[] = hubs.map((h) => ({
			value: h.hubId,
			name: h.private ? `${h.name} (private)` : h.name
		}));
		for (const side of [profile.market.inputHub, profile.market.inputFallbackHub, profile.market.outputHub]) {
			if (!items.some((i) => i.value === side)) items.push({ value: side, name: `${side} (unavailable)` });
		}
		return items;
	});

	// Live preview of the efficiency modifiers for the current form values (engine formulas).
	const preview = $derived.by(() => {
		const band = (
			ENGINE_BANDS.includes(system?.securityBand ?? '') ? system!.securityBand : 'lowsec'
		) as SecurityBand;
		const skill = Number(profile.reactionsSkill);
		const p = { ...profile, reactionsSkill: skill, securityBand: band };
		return {
			band,
			me: materialModifier(p, constants),
			te: Number.isInteger(skill) && skill >= 1 && skill <= 5 ? timeModifier(p, constants) : null
		};
	});

	const field = (name: string) => `${prefix}.${name}`;
	const err = (name: string) => errors[`${prefix}.${name}`];
	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
</script>

<div class="grid gap-4 lg:grid-cols-3">
	<section class={card} aria-label="Facility">
		<h3 class={heading}>Facility</h3>
		<div class="grid grid-cols-2 gap-3">
			<SelectField
				name={field('structure')}
				label="Structure"
				items={STRUCTURE_OPTIONS}
				bind:value={profile.structure}
				error={err('structure')}
			/>
			<SelectField
				name={field('reactionsSkill')}
				label="Reactions skill"
				items={SKILL_OPTIONS}
				bind:value={() => String(profile.reactionsSkill), (v) => (profile.reactionsSkill = Number(v))}
				error={err('reactionsSkill')}
			/>
			<SelectField
				name={field('meRig')}
				label="ME rig"
				items={RIG_OPTIONS}
				bind:value={profile.meRig}
				error={err('meRig')}
			/>
			<SelectField
				name={field('teRig')}
				label="TE rig"
				items={RIG_OPTIONS}
				bind:value={profile.teRig}
				error={err('teRig')}
			/>
			<div class="col-span-2">
				<SystemAutocomplete {prefix} bind:selected={system} bind:text={systemText} error={err('systemId')} />
			</div>
			<NumberField
				name={field('costIndexOverridePct')}
				label="Cost index override %"
				min={0}
				max={100}
				placeholder="From ESI"
				bind:value={profile.costIndexOverridePct}
				error={err('costIndexOverridePct')}
			/>
			<NumberField
				name={field('facilityTaxPct')}
				label="Facility tax %"
				min={0}
				max={50}
				bind:value={profile.facilityTaxPct}
				error={err('facilityTaxPct')}
			/>
			<NumberField
				name={field('sccPct')}
				label="SCC surcharge %"
				min={0}
				max={20}
				bind:value={profile.sccPct}
				error={err('sccPct')}
			/>
		</div>
		<p
			class="mt-3 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700 tabular-nums dark:bg-gray-800 dark:text-gray-300"
			aria-live="polite"
			data-preview
		>
			Effective modifiers ({preview.band}):
			<strong class="font-semibold text-gray-900 dark:text-white" data-preview-me
				>ME ×{preview.me.toFixed(4)}</strong
			>
			({formatPct((1 - preview.me) * 100, 2)} fewer materials) ·
			<strong class="font-semibold text-gray-900 dark:text-white" data-preview-te
				>TE ×{preview.te === null ? 'n/a' : preview.te.toFixed(4)}</strong
			>
			{#if preview.te !== null}({formatPct((1 - preview.te) * 100, 1)} faster){/if}
		</p>
	</section>

	<section class={card} aria-label="Market">
		<h3 class={heading}>Market</h3>
		<div class="grid grid-cols-2 gap-3">
			{#each ['input', 'output'] as const as side (side)}
				{@const method = side === 'input' ? profile.market.inputMethod : profile.market.outputMethod}
				<div class="group/side space-y-3" data-side={side}>
					{#if side === 'input'}
						<SelectField
							name={field('market.inputHub')}
							label="Input hub"
							items={hubItems}
							bind:value={profile.market.inputHub}
							error={err('market.inputHub')}
						/>
						<SelectField
							name={field('market.inputMethod')}
							label="Buy inputs with"
							items={INPUT_METHOD_OPTIONS}
							bind:value={profile.market.inputMethod}
							error={err('market.inputMethod')}
						/>
					{:else}
						<SelectField
							name={field('market.outputHub')}
							label="Output hub"
							items={hubItems}
							bind:value={profile.market.outputHub}
							error={err('market.outputHub')}
						/>
						<SelectField
							name={field('market.outputMethod')}
							label="Sell outputs with"
							items={OUTPUT_METHOD_OPTIONS}
							bind:value={profile.market.outputMethod}
							error={err('market.outputMethod')}
						/>
					{/if}
					{#if !enhanced || method === 'contract'}
						<!-- Without JS, CSS shows the basis only while "Contract" is the selected method. -->
						<div
							class={enhanced ? '' : 'hidden group-has-[option[value=contract]:checked]/side:block'}
							data-contract-basis={side}
						>
							{#if side === 'input'}
								<SelectField
									name={field('market.inputContractBasis')}
									label="Contract price basis"
									items={BASIS_OPTIONS}
									bind:value={profile.market.inputContractBasis}
									error={err('market.inputContractBasis')}
								/>
							{:else}
								<SelectField
									name={field('market.outputContractBasis')}
									label="Contract price basis"
									items={BASIS_OPTIONS}
									bind:value={profile.market.outputContractBasis}
									error={err('market.outputContractBasis')}
								/>
							{/if}
						</div>
					{/if}
					{#if side === 'input'}
						<NumberField
							name={field('market.inputPricePct')}
							label="Input price %"
							min={50}
							max={150}
							bind:value={profile.market.inputPricePct}
							error={err('market.inputPricePct')}
						/>
					{:else}
						<NumberField
							name={field('market.outputPricePct')}
							label="Output price %"
							min={50}
							max={150}
							bind:value={profile.market.outputPricePct}
							error={err('market.outputPricePct')}
						/>
					{/if}
				</div>
			{/each}
			<NumberField
				name={field('market.brokerFeePct')}
				label="Broker fee %"
				min={0}
				max={10}
				bind:value={profile.market.brokerFeePct}
				error={err('market.brokerFeePct')}
			/>
			<NumberField
				name={field('market.salesTaxPct')}
				label="Sales tax %"
				min={0}
				max={10}
				bind:value={profile.market.salesTaxPct}
				error={err('market.salesTaxPct')}
			/>
			<div class="col-span-2">
				<SelectField
					name={field('market.inputFallbackHub')}
					label="Buy missing inputs from"
					items={hubItems}
					bind:value={profile.market.inputFallbackHub}
					error={err('market.inputFallbackHub')}
					hint="Used when the input hub lists fewer units than you need"
				/>
			</div>
		</div>
	</section>

	<section class={card} aria-label="Shipping">
		<h3 class={heading}>Shipping</h3>
		<div class="space-y-4">
			{#each ['input', 'output'] as const as side (side)}
				{@const shipping = profile.shipping[side]}
				<fieldset class="space-y-3" data-shipping={side}>
					<legend class="sr-only">{side === 'input' ? 'Input' : 'Output'} shipping</legend>
					<Checkbox
						name={field(`shipping.${side}.enabled`)}
						bind:checked={profile.shipping[side].enabled}
						classes={{ div: 'text-sm font-medium text-gray-900 dark:text-white' }}
					>
						{side === 'input' ? 'Ship inputs to the reactor' : 'Ship outputs to the market'}
					</Checkbox>
					<div class="grid grid-cols-3 gap-3">
						<NumberField
							name={field(`shipping.${side}.iskPerM3`)}
							label="ISK per m³"
							min={0}
							max={1_000_000}
							disabled={enhanced && !shipping.enabled}
							bind:value={profile.shipping[side].iskPerM3}
							error={err(`shipping.${side}.iskPerM3`)}
						/>
						<NumberField
							name={field(`shipping.${side}.collateralPct`)}
							label="Collateral %"
							min={0}
							max={100}
							disabled={enhanced && !shipping.enabled}
							bind:value={profile.shipping[side].collateralPct}
							error={err(`shipping.${side}.collateralPct`)}
						/>
						<NumberField
							name={field(`shipping.${side}.discountPct`)}
							label="Discount %"
							min={0}
							max={100}
							hint="e.g. a volume discount from your hauling service"
							disabled={enhanced && !shipping.enabled}
							bind:value={profile.shipping[side].discountPct}
							error={err(`shipping.${side}.discountPct`)}
						/>
					</div>
				</fieldset>
			{/each}
		</div>
	</section>
</div>
