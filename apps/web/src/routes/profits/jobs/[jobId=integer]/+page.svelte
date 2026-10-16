<script lang="ts">
	import { ArrowLeftOutline, ArrowRightOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import JobMarks from '$lib/components/jobs/JobMarks.svelte';
	import JobOutputBar from '$lib/components/jobs/JobOutputBar.svelte';
	import JobStatusPill from '$lib/components/jobs/JobStatusPill.svelte';
	import { ESTIMATE } from '$lib/components/jobs/JobTable.svelte';
	import CorrectionForm from '$lib/components/ledger/CorrectionForm.svelte';
	import Estimated from '$lib/components/profits/Estimated.svelte';
	import Isk from '$lib/components/profits/Isk.svelte';
	import Pill from '$lib/components/profits/Pill.svelte';
	import { BAND_NAMES } from '$lib/account/facilities';
	import { formatNumber, formatPct, formatRelative, formatUtc } from '$lib/format';
	import type { JobActionResult, JobDetailData, JobInputView, JobLink, JobLotOrigin } from '$lib/jobs/types';
	import { ORIGIN_TEXT } from '$lib/ledger/source';
	import Seo from '$lib/seo/Seo.svelte';
	import { blueprintIconUrl, typeIconUrl } from '$lib/site';

	let { data, form } = $props();

	const result = $derived(form as JobActionResult | null);
	/** Correction forms on the page: their errors show next to them, other errors above the result. */
	const correctionRefs = $derived(
		new Set(data.detail?.inputs.flatMap((i) => i.lots.map((l) => l.correctionRef)) ?? [])
	);
	const pageError = $derived(result?.error && !correctionRefs.has(result.ref) ? result.error : null);

	/** Short form of a batch origin in the source mix (sentences: the ledger's `ORIGIN_TEXT`). */
	const MIX_WORD: Record<JobLotOrigin, string> = {
		transaction: 'bought',
		contract: 'bought by contract',
		job: 'made by job',
		market: 'market estimate',
		correction: 'your correction',
		manual: 'entered by you'
	};

	/** How a manufacturing use was valued (the manufacturing setting on Profit tracking settings). */
	const BASIS_TEXT = { buy_value: 'buy value', cost: 'at cost' } as const;

	/** The account reactor settings' ME rig, as the material bonus names it. */
	const PROFILE_RIG = { none: 'No ME rig', t1: 'T1 ME rig', t2: 'T2 ME rig' } as const;

	/** "2 batches: bought, made by job". */
	function sourceMix(input: JobInputView): string {
		const kinds = [...new Set(input.lots.map((l) => MIX_WORD[l.origin]))];
		const n = input.lots.length;
		return `${formatNumber(n)} ${n === 1 ? 'batch' : 'batches'}: ${kinds.join(', ')}`;
	}

	/** The parts of the result card; values in ISK, null when unknown. */
	function breakdown(d: JobDetailData) {
		const { job, output } = d;
		const totalCost = job.inputCost === null ? null : job.inputCost + (job.jobCost ?? 0);
		const sold = output ? (job.salesNet ?? 0) : null;
		const used = output && job.unitCost !== null ? output.usedQty * job.unitCost : null;
		const manufactured = output
			? output.manufacturing.reduce((s, m) => s + m.quantity * m.unitValue, 0)
			: null;
		const unsold = output ? (output.unsoldQty > 0 ? output.unsoldValueNow : 0) : null;
		const outputValue =
			output && sold !== null && used !== null && manufactured !== null && unsold !== null
				? sold + used + manufactured + unsold
				: null;
		const max = Math.max(totalCost ?? 0, outputValue ?? 0, job.jobCost ?? 0);
		return { totalCost, sold, used, manufactured, unsold, outputValue, max };
	}

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const thead = 'bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400';
	const cell = 'px-3 py-2 align-top';
	const num =
		'px-3 py-2 align-top text-right tabular-nums whitespace-nowrap text-gray-800 dark:text-gray-200';
	/** Columns of an input row and of the header above them (desktop). */
	const inputGrid =
		'grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 sm:grid-cols-[1rem_minmax(0,1fr)_6rem_7rem_8rem]';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';
	const BAR = {
		cost: 'bg-red-400 dark:bg-red-500',
		value: 'bg-green-500 dark:bg-green-500',
		total: 'bg-gray-500 dark:bg-gray-400'
	} as const;
</script>

{#snippet jobChip(l: JobLink, current = false)}
	<a
		href="/profits/jobs/{l.jobId}"
		class="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium {current
			? 'border-primary-500 bg-primary-50 text-primary-800 dark:border-primary-400 dark:bg-primary-900/40 dark:text-primary-200'
			: 'border-gray-200 bg-white text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600'}"
		aria-current={current ? 'page' : undefined}
		data-job-link={l.jobId}
	>
		<img
			src={blueprintIconUrl(l.formula.blueprintTypeId)}
			alt=""
			width="20"
			height="20"
			loading="lazy"
			class="h-5 w-5 rounded"
		/>
		<span class="flex flex-col">
			<span>{l.formula.name ?? 'Unknown formula'}</span>
			<span class="font-normal tabular-nums {current ? '' : muted}" data-job-link-start={l.startDate}
				>{`Started ${formatUtc(l.startDate)}${current ? '' : ` · ${formatNumber(l.quantity)} units`}`}</span
			>
		</span>
	</a>
{/snippet}

{#snippet barRow(
	text: string,
	value: number | null,
	max: number,
	tone: keyof typeof BAR,
	options: { estimated?: string | null; strong?: boolean; key: string; note?: string }
)}
	<div class="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3" data-part={options.key}>
		<span
			class={options.strong
				? 'font-semibold text-gray-900 dark:text-white'
				: 'text-gray-700 dark:text-gray-300'}
			>{text}{#if options.note}<span class="block text-xs font-normal {muted}">{options.note}</span
				>{/if}</span
		>
		<span class="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
			<span
				class="block h-full rounded-full {BAR[tone]}"
				style="width: {value !== null && max > 0 ? Math.max(0, (value / max) * 100) : 0}%"
			></span>
		</span>
		<span class="text-right whitespace-nowrap {options.strong ? 'font-semibold' : ''}"
			><Isk {value} estimated={options.estimated ?? null} /></span
		>
	</div>
{/snippet}

{#if data.detail}
	{@const d = data.detail}
	{@const job = d.job}
	{@const parts = breakdown(d)}
	{@const fuel = d.kind === 'fuel_block'}
	{@const title = job.formula.name ?? (fuel ? 'Fuel block job' : 'Reaction job')}
	{@const inputsEstimate = job.marks.includes('market_fallback') ? ESTIMATE.inputs : null}
	{@const unsoldEstimate = (d.output?.unsoldQty ?? 0) > 0 ? ESTIMATE.unsold : null}
	{@const runningEstimate =
		job.runningOutputQty !== null
			? "An estimate: the output this job will make, at today's market price with your settings, minus its costs."
			: null}
	<Seo
		{title}
		description={fuel
			? 'Inputs, costs and output of one of your tracked EVE Online fuel block jobs.'
			: 'Inputs, costs and output of one of your tracked EVE Online reaction jobs.'}
		path="/profits/jobs/{job.jobId}"
		noindex
	/>

	<div class="space-y-4 pb-4">
		<header class="space-y-2">
			<a href="/profits/jobs" class="inline-flex items-center gap-1 text-sm {link}" data-back>
				<ArrowLeftOutline class="h-4 w-4" aria-hidden="true" /> All jobs
			</a>
			<div class="flex flex-wrap items-start gap-3">
				<img
					src={blueprintIconUrl(job.formula.blueprintTypeId, 64)}
					alt=""
					width="48"
					height="48"
					class="h-12 w-12 rounded"
				/>
				<div class="min-w-0 flex-1">
					<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">{title}</h1>
					<p class="text-sm text-gray-600 dark:text-gray-400" data-job-facts>
						{#if fuel}<span data-fuel-block>Fuel block job ·</span>{/if}
						{formatNumber(job.runs)}
						{job.runs === 1 ? 'run' : 'runs'} · {job.owner} · {job.facility}
					</p>
					<p class="mt-1 flex flex-wrap gap-x-4 text-xs {muted}" data-dates>
						<span title={formatUtc(job.startDate)}
							>Started {formatRelative(job.startDate, d.now)} ({formatUtc(job.startDate)})</span
						>
						{#if job.status !== 'cancelled'}
							<span title={formatUtc(job.endDate)}
								>{job.status === 'running' ? 'Ends' : 'Ended'}
								{formatRelative(job.endDate, d.now)} ({formatUtc(job.endDate)})</span
							>
						{/if}
					</p>
				</div>
				<div class="flex items-start gap-2">
					<JobStatusPill status={job.status} startDate={job.startDate} endDate={job.endDate} now={d.now} />
					<JobMarks marks={job.marks} />
				</div>
			</div>
			<p class="text-xs {muted}" data-rebuilt>
				{#if d.dirty}
					Updating the numbers with your latest changes.
				{:else if d.rebuiltAt}
					Numbers updated <span title={formatUtc(d.rebuiltAt)}>{formatRelative(d.rebuiltAt, d.now)}</span>.
				{:else}
					Numbers not worked out yet.
				{/if}
			</p>
		</header>

		{#if result?.notice || pageError}
			<div
				role={pageError ? 'alert' : 'status'}
				data-notice={pageError ? 'error' : 'ok'}
				class="rounded-md border px-3 py-2 text-sm {pageError
					? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
					: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
			>
				{pageError ?? result?.notice}
			</div>
		{/if}

		<section class={card} data-result>
			<h2 class={heading}>Result</h2>
			<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<div class="space-y-2">
					{@render barRow('Inputs', job.inputCost, parts.max, 'cost', {
						key: 'inputs',
						estimated: inputsEstimate
					})}
					{@render barRow('Job cost', job.jobCost, parts.max, 'cost', { key: 'job-cost' })}
					{@render barRow('Total cost', parts.totalCost, parts.max, 'total', {
						key: 'total-cost',
						strong: true,
						estimated: inputsEstimate
					})}
					{#if d.output}
						<div class="border-t border-gray-200 pt-2 dark:border-gray-600"></div>
						{@render barRow('Sold', parts.sold, parts.max, 'value', {
							key: 'sold',
							note: `${formatNumber(d.output.soldQty)} units, after tax and fees`
						})}
						{@render barRow('Used by later jobs', parts.used, parts.max, 'value', {
							key: 'used',
							note: `${formatNumber(d.output.usedQty)} units, at cost`
						})}
						{#if d.output.manufacturedQty > 0}
							{@render barRow('Used in manufacturing', parts.manufactured, parts.max, 'value', {
								key: 'manufactured',
								note: `${formatNumber(d.output.manufacturedQty)} units, ${
									d.output.manufacturing.some((m) => m.basis === 'buy_value')
										? 'at buy value on the day each job started'
										: 'at cost'
								}`
							})}
						{/if}
						{@render barRow('Unsold', parts.unsold, parts.max, 'value', {
							key: 'unsold',
							note: `${formatNumber(d.output.unsoldQty)} units, today's value`,
							estimated: unsoldEstimate
						})}
						{#if !fuel}
							{@render barRow('Output value', parts.outputValue, parts.max, 'value', {
								key: 'output-value',
								strong: true,
								estimated: unsoldEstimate
							})}
						{/if}
					{:else if job.status === 'running'}
						<p class={muted} data-no-output>
							{#if fuel}
								{job.runningOutputQty !== null
									? `Still running: it will make ${formatNumber(job.runningOutputQty)} units for your reactions.`
									: 'Still running: the output is known once it ends.'}
							{:else}
								{job.runningOutputQty !== null
									? `Still running: it will make ${formatNumber(job.runningOutputQty)} units. The realized profit is known once they are sold; the expected profit is an estimate at today's prices.`
									: 'Still running: output and profit are known once it ends.'}
							{/if}
						</p>
					{:else if job.status === 'cancelled'}
						<p class={muted} data-no-output>
							Cancelled: the inputs and the job cost are lost and there is no output.
						</p>
					{:else}
						<p class={muted} data-no-output>
							The output is not worked out yet: it shows up once the numbers are updated.
						</p>
					{/if}
				</div>
				<dl class="grid grid-cols-2 gap-4 self-start lg:grid-cols-1">
					{#if !fuel}
						<div>
							<dt class={muted}>Realized profit</dt>
							<dd class="text-xl font-semibold" data-profit="realized">
								<Isk value={job.realizedProfit} profit missing={job.realizedNote} />
							</dd>
							<dd class="text-xs {muted}">
								{(d.output?.manufacturedQty ?? 0) > 0
									? 'from the output sold or used in manufacturing so far'
									: 'from the output sold so far'}
							</dd>
						</div>
						<div>
							<dt class={muted}>Expected profit</dt>
							<dd class="text-xl font-semibold" data-profit="expected">
								<Isk
									value={job.expectedProfit}
									profit
									missing={job.expectedNote}
									estimated={job.expectedProfit !== null ? (runningEstimate ?? unsoldEstimate) : null}
								/>
							</dd>
							<dd class="text-xs {muted}">
								{job.expectedNote ??
									(job.runningOutputQty !== null
										? `if the ${formatNumber(job.runningOutputQty)} units it will make sell at today's price (an estimate)`
										: "if the unsold output sells at today's price")}
							</dd>
						</div>
					{/if}
					<div>
						<dt class={muted}>Cost per unit of output</dt>
						<dd class="text-lg font-semibold text-gray-900 dark:text-gray-100" data-unit-cost>
							<Isk value={job.unitCost} estimated={job.unitCost !== null ? inputsEstimate : null} />
						</dd>
						{#if fuel}
							<dd class="text-xs {muted}" data-fuel-note>
								what each fuel block cost you: your reactions take them at this cost
							</dd>
						{/if}
					</div>
				</dl>
			</div>
		</section>

		<section class={card} data-inputs>
			<h2 class={heading}>Inputs</h2>
			{#if d.materialBonus}
				{@const mb = d.materialBonus}
				{@const bandText = mb.band ? BAND_NAMES[mb.band] : 'highsec values, system unknown'}
				<div class="mb-3 space-y-1" data-material-bonus={mb.source}>
					<p>
						<span class="font-semibold text-gray-900 dark:text-gray-100">Material bonus:</span>
						{mb.reduction > 0 ? `${formatPct(mb.reduction * 100, 2)} fewer materials` : 'none'} at {mb.facility}
						({mb.band ? BAND_NAMES[mb.band] : 'system unknown'}).
					</p>
					{#if mb.parts.length || mb.profileRig}
						<ul class="list-inside list-disc text-xs text-gray-700 dark:text-gray-300">
							{#each mb.parts as part, i (i)}
								<li data-bonus-part={part.kind}>
									{part.kind === 'structure' ? 'Structure' : 'Rig'}
									{part.name}: {formatPct(part.reduction * 100, 2)}{part.kind === 'rig'
										? ` (${bandText})`
										: ''}
								</li>
							{/each}
							{#if mb.profileRig}
								<li data-profile-rig>
									{PROFILE_RIG[mb.profileRig.meRig]} of your reactor settings: {formatPct(
										mb.profileRig.reduction * 100,
										2
									)} ({BAND_NAMES[mb.profileRig.band]})
								</li>
							{/if}
						</ul>
					{/if}
					{#if mb.source !== 'facility'}
						<p
							class="text-xs {muted}"
							data-bonus-note={mb.reactorSettingsSystem ? 'reactor-system' : 'unknown'}
						>
							{#if mb.reactorSettingsSystem}
								This structure is in the system of your reactor settings, so {mb.source === 'profile'
									? 'their structure and ME rig are'
									: 'their ME rig is'} used for it. To use others, set its {mb.source === 'profile'
									? 'structure and rigs'
									: 'rigs'} on
								<a href="/account/tracking#facilities" class={link}>Profit tracking settings</a>.
							{:else}
								{mb.source === 'profile'
									? 'The structure of this facility is not known, so your account reactor settings were used.'
									: 'The rigs of this structure are not known, so the ME rig of your reactor settings was used.'}
								Set it on <a href="/account/tracking#facilities" class={link}>Profit tracking settings</a>.
							{/if}
						</p>
					{/if}
				</div>
			{/if}
			{#if d.inputs.length}
				<p class="mb-3 text-xs {muted}">
					Quantities come from the {fuel ? 'blueprint' : 'formula'} and your facility settings. Each input is taken
					from your oldest batches first. Open an input to see its batches.
				</p>
				<div
					class="divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 dark:divide-gray-600 dark:border-gray-600"
				>
					<div class="hidden py-2 sm:grid {inputGrid} {thead}" data-inputs-head>
						<span></span>
						<span>Input</span>
						<span class="text-right">Quantity</span>
						<span class="text-right">Unit price</span>
						<span class="text-right">Cost</span>
					</div>
					{#each d.inputs as input (input.typeId)}
						{@const open = input.lots.some(
							(l) => l.correctionRef !== null && l.correctionRef === result?.ref
						)}
						{@const estimate = input.lots.some((l) => l.origin === 'market')}
						<details class="group" {open} data-input={input.typeId}>
							<summary
								class="{inputGrid} cursor-pointer list-none items-start py-2 hover:bg-gray-50 dark:hover:bg-gray-800 [&::-webkit-details-marker]:hidden"
							>
								<ChevronRightOutline
									class="mt-1 h-4 w-4 text-gray-500 transition-transform group-open:rotate-90"
									aria-hidden="true"
								/>
								<span class="flex min-w-0 flex-col items-start gap-1">
									<span class="flex max-w-full min-w-0 items-center gap-2">
										<img
											src={typeIconUrl(input.typeId)}
											alt=""
											width="24"
											height="24"
											loading="lazy"
											class="h-6 w-6 shrink-0 rounded"
										/>
										<a
											href="/profits/ledger/{input.typeId}"
											class="truncate font-medium {link}"
											data-item-link>{input.name}</a
										>
									</span>
									<span class="max-w-full overflow-hidden" data-mix>
										<Pill tone={estimate ? 'amber' : 'gray'}>{sourceMix(input)}</Pill>
									</span>
								</span>
								<span class="pt-0.5 text-right tabular-nums" title="Quantity used" data-quantity>
									{formatNumber(input.quantity)}
									<span class="text-xs {muted} sm:hidden">used</span>
								</span>
								<span
									class="col-start-2 text-xs sm:col-start-auto sm:pt-0.5 sm:text-right sm:text-sm {muted}"
									title="Average unit price"
									data-average
									><Isk value={input.quantity ? input.cost / input.quantity : null} />
									<span class="sm:hidden">each</span></span
								>
								<span class="text-right font-medium tabular-nums sm:pt-0.5" title="Cost" data-cost>
									<Isk value={input.cost} estimated={estimate ? ESTIMATE.inputs : null} />
								</span>
							</summary>
							<div
								class="relative overflow-x-auto border-t border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800"
							>
								<table class="w-full text-left text-sm" aria-label="Batches of {input.name}">
									<thead class={thead}>
										<tr>
											<th class={cell}>Acquired</th>
											<th class={cell}>Where from</th>
											<th class={cell}>Price from</th>
											<th class="{cell} text-right">Quantity</th>
											<th class="{cell} text-right">Unit cost</th>
											<th class="{cell} text-right">Cost</th>
											<th class={cell}><span class="sr-only">Correction</span></th>
										</tr>
									</thead>
									<tbody>
										{#each input.lots as lot (lot.lotId)}
											<tr class="border-t border-gray-200 dark:border-gray-700" data-lot={lot.lotId}>
												<td class="{cell} whitespace-nowrap {muted}" title={formatUtc(lot.acquiredAt)}
													>{formatRelative(lot.acquiredAt, d.now)}</td
												>
												<td class="{cell} text-gray-900 dark:text-gray-100" data-origin={lot.origin}>
													{ORIGIN_TEXT[lot.origin]}
													{#if lot.madeBy}
														<a
															href="/profits/jobs/{lot.madeBy.jobId}"
															class="block text-xs {link}"
															data-made-by={lot.madeBy.jobId}
															>{lot.madeBy.formula.name ?? 'Unknown formula'}</a
														>
													{/if}
													{#if lot.origin === 'market'}<Estimated reason={ESTIMATE.inputs} />{/if}
												</td>
												<td class="{cell} text-xs text-gray-600 dark:text-gray-400" data-price-from>
													{#if lot.priceSource !== ORIGIN_TEXT[lot.origin]}{lot.priceSource}{/if}
												</td>
												<td class={num}>{formatNumber(lot.quantity)}</td>
												<td class={num}><Isk value={lot.unitCost} /></td>
												<td class={num}><Isk value={lot.cost} /></td>
												<td class={cell}>
													{#if lot.correctionRef && (lot.origin === 'market' || lot.origin === 'correction')}
														<CorrectionForm
															kind="job_input"
															ref={lot.correctionRef}
															correction={lot.corrected
																? { unitPrice: lot.unitCost, note: lot.correctionNote }
																: null}
															form={result}
														/>
													{/if}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</details>
					{/each}
				</div>
			{:else}
				<p class={muted} data-no-inputs>
					No inputs recorded for this job yet. They show up once the numbers are updated.
				</p>
			{/if}
		</section>

		<section class={card} data-output>
			<h2 class={heading}>Output</h2>
			{#if d.output}
				{@const output = d.output}
				<div class="flex flex-wrap items-center justify-between gap-3">
					<a href="/profits/ledger/{output.typeId}" class="inline-flex items-center gap-2 font-medium {link}">
						<img src={typeIconUrl(output.typeId)} alt="" width="32" height="32" class="h-8 w-8 rounded" />
						{output.name}
					</a>
					<span class="text-lg font-semibold text-gray-900 tabular-nums dark:text-gray-100"
						>{formatNumber(output.quantity)} <span class="text-sm font-normal {muted}">made</span></span
					>
				</div>
				<div class="mt-2">
					<JobOutputBar
						soldQty={output.soldQty}
						usedQty={output.usedQty}
						manufacturedQty={output.manufacturedQty}
						unsoldQty={output.unsoldQty}
						size="md"
						legend
					/>
				</div>
				<div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div data-sales>
						<h3 class="mb-2 text-xs font-semibold text-gray-700 uppercase dark:text-gray-300">Sales</h3>
						{#if output.sales.length}
							<div class="relative overflow-x-auto">
								<table class="w-full text-left text-sm" aria-label="Sales of {output.name}">
									<thead class={thead}>
										<tr>
											<th class={cell}>Sold</th>
											<th class="{cell} text-right">Quantity</th>
											<th class="{cell} text-right">Net per unit</th>
											<th class={cell}><span class="sr-only">Ledger</span></th>
										</tr>
									</thead>
									<tbody>
										{#each output.sales as sale (sale.ref)}
											<tr class="border-t border-gray-200 dark:border-gray-700" data-sale={sale.ref}>
												<td class="{cell} whitespace-nowrap" title={formatUtc(sale.at)}>
													{formatRelative(sale.at, d.now)}
													<span class="block text-xs {muted}"
														>{sale.kind === 'contract' ? 'Contract' : 'Market'}</span
													>
												</td>
												<td class={num}>{formatNumber(sale.quantity)}</td>
												<td class={num}><Isk value={sale.netUnitValue} /></td>
												<td class={cell}>
													<a href="/profits/ledger?type={output.typeId}" class="text-xs {link}" data-sale-link
														>In the ledger</a
													>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{:else}
							<p class={muted}>None sold yet.</p>
						{/if}
					</div>
					<div class="space-y-4">
						<div data-used-by>
							<h3 class="mb-2 text-xs font-semibold text-gray-700 uppercase dark:text-gray-300">
								Used by later jobs
							</h3>
							{#if output.usedBy.length}
								<div class="flex flex-wrap gap-2">
									{#each output.usedBy as next (next.jobId)}{@render jobChip(next)}{/each}
								</div>
							{:else}
								<p class={muted}>None of it went into a later job.</p>
							{/if}
						</div>
						{#if output.manufacturing.length}
							<div data-manufacturing>
								<h3 class="mb-2 text-xs font-semibold text-gray-700 uppercase dark:text-gray-300">
									Used in manufacturing
								</h3>
								<div class="relative overflow-x-auto">
									<table
										class="w-full text-left text-sm"
										aria-label="Manufacturing jobs that used {output.name}"
									>
										<thead class={thead}>
											<tr>
												<th class={cell}>Manufacturing job</th>
												<th class={cell}>Started</th>
												<th class="{cell} text-right">Quantity</th>
												<th class="{cell} text-right">Per unit</th>
											</tr>
										</thead>
										<tbody>
											{#each output.manufacturing as m (m.jobId)}
												<tr
													class="border-t border-gray-200 dark:border-gray-700"
													data-manufacturing-job={m.jobId}
												>
													<td class={cell}>
														<span class="inline-flex items-center gap-2">
															{#if m.product}
																<img
																	src={typeIconUrl(m.product.typeId)}
																	alt=""
																	width="24"
																	height="24"
																	loading="lazy"
																	class="h-6 w-6 shrink-0 rounded"
																/>
															{/if}
															<span>
																<span class="text-gray-900 dark:text-gray-100"
																	>{m.product?.name ?? 'Unknown blueprint'}</span
																>
																<span class="block text-xs {muted}">Manufacturing job</span>
															</span>
														</span>
													</td>
													<td class="{cell} whitespace-nowrap" title={formatUtc(m.at)}>
														{formatRelative(m.at, d.now)}
													</td>
													<td class={num}>{formatNumber(m.quantity)}</td>
													<td class={num}>
														<Isk value={m.unitValue} />
														<span class="block text-xs {muted}" data-basis={m.basis}
															>{BASIS_TEXT[m.basis]}</span
														>
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}
						{#if output.unsoldQty > 0}
							<p data-unsold>
								<span class="font-medium text-gray-900 dark:text-gray-100"
									>{formatNumber(output.unsoldQty)} unsold</span
								>
								{#if output.unsoldValueNow === null}
									<span class={muted}>: no market price today with your settings.</span>
								{:else}
									worth <Isk value={output.unsoldValueNow} estimated={ESTIMATE.unsold} /> today
									<span class={muted}>(<Isk value={output.unitValueNow} /> each).</span>
								{/if}
							</p>
						{/if}
					</div>
				</div>
			{:else if job.status === 'running'}
				<p class={muted} data-no-output>
					{job.product ? `Still running. It makes ${job.product.name}.` : 'Still running.'}
				</p>
			{:else if job.status === 'cancelled'}
				<p class={muted}>Cancelled: no output.</p>
			{:else}
				<p class={muted}>The output is not worked out yet. It shows up once the numbers are updated.</p>
			{/if}
		</section>

		<section class={card} data-chain>
			<h2 class={heading}>Chain</h2>
			{#if d.chain.from.length || d.chain.to.length}
				<div class="flex flex-col gap-3 md:flex-row md:items-center">
					<div class="flex flex-wrap gap-2" data-chain-from>
						{#each d.chain.from as prev (prev.jobId)}{@render jobChip(prev)}{:else}<span
								class="text-xs whitespace-nowrap {muted}">No earlier job</span
							>{/each}
					</div>
					<ArrowRightOutline
						class="h-4 w-4 shrink-0 rotate-90 text-gray-400 md:rotate-0"
						aria-hidden="true"
					/>
					<div data-chain-this>
						{@render jobChip(
							{ jobId: job.jobId, formula: job.formula, startDate: job.startDate, quantity: 0 },
							true
						)}
					</div>
					<ArrowRightOutline
						class="h-4 w-4 shrink-0 rotate-90 text-gray-400 md:rotate-0"
						aria-hidden="true"
					/>
					<div class="flex flex-wrap gap-2" data-chain-to>
						{#each d.chain.to as next (next.jobId)}{@render jobChip(next)}{:else}<span
								class="text-xs whitespace-nowrap {muted}">No later job</span
							>{/each}
					</div>
				</div>
				<p class="mt-2 text-xs {muted}">
					Jobs that made this job's inputs, and jobs that used its output. The units are what moved between
					them.
				</p>
			{:else}
				<p class={muted}>No other tracked job made this job's inputs or used its output.</p>
			{/if}
		</section>
	</div>
{/if}
