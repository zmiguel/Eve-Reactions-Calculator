<script lang="ts" module>
	import type { GrantableFeature } from '@reactions/eve';

	export interface AccountCharacter {
		characterId: number;
		name: string;
		/** The character this session logged in with. */
		isLogin: boolean;
		features: GrantableFeature[];
		tokenStatus: 'none' | 'ok' | 'invalid';
		lastRefreshedAt: number | null;
		lastError: string | null;
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { FEATURE_LABELS } from '$lib/account/features';
	import { formatUtc } from '$lib/format';
	import { portraitUrl } from '../AccountMenu.svelte';

	interface Props {
		character: AccountCharacter;
		/** Features the site lets users enable (`OFFERED_FEATURES`). */
		offeredFeatures: readonly GrantableFeature[];
		/** Removing the only character deletes the account. */
		onlyCharacter: boolean;
		/** Show the features/token columns (only when a feature can be enabled or is granted). */
		showAccess: boolean;
	}

	let { character, offeredFeatures, onlyCharacter, showAccess }: Props = $props();

	const enable = $derived(offeredFeatures.filter((f) => !character.features.includes(f)));
	const TOKEN = {
		none: { label: 'No token', class: 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200' },
		ok: { label: 'Token OK', class: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
		invalid: { label: 'Token invalid', class: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' }
	} as const;
	const badge = 'inline-block rounded px-1.5 py-0.5 text-xs font-medium';
	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600';
</script>

<tr class="border-t border-gray-200 align-middle dark:border-gray-700" data-character={character.characterId}>
	<td class="px-3 py-2">
		<div class="flex items-center gap-2">
			<img
				src={portraitUrl(character.characterId)}
				alt=""
				width="32"
				height="32"
				loading="lazy"
				class="h-8 w-8 shrink-0 rounded"
			/>
			<span class="font-semibold text-gray-900 dark:text-gray-100">{character.name}</span>
			{#if character.isLogin}
				<span class="{badge} bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-300"
					>Logged in</span
				>
			{/if}
		</div>
	</td>
	{#if showAccess}
		<td class="px-3 py-2" data-features>
			{#if character.features.length}
				<span class="flex flex-wrap gap-1">
					{#each character.features as feature (feature)}
						<span class="{badge} bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300"
							>{FEATURE_LABELS[feature]}</span
						>
					{/each}
				</span>
			{:else}
				<span class="text-xs text-gray-500 dark:text-gray-400">none</span>
			{/if}
		</td>
		<td class="px-3 py-2">
			<span class="{badge} {TOKEN[character.tokenStatus].class}" data-token-status={character.tokenStatus}
				>{TOKEN[character.tokenStatus].label}</span
			>
		</td>
		<td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
			{character.lastRefreshedAt ? formatUtc(character.lastRefreshedAt) : 'n/a'}
			{#if character.lastError}
				<span class="block text-red-600 dark:text-red-400" title={character.lastError}
					>{character.lastError}</span
				>
			{/if}
		</td>
	{/if}
	<td class="px-3 py-2">
		<div class="flex flex-wrap items-center justify-end gap-1.5">
			{#each enable as feature (feature)}
				<a
					href="/auth/login?purpose=feature&feature={feature}&characterId={character.characterId}&returnTo=%2Faccount"
					data-sveltekit-reload
					class="{button} text-primary-700 dark:text-primary-400">Enable {FEATURE_LABELS[feature]}</a
				>
			{/each}
			{#if onlyCharacter}
				<!-- Removing the only character deletes the account: one confirmation step (works without JS). -->
				<details class="relative">
					<summary
						class="{button} list-none text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
						>Remove</summary
					>
					<form
						method="POST"
						action="?/remove"
						use:enhance
						class="absolute end-0 z-10 mt-1 w-60 rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-md dark:border-gray-600 dark:bg-gray-700"
					>
						<p class="mb-2">This is your only character: removing it deletes your account.</p>
						<input type="hidden" name="characterId" value={character.characterId} />
						<button type="submit" class="{button} text-red-600 dark:text-red-400"
							>Remove and delete account</button
						>
					</form>
				</details>
			{:else}
				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="characterId" value={character.characterId} />
					<button type="submit" class="{button} text-red-600 dark:text-red-400">Remove</button>
				</form>
			{/if}
		</div>
	</td>
</tr>
