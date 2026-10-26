<script lang="ts">
	import { untrack } from 'svelte';
	import type { ManualItemChoice } from '#lib/ledger/types.js';

	interface Props {
		choices: ManualItemChoice[];
		/** Visible text (`item` field): what the visitor typed or the picked item's name. */
		text?: string;
		/** Picked type (`typeId` field, hidden); empty while the text does not name a picked item. */
		typeId?: string;
		label?: string;
		/** Suggestions shown at most. */
		limit?: number;
	}

	let { choices, text = '', typeId = '', label = 'Item', limit = 12 }: Props = $props();

	const id = $props.id();
	const listId = `${id}-list`;
	// The page re-creates the field (`{#key}`) when it sends new values.
	let value = $state(untrack(() => text));
	let picked = $state(untrack(() => typeId));
	let open = $state(false);
	let active = $state(-1);

	const GROUP_LABEL: Record<ManualItemChoice['group'], string> = {
		material: 'Reaction material',
		product: 'Reaction product',
		other: 'Other item'
	};

	/** Names containing the typed text, those starting with it first (choices keep their group order). */
	const results = $derived.by(() => {
		const q = value.trim().toLowerCase();
		if (q.length < 2) return [];
		const starts: ManualItemChoice[] = [];
		const contains: ManualItemChoice[] = [];
		for (const c of choices) {
			const name = c.name.toLowerCase();
			if (name.startsWith(q)) starts.push(c);
			else if (name.includes(q)) contains.push(c);
			if (starts.length >= limit) break;
		}
		return [...starts, ...contains].slice(0, limit);
	});

	function oninput() {
		const choice = choices.find((c) => String(c.typeId) === picked);
		if (picked && choice?.name.toLowerCase() !== value.trim().toLowerCase()) picked = '';
		open = value.trim().length >= 2;
		active = 0;
	}

	function choose(choice: ManualItemChoice) {
		value = choice.name;
		picked = String(choice.typeId);
		open = false;
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
			// Picking a suggestion must not submit the form.
			event.preventDefault();
			choose(results[active]);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
		}
	}
</script>

<div class="relative" data-item-combobox>
	<label for={id} class="mb-1 block text-xs text-gray-600 dark:text-gray-400">{label}</label>
	<input type="hidden" name="typeId" value={picked} />
	<input
		{id}
		name="item"
		type="text"
		role="combobox"
		required
		autocomplete="off"
		spellcheck="false"
		placeholder="Item name"
		aria-autocomplete="list"
		aria-expanded={open && results.length > 0}
		aria-controls={listId}
		aria-activedescendant={open && active >= 0 && results.length > 0 ? `${listId}-${active}` : undefined}
		aria-describedby={`${id}-hint`}
		class="block w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
		bind:value
		{oninput}
		{onkeydown}
		onblur={() => (open = false)}
	/>
	{#if open && results.length > 0}
		<ul
			id={listId}
			role="listbox"
			aria-label="Matching items"
			class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
		>
			{#each results as choice, i (choice.typeId)}
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
						choose(choice);
					}}
					onmouseenter={() => (active = i)}
					data-choice={choice.typeId}
				>
					<span class="font-medium">{choice.name}</span>
					<span class="text-xs text-gray-500 dark:text-gray-400">{GROUP_LABEL[choice.group]}</span>
				</li>
			{/each}
		</ul>
	{/if}
	<p id={`${id}-hint`} class="mt-1 text-xs text-gray-500 dark:text-gray-400">
		The exact item name, as in game (any letter case).
	</p>
</div>
