<script lang="ts">
	import { tick } from 'svelte';
	import { FILL_SCOPES, FILL_SCOPE_IDS, type FillScope } from '$lib/planner/plan';

	interface Props {
		scope: FillScope;
		disabled?: boolean;
		onfill: () => void;
	}

	let { scope = $bindable(), disabled = false, onfill }: Props = $props();

	const menuId = $props.id();
	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let toggle: HTMLButtonElement | undefined = $state();
	const items: HTMLButtonElement[] = $state([]);

	async function openMenu(focus: 'checked' | 'first' | 'last' = 'checked') {
		open = true;
		await tick();
		const index =
			focus === 'first'
				? 0
				: focus === 'last'
					? items.length - 1
					: Math.max(0, FILL_SCOPE_IDS.indexOf(scope));
		items[index]?.focus();
	}

	function close(refocus = true) {
		open = false;
		if (refocus) toggle?.focus();
	}

	function choose(id: FillScope) {
		scope = id;
		close();
	}

	function onMenuKey(event: KeyboardEvent) {
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		const move = (to: number) => {
			event.preventDefault();
			items[(to + items.length) % items.length]?.focus();
		};
		if (event.key === 'ArrowDown') move(current + 1);
		else if (event.key === 'ArrowUp') move(current - 1);
		else if (event.key === 'Home') move(0);
		else if (event.key === 'End') move(items.length - 1);
		else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		} else if (event.key === 'Tab') close(false);
	}

	function onToggleKey(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
		}
	}
</script>

<svelte:window
	onpointerdown={(e) => {
		if (open && root && !root.contains(e.target as Node)) close(false);
	}}
/>

<div class="relative inline-flex" bind:this={root} data-autofill>
	<button
		type="button"
		class="bg-primary-600 hover:bg-primary-700 rounded-l-md px-2.5 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
		{disabled}
		title="Add lines of the most profitable reactions ({FILL_SCOPES[scope].label}) until no more fit"
		onclick={onfill}
		data-rybbit-event="planner_autofill"
		data-rybbit-prop-scope={scope}
	>
		Auto-fill best
	</button>
	<button
		type="button"
		bind:this={toggle}
		class="bg-primary-600 hover:bg-primary-700 border-primary-500 inline-flex max-w-[12rem] items-center gap-1 rounded-r-md border-l px-2 py-1 text-xs font-medium text-white"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? menuId : undefined}
		aria-label="Auto-fill picks: {FILL_SCOPES[scope].label}"
		onclick={() => (open ? close(false) : openMenu())}
		onkeydown={onToggleKey}
	>
		<span class="truncate">{FILL_SCOPES[scope].label}</span>
		<svg viewBox="0 0 20 20" class="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
			<path
				d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
			/>
		</svg>
	</button>
	{#if open}
		<div
			id={menuId}
			role="menu"
			tabindex="-1"
			aria-label="Auto-fill picks"
			class="absolute top-full left-0 z-20 mt-1 w-64 rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-800"
			onkeydown={onMenuKey}
		>
			{#each FILL_SCOPE_IDS as id, i (id)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={id === scope}
					tabindex="-1"
					bind:this={items[i]}
					class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-gray-700 dark:focus:bg-gray-700"
					onclick={() => choose(id)}
				>
					<span class="w-3 text-primary-600 dark:text-primary-400" aria-hidden="true"
						>{id === scope ? '✓' : ''}</span
					>
					{FILL_SCOPES[id].label}
				</button>
			{/each}
		</div>
	{/if}
</div>
