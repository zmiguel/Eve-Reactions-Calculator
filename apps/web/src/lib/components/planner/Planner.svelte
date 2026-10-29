<script lang="ts">
	import {
		STOCK_PLAN_DEFAULT_MAX_CYCLES,
		STOCK_PLAN_MAX_CYCLES,
		isFuelBlock,
		planReactions,
		suggestFillPlan,
		type PlanInput,
		type StockPlan,
		type StockPlanInput
	} from '@reactions/engine';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SettingsSummary from '#lib/components/listing/SettingsSummary.svelte';
	import InfoNote from '#lib/components/InfoNote.svelte';
	import { formatNumber } from '#lib/format.js';
	import { formulaNameIndex, parsePaste, typeNameIndex } from '#lib/planner/parsePaste.js';
	import {
		buildBuyItems,
		dailyVolumes,
		fillOptions,
		hubDailyVolumes,
		inputMarket,
		inputVolumes,
		plannerContext,
		productVolumes,
		targetFootprint,
		type PlannerData
	} from '#lib/planner/plan.js';
	import { reactionSlots, MAX_SKILL_LEVEL } from '#lib/planner/slots.js';
	import {
		DEFAULT_STOCK_SEARCH_SECONDS,
		MAX_STOCK_SEARCH_SECONDS,
		MIN_STOCK_SEARCH_SECONDS,
		MAX_SLOTS,
		decodeShare,
		emptyState,
		encodeShare,
		loadState,
		saveState,
		type PlannerState
	} from '#lib/planner/state.js';
	import { planOnThread, workerStockPlanner, type StockPlanner } from '#lib/planner/stockPlanner.js';
	import AutoFillButton from './AutoFillButton.svelte';
	import PlannerPaste from './PlannerPaste.svelte';
	import PlannerInventory from './PlannerInventory.svelte';
	import PlannerResults from './PlannerResults.svelte';
	import StockPlanResults from './StockPlanResults.svelte';
	import PlannerTargets from './PlannerTargets.svelte';

	interface Props {
		data: PlannerData;
		/** `?s=` share code to open instead of the stored plan. */
		share?: string | null;
		/** Persistence (default `localStorage`); test seam. */
		storage?: Pick<Storage, 'getItem' | 'setItem'>;
		/** Runs "Use what I have" plans (default: a Web Worker, else this thread); test seam. */
		planStock?: StockPlanner;
	}

	let { data, share = null, storage, planStock }: Props = $props();

	let setup = $state<PlannerState>(emptyState());
	let ready = $state(false);
	let shareInvalid = $state(false);
	/** JSON of the last stored (or opened) state; edits that change it are saved. */
	let lastSaved: string | null = null;
	/** Opened from a share link: localStorage is left alone (and `?s=` kept) until the first edit. */
	let fromShare = $state(false);
	/** The opened share link's plan replaces a different, non-empty stored plan on the first edit. */
	let replacesSaved = $state(false);
	let store: Pick<Storage, 'getItem' | 'setItem'> | undefined;

	onMount(() => {
		try {
			store = storage ?? window.localStorage;
		} catch {
			store = undefined; // storage disabled (privacy mode)
		}
		let cancelled = false;
		(async () => {
			const shared = share ? await decodeShare(share) : null;
			if (cancelled) return;
			shareInvalid = share !== null && shared === null;
			fromShare = shared !== null;
			const saved = loadState(store);
			const savedJson = JSON.stringify(saved);
			replacesSaved =
				shared !== null &&
				savedJson !== JSON.stringify(emptyState()) &&
				savedJson !== JSON.stringify(shared.state);
			setup = shared?.state ?? saved;
			lastSaved = JSON.stringify(setup);
			ready = true;
		})();
		return () => (cancelled = true);
	});

	$effect(() => {
		const json = JSON.stringify(setup);
		if (!ready || json === lastSaved) return;
		lastSaved = json;
		saveState(store, setup);
		if (fromShare) {
			fromShare = false;
			const url = new URL(page.url.href);
			url.searchParams.delete('s');
			void goto(url, { shallow: true, replace: true, state: page.state });
		}
	});

	const cycleDays = $derived(setup.cycleDays ?? data.settings.cycleDays);
	const ctx = $derived(plannerContext(data, cycleDays));
	const typeIndex = $derived(typeNameIndex(data.dataset));
	const formulaIndex = $derived(formulaNameIndex(data.dataset));
	const stock = $derived(parsePaste(setup.stockText, typeIndex));
	const owned = $derived(parsePaste(setup.formulasText, formulaIndex));
	// No choice stored: the account's inventory when there is one. A plan set to the inventory opened
	// without one (a share link, another browser) falls back to the pasted lists.
	const stockSource = $derived(setup.stockSource ?? (data.inventory ? 'account' : 'paste'));
	const inventory = $derived(stockSource === 'account' ? data.inventory : null);
	const inventoryMissing = $derived(stockSource === 'account' && !data.inventory);
	const volumes = $derived(productVolumes(data));
	const purchaseVolumes = $derived(inputVolumes(data));
	const input: PlanInput = $derived({
		ctx,
		totalSlots: setup.slots,
		targets: setup.targets,
		buyInsteadOfBuild: setup.buy,
		stock: inventory ? inventory.stock : stock.quantities,
		ownedFormulas: inventory ? inventory.formulas : owned.quantities,
		dailyVolumes: dailyVolumes(volumes),
		inputDailyVolumes: hubDailyVolumes(data)
	});
	const plan = $derived(planReactions({ ...input, horizonCycles: setup.shoppingCycles }));
	/** The plan holds stock of a type it buys or makes: the shopping list may subtract it or not. */
	const hasStock = $derived(
		plan.reactions.some((r) =>
			[r.product, ...r.materials].some((item) => (input.stock[item.typeId] ?? 0) > 0)
		)
	);
	const useStock = $derived(setup.shoppingUseStock ?? true);
	// The same cycles planned without the stock; computed only while the toggle is off.
	const shoppingPlan = $derived(
		hasStock && !useStock ? planReactions({ ...input, stock: {}, horizonCycles: plan.horizon.cycles }) : plan
	);
	const buildBuy = $derived(buildBuyItems(plan, setup.buy, data.dataset));
	const formulaNames = $derived(
		Object.fromEntries(data.dataset.reactions.map((r) => [r.blueprintTypeId, r.formulaName]))
	);
	const missing = $derived(plan.missingPrices.map((id) => data.dataset.types[id]?.name ?? `Type ${id}`));
	const mode = $derived(setup.mode ?? 'targets');
	const stockSearchSeconds = $derived(setup.stockSearchSeconds ?? DEFAULT_STOCK_SEARCH_SECONDS);
	const stockInput: StockPlanInput | null = $derived(
		mode === 'stock'
			? {
					ctx,
					totalSlots: setup.slots,
					stock: inventory ? inventory.stock : stock.quantities,
					ownedFormulas: inventory ? inventory.formulas : owned.quantities,
					maxCycles: setup.stockCycles,
					allowUnownedFormulas: setup.allowUnownedFormulas ?? false,
					// Past it, the best plan found so far is the result (not proven optimal).
					timeLimitMs: stockSearchSeconds * 1000
				}
			: null
	);

	// "Use what I have" plans in a Web Worker (the search runs for seconds); without one (server render,
	// tests) on this thread.
	let stockPlanner: StockPlanner = planOnThread;
	onMount(() => {
		if (planStock) {
			stockPlanner = planStock;
			return;
		}
		if (typeof Worker === 'undefined') return;
		const worker = workerStockPlanner();
		stockPlanner = worker.plan;
		return worker.dispose;
	});
	/** Plan shown: the latest run's best so far or result, else the previous run's (dimmed). */
	let stockPlan = $state<StockPlan | null>(null);
	/** A run is pending or searching. */
	let planning = $state(false);
	/** `stockPlan` belongs to the run in progress (a plan found so far). */
	let incumbentShown = $state(false);
	let stockFailed = $state(false);
	/** Input changes wait this long before planning, so typing does not start a run per keystroke. */
	const STOCK_DEBOUNCE_MS = 250;
	$effect(() => {
		// Plain data (no state proxies), so it clones into the worker as is.
		const input = ready ? stockInput : null;
		if (!input) {
			planning = false;
			return;
		}
		planning = true;
		incumbentShown = false;
		// Only the latest request counts: a change aborts the run in flight (terminating its worker).
		const controller = new AbortController();
		const timer = setTimeout(
			() =>
				stockPlanner(input, controller.signal, (incumbent) => {
					if (controller.signal.aborted) return;
					stockPlan = incumbent;
					incumbentShown = true;
				}).then(
					(result) => {
						if (controller.signal.aborted) return;
						stockPlan = result;
						stockFailed = false;
						planning = false;
					},
					() => {
						if (controller.signal.aborted) return;
						stockFailed = true;
						planning = false;
					}
				),
			untrack(() => stockPlan) ? STOCK_DEBOUNCE_MS : 0
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	const stockJobs = $derived(stockPlan?.cycles.some((c) => c.jobs.length > 0) ?? false);
	/** Cycles slider position: the chosen count, else the engine's default for this stock (the last plan's). */
	const stockCyclesShown = $derived(
		setup.stockCycles ?? stockPlan?.maxCycles ?? STOCK_PLAN_DEFAULT_MAX_CYCLES
	);

	const fuelTypeIds = $derived(
		new Set(
			Object.values(data.dataset.types)
				.filter((t) => isFuelBlock(data.dataset, t.typeId))
				.map((t) => t.typeId)
		)
	);

	// Slot calculator (local only).
	let characters = $state(1);
	let massReactions = $state(MAX_SKILL_LEVEL);
	let advancedMassReactions = $state(MAX_SKILL_LEVEL);
	const helperSlots = $derived(reactionSlots(characters, massReactions, advancedMassReactions));

	/** Utilisation counted as full: no slot time left for auto-fill to top up (float tolerance). */
	const FULL_UTILISATION = 1 - 1e-9;

	function autoFill() {
		const fill = suggestFillPlan(input, fillOptions(setup.fillScope, setup.maxVolumePct));
		setup.targets = fill.targets;
		setup.buy = fill.buyInsteadOfBuild;
	}

	function setMaxVolume(el: HTMLInputElement) {
		const n = el.valueAsNumber;
		if (Number.isFinite(n)) setup.maxVolumePct = Math.min(100, Math.max(1, n));
		el.value = String(setup.maxVolumePct);
	}

	// Paste examples in EVE's inventory copy format (attribute strings cannot hold a tab).
	const STOCK_EXAMPLE = 'Carbon Polymers\t12,345';
	const FORMULAS_EXAMPLE = 'Carbon Polymers Reaction Formula\t2';

	function setSlots(el: HTMLInputElement) {
		const n = el.valueAsNumber;
		setup.slots = Number.isFinite(n) ? Math.min(MAX_SLOTS, Math.max(0, Math.floor(n))) : setup.slots;
		el.value = String(setup.slots);
	}

	function setCycleDays(el: HTMLInputElement) {
		const n = el.valueAsNumber;
		const days = Number.isFinite(n) ? Math.min(30, Math.max(0.25, n)) : null;
		setup.cycleDays = days === null || days === data.settings.cycleDays ? null : days;
		el.value = String(setup.cycleDays ?? data.settings.cycleDays);
	}

	function toggleBuy(typeId: number, buy: boolean) {
		setup.buy = buy ? [...new Set([...setup.buy, typeId])] : setup.buy.filter((id) => id !== typeId);
	}

	let shareStatus = $state<'idle' | 'copied' | 'failed'>('idle');
	let shareUrl = $state('');
	// Encoded ahead of the click: browsers allow clipboard writes only within the user's gesture.
	// The link carries the settings this plan is computed with, so the recipient sees the same numbers.
	$effect(() => {
		const json = JSON.stringify(setup); // reads (and tracks) every field
		const settings = data.settings;
		// The source in use (not the inventory itself), so a recipient without one sees the fallback note.
		const source = stockSource;
		if (!ready) return;
		let stale = false;
		const shared: PlannerState = JSON.parse(json);
		if (source === 'account') shared.stockSource = source;
		encodeShare(shared, settings).then((code) => {
			if (!stale) shareUrl = `${window.location.origin}/planner?s=${code}`;
		});
		return () => (stale = true);
	});

	/** The current URL with `?s=` set to `code`, or removed (the stored plan opens). */
	function withShare(code: string | null): string {
		const url = new URL(page.url.href);
		if (code === null) url.searchParams.delete('s');
		else url.searchParams.set('s', code);
		return url.pathname + url.search;
	}
	// Until the first edit the shared plan is not stored, so the visitor's settings need the plan in the
	// link; afterwards the stored plan is that plan.
	const ownSettingsHref = $derived(
		data.sharedSettings && withShare(!ready || fromShare ? data.sharedSettings.planCode : null)
	);

	async function copyShare() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			shareStatus = 'copied';
		} catch {
			shareStatus = 'failed';
		}
	}
	$effect(() => {
		if (shareStatus !== 'copied') return;
		const timer = setTimeout(() => (shareStatus = 'idle'), 2500);
		return () => clearTimeout(timer);
	});

	const inputsAsOf = $derived(data.inputPrices ?? data.prices);
	const stamp = (iso: string) => (iso.length > 10 ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : iso);

	const caption = 'text-xs font-semibold tracking-wide text-gray-600 uppercase dark:text-gray-300';
	const label = `mb-1 block ${caption}`;
	const fieldBase =
		'rounded-md border border-gray-300 bg-gray-50 text-gray-900 tabular-nums focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';
	const field = `${fieldBase} h-8 px-2 py-1 text-sm`;
	const fieldSm = `${fieldBase} h-7 px-1.5 py-0.5 text-xs`;
	const button =
		'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const segment = (active: boolean) =>
		active
			? 'bg-primary-600 text-white'
			: 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
</script>

<div class="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[28rem_minmax(0,1fr)]">
	<section
		class="space-y-3 rounded-lg bg-white p-3 text-sm lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto dark:bg-gray-700"
		aria-label="Plan inputs"
	>
		<span
			class="flex overflow-hidden rounded-md border border-gray-200 text-sm font-medium dark:border-gray-600"
			role="group"
			aria-label="Planner mode"
		>
			<button
				type="button"
				class="flex-1 px-2 py-1 {segment(mode === 'targets')}"
				aria-pressed={mode === 'targets'}
				onclick={() => (setup.mode = 'targets')}>Plan targets</button
			>
			<button
				type="button"
				class="flex-1 border-l border-gray-200 px-2 py-1 dark:border-gray-600 {segment(mode === 'stock')}"
				aria-pressed={mode === 'stock'}
				onclick={() => (setup.mode = 'stock')}>Use what I have</button
			>
		</span>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="planner-slots" class={label}>Slots</label>
				<input
					id="planner-slots"
					type="number"
					min="0"
					max={MAX_SLOTS}
					step="1"
					class="{field} w-full"
					value={setup.slots}
					onchange={(e) => setSlots(e.currentTarget)}
				/>
			</div>
			<div>
				<label for="planner-cycle" class={label}>Cycle days</label>
				<input
					id="planner-cycle"
					type="number"
					min="0.25"
					max="30"
					step="any"
					class="{field} w-full"
					value={cycleDays}
					onchange={(e) => setCycleDays(e.currentTarget)}
				/>
			</div>
		</div>

		<fieldset class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
			<legend class="sr-only">Slot calculator</legend>
			<input
				type="number"
				min="0"
				step="1"
				class="{fieldSm} w-12"
				aria-label="Characters"
				bind:value={characters}
			/>
			<span>chars × (1 +</span>
			<input
				type="number"
				min="0"
				max={MAX_SKILL_LEVEL}
				step="1"
				class="{fieldSm} w-10"
				aria-label="Mass Reactions level"
				title="Mass Reactions level"
				bind:value={massReactions}
			/>
			<abbr title="Mass Reactions" class="no-underline">MR</abbr>
			<span>+</span>
			<input
				type="number"
				min="0"
				max={MAX_SKILL_LEVEL}
				step="1"
				class="{fieldSm} w-10"
				aria-label="Advanced Mass Reactions level"
				title="Advanced Mass Reactions level"
				bind:value={advancedMassReactions}
			/>
			<abbr title="Advanced Mass Reactions" class="no-underline">AMR</abbr>
			<span>) =</span>
			<button
				type="button"
				class="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
				title="Use as total slots"
				onclick={() => (setup.slots = Math.min(MAX_SLOTS, helperSlots))}>Use {helperSlots}</button
			>
		</fieldset>

		{#if mode === 'stock'}
			<div class="space-y-2" data-stock-options>
				<div class="space-y-1">
					<div class="flex items-center justify-between gap-2">
						<label for="planner-stock-cycles" class={caption}>Cycles</label>
						<span class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
							<output
								for="planner-stock-cycles"
								class="font-medium text-gray-900 tabular-nums dark:text-gray-100">{stockCyclesShown}</output
							>
							{#if setup.stockCycles === undefined}
								<span>(default)</span>
							{:else}
								<button
									type="button"
									class="text-primary-700 dark:text-primary-400 hover:underline"
									onclick={() => (setup.stockCycles = undefined)}>Use default</button
								>
							{/if}
						</span>
					</div>
					<input
						id="planner-stock-cycles"
						type="range"
						min="1"
						max={STOCK_PLAN_MAX_CYCLES}
						step="1"
						value={stockCyclesShown}
						oninput={(e) => (setup.stockCycles = Number(e.currentTarget.value))}
						class="accent-primary-600 w-full"
					/>
				</div>
				<p class="-mt-1 text-xs text-gray-500 dark:text-gray-400">
					One cycle is one round of reaction jobs of your cycle length; later cycles can use what earlier ones
					made.
				</p>
				<div class="space-y-1">
					<div class="flex items-center justify-between gap-2">
						<label for="planner-stock-search" class={caption}>Search time</label>
						<output
							for="planner-stock-search"
							class="text-xs font-medium text-gray-900 tabular-nums dark:text-gray-100"
							>{stockSearchSeconds} s</output
						>
					</div>
					<input
						id="planner-stock-search"
						type="range"
						min={MIN_STOCK_SEARCH_SECONDS}
						max={MAX_STOCK_SEARCH_SECONDS}
						step="5"
						value={stockSearchSeconds}
						oninput={(e) => (setup.stockSearchSeconds = Number(e.currentTarget.value))}
						class="accent-primary-600 w-full"
					/>
				</div>
				<p class="-mt-1 text-xs text-gray-500 dark:text-gray-400">
					Runs in your browser; the best plan found so far is shown while it searches.
				</p>
				<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
					<input
						type="checkbox"
						class="text-primary-600 focus:ring-primary-500 h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
						checked={setup.allowUnownedFormulas ?? false}
						onchange={(e) => (setup.allowUnownedFormulas = e.currentTarget.checked)}
					/>
					Allow formulas I don't own
				</label>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					Puts your stock to use over the chosen cycles; only fuel blocks are bought{setup.allowUnownedFormulas
						? ', plus the formulas the plan needs'
						: ', and reactions need an owned formula'}.
				</p>
			</div>
		{:else}
			<div>
				<h2 class={label}>Targets</h2>
				<PlannerTargets
					bind:targets={setup.targets}
					reactions={data.dataset.reactions}
					footprint={(t) => targetFootprint(input, t)}
				>
					{#snippet actions()}
						<AutoFillButton
							bind:scope={setup.fillScope}
							disabled={plan.slotsRemaining === 0 &&
								plan.utilisation >= FULL_UTILISATION &&
								!setup.targets.some((t) => t.auto)}
							onfill={autoFill}
						/>
					{/snippet}
				</PlannerTargets>
				<div
					class="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300"
				>
					<label for="planner-max-volume">Auto-fill: max share of daily volume</label>
					<input
						id="planner-max-volume"
						aria-describedby="planner-max-volume-hint"
						type="number"
						min="1"
						max="100"
						step="any"
						class="{fieldSm} w-14"
						value={setup.maxVolumePct}
						onchange={(e) => setMaxVolume(e.currentTarget)}
					/>
					<span>%</span>
					<span class="basis-full text-gray-500 dark:text-gray-400" id="planner-max-volume-hint">
						Per product, sold per day vs the region's 30-day average; products without volume data get one
						line.
					</span>
				</div>
			</div>

			{#if buildBuy.length > 0}
				<div>
					<h2 class={label}>Intermediates</h2>
					<ul class="divide-y divide-gray-200 dark:divide-gray-600" aria-label="Build or buy intermediates">
						{#each buildBuy as item (item.typeId)}
							<li class="flex items-center justify-between gap-2 py-0.5" data-build-buy={item.typeId}>
								<span class="truncate">{item.name}</span>
								<span
									class="inline-flex shrink-0 overflow-hidden rounded-md border border-gray-200 text-xs font-medium dark:border-gray-600"
								>
									<button
										type="button"
										class="px-2 py-0.5 {segment(!item.buy)}"
										aria-pressed={!item.buy}
										aria-label="Build {item.name}"
										onclick={() => toggleBuy(item.typeId, false)}>Build</button
									>
									<button
										type="button"
										class="border-l border-gray-200 px-2 py-0.5 dark:border-gray-600 {segment(item.buy)}"
										aria-pressed={item.buy}
										aria-label="Buy {item.name}"
										onclick={() => toggleBuy(item.typeId, true)}>Buy</button
									>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}

		<div class="space-y-2">
			{#if data.inventory}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class={caption} id="planner-stock-source">Stock and formulas from</h2>
					<span
						class="inline-flex shrink-0 overflow-hidden rounded-md border border-gray-200 text-xs font-medium dark:border-gray-600"
						role="group"
						aria-labelledby="planner-stock-source"
					>
						<button
							type="button"
							class="px-2 py-0.5 {segment(stockSource === 'account')}"
							aria-pressed={stockSource === 'account'}
							onclick={() => (setup.stockSource = 'account')}>My inventory</button
						>
						<button
							type="button"
							class="border-l border-gray-200 px-2 py-0.5 dark:border-gray-600 {segment(
								stockSource === 'paste'
							)}"
							aria-pressed={stockSource === 'paste'}
							onclick={() => (setup.stockSource = 'paste')}>Pasted lists</button
						>
					</span>
				</div>
			{/if}
			{#if inventory}
				<PlannerInventory {inventory} />
			{:else}
				<PlannerPaste
					label="Stock"
					noun="item"
					hint="Paste from your EVE inventory (Name, tab, quantity per line); {mode === 'stock'
						? 'the plan puts this stock to use'
						: 'stock reduces the initial purchases'}."
					placeholder={STOCK_EXAMPLE}
					bind:text={setup.stockText}
					result={stock}
				/>
				<PlannerPaste
					label="Owned formulas"
					noun="formula"
					hint="Paste formula names with counts; {mode === 'stock'
						? 'each owned formula runs one slot per cycle'
						: 'owned formulas are not bought'}."
					placeholder={FORMULAS_EXAMPLE}
					bind:text={setup.formulasText}
					result={owned}
				/>
			{/if}
		</div>

		<form method="GET" action="/planner" class="space-y-1" data-sveltekit-reset="false">
			{#if fromShare && share}
				<!-- An unedited shared plan is not stored yet; keep it (and its settings) open. -->
				<input type="hidden" name="s" value={share} />
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<label for="planner-days-ago" class={caption}>Inputs priced</label>
				<input
					id="planner-days-ago"
					name="inputsDaysAgo"
					type="number"
					min="0"
					max="60"
					step="1"
					class="{field} w-16"
					value={data.inputsDaysAgo}
				/>
				<span class="text-gray-600 dark:text-gray-300">days ago</span>
				<button type="submit" class={button}>Apply</button>
				{#if data.inputsDaysAgo > 0}
					<a
						href={fromShare && share ? `/planner?s=${share}` : '/planner'}
						class="text-primary-700 dark:text-primary-400 hover:underline">Now</a
					>
				{/if}
			</div>
			<p class="text-xs text-gray-500 dark:text-gray-400" data-inputs-as-of>
				Inputs: {data.inputsDaysAgo === 0 ? 'current prices' : 'prices'} of {stamp(
					inputsAsOf.asOf
				)}{inputsAsOf.approximate ? ' (approximate: daily averages)' : ''} · outputs: current
			</p>
		</form>

		<div class="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-600">
			<button
				type="button"
				class={button}
				disabled={!shareUrl}
				onclick={copyShare}
				data-rybbit-event="share_link_copy"
				data-rybbit-prop-kind="planner"
			>
				{shareStatus === 'copied' ? 'Link copied' : 'Share'}
			</button>
			<button
				type="button"
				class={button}
				onclick={() =>
					(setup = {
						...emptyState(),
						slots: setup.slots,
						cycleDays: setup.cycleDays,
						stockSource: setup.stockSource,
						mode: setup.mode
					})}>Clear</button
			>

			<span class="text-xs text-gray-500 dark:text-gray-400" role="status">
				{#if shareInvalid}
					The shared plan could not be opened; your saved plan is shown.
				{:else if shareStatus === 'copied'}
					Share link copied.
				{/if}
			</span>
			{#if shareStatus === 'failed'}
				<input
					readonly
					class="{field} w-full font-mono text-xs"
					aria-label="Share link"
					value={shareUrl}
					onfocus={(e) => e.currentTarget.select()}
				/>
			{/if}
		</div>
	</section>

	<div class="min-w-0 space-y-3">
		{#if data.sharedSettings && ownSettingsHref}
			<InfoNote name="shared-settings">
				This plan uses the settings it was shared with, which differ from yours.
				<a href={ownSettingsHref} class="font-medium underline">Use my settings</a> ·
				<a href="/settings?import={data.sharedSettings.importCode}" class="font-medium underline"
					>Review these settings</a
				>
			</InfoNote>
		{/if}
		{#if fromShare && replacesSaved}
			<InfoNote name="shared-plan">
				Editing this shared plan replaces your saved plan.
				<a href={withShare(null)} class="font-medium underline" data-sveltekit-reload>Open my saved plan</a>
			</InfoNote>
		{/if}
		{#if inventoryMissing}
			<InfoNote name="inventory-fallback">
				This plan takes stock and formulas from an account inventory, and you have no synced inventory here:
				your pasted lists are used instead.
			</InfoNote>
		{/if}
		{#if data.settingsSummary}
			<SettingsSummary
				settings={data.settingsSummary}
				warnings={(mode === 'stock' ? stockJobs : plan.reactions.length > 0) ? [] : data.profileWarnings}
			/>
		{:else}
			<a href="/settings" class="text-primary-700 dark:text-primary-400 text-sm hover:underline"
				>Per-reactor settings in use · Edit settings</a
			>
		{/if}
		{#if mode === 'stock'}
			<p
				class="text-sm font-medium text-gray-700 empty:hidden dark:text-gray-200"
				role="status"
				aria-live="polite"
				data-stock-status
			>
				{#if planning && incumbentShown}
					Looking for a better plan…
				{:else if planning || (!stockPlan && !stockFailed)}
					Planning…
				{:else if stockFailed}
					Planning failed: change an input to try again.
				{/if}
			</p>
			{#if stockPlan}
				<div
					class="transition-opacity {planning && !incumbentShown ? 'opacity-50' : ''}"
					aria-busy={planning}
					data-stock-plan
				>
					{#if stockJobs}
						<StockPlanResults
							plan={stockPlan}
							final={!planning}
							dataset={data.dataset}
							totalSlots={setup.slots}
							allowUnownedFormulas={setup.allowUnownedFormulas ?? false}
							inputMarket={inputMarket(data)}
							profileWarnings={data.profileWarnings}
						/>
					{:else}
						<div
							class="space-y-2 rounded-lg bg-white p-4 text-sm text-gray-600 dark:bg-gray-700 dark:text-gray-300"
							data-empty
						>
							<p class="font-medium text-gray-800 dark:text-gray-200">
								{formatNumber(setup.slots)} slots, {cycleDays}-day cycle: no reaction can run on this stock.
							</p>
							<ul class="list-disc space-y-1 ps-5">
								<li>Paste your stock and owned formulas, or use My inventory when you are logged in.</li>
								<li>
									A reaction runs when your stock or earlier cycles hold its inputs (fuel blocks are bought)
									and you own its formula{setup.allowUnownedFormulas ? ' or it can be bought' : ''}.
								</li>
								{#if !setup.allowUnownedFormulas}
									<li>Allow formulas I don't own to also use reactions whose formula you would buy.</li>
								{/if}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		{:else if plan.reactions.length > 0}
			<PlannerResults
				{plan}
				dataset={data.dataset}
				totalSlots={setup.slots}
				{cycleDays}
				{formulaNames}
				{missing}
				{volumes}
				{purchaseVolumes}
				inputMarket={inputMarket(data)}
				profileWarnings={data.profileWarnings}
				{fuelTypeIds}
				{shoppingPlan}
				{hasStock}
				{useStock}
				oncycles={(cycles) => (setup.shoppingCycles = cycles)}
				onusestock={(on) => (setup.shoppingUseStock = on)}
			/>
		{:else}
			<div
				class="space-y-2 rounded-lg bg-white p-4 text-sm text-gray-600 dark:bg-gray-700 dark:text-gray-300"
				data-empty
			>
				<p class="font-medium text-gray-800 dark:text-gray-200">
					{formatNumber(setup.slots)} slots, {cycleDays}-day cycle: add a target or use Auto-fill best to
					build a plan.
				</p>
				<ul class="list-disc space-y-1 ps-5">
					<li>
						Each line is one slot of the final product running a full cycle; intermediates get their own
						slots.
					</li>
					<li>Intermediates start one cycle earlier (build-up); from then on every slot runs each cycle.</li>
					<li>Switch an intermediate to Buy to skip its reaction and purchase it instead.</li>
					<li>Paste stock and owned formulas from your inventory to cut the initial investment.</li>
				</ul>
			</div>
		{/if}
	</div>
</div>
