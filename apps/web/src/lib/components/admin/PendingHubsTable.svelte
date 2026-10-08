<script lang="ts">
	import { enhance } from '$app/forms';
	import type { AdminHub } from './HubsAdminTable.svelte';

	interface Props {
		/** Structure hubs with `share_status='pending'`. */
		hubs: AdminHub[];
	}

	let { hubs }: Props = $props();

	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-600';
</script>

{#if hubs.length}
	<div class="overflow-x-auto">
		<table
			class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
				<tr>
					<th class="px-3 py-2">Market</th>
					<th class="px-3 py-2">Contributors</th>
					<th class="px-3 py-2 text-right"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each hubs as hub (hub.hubId)}
					<tr class="border-t border-gray-200 align-middle dark:border-gray-700" data-pending={hub.hubId}>
						<td class="px-3 py-2">
							<span class="block font-semibold text-gray-900 dark:text-gray-100">{hub.name}</span>
							<span class="block text-xs text-gray-500 dark:text-gray-400"
								>{hub.hubId}{hub.systemName ? ` · ${hub.systemName}` : ''}</span
							>
						</td>
						<td class="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
							{hub.contributors.length ? hub.contributors.join(', ') : 'none'}
						</td>
						<td class="px-3 py-2">
							<div class="flex justify-end gap-1">
								<form method="POST" action="?/approve" use:enhance>
									<input type="hidden" name="hubId" value={hub.hubId} />
									<button type="submit" class="{button} text-green-700 dark:text-green-400">Approve</button>
								</form>
								<form method="POST" action="?/reject" use:enhance>
									<input type="hidden" name="hubId" value={hub.hubId} />
									<button type="submit" class="{button} text-red-600 dark:text-red-400">Reject</button>
								</form>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="text-gray-500 dark:text-gray-400">Nothing waiting for review.</p>
{/if}
