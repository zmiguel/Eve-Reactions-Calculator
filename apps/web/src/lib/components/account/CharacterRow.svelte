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

	/** Token badge per status (green only while the last refresh worked). */
	export const TOKEN_BADGE = {
		none: { label: 'No token', tone: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
		ok: { label: 'Token OK', tone: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
		failing: {
			label: 'Refresh failed',
			tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300'
		},
		invalid: { label: 'Token invalid', tone: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' }
	} as const;
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { FEATURE_LABELS, permissionsSaveAction } from '#lib/account/features.js';
	import { formatUtc } from '#lib/format.js';
	import { TOKEN_ERROR_REVOKED, userFacingError } from '@reactions/eve/errors';
	import { PenOutline, TrashBinOutline } from 'flowbite-svelte-icons';
	import { portraitUrl } from '../AccountMenu.svelte';
	import PermissionsDialog from './PermissionsDialog.svelte';

	interface Props {
		character: AccountCharacter;
		/** Features the site lets users enable (`OFFERED_FEATURES`). */
		offeredFeatures: readonly GrantableFeature[];
		/** Removing the only character deletes the account. */
		onlyCharacter: boolean;
	}

	let { character, offeredFeatures, onlyCharacter }: Props = $props();

	const token = $derived(
		character.tokenStatus === 'invalid'
			? 'invalid'
			: character.tokenStatus === 'ok' && character.lastError
				? 'failing'
				: character.tokenStatus
	);
	// What went wrong, when EVE refused the token or its last refresh failed.
	const attention = $derived(
		token === 'invalid'
			? userFacingError(character.lastError ?? TOKEN_ERROR_REVOKED)
			: token === 'failing'
				? userFacingError(character.lastError!)
				: null
	);
	const badge = 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap';
	const icon =
		'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600';
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
			<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
				<span class="font-semibold whitespace-nowrap text-gray-900 dark:text-gray-100">{character.name}</span>
				{#if character.isLogin}
					<span class="{badge} bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-300"
						>Logged in</span
					>
				{/if}
			</div>
		</div>
	</td>
	<td class="px-3 py-2" data-permissions>
		{#if character.features.length}
			<ul class="flex max-w-md flex-wrap gap-1">
				{#each character.features as feature (feature)}
					<li class="{badge} bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300">
						{FEATURE_LABELS[feature]}
					</li>
				{/each}
			</ul>
		{:else}
			<span class="text-xs text-gray-500 dark:text-gray-400">None</span>
		{/if}
	</td>
	<td class="px-3 py-2 text-xs" data-token={token}>
		<span class="{badge} {TOKEN_BADGE[token].tone}">{TOKEN_BADGE[token].label}</span>
		{#if character.lastRefreshedAt}
			<span class="mt-0.5 block whitespace-nowrap text-gray-500 dark:text-gray-400" data-last-refresh
				>Refreshed {formatUtc(character.lastRefreshedAt)}</span
			>
		{/if}
		{#if attention}
			<div class="mt-0.5 text-red-600 dark:text-red-400" data-token-attention>
				{attention}
				<!-- Logs in again with the current features (a POST: the login can change permissions). -->
				<form method="POST" action={permissionsSaveAction(character.characterId)} class="inline">
					{#each character.features as feature (feature)}
						<input type="hidden" name="features" value={feature} />
					{/each}
					<button type="submit" class="cursor-pointer font-medium underline">Log in again</button>
				</form>
			</div>
		{/if}
	</td>
	<td class="px-3 py-2">
		<div class="flex items-start justify-end gap-1.5">
			<PermissionsDialog {character} {offeredFeatures} triggerClass="{icon} text-gray-700 dark:text-gray-300">
				<PenOutline class="h-4 w-4" aria-hidden="true" />
			</PermissionsDialog>
			{#if onlyCharacter}
				<!-- Removing the only character deletes the account: one confirmation step (works without JS).
				     The confirmation opens in the cell itself, so the table's scroll box cannot clip it. -->
				<details class="text-right" data-remove-confirm>
					<summary
						class="{icon} list-none text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
						title="Remove {character.name}"
						aria-label="Remove {character.name}"
					>
						<TrashBinOutline class="h-4 w-4" aria-hidden="true" />
					</summary>
					<form
						method="POST"
						action="?/remove"
						use:enhance
						class="ms-auto mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 text-left text-xs dark:border-gray-600 dark:bg-gray-700"
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
					<button
						type="submit"
						class="{icon} text-red-600 dark:text-red-400"
						title="Remove {character.name}"
						aria-label="Remove {character.name}"
					>
						<TrashBinOutline class="h-4 w-4" aria-hidden="true" />
					</button>
				</form>
			{/if}
		</div>
	</td>
</tr>
