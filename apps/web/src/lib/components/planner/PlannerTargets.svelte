<script lang="ts">
	import { REACTORS, type PlanTarget, type Reaction, type Reactor } from '@reactions/engine';
	import type { Snippet } from 'svelte';
	import { formatNumber } from '$lib/format';
	import { parseQuantity } from '$lib/planner/parsePaste';
	import type { TargetFootprint } from '$lib/planner/plan';
	import { MAX_LINES, MAX_QUANTITY } from '$lib/planner/state';
	import { REACTOR_LABEL, REACTOR_TIERS } from '$lib/site';
	import OrderHelper from './OrderHelper.svelte';

	type ReactionOption = Pick<Reaction, 'blueprintTypeId' | 'name' | 'reactor' | 'tier'>;

	interface Props {
		targets: PlanTarget[];
		reactions: ReactionOption[];
		/** Slots a target needs on its own. */
		footprint?: (target: PlanTarget) => TargetFootprint;
		/** Extra controls next to "Add target". */
		actions?: Snippet;
	}

	let { targets = $bindable(), reactions, footprint, actions }: Props = $props();

	const groups = $derived(
		Object.fromEntries(
			REACTORS.map((reactor) => [
				reactor,
				REACTOR_TIERS[reactor]
					.map(({ tier, title }) => ({
						title,
						options: reactions
							.filter((r) => r.reactor === reactor && r.tier === tier)
							.sort((a, b) => a.name.localeCompare(b.name))
					}))
					.filter((g) => g.options.length > 0)
			])
		) as Record<Reactor, { title: string; options: ReactionOption[] }[]>
	);
	const byId = $derived(new Map(reactions.map((r) => [r.blueprintTypeId, r])));
	const reactorOrder: Reactor[] = ['composite', 'biochemical', 'hybrid'];

	const firstOf = (reactor: Reactor) => groups[reactor][0]?.options[0]?.blueprintTypeId;

	function update(index: number, patch: Partial<PlanTarget>) {
		targets = targets.map((t, i) => (i === index ? { ...t, ...patch } : t));
	}

	function add() {
		const id = firstOf('composite') ?? reactions[0]?.blueprintTypeId;
		if (id !== undefined) targets = [...targets, { blueprintTypeId: id, lines: 1 }];
	}

	function setLines(index: number, input: HTMLInputElement) {
		const lines = Math.min(MAX_LINES, Math.max(1, Math.floor(input.valueAsNumber) || 1));
		update(index, { lines });
		input.value = String(lines);
	}

	function setQuantity(index: number, input: HTMLInputElement) {
		const parsed = parseQuantity(input.value);
		const quantity = parsed && parsed > 0 ? Math.min(MAX_QUANTITY, parsed) : targets[index].quantity;
		update(index, { quantity });
		input.value = formatNumber(quantity);
	}

	/** Quantity mode starts from what the current lines make per cycle. */
	function toQuantity(index: number) {
		const t = targets[index];
		const perLine = footprint?.(t).unitsPerLine ?? 0;
		update(index, { quantity: Math.max(1, perLine * t.lines) });
	}

	const field =
		'h-8 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-900 tabular-nums focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';
	const button =
		'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const segment = (active: boolean) =>
		active
			? 'bg-primary-600 text-white'
			: 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<div class="space-y-2" data-targets>
	{#if targets.length > 0}
		<ul class="space-y-1.5" aria-label="Targets">
			{#each targets as target, i (i)}
				{@const reaction = byId.get(target.blueprintTypeId)}
				{@const reactor = reaction?.reactor ?? 'composite'}
				{@const size = footprint?.(target)}
				{@const byQuantity = target.quantity !== undefined}
				<li
					class="space-y-1 rounded-md border border-gray-200 p-1.5 dark:border-gray-600"
					data-target-row={i}
				>
					<div class="flex items-center gap-1">
						<select
							class="{field} w-[6.5rem] shrink-0 pr-7"
							aria-label="Reactor of target {i + 1}"
							value={reactor}
							onchange={(e) => {
								const id = firstOf(e.currentTarget.value as Reactor);
								if (id !== undefined) update(i, { blueprintTypeId: id });
							}}
						>
							{#each reactorOrder as r (r)}
								<option value={r}>{REACTOR_LABEL[r]}</option>
							{/each}
						</select>
						<select
							class="{field} min-w-0 flex-1 pr-7"
							aria-label="Product of target {i + 1}"
							value={target.blueprintTypeId}
							onchange={(e) => update(i, { blueprintTypeId: Number(e.currentTarget.value) })}
						>
							{#each groups[reactor] as group (group.title)}
								<optgroup label={group.title}>
									{#each group.options as option (option.blueprintTypeId)}
										<option value={option.blueprintTypeId}>{option.name}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<button
							type="button"
							class="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-red-400"
							aria-label="Remove {reaction?.name ?? 'target'}"
							title="Remove"
							onclick={() => (targets = targets.filter((_, j) => j !== i))}
						>
							<svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor" aria-hidden="true">
								<path
									d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
								/>
							</svg>
						</button>
					</div>
					<div class="flex flex-wrap items-center gap-1.5">
						<span
							class="inline-flex shrink-0 overflow-hidden rounded-md border border-gray-200 text-xs font-medium dark:border-gray-600"
							role="group"
							aria-label="Amount of target {i + 1}"
						>
							<button
								type="button"
								class="px-2 py-1 {segment(!byQuantity)}"
								aria-pressed={!byQuantity}
								onclick={() => update(i, { quantity: undefined })}>Lines</button
							>
							<button
								type="button"
								class="border-l border-gray-200 px-2 py-1 dark:border-gray-600 {segment(byQuantity)}"
								aria-pressed={byQuantity}
								title="Units per cycle"
								onclick={() => !byQuantity && toQuantity(i)}>Qty / cycle</button
							>
						</span>
						{#if byQuantity}
							<input
								type="text"
								inputmode="numeric"
								class="{field} w-32"
								aria-label="Quantity per cycle of target {i + 1}"
								value={formatNumber(target.quantity)}
								onchange={(e) => setQuantity(i, e.currentTarget)}
							/>
						{:else}
							<input
								type="number"
								min="1"
								max={MAX_LINES}
								step="1"
								class="{field} w-16"
								aria-label="Lines of target {i + 1}"
								value={target.lines}
								onchange={(e) => setLines(i, e.currentTarget)}
							/>
						{/if}
						{#if size}
							<span
								class="ms-auto text-xs whitespace-nowrap text-gray-600 tabular-nums dark:text-gray-300"
								title="Slots this target needs on its own, intermediates included"
								data-field="slots"
							>
								<span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{size.total}</span>
								{size.total === 1 ? 'slot' : 'slots'}{byQuantity
									? ` · ${size.finalSlots} final`
									: target.lines > 1
										? ` · ${size.perLine}/line`
										: ''}
							</span>
						{/if}
					</div>
					{#if byQuantity}
						<OrderHelper label="target {i + 1}" onapply={(quantity) => update(i, { quantity })} />
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-gray-500 dark:text-gray-400">
			No targets yet: add the products you want to sell, or let auto-fill pick the most profitable ones.
		</p>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<button type="button" class={button} onclick={add}>+ Add target</button>
		{@render actions?.()}
	</div>
</div>
