<script lang="ts" module>
	import type { InventorySourceView, TrackingStreamView } from '$lib/inventory/types';
	import { userFacingError } from '@reactions/eve/errors';

	/** Status line of a sync (inventory or profit tracking), before its last error (if any). */
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

	/** "OK", "Waiting", "Failed" or why ESI denied the stream ("<Character> needs the Accountant role"). */
	export function streamStatusText(stream: Pick<TrackingStreamView, 'status' | 'lastError'>): string {
		switch (stream.status) {
			case 'ok':
				return 'OK';
			case 'pending':
				return 'Waiting';
			case 'error':
				return 'Failed';
			case 'denied':
				return stream.lastError ? userFacingError(stream.lastError) : 'ESI denied access';
		}
	}
</script>

<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { formatUtc } from '$lib/format';
	import type { ConnectionView, InventorySourceStatus } from '$lib/inventory/types';

	let { source }: { source: ConnectionView } = $props();

	/** A request is in flight: the card's buttons stay disabled until the page data is back. */
	let pending = $state(false);
	const settle: SubmitFunction = () => {
		pending = true;
		return async ({ update }) => {
			await update();
			pending = false;
		};
	};
	const syncing = (status: InventorySourceStatus | null) => status === 'pending' || status === 'running';
	const statusClass = (status: InventorySourceStatus | null) =>
		status === 'error' || status === 'denied'
			? 'text-red-600 dark:text-red-400'
			: syncing(status)
				? 'text-yellow-700 dark:text-yellow-300'
				: 'text-green-700 dark:text-green-400';
	/** An `ok` sync may carry a note (grey), not an error. */
	const noteClass = (status: InventorySourceStatus | null) =>
		status === 'error' || status === 'denied'
			? 'block text-red-600 dark:text-red-400'
			: 'block text-gray-500 dark:text-gray-400';

	const tracking = $derived(source.tracking);

	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-600';
	const part = 'rounded-md border border-gray-200 p-2 dark:border-gray-600';
	const partHeading = 'text-xs font-semibold tracking-wide text-gray-700 uppercase dark:text-gray-300';
	const muted = 'text-xs text-gray-500 dark:text-gray-400';
</script>

{#snippet toggle(feature: 'inventory' | 'tracking', label: string, on: boolean)}
	<form method="POST" action="?/switch" use:enhance={settle}>
		<input type="hidden" name="sourceId" value={source.sourceId} />
		<input type="hidden" name="feature" value={feature} />
		<input type="hidden" name="on" value={on ? '0' : '1'} />
		<button
			type="submit"
			role="switch"
			aria-checked={on}
			aria-label={label}
			disabled={pending}
			data-switch={feature}
			class="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-700 disabled:cursor-wait disabled:opacity-50 dark:text-gray-200"
		>
			<span
				class="relative inline-block h-4 w-7 rounded-full transition-colors {on
					? 'bg-primary-600'
					: 'bg-gray-300 dark:bg-gray-500'}"
			>
				<span
					class="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all {on ? 'left-3.5' : 'left-0.5'}"
				></span>
			</span>
			{on ? 'On' : 'Off'}
		</button>
	</form>
{/snippet}

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
					>{source.kind === 'corporation' ? 'Corporation' : 'Character'}</span
				>
			</h3>
			{#if source.kind === 'corporation'}
				<div class={muted} data-readers>
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
		</div>
		<details>
			<summary class="{button} list-none text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
				>Remove…</summary
			>
			<form method="POST" action="?/remove" use:enhance={settle} class="mt-2 space-y-2">
				<input type="hidden" name="sourceId" value={source.sourceId} />
				<p class="text-xs font-semibold text-red-700 dark:text-red-400">
					Remove this connection and everything synced from it?
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

	{#if !source.inventoryEnabled && !tracking.enabled}
		<p class="mb-2 {muted}" data-nothing-read>
			Nothing is read from ESI for this connection. Switch on Inventory or Profit tracking.
		</p>
	{/if}

	<div class="grid gap-2 md:grid-cols-2">
		<section class={part} data-part="inventory" aria-label="Inventory of {source.ownerName}">
			<div class="mb-1 flex items-center justify-between gap-2">
				<h4 class={partHeading}>Inventory</h4>
				{@render toggle('inventory', 'Inventory', source.inventoryEnabled)}
			</div>
			{#if source.inventoryEnabled}
				<p class="text-xs" data-status>
					<span class={statusClass(source.status)}>{sourceStatusText(source)}</span>
					{#if source.lastError}
						<!-- An ok source keeps a note here (e.g. industry jobs not readable), not an error. -->
						<span class={noteClass(source.status)} data-error>{userFacingError(source.lastError)}</span>
					{/if}
				</p>
				<p class={muted} data-times>
					{#if source.dataAsOf}
						<span class="block">Data from ESI as of {formatUtc(source.dataAsOf)}</span>
					{/if}
					<span class="block"
						>{source.lastSyncedAt ? `Synced ${formatUtc(source.lastSyncedAt)}` : 'Not synced yet'}</span
					>
				</p>
				<form method="POST" action="?/sync" use:enhance={settle} class="mt-2">
					<input type="hidden" name="sourceId" value={source.sourceId} />
					<button type="submit" class={button} disabled={pending || syncing(source.status)}>Sync now</button>
				</form>
			{:else}
				<p class={muted}>Off: assets are not read and the planner does not use them.</p>
			{/if}
		</section>

		<section class={part} data-part="tracking" aria-label="Profit tracking of {source.ownerName}">
			<div class="mb-1 flex items-center justify-between gap-2">
				<h4 class={partHeading}>Profit tracking</h4>
				{@render toggle('tracking', 'Profit tracking', tracking.enabled)}
			</div>
			{#if tracking.enabled}
				{#if tracking.status || tracking.lastError}
					<p class="text-xs" data-tracking-status>
						{#if tracking.status}
							<span class={statusClass(tracking.status)}
								>{sourceStatusText({ ...source, status: tracking.status })}</span
							>
						{/if}
						{#if tracking.lastError}
							<span class={noteClass(tracking.status)} data-tracking-error
								>{userFacingError(tracking.lastError)}</span
							>
						{/if}
					</p>
				{/if}
				<p class={muted} data-tracking-times>
					{tracking.syncedAt ? `Synced ${formatUtc(tracking.syncedAt)}` : 'Not synced yet'}
				</p>
				<ul class="mt-1 space-y-0.5 text-xs" data-streams>
					{#each tracking.streams as stream (stream.key)}
						<li class="flex flex-wrap gap-x-2" data-stream={stream.key}>
							<span class="text-gray-700 dark:text-gray-300">{stream.label}</span>
							<span
								class={stream.status === 'ok'
									? 'text-green-700 dark:text-green-400'
									: stream.status === 'pending'
										? 'text-gray-500 dark:text-gray-400'
										: 'text-red-600 dark:text-red-400'}
								data-stream-status>{streamStatusText(stream)}</span
							>
						</li>
					{/each}
				</ul>
				{#if tracking.walletDivisions.length}
					<details class="mt-2" data-divisions>
						<summary class="cursor-pointer text-xs text-gray-600 hover:underline dark:text-gray-400"
							>Wallet divisions…</summary
						>
						<form method="POST" action="?/walletDivisions" use:enhance={settle} class="mt-1 space-y-1">
							<input type="hidden" name="sourceId" value={source.sourceId} />
							<fieldset>
								<legend class={muted}>Count the trades of these wallet divisions:</legend>
								<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
									{#each tracking.walletDivisions as division (division.division)}
										<label class="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
											<input
												type="checkbox"
												name="division"
												value={division.division}
												checked={division.counted}
												class="h-4 w-4 rounded border-gray-300 bg-gray-50 text-primary-600 focus:ring-primary-500 dark:border-gray-500 dark:bg-gray-800"
											/>
											{division.name}
										</label>
									{/each}
								</div>
							</fieldset>
							<button type="submit" class={button} disabled={pending}>Save divisions</button>
						</form>
					</details>
				{/if}
				<form method="POST" action="?/syncTracking" use:enhance={settle} class="mt-2">
					<input type="hidden" name="sourceId" value={source.sourceId} />
					<button type="submit" class={button} disabled={pending || syncing(tracking.status)}>Sync now</button
					>
				</form>
			{:else}
				<p class={muted}>Off: jobs, blueprints, wallet, orders and contracts are not read.</p>
			{/if}
		</section>
	</div>
</article>
