<script lang="ts">
	import type { GrantableFeature } from '@reactions/eve';
	import { untrack, type Snippet } from 'svelte';
	import {
		FEATURE_DESCRIPTIONS,
		FEATURE_LABELS,
		FEATURE_ROLES,
		permissionsSaveAction
	} from '#lib/account/features.js';

	interface Props {
		character: { characterId: number; name: string; features: readonly GrantableFeature[] };
		/** Features the site lets users enable (`OFFERED_FEATURES`). */
		offeredFeatures: readonly GrantableFeature[];
		/** Extra buttons next to the submit button (the dialog's Cancel). */
		actions?: Snippet;
	}

	let { character, offeredFeatures, actions }: Props = $props();

	// The ticks start from the current grants; later prop changes do not reset what the user ticked.
	let checked = $state<string[]>(
		untrack(() => offeredFeatures.filter((f) => character.features.includes(f)))
	);

	const idPrefix = $derived(`permission-${character.characterId}`);
	const primaryButton =
		'inline-flex cursor-pointer items-center rounded-md border border-primary-700 bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 dark:border-primary-600 dark:bg-primary-600 dark:hover:bg-primary-700';
</script>

<!-- A POST (origin-checked) to the permissions page's action, which starts the EVE login. -->
<form method="POST" action={permissionsSaveAction(character.characterId)} class="space-y-3 text-sm">
	<fieldset class="space-y-2">
		<legend class="sr-only">Permissions of {character.name}</legend>
		{#each offeredFeatures as feature (feature)}
			<div class="flex items-start gap-2">
				<input
					id="{idPrefix}-{feature}"
					type="checkbox"
					name="features"
					value={feature}
					bind:group={checked}
					aria-describedby="{idPrefix}-{feature}-description"
					class="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 bg-gray-50 text-primary-600 focus:ring-primary-500 dark:border-gray-500 dark:bg-gray-800"
				/>
				<div>
					<label for="{idPrefix}-{feature}" class="font-medium text-gray-900 dark:text-gray-100"
						>{FEATURE_LABELS[feature]}</label
					>
					<p id="{idPrefix}-{feature}-description" class="text-xs text-gray-600 dark:text-gray-400">
						{FEATURE_DESCRIPTIONS[feature]}
						{#if FEATURE_ROLES[feature]}
							<span class="block">{FEATURE_ROLES[feature]}</span>
						{/if}
					</p>
				</div>
			</div>
		{/each}
	</fieldset>
	<div class="space-y-1 text-xs text-gray-600 dark:text-gray-400" data-permissions-note>
		<p>
			Saving takes you to the EVE Online login, which lists every permission this site asks for. Unticking a
			permission removes it from this site, and what it enabled for {character.name} is switched off.
		</p>
		<p>
			To revoke the earlier grant at EVE as well, remove this site on EVE's
			<a
				href="https://developers.eveonline.com/authorized-apps"
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary-700 hover:underline dark:text-primary-400">third-party applications page</a
			>.
		</p>
	</div>
	<div class="flex flex-wrap justify-end gap-2">
		{@render actions?.()}
		<button type="submit" class={primaryButton}>Save and log in with EVE</button>
	</div>
</form>
