<script lang="ts">
	import type { Reactor } from '@reactions/engine';
	import { DEFAULT_TABS, type DefaultTabs } from './links';
	import ReactionTable from './ReactionTable.svelte';
	import TabBar from './TabBar.svelte';
	import type { TierSectionData, Variant } from './types';

	interface Props {
		section: TierSectionData;
		reactor: Reactor;
		/**
		 * The visitor's preferred tabs: a section opens on Using unrefined (when the setting builds chains
		 * with unrefined routes), Full chain or Reprocess when it has that tab.
		 */
		defaults?: DefaultTabs;
	}

	let { section, reactor, defaults = DEFAULT_TABS }: Props = $props();

	const panelId = $props.id();
	let chosen = $state<Variant | null>(null);
	const has = (variant: Variant) => section.tabs.some((t) => t.variant === variant);
	const preferred = $derived<Variant>(
		defaults.unrefined && has('unrefined')
			? 'unrefined'
			: defaults.view === 'chain' && has('chain')
				? 'chain'
				: defaults.output === 'reprocessed'
					? 'reprocessed'
					: 'single'
	);
	const active = $derived(
		section.tabs.find((t) => t.variant === (chosen ?? preferred))?.variant ??
			section.tabs[0]?.variant ??
			'single'
	);

	const tabs = $derived(
		section.tabs.map((t) => ({
			id: t.variant,
			label: t.label,
			count: section.rows.filter((r) => r[t.variant] !== null).length
		}))
	);
</script>

<section id={section.tier} class="mt-5 scroll-mt-16" aria-labelledby={`${panelId}-title`}>
	<h2
		id={`${panelId}-title`}
		class="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-800 sm:text-xl dark:text-gray-200"
	>
		{section.title}
		<span
			class="rounded-sm bg-primary-100 px-1.5 py-0.5 text-xs leading-none font-semibold text-primary-800 tabular-nums dark:bg-primary-900 dark:text-primary-300"
			>{section.rows.length}<span class="sr-only">&nbsp;reactions</span></span
		>
	</h2>
	{#if section.tabs.length > 1}
		<div class="mb-3">
			<TabBar
				{tabs}
				{active}
				label={`${section.title} view`}
				controls={panelId}
				onselect={(variant) => (chosen = variant)}
			/>
		</div>
	{/if}
	<div id={panelId} role={section.tabs.length > 1 ? 'tabpanel' : undefined}>
		<ReactionTable rows={section.rows} variant={active} {reactor} {defaults} caption={section.title} />
	</div>
</section>
