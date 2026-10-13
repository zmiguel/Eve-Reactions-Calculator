<script lang="ts" module>
	import type { InventorySourceView } from '$lib/inventory/types';

	/** Status line of a source, before its last error (if any). */
	export function sourceStatusText(
		source: Pick<InventorySourceView, 'status' | 'kind' | 'characterName'>
	): string {
		switch (source.status) {
			case 'pending':
				return 'Sync queued';
			case 'running':
				return 'Sync running';
			case 'ok':
				return 'Up to date';
			case 'error':
				return 'Last sync failed';
			case 'denied':
				// A corporation's error names every reader that was tried.
				return source.kind === 'corporation'
					? 'ESI denied access'
					: `ESI denied access for ${source.characterName}`;
		}
	}
</script>

<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { formatUtc } from '$lib/format';
	import { userFacingError } from '@reactions/eve/errors';
	import InventoryPlaces from './InventoryPlaces.svelte';

	let { source }: { source: InventorySourceView } = $props();

	/** A sync/remove request is in flight: its buttons stay disabled until the page data is back. */
	let pending = $state(false);
	const settle: SubmitFunction = () => {
		pending = true;
		return async ({ update }) => {
			await update();
			pending = false;
		};
	};

	const busy = $derived(source.status === 'pending' || source.status === 'running');
	const failed = $derived(source.status === 'error' || source.status === 'denied');

	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-600';
</script>

<article
	class="rounded-lg border border-gray-200 p-3 dark:border-gray-600"
	data-source={source.sourceId}
	aria-label={source.ownerName}
>
	<div class="mb-3 flex flex-wrap items-start justify-between gap-2">
		<div>
			<h3 class="font-semibold text-gray-900 dark:text-gray-100">
				{source.ownerName}
				<span class="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400"
					>{source.kind === 'corporation' ? 'Corporation assets' : 'Personal assets'}</span
				>
			</h3>
			{#if source.kind === 'corporation'}
				<div class="text-xs text-gray-500 dark:text-gray-400" data-readers>
					<p>Read with {source.characterName}</p>
					{#if source.otherReaders.length}
						<p>Also: {source.otherReaders.map((r) => r.name).join(', ')}</p>
						<details class="mt-1">
							<summary class="cursor-pointer hover:underline">Change readers…</summary>
							<ul class="mt-1 flex flex-wrap gap-2">
								{#each [{ characterId: source.characterId, name: source.characterName }, ...source.otherReaders] as reader (reader.characterId)}
									<li>
										<form method="POST" action="?/removeReader" use:enhance={settle}>
											<input type="hidden" name="sourceId" value={source.sourceId} />
											<input type="hidden" name="characterId" value={reader.characterId} />
											<button type="submit" class={button} disabled={pending}>Stop using {reader.name}</button
											>
										</form>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			{/if}
			<p class="mt-1 text-xs" data-status>
				<span
					class={failed
						? 'text-red-600 dark:text-red-400'
						: busy
							? 'text-yellow-700 dark:text-yellow-300'
							: 'text-green-700 dark:text-green-400'}>{sourceStatusText(source)}</span
				>
				{#if source.lastError}
					<!-- An ok source keeps a note here (e.g. industry jobs not readable), not an error. -->
					<span
						class={failed ? 'block text-red-600 dark:text-red-400' : 'block text-gray-500 dark:text-gray-400'}
						data-error>{userFacingError(source.lastError)}</span
					>
				{/if}
			</p>
			<p class="text-xs text-gray-500 dark:text-gray-400" data-times>
				{#if source.dataAsOf}
					<span class="block">Data from ESI as of {formatUtc(source.dataAsOf)}</span>
				{/if}
				<span class="block"
					>{source.lastSyncedAt ? `Synced ${formatUtc(source.lastSyncedAt)}` : 'Not synced yet'}</span
				>
			</p>
		</div>
		<div class="flex flex-wrap items-start gap-2">
			<form method="POST" action="?/sync" use:enhance={settle}>
				<input type="hidden" name="sourceId" value={source.sourceId} />
				<button type="submit" class={button} disabled={pending || busy}>Sync now</button>
			</form>
			<details>
				<summary class="{button} list-none text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
					>Remove…</summary
				>
				<form method="POST" action="?/remove" use:enhance={settle} class="mt-2 space-y-2">
					<input type="hidden" name="sourceId" value={source.sourceId} />
					<p class="text-xs font-semibold text-red-700 dark:text-red-400">
						Remove this source and its synced assets?
					</p>
					<button
						type="submit"
						disabled={pending}
						class="cursor-pointer rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-50"
						>Yes, remove</button
					>
				</form>
			</details>
		</div>
	</div>
	{#if source.places.length || source.lastSyncedAt}
		<InventoryPlaces sourceId={source.sourceId} characterName={source.characterName} places={source.places} />
	{/if}
</article>
