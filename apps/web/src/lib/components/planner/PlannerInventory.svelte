<script lang="ts">
	import { formatNumber, formatUtc } from '$lib/format';
	import type { UserInventory } from '$lib/server/inventory';

	interface Props {
		inventory: UserInventory;
		/** Clock for the stale note; test seam. */
		now?: number;
	}

	let { inventory, now = Date.now() }: Props = $props();

	/** Sources sync once a day; older than this the stock may have moved. */
	const STALE_MS = 2 * 86_400_000;

	const materials = $derived(Object.keys(inventory.stock).length);
	const formulas = $derived(Object.values(inventory.formulas).reduce((a, n) => a + n, 0));
	const owners = $derived(inventory.sources.map((s) => s.ownerName).join(', '));
	const failed = $derived(inventory.sources.filter((s) => s.status === 'error'));
	const stale = $derived(inventory.oldestSyncAt !== null && now - inventory.oldestSyncAt > STALE_MS);
</script>

<div
	class="space-y-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
	data-inventory-summary
>
	<p>
		{formatNumber(materials)}
		{materials === 1 ? 'material' : 'materials'} and {formatNumber(formulas)}
		{formulas === 1 ? 'formula' : 'formulas'} from {owners}{inventory.oldestSyncAt === null
			? ', not synced yet'
			: `, synced ${formatUtc(inventory.oldestSyncAt)}`}.
	</p>
	{#if failed.length > 0}
		<p class="text-xs text-amber-700 dark:text-amber-400" data-inventory-error>
			The last sync of {failed.map((s) => s.ownerName).join(', ')} failed; the items of the sync before are used.
		</p>
	{/if}
	{#if stale}
		<p class="text-xs text-amber-700 dark:text-amber-400" data-inventory-stale>
			Synced more than 2 days ago: your stock may have changed since.
		</p>
	{/if}
	<a href="/account/inventory" class="text-primary-700 dark:text-primary-400 text-xs hover:underline"
		>Sources and places on your inventory page</a
	>
</div>
