<script lang="ts" generics="T extends string">
	interface Props {
		/** `count` adds a small badge after the label (not part of the tab's accessible name). */
		tabs: { id: T; label: string; count?: number }[];
		active: T;
		/** Accessible name of the tab list. */
		label: string;
		/** Id of the panel the tabs control. */
		controls: string;
		onselect: (id: T) => void;
	}

	let { tabs, active, label, controls, onselect }: Props = $props();
</script>

<div
	role="tablist"
	aria-label={label}
	class="flex flex-wrap border-b border-gray-200 text-sm font-medium dark:border-gray-700"
>
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			role="tab"
			aria-selected={active === tab.id}
			aria-controls={controls}
			class={[
				'-mb-px inline-flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 leading-tight',
				active === tab.id
					? 'border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-500'
					: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'
			]}
			onclick={() => onselect(tab.id)}
		>
			{tab.label}
			{#if tab.count !== undefined}
				<span
					aria-hidden="true"
					class="rounded-sm bg-primary-100 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-primary-800 tabular-nums dark:bg-primary-900 dark:text-primary-300"
					>{tab.count}</span
				>
			{/if}
		</button>
	{/each}
</div>
