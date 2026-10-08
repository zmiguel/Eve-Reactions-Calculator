<script lang="ts">
	import { Label } from 'flowbite-svelte';
	import { formatPct } from '$lib/format';
	import type { SystemSummary } from '$lib/settings/fields';

	interface Props {
		/** Field-name prefix of the profile: posts `<prefix>.systemId` (hidden) and `<prefix>.system` (text). */
		prefix: string;
		/** Chosen system; `null` while the text does not name a picked system. */
		selected: SystemSummary | null;
		/** Visible text (the system name, or what the visitor typed). */
		text: string;
		error?: string;
		/** Delay before querying `/api/v2/systems` after typing. */
		debounceMs?: number;
	}

	let { prefix, selected = $bindable(), text = $bindable(), error, debounceMs = 250 }: Props = $props();

	const id = $props.id();
	const listId = `${id}-list`;
	let results = $state<SystemSummary[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let status = $state<'idle' | 'loading' | 'empty' | 'error'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	async function search(q: string) {
		controller?.abort();
		controller = new AbortController();
		status = 'loading';
		try {
			const response = await fetch(`/api/v2/systems?q=${encodeURIComponent(q)}&limit=10`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			results = (await response.json()) as SystemSummary[];
			status = results.length === 0 ? 'empty' : 'idle';
			active = results.length > 0 ? 0 : -1;
			open = true;
		} catch (e) {
			if ((e as Error).name === 'AbortError') return;
			results = [];
			status = 'error';
			open = true;
		}
	}

	function oninput() {
		if (selected && text.trim().toLowerCase() !== selected.name.toLowerCase()) selected = null;
		clearTimeout(timer);
		const q = text.trim();
		if (q.length < 2) {
			controller?.abort();
			results = [];
			open = false;
			status = 'idle';
			return;
		}
		timer = setTimeout(() => search(q), debounceMs);
	}

	function choose(system: SystemSummary) {
		selected = system;
		text = system.name;
		open = false;
		results = [];
		active = -1;
	}

	function onkeydown(event: KeyboardEvent) {
		if (!open || results.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % results.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active - 1 + results.length) % results.length;
		} else if (event.key === 'Enter' && active >= 0) {
			// Picking a suggestion must not submit the settings form.
			event.preventDefault();
			choose(results[active]);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
		}
	}

	const BAND_CLASS: Record<string, string> = {
		lowsec: 'text-yellow-700 dark:text-yellow-400',
		nullsec: 'text-red-700 dark:text-red-400',
		wormhole: 'text-violet-700 dark:text-violet-400',
		highsec: 'text-green-700 dark:text-green-400'
	};
</script>

<div class="relative">
	<Label for={id} class="mb-1 block text-sm font-medium text-gray-900 dark:text-white">System</Label>
	<input type="hidden" name={`${prefix}.systemId`} value={selected?.id ?? ''} />
	<input
		{id}
		name={`${prefix}.system`}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		placeholder="Type at least 2 letters"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
		aria-invalid={error ? true : undefined}
		aria-describedby={`${id}-hint`}
		class={[
			'block w-full rounded-md border bg-gray-50 p-2 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-400',
			error ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
		]}
		bind:value={text}
		{oninput}
		{onkeydown}
		onblur={() => (open = false)}
	/>
	{#if open}
		<ul
			id={listId}
			role="listbox"
			aria-label="Matching systems"
			class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
		>
			{#each results as system, i (system.id)}
				<li
					id={`${listId}-${i}`}
					role="option"
					aria-selected={i === active}
					class={[
						'flex cursor-pointer items-baseline justify-between gap-2 px-3 py-1.5',
						i === active
							? 'bg-primary-100 text-primary-900 dark:bg-primary-900 dark:text-white'
							: 'text-gray-800 dark:text-gray-200'
					]}
					onmousedown={(event) => {
						event.preventDefault();
						choose(system);
					}}
					onmouseenter={() => (active = i)}
				>
					<span class="font-medium">{system.name}</span>
					<span class="text-xs text-gray-500 dark:text-gray-400">
						{system.regionName ?? ''} ·
						<span class={BAND_CLASS[system.securityBand]}>{system.securityBand}</span>
					</span>
				</li>
			{:else}
				<li class="px-3 py-1.5 text-gray-500 dark:text-gray-400">
					{status === 'error' ? 'Search failed, type the exact name instead' : 'No reaction system found'}
				</li>
			{/each}
		</ul>
	{/if}
	<p id={`${id}-hint`} class="mt-1 text-xs text-gray-500 dark:text-gray-400">
		{#if error}
			<span class="text-red-600 dark:text-red-400">{error}</span>
		{:else if selected}
			{selected.regionName ?? 'Unknown region'} ·
			<span class={BAND_CLASS[selected.securityBand]}>{selected.securityBand}</span> · cost index
			{selected.reactionCostIndex === null ? 'unknown' : formatPct(selected.reactionCostIndex * 100, 2)}
		{:else}
			Lowsec, nullsec or J-space system name
		{/if}
	</p>
</div>
