<script lang="ts" module>
	import type { InventoryBucketView, InventoryPlaceView } from '$lib/inventory/types';

	/** "2 formulas, 5 materials" for a bucket; "Nothing found" when it holds neither. */
	export function bucketCounts(bucket: Pick<InventoryBucketView, 'formulas' | 'materials'>): string {
		const parts = [];
		if (bucket.formulas) parts.push(`${bucket.formulas} formula${bucket.formulas === 1 ? '' : 's'}`);
		if (bucket.materials) parts.push(`${bucket.materials} material${bucket.materials === 1 ? '' : 's'}`);
		return parts.length ? parts.join(', ') : 'Nothing found';
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';

	interface Props {
		sourceId: number;
		/** The character whose token reads the assets (named in the "cannot dock" hint). */
		characterName: string;
		places: InventoryPlaceView[];
	}

	let { sourceId, characterName, places }: Props = $props();

	let saving = $state(false);

	const table =
		'w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-600';
</script>

{#if places.length}
	<form
		method="POST"
		action="?/select"
		data-places={sourceId}
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<input type="hidden" name="sourceId" value={sourceId} />
		<div class="overflow-x-auto">
			<table class={table}>
				<thead class={thead}>
					<tr>
						<th class="px-3 py-2">Place</th>
						<th class="px-3 py-2">Use</th>
					</tr>
				</thead>
				<tbody>
					{#each places as place (place.locationId)}
						<tr class="border-t border-gray-200 align-top dark:border-gray-700" data-place={place.locationId}>
							<td class="px-3 py-2">
								<!-- Structures the character cannot dock at have no name. -->
								<span class="block font-semibold text-gray-900 dark:text-gray-100"
									>{place.name ?? `Structure ${place.locationId}`}</span
								>
								{#if place.systemName}
									<span class="block text-xs text-gray-500 dark:text-gray-400">{place.systemName}</span>
								{/if}
								{#if place.name === null}
									<span class="block text-xs text-gray-500 dark:text-gray-400" data-no-dock
										>{characterName} cannot dock here, so its name is unknown.</span
									>
								{/if}
							</td>
							<td class="px-3 py-2">
								<ul class="space-y-1">
									{#each place.buckets as bucket (bucket.bucket)}
										<li>
											<label
												class="inline-flex cursor-pointer items-center gap-2"
												data-bucket={bucket.bucket}
											>
												<input
													type="checkbox"
													name="place"
													value="{place.locationId}:{bucket.bucket}"
													checked={bucket.selected}
													class="h-4 w-4 rounded border-gray-300 bg-gray-50 text-primary-600 focus:ring-primary-500 dark:border-gray-500 dark:bg-gray-800"
												/>
												<span class="font-medium text-gray-800 dark:text-gray-200">{bucket.label}</span>
												<span class="text-xs text-gray-500 dark:text-gray-400" data-counts
													>{bucketCounts(bucket)}</span
												>
											</label>
										</li>
									{/each}
								</ul>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="mt-2 flex flex-wrap gap-2">
			<button type="submit" class="{button} text-primary-700 dark:text-primary-400" disabled={saving}
				>Save</button
			>
			<button type="submit" name="mode" value="all" class={button} disabled={saving}>Select all</button>
			<button type="submit" name="mode" value="none" class={button} disabled={saving}>Select none</button>
		</div>
	</form>
{:else}
	<p class="text-gray-500 dark:text-gray-400" data-no-places>
		No places with reaction formulas or materials found.
	</p>
{/if}
