<script lang="ts" module>
	export interface StructureLink {
		structureId: number;
		name: string;
		systemName: string | null;
		regionName: string | null;
		visibility: 'public' | 'private';
		shareStatus: 'none' | 'pending' | 'approved' | 'rejected';
		enabled: boolean;
		lastSuccessAt: number | null;
		lastError: string | null;
		accessStatus: 'ok' | 'denied';
		shareRequested: boolean;
		characterId: number;
		characterName: string;
	}

	const BADGES = {
		public: { label: 'Public', class: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
		pending: {
			label: 'Shared, pending review',
			class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
		},
		rejected: { label: 'Rejected', class: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
		private: { label: 'Private', class: 'bg-gray-100 text-gray-700 dark:bg-gray-600 dark:text-gray-200' }
	} as const;

	/** Visibility badge of a structure hub: public wins, then the review state, else private. */
	export function visibilityBadge(
		link: Pick<StructureLink, 'visibility' | 'shareStatus'>
	): keyof typeof BADGES {
		if (link.visibility === 'public') return 'public';
		if (link.shareStatus === 'pending' || link.shareStatus === 'rejected') return link.shareStatus;
		return 'private';
	}
</script>

<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { formatRelative, formatUtc } from '$lib/format';

	interface Props {
		link: StructureLink;
		now: number;
	}

	let { link, now }: Props = $props();

	/** A share/remove request is in flight: its buttons stay disabled until the page data is back. */
	let pending = $state(false);
	const badge = $derived(BADGES[visibilityBadge(link)]);
	const settle: SubmitFunction = () => {
		pending = true;
		return async ({ update }) => {
			await update();
			pending = false;
		};
	};
	const button =
		'inline-flex cursor-pointer items-center rounded border border-gray-300 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-600';
</script>

<tr class="border-t border-gray-200 align-middle dark:border-gray-700" data-structure={link.structureId}>
	<td class="px-3 py-2">
		<span class="block font-semibold text-gray-900 dark:text-gray-100">{link.name}</span>
		<span class="block text-xs text-gray-500 dark:text-gray-400"
			>{link.systemName ?? 'Unknown system'}{link.regionName ? ` · ${link.regionName}` : ''}</span
		>
	</td>
	<td class="px-3 py-2 text-xs" data-status>
		{#if !link.enabled}
			<span class="text-red-600 dark:text-red-400">Disabled</span>
		{:else if link.lastSuccessAt}
			<span class="text-gray-700 dark:text-gray-300" title={formatUtc(link.lastSuccessAt)}
				>Prices {formatRelative(link.lastSuccessAt, now)}</span
			>
		{:else}
			<span class="text-gray-500 dark:text-gray-400">Prices pending</span>
		{/if}
		{#if link.accessStatus === 'denied'}
			<span class="block text-red-600 dark:text-red-400">{link.characterName} lost access</span>
		{/if}
		{#if link.lastError}
			<span class="block max-w-xs truncate text-red-600 dark:text-red-400" title={link.lastError}
				>{link.lastError}</span
			>
		{/if}
	</td>
	<td class="px-3 py-2">
		<span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {badge.class}" data-badge
			>{badge.label}</span
		>
	</td>
	<td class="px-3 py-2">
		<form method="POST" action="?/share" use:enhance={settle} onsubmit={() => (pending = true)}>
			<input type="hidden" name="structureId" value={link.structureId} />
			<input type="hidden" name="share" value={link.shareRequested ? '0' : '1'} />
			<button
				type="submit"
				role="switch"
				aria-checked={link.shareRequested}
				disabled={pending}
				class="group inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700 disabled:cursor-wait disabled:opacity-50 dark:text-gray-300"
			>
				<span
					class="relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors {link.shareRequested
						? 'bg-primary-600'
						: 'bg-gray-300 dark:bg-gray-600'}"
				>
					<span
						class="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all {link.shareRequested
							? 'left-3.5'
							: 'left-0.5'}"
					></span>
				</span>
				Allow everyone to use this market
			</button>
		</form>
	</td>
	<td class="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{link.characterName}</td>
	<td class="px-3 py-2 text-right">
		<form method="POST" action="?/remove" use:enhance={settle} onsubmit={() => (pending = true)}>
			<input type="hidden" name="structureId" value={link.structureId} />
			<button type="submit" disabled={pending} class="{button} text-red-600 dark:text-red-400">Remove</button>
		</form>
	</td>
</tr>
