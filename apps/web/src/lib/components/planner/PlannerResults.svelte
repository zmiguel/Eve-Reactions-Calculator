<script lang="ts">
	import type { PlanResult } from '@reactions/engine';
	import type { InputMarket, ProductVolume } from '$lib/planner/plan';
	import InfoNote from '$lib/components/InfoNote.svelte';
	import LineItemsTable from '$lib/components/detail/LineItemsTable.svelte';
	import MultibuyButton from '$lib/components/detail/MultibuyButton.svelte';
	import { formatDuration, formatIsk, formatIskFull, formatNumber, formatPct } from '$lib/format';
	import { lineItemsMultibuy } from '$lib/multibuy';
	import { typeIconUrl } from '$lib/site';
	import { phaseTitle, startupSummary, unrefinedRoute } from '$lib/startup';

	interface Props {
		plan: PlanResult;
		totalSlots: number;
		cycleDays: number;
		/** Blueprint type id → formula name. */
		formulaNames: Record<number, string>;
		/** Names of the types without a market price. */
		missing?: string[];
		/** Profile warnings from the load (`HUB_UNAVAILABLE`, …). */
		profileWarnings?: string[];
		/** Market of each product (output hub region and its average daily volume). */
		volumes?: Record<number, ProductVolume>;
		/** Market of each bought input (input hub region and its average daily volume). */
		purchaseVolumes?: Record<number, ProductVolume>;
		/** Input and fallback hub shared by every profile; `null` when profiles differ. */
		inputMarket?: InputMarket | null;
	}

	let {
		plan,
		totalSlots,
		cycleDays,
		formulaNames,
		missing = [],
		profileWarnings = [],
		volumes = {},
		purchaseVolumes = {},
		inputMarket = null
	}: Props = $props();

	const days = $derived(+cycleDays.toFixed(2));

	/** Selling or buying more than this share of the region's average daily volume is flagged. */
	const VOLUME_WARNING_PCT = 20;

	const WARNING_TEXT: Record<string, string> = {
		MAX_RUNS_PER_JOB:
			'A formula in this plan allows fewer runs per job than your cycle could fit (Molecular-Forged: 100), so its jobs end early.',
		SKILL_TOO_LOW: 'Your Reactions skill is below the level a formula in this plan requires.',
		COST_INDEX_MISSING: 'No reaction cost index is known for your system; job costs assume 0%.',
		MISSING_ADJUSTED_PRICE: 'Some inputs have no adjusted price, so job costs are underestimated.',
		HUB_UNAVAILABLE:
			'A market hub in your settings is not available to you; Jita 4-4 prices are used instead.',
		CYCLE_SHORTER_THAN_RUN: 'Your cycle is shorter than one run; one run per cycle is assumed.'
	};

	const t = $derived(plan.totals);
	const warnings = $derived.by(() => {
		const list: { code: string; text: string }[] = [];
		if (plan.warnings.includes('SLOTS_EXCEEDED'))
			list.push({
				code: 'SLOTS_EXCEEDED',
				text: `This plan needs ${plan.slotsUsed} slots but only ${totalSlots} are available.`
			});
		const inputName = inputMarket?.name ?? 'the input hub';
		const fallbackName = inputMarket?.fallbackName ?? 'the fallback hub';
		const shortItems = plan.purchasesPerCycle.filter(
			(p) => p.sources !== undefined && p.availableAtInputHub != null
		);
		for (const code of new Set([...plan.warnings, ...profileWarnings])) {
			if (code === 'SLOTS_EXCEEDED' || (code === 'INPUT_VOLUME_SHORT' && shortItems.length > 0)) continue;
			list.push({
				code,
				text:
					code === 'INPUT_VOLUME_SHORT'
						? `Initial purchases need more of some inputs than ${inputName} lists; the rest is priced at ${fallbackName}.`
						: (WARNING_TEXT[code] ?? code)
			});
		}
		for (const p of shortItems) {
			const listed = p.availableAtInputHub!;
			list.push({
				code: 'INPUT_VOLUME_SHORT',
				text: `${p.name}: ${formatNumber(p.quantity)} needed per cycle, ${formatNumber(listed)} listed at ${inputName}; ${formatNumber(p.quantity - listed)} priced at ${fallbackName}.`
			});
		}
		if (missing.length > 0)
			list.push({
				code: 'MISSING_PRICES',
				text: `No market price for ${missing.join(', ')}: profit and margin are not available.`
			});
		for (const o of plan.outputsPerCycle)
			if (o.dailyVolumeSharePct !== null && o.dailyVolumeSharePct > VOLUME_WARNING_PCT) {
				const market = volumes[o.typeId];
				const region = market ? `${market.regionName}'s` : "the region's";
				const regional = market?.volume ? ` (${formatNumber(market.volume)}/day)` : '';
				list.push({
					code: 'HIGH_VOLUME_SHARE',
					text: `${o.name}: ${formatNumber(o.quantity / cycleDays)}/day (${formatNumber(o.quantity)} per ${days}-day cycle) is ${formatPct(o.dailyVolumeSharePct)} of ${region} average daily volume${regional}, which may push the price down.`
				});
			}
		for (const p of plan.purchasesPerCycle)
			if (p.dailyVolumeSharePct !== null && p.dailyVolumeSharePct > VOLUME_WARNING_PCT) {
				const market = purchaseVolumes[p.typeId];
				const region = market ? `${market.regionName}'s` : "the region's";
				list.push({
					code: 'HIGH_INPUT_VOLUME_SHARE',
					text: `${p.name}: ${formatNumber(p.quantity)} per ${days}-day cycle is ${formatPct(p.dailyVolumeSharePct)} of ${region} traded volume over the same period, which may push the price up.`
				});
			}
		return list;
	});

	/** Bought inputs sourced on the market (contract purchases have neither listings nor a share). */
	const marketRows = $derived(
		plan.purchasesPerCycle.filter((p) => p.availableAtInputHub != null || p.dailyVolumeSharePct !== null)
	);
	const showFallback = $derived(
		marketRows.some((p) => p.availableAtInputHub != null && p.availableAtInputHub < p.quantity)
	);
	/** Units the input hub cannot supply, bought at the fallback hub instead. */
	const fallbackQty = (p: { quantity: number; availableAtInputHub?: number | null }) =>
		p.availableAtInputHub == null ? 0 : Math.max(0, p.quantity - p.availableAtInputHub);

	const reactionNames = $derived(new Map(plan.reactions.map((r) => [r.blueprintTypeId, r.name])));
	const phaseScale = $derived(Math.max(totalSlots, plan.slotsUsed, 1));
	const startupLine = $derived(startupSummary(plan.startup, reactionNames));
	const unrefinedRoutes = $derived(
		plan.reactions
			.filter((r) => r.reprocess)
			.map((r) => ({ id: r.blueprintTypeId, ...unrefinedRoute(r, reactionNames, plan.startup) }))
	);
	const usedPct = $derived(Math.min(100, (plan.slotsUsed / Math.max(totalSlots, 1)) * 100));

	type Tone = 'profit' | 'plain';
	const cards = $derived.by(() => {
		const isk = (n: number | null) => ({ text: formatIsk(n), title: formatIskFull(n) });
		return [
			{
				label: 'Utilisation',
				text: formatPct(plan.utilisation * 100),
				title: `${formatDuration(plan.slotSecondsBusy)} busy of ${formatDuration(plan.slotsUsed * cycleDays * 86400)} slot time`,
				hint: '',
				value: plan.utilisation,
				tone: 'plain'
			},
			{
				label: 'Recurring / cycle',
				...isk(t.recurringInvestment),
				hint: 'Purchases and job costs of one steady cycle',
				value: t.recurringInvestment,
				tone: 'plain'
			},
			{
				label: 'Initial investment',
				...isk(t.initialInvestment),
				hint: 'Build-up and first steady cycle purchases (minus stock), their job costs and formulas',
				value: t.initialInvestment,
				tone: 'plain'
			},
			{
				label: 'Profit / cycle',
				...isk(t.profitPerCycle),
				hint: '',
				value: t.profitPerCycle,
				tone: 'profit'
			},
			{ label: 'Profit / day', ...isk(t.profitPerDay), hint: '', value: t.profitPerDay, tone: 'profit' },
			{
				label: 'Profit / slot / day',
				...isk(t.profitPerSlotDay),
				hint: 'Profit per cycle ÷ (slots used × cycle days)',
				value: t.profitPerSlotDay,
				tone: 'profit'
			},
			{
				label: 'Margin',
				text: formatPct(t.marginPct),
				title: '',
				hint: '',
				value: t.marginPct,
				tone: 'profit'
			}
		] satisfies {
			label: string;
			text: string;
			title: string;
			hint: string;
			value: number | null;
			tone: Tone;
		}[];
	});

	const toneClass = (tone: Tone, value: number | null) =>
		tone === 'plain' || value === null || value === 0
			? 'text-gray-900 dark:text-white'
			: value > 0
				? 'text-green-600 dark:text-green-400'
				: 'text-red-600 dark:text-red-300';

	const h3 = 'text-sm font-semibold text-gray-800 dark:text-gray-200';
	const table =
		'w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
	const row =
		'border-t border-gray-200 text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700';
	const th = 'px-3 py-1.5 text-right whitespace-nowrap';
	const td = 'px-3 py-1 text-right tabular-nums whitespace-nowrap';
</script>

<div class="space-y-4" data-results>
	<dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="rounded-lg bg-white px-3 py-2 dark:bg-gray-700" data-metric="slots">
			<dt class="text-xs font-medium text-gray-600 uppercase dark:text-gray-300">Slots used</dt>
			<dd class="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 whitespace-nowrap tabular-nums">
				<span
					class="text-lg font-bold {plan.slotsUsed > totalSlots
						? 'text-red-600 dark:text-red-300'
						: 'text-gray-900 dark:text-white'}"
					data-field="slotsUsed">{plan.slotsUsed} / {totalSlots}</span
				>
				<span class="text-xs text-gray-600 dark:text-gray-300" data-field="slotsRemaining"
					>{plan.slotsRemaining} remaining</span
				>
			</dd>
			<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600" aria-hidden="true">
				<div
					class="h-full rounded-full {plan.slotsUsed > totalSlots ? 'bg-red-500' : 'bg-primary-500'}"
					style="width: {usedPct}%"
				></div>
			</div>
		</div>
		{#each cards as card (card.label)}
			<div class="rounded-lg bg-white px-3 py-2 dark:bg-gray-700" data-metric={card.label}>
				<dt
					class="text-xs font-medium whitespace-nowrap text-gray-600 uppercase dark:text-gray-300"
					title={card.hint || undefined}
				>
					{card.label}
				</dt>
				<dd
					class="mt-0.5 text-lg font-bold whitespace-nowrap tabular-nums {toneClass(card.tone, card.value)}"
					title={card.title || undefined}
				>
					{card.text}
				</dd>
			</div>
		{/each}
	</dl>

	{#if warnings.length > 0}
		<ul class="space-y-1 text-sm" aria-label="Warnings">
			{#each warnings as w (w.code + w.text)}
				<li
					class="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
					data-warning={w.code}
				>
					{w.text}
				</li>
			{/each}
		</ul>
	{/if}

	<section class="space-y-2" aria-labelledby="plan-reactions">
		<h3 id="plan-reactions" class={h3}>Reactions to run</h3>
		<div class="overflow-x-auto">
			<table class={table}>
				<thead class={thead}>
					<tr>
						<th scope="col" class="px-3 py-1.5">Reaction</th>
						<th scope="col" class={th} title="0 = final product; higher = feeds the level above">Depth</th>
						<th scope="col" class={th}>Slots</th>
						<th scope="col" class={th}>Runs / slot</th>
						<th scope="col" class={th}>Duration / slot</th>
						<th scope="col" class={th}>First cycle</th>
					</tr>
				</thead>
				<tbody>
					{#each plan.reactions as r (r.blueprintTypeId)}
						<tr class={row} data-plan-reaction={r.blueprintTypeId}>
							<td class="px-3 py-1 font-medium whitespace-nowrap" data-field="name">{r.name}</td>
							<td class={td}>{r.depth}</td>
							<td class={td} data-field="slots">{r.slots}</td>
							<td class={td}>{[...new Set(r.runsPerSlot)].map((n) => formatNumber(n)).join(' / ')}</td>
							<td
								class={td}
								title="{formatNumber(r.runsPerSlot[0])} runs × {formatDuration(r.runTimeSeconds)}"
							>
								{formatDuration(Math.max(...r.runsPerSlot) * r.runTimeSeconds)}
							</td>
							<td class={td}>{r.firstCycle}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if unrefinedRoutes.length > 0}
			<InfoNote name="unrefined-routes">
				<h3 class="font-semibold">Unrefined routes</h3>
				<ul class="mt-1 space-y-2">
					{#each unrefinedRoutes as route (route.id)}
						<li data-unrefined-route={route.id}>
							<div data-route-head>
								{route.replaces.join(', ')}
								<span aria-hidden="true">→</span>
								<span class="sr-only">replaced by</span>
								<span class="font-medium">{route.name}</span>
								{#if route.step0}
									<span class="text-blue-700 dark:text-blue-300">· runs once in step 0</span>
								{/if}
							</div>
							{#if route.byproducts.length > 0}
								<ul class="mt-0.5 space-y-0.5 pl-4">
									{#each route.byproducts as b (b.name)}
										<li data-route-byproduct>
											<div>
												Reprocessed <span class="font-medium">{b.name}</span>: {formatNumber(b.quantity)} per cycle
											</div>
											<ul class="pl-4">
												{#if b.used > 0}
													<li data-route-use>
														<span aria-hidden="true">→</span>
														{formatNumber(b.used)} replace purchases in
														{#if b.sharedFromCycle !== null}
															{b.usedBy.map((u) => u.name).join(', ')}
															<span class="text-blue-700 dark:text-blue-300"
																>(from cycle {b.sharedFromCycle})</span
															>
														{:else}
															{#each b.usedBy as u, i (u.name)}{i > 0 ? ', ' : ''}{u.name}
																<span class="text-blue-700 dark:text-blue-300"
																	>(from cycle {u.fromCycle})</span
																>{/each}
														{/if}
													</li>
												{/if}
												{#if b.sold > 0}
													<li data-route-sold>
														<span aria-hidden="true">→</span>
														{formatNumber(b.sold)} sold
													</li>
												{/if}
											</ul>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			</InfoNote>
		{/if}

		<ol class="space-y-1 text-sm" aria-label="Phases" data-phases>
			{#each plan.phases as phase (phase.cycle)}
				<li
					class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2"
					data-phase={phase.label}
					title={phase.blueprintTypeIds.map((id) => reactionNames.get(id)).join(', ')}
				>
					<span class="text-gray-600 dark:text-gray-300"
						>{phase.label === 'step_0'
							? 'Step 0'
							: `Cycle ${phase.cycle}${phase.label === 'steady' ? '+' : ''}`}</span
					>
					<span class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600" aria-hidden="true">
						<span
							class="block h-full rounded-full {phase.label === 'steady' ? 'bg-primary-500' : 'bg-amber-500'}"
							style="width: {Math.min(100, (phase.slots / phaseScale) * 100)}%"
						></span>
					</span>
					<span class="whitespace-nowrap tabular-nums">
						<span class="font-medium text-gray-900 dark:text-gray-100">{phase.slots}</span>
						{phase.slots === 1 ? 'slot' : 'slots'} ·
						<span class="text-gray-600 dark:text-gray-300"
							>{phase.label === 'steady' ? 'steady' : phase.label === 'step_0' ? 'once' : 'build-up'}</span
						>
					</span>
				</li>
			{/each}
		</ol>
	</section>

	<section class="space-y-1">
		<LineItemsTable
			title="Shopping list per cycle"
			items={plan.purchasesPerCycle}
			emptyText="Nothing to buy."
			sources={false}
		/>
		<MultibuyButton text={lineItemsMultibuy(plan.purchasesPerCycle)} />
	</section>

	<section class="space-y-2" aria-labelledby="plan-startup" data-plan-startup>
		<h3 id="plan-startup" class={h3}>Start-up purchases, minus stock</h3>
		{#if startupLine}
			<InfoNote name="startup-choice">{startupLine}</InfoNote>
		{/if}
		{#each plan.phases as phase (phase.cycle)}
			<div class="space-y-1" data-startup-phase={phase.cycle}>
				<LineItemsTable
					title={phase.label === 'steady' ? `Cycle ${phase.cycle}, first steady cycle` : phaseTitle(phase)}
					items={phase.purchases}
					level={4}
					emptyText="Nothing to buy: stock or earlier reprocessing covers it."
					sources={false}
				/>
				<MultibuyButton text={lineItemsMultibuy(phase.purchases)} />
			</div>
		{/each}
		{#if plan.phases.length > 1 && plan.initialPurchases.length > 0}
			<div class="flex flex-wrap items-center justify-end gap-2 text-sm" data-startup-all>
				<span class="text-gray-600 dark:text-gray-300"
					>All start-up purchases: <strong class="text-gray-900 tabular-nums dark:text-white"
						>{formatIsk(
							plan.initialPurchases.some((i) => i.unitPrice === null)
								? null
								: plan.initialPurchases.reduce((a, i) => a + i.total + i.fees + i.shipping, 0)
						)}</strong
					></span
				>
				<MultibuyButton text={lineItemsMultibuy(plan.initialPurchases)} />
			</div>
		{/if}
	</section>

	{#if marketRows.length > 0}
		<section class="space-y-1" aria-labelledby="plan-market">
			<h3 id="plan-market" class={h3}>
				Market availability{inputMarket ? ` at ${inputMarket.name}` : ''}
			</h3>
			<div class="overflow-x-auto">
				<table class={table}>
					<thead class={thead}>
						<tr>
							<th scope="col" class="px-3 py-1.5">Item</th>
							<th scope="col" class={th}>Needed per cycle</th>
							<th scope="col" class={th} title="Units listed for sale at the input hub">Listed</th>
							{#if showFallback}
								<th scope="col" class={th}>From {inputMarket?.fallbackName ?? 'fallback'}</th>
							{/if}
							<th
								scope="col"
								class={th}
								title="Needed per cycle ÷ units traded in the region over one cycle (30-day average)"
								>Share of region volume</th
							>
						</tr>
					</thead>
					<tbody>
						{#each marketRows as p (p.typeId)}
							{@const market = purchaseVolumes[p.typeId]}
							{@const listed = p.availableAtInputHub ?? null}
							{@const high = p.dailyVolumeSharePct !== null && p.dailyVolumeSharePct > VOLUME_WARNING_PCT}
							<tr class={row} data-purchase={p.typeId}>
								<td class="px-3 py-1">
									<span class="flex items-center gap-2 whitespace-nowrap">
										<img
											src={typeIconUrl(p.typeId)}
											alt=""
											width="20"
											height="20"
											loading="lazy"
											class="h-5 w-5 rounded"
										/>
										{p.name}
									</span>
								</td>
								<td class={td} data-field="needed">{formatNumber(p.quantity)}</td>
								<td
									class="{td} {listed !== null && listed < p.quantity
										? 'text-amber-700 dark:text-amber-400'
										: ''}"
									data-field="listed">{listed === null ? 'n/a' : formatNumber(listed)}</td
								>
								{#if showFallback}
									<td class={td} data-field="fallback"
										>{fallbackQty(p) > 0 ? formatNumber(fallbackQty(p)) : 'n/a'}</td
									>
								{/if}
								<td
									class="{td} {high ? 'font-semibold text-red-600 dark:text-red-300' : ''}"
									data-field="volumeShare"
									title={market?.volume
										? `${formatNumber(market.volume)}/day traded in ${market.regionName}`
										: 'No volume data for this region'}>{formatPct(p.dailyVolumeSharePct)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<section class="space-y-1" aria-labelledby="plan-formulas">
		<h3 id="plan-formulas" class={h3}>Formulas to buy</h3>
		{#if plan.formulasToBuy.length === 0}
			<p class="text-sm text-gray-500 dark:text-gray-400">You own every formula this plan needs.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class={table}>
					<thead class={thead}>
						<tr>
							<th scope="col" class="px-3 py-1.5">Formula</th>
							<th scope="col" class={th}>Count</th>
							<th scope="col" class={th}>Unit price</th>
							<th scope="col" class={th}>Total</th>
						</tr>
					</thead>
					<tbody>
						{#each plan.formulasToBuy as f (f.blueprintTypeId)}
							<tr class={row} data-formula={f.blueprintTypeId}>
								<td class="px-3 py-1 whitespace-nowrap"
									>{formulaNames[f.blueprintTypeId] ?? f.blueprintTypeId}</td
								>
								<td class={td}>{f.count}</td>
								<td class={td} title={formatIskFull(f.unitPrice)}>{formatIsk(f.unitPrice)}</td>
								<td class={td} title={formatIskFull(f.unitPrice === null ? null : f.unitPrice * f.count)}>
									{formatIsk(f.unitPrice === null ? null : f.unitPrice * f.count)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="space-y-1" aria-labelledby="plan-outputs">
		<h3 id="plan-outputs" class={h3}>Outputs per cycle</h3>
		<div class="overflow-x-auto">
			<table class={table}>
				<thead class={thead}>
					<tr>
						<th scope="col" class="px-3 py-1.5">Product</th>
						<th scope="col" class={th}>Per cycle</th>
						<th scope="col" class={th} title="Per cycle ÷ {days} cycle days">Sold / day</th>
						<th scope="col" class={th} title="30-day average units traded per day in the output hub's region">
							Region daily volume
						</th>
						<th scope="col" class={th} title="Sold per day ÷ region daily volume">Share</th>
						<th scope="col" class={th}>Value</th>
						<th scope="col" class={th} title="After broker fees, sales tax and shipping">Net</th>
					</tr>
				</thead>
				<tbody>
					{#each plan.outputsPerCycle as o (o.typeId)}
						{@const high = o.dailyVolumeSharePct !== null && o.dailyVolumeSharePct > VOLUME_WARNING_PCT}
						{@const market = volumes[o.typeId]}
						<tr class={row} data-output={o.typeId}>
							<td class="px-3 py-1">
								<span class="flex items-center gap-2 whitespace-nowrap">
									<img
										src={typeIconUrl(o.typeId)}
										alt=""
										width="20"
										height="20"
										loading="lazy"
										class="h-5 w-5 rounded"
									/>
									{o.name}
								</span>
							</td>
							<td class={td} data-field="perCycle">{formatNumber(o.quantity)}</td>
							<td class={td} data-field="perDay">{formatNumber(o.quantity / cycleDays)}</td>
							<td class={td} data-field="regionVolume">
								{market?.volume ? formatNumber(market.volume) : 'n/a'}
								{#if market}<span class="ms-1 text-xs text-gray-500 dark:text-gray-400"
										>{market.regionName}</span
									>{/if}
							</td>
							<td
								class="{td} {high ? 'font-semibold text-red-600 dark:text-red-300' : ''}"
								data-field="volumeShare"
								title={o.dailyVolumeSharePct === null ? 'No volume data for this region' : undefined}
							>
								{formatPct(o.dailyVolumeSharePct)}
							</td>
							<td class={td} title={formatIskFull(o.unitPrice === null ? null : o.total)}>
								{o.unitPrice === null ? 'n/a' : formatIsk(o.total)}
							</td>
							<td class={td} title={formatIskFull(o.total - o.fees - o.shipping)}>
								{o.unitPrice === null ? 'n/a' : formatIsk(o.total - o.fees - o.shipping)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	{#if plan.surplusPerCycle.length > 0}
		<LineItemsTable title="Surplus per cycle" items={plan.surplusPerCycle} costs={false} volume={false} />
	{/if}
</div>
