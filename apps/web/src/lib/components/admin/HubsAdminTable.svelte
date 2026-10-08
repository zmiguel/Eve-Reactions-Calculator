<script lang="ts" module>
	export interface AdminHub {
		hubId: string;
		name: string;
		kind: string;
		visibility: 'public' | 'private';
		shareStatus: 'none' | 'pending' | 'approved' | 'rejected';
		enabled: boolean;
		sortOrder: number;
		systemName: string | null;
		lastSuccessAt: number | null;
		lastError: string | null;
		/** Character names of the structure links (structure hubs only). */
		contributors: string[];
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatRelative, formatUtc } from '$lib/format';

	interface Props {
		hubs: AdminHub[];
		now: number;
	}

	let { hubs, now }: Props = $props();

	const publicIds = $derived(hubs.filter((h) => h.visibility === 'public').map((h) => h.hubId));
	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-default disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-600';
	const badge = 'inline-block rounded px-1.5 py-0.5 text-xs font-medium';
	const muted = 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200';
</script>

<div class="overflow-x-auto">
	<table
		class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
	>
		<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
			<tr>
				<th class="px-3 py-2">Hub</th>
				<th class="px-3 py-2">Kind</th>
				<th class="px-3 py-2">Visibility</th>
				<th class="px-3 py-2">Share</th>
				<th class="px-3 py-2">Enabled</th>
				<th class="px-3 py-2 text-right">Order</th>
				<th class="px-3 py-2">Contributors</th>
				<th class="px-3 py-2">Last success</th>
				<th class="px-3 py-2">Last error</th>
				<th class="px-3 py-2 text-right"><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each hubs as hub (hub.hubId)}
				{@const isPublic = hub.visibility === 'public'}
				{@const position = publicIds.indexOf(hub.hubId)}
				<tr class="border-t border-gray-200 align-middle dark:border-gray-700" data-hub={hub.hubId}>
					<td class="px-3 py-2">
						<span class="block font-semibold text-gray-900 dark:text-gray-100">{hub.name}</span>
						<span class="block text-xs text-gray-500 dark:text-gray-400"
							>{hub.hubId}{hub.systemName ? ` · ${hub.systemName}` : ''}</span
						>
					</td>
					<td class="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{hub.kind}</td>
					<td class="px-3 py-2">
						<span
							class="{badge} {isPublic
								? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
								: muted}">{hub.visibility}</span
						>
					</td>
					<td class="px-3 py-2 text-xs text-gray-700 dark:text-gray-300" data-share={hub.shareStatus}
						>{hub.shareStatus}</td
					>
					<td class="px-3 py-2 text-xs">
						{#if hub.enabled}
							<span class="text-green-700 dark:text-green-400">yes</span>
						{:else}
							<span class="text-red-600 dark:text-red-400">no</span>
						{/if}
					</td>
					<td class="px-3 py-2 text-right text-xs text-gray-700 tabular-nums dark:text-gray-300"
						>{hub.sortOrder}</td
					>
					<td class="px-3 py-2 text-xs text-gray-700 dark:text-gray-300" data-contributors>
						{#if hub.kind === 'structure'}
							<span class="font-semibold tabular-nums">{hub.contributors.length}</span>
							{#if hub.contributors.length}
								<span class="text-gray-500 dark:text-gray-400">· {hub.contributors.join(', ')}</span>
							{/if}
						{:else}
							n/a
						{/if}
					</td>
					<td class="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
						{#if hub.lastSuccessAt}
							<span title={formatUtc(hub.lastSuccessAt)}>{formatRelative(hub.lastSuccessAt, now)}</span>
						{:else}
							n/a
						{/if}
					</td>
					<td class="max-w-56 truncate px-3 py-2 text-xs text-red-600 dark:text-red-400" title={hub.lastError}
						>{hub.lastError ?? ''}</td
					>
					<td class="px-3 py-2">
						<div class="flex flex-wrap items-center justify-end gap-1">
							{#if isPublic}
								<form method="POST" action="?/{hub.enabled ? 'disable' : 'enable'}" use:enhance>
									<input type="hidden" name="hubId" value={hub.hubId} />
									<button type="submit" class={button}>{hub.enabled ? 'Disable' : 'Enable'}</button>
								</form>
								<form method="POST" action="?/up" use:enhance>
									<input type="hidden" name="hubId" value={hub.hubId} />
									<button
										type="submit"
										class={button}
										disabled={position === 0}
										aria-label="Move {hub.name} up">↑</button
									>
								</form>
								<form method="POST" action="?/down" use:enhance>
									<input type="hidden" name="hubId" value={hub.hubId} />
									<button
										type="submit"
										class={button}
										disabled={position === publicIds.length - 1}
										aria-label="Move {hub.name} down">↓</button
									>
								</form>
								{#if hub.kind === 'structure'}
									<form method="POST" action="?/revoke" use:enhance>
										<input type="hidden" name="hubId" value={hub.hubId} />
										<button type="submit" class="{button} text-red-600 dark:text-red-400"
											>Revoke public</button
										>
									</form>
								{/if}
							{/if}
							{#if hub.kind === 'structure'}
								<!-- One confirmation step that works without JS; opens inline (the table scrolls sideways). -->
								<details class="open:basis-full" data-delete>
									<summary
										class="{button} ms-auto w-fit list-none text-red-600 dark:text-red-400 [&::-webkit-details-marker]:hidden"
										>Delete</summary
									>
									<form
										method="POST"
										action="?/delete"
										use:enhance
										class="mt-1 flex items-center justify-end gap-2 text-xs whitespace-nowrap text-gray-700 dark:text-gray-300"
									>
										<span>Also removes its links and prices.</span>
										<input type="hidden" name="hubId" value={hub.hubId} />
										<button
											type="submit"
											class="{button} text-red-600 dark:text-red-400"
											aria-label="Delete {hub.name}">Delete hub</button
										>
									</form>
								</details>
							{/if}
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
