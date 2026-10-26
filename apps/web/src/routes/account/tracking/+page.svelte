<script lang="ts">
	import { DEFAULT_BLUEPRINT_ME } from '@reactions/engine';
	import { enhance } from '$app/forms';
	import FacilityEditor from '#lib/components/account/FacilityEditor.svelte';
	import { formatNumber, formatUtc } from '#lib/format.js';
	import { blueprintIconUrl } from '#lib/site.js';
	import Seo from '#lib/seo/Seo.svelte';

	let { data, form } = $props();

	type FormName = 'contracts' | 'facilities' | 'manufacturing' | 'period';
	let saving = $state<FormName | null>(null);
	const submit = (name: FormName) => () => {
		saving = name;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			saving = null;
		};
	};
	const hasManufacturing = $derived(data.facilities.list.some((f) => f.jobs.manufacturing > 0));

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
	const button =
		'inline-flex cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600';
	const field =
		'rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
	const label = 'flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400';
	const muted = 'text-gray-500 dark:text-gray-400';
	const link = 'text-primary-700 hover:underline dark:text-primary-400';

	const USES = [
		[
			'buy_value',
			'At its buy value',
			'Count it at its buy value on the day the manufacturing job started (profit = buy value − what it cost you).'
		],
		['zero', 'At what it cost you', 'Count it at what it cost you (no profit, no loss).']
	] as const;
	const PERIODS = [
		['7', '7 days'],
		['30', '30 days'],
		['90', '90 days'],
		['365', '1 year'],
		['all', 'All time']
	] as const;
</script>

<Seo
	title="Profit tracking"
	description="Settings for profit tracking of your EVE Online Reactions Calculator account."
	path="/account/tracking"
	noindex
/>

<!-- The outcome of a save, next to the Save button that was clicked. -->
{#snippet message(name: FormName)}
	{#if form?.form === name && (form.notice || form.error)}
		<p
			role={form.error ? 'alert' : 'status'}
			data-notice={form.error ? 'error' : 'ok'}
			class="rounded-md border px-3 py-1.5 text-sm {form.error
				? 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
				: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300'}"
		>
			{form.error ?? form.notice}
		</p>
	{/if}
{/snippet}

<div class="space-y-4 pb-4">
	<header class="border-b-2 border-gray-300 pb-3 dark:border-gray-600">
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Profit tracking</h1>
		<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
			How the jobs, trades and contracts of your connections with Profit tracking on are priced.
		</p>
	</header>

	<section class={card} data-summary>
		<h2 class="mb-3 {heading}">Tracked connections</h2>
		{#if data.connections.length}
			<ul class="space-y-1" data-connections>
				{#each data.connections as c (c.sourceId)}
					<li class="flex flex-wrap items-baseline gap-2">
						<span class="font-semibold text-gray-900 dark:text-gray-100">{c.ownerName}</span>
						<span class="text-xs {muted}">{c.kind === 'corporation' ? 'Corporation' : 'Character'}</span>
						<span class="text-xs {muted}"
							>{c.trackingSyncedAt ? `Synced ${formatUtc(c.trackingSyncedAt)}` : 'Not synced yet'}</span
						>
					</li>
				{/each}
			</ul>
			<p class="mt-2 {muted}">
				Switch Profit tracking on or off per connection on <a href="/account/connections" class={link}
					>Connections</a
				>.
			</p>
		{:else}
			<p class={muted} data-empty>
				No connection has Profit tracking on. Switch it on for a connection on <a
					href="/account/connections"
					class={link}>Connections</a
				>. A character needs the "Profit tracking" permission, a corporation the "Corporation profit tracking"
				permission.
			</p>
		{/if}
		<p class="mt-2 {muted}" data-rebuilt>
			{#if data.dirty}
				Waiting to be recalculated.
			{:else if data.rebuiltAt}
				Results recalculated {formatUtc(data.rebuiltAt)}.
			{:else}
				Not calculated yet.
			{/if}
		</p>
		{#if data.reviewCount > 0}
			<p class="mt-1 {muted}">
				<a href="/profits/ledger?review=1" class={link}
					>Prices needing review: <span data-review>{formatNumber(data.reviewCount)}</span></a
				>
			</p>
		{/if}
	</section>

	<section class={card}>
		<h2 class="mb-3 {heading}">Contract prices</h2>
		<p class="mb-3 {muted}">
			A contract with one item type gives that item its exact price. A contract with several item types is
			split by the Janice appraisal linked in its title, when there is one. Otherwise it is split by these
			reference prices, and flagged for review when the contract total is outside the expected % plus or minus
			the tolerance.
		</p>
		<form
			method="POST"
			action="?/contracts"
			class="flex flex-wrap items-end gap-3"
			data-form="contracts"
			use:enhance={submit('contracts')}
		>
			<label class={label}>
				Market hub
				<select name="hubId" class="{field} pr-8">
					{#each data.hubs as hub (hub.hubId)}
						<option value={hub.hubId} selected={hub.hubId === data.settings.contractRule.hubId}
							>{hub.name}{hub.private ? ' (private)' : ''}</option
						>
					{/each}
				</select>
			</label>
			<label class={label}>
				Basis
				<select name="basis" class="{field} pr-8">
					{#each [['buy', 'Buy'], ['sell', 'Sell'], ['split', 'Split']] as [value, text] (value)}
						<option {value} selected={value === data.settings.contractRule.basis}>{text}</option>
					{/each}
				</select>
			</label>
			<label class={label}>
				Expected %
				<input
					type="number"
					name="expectedPct"
					min="1"
					max="200"
					step="any"
					required
					value={data.settings.contractRule.expectedPct}
					class="{field} w-24"
				/>
			</label>
			<label class={label}>
				Tolerance (percentage points)
				<input
					type="number"
					name="tolerancePct"
					min="0"
					max="50"
					step="any"
					required
					value={data.settings.contractRule.tolerancePct}
					class="{field} w-24"
				/>
			</label>
			<button type="submit" class={button} disabled={saving === 'contracts'}>Save</button>
			{@render message('contracts')}
		</form>
		<p class="mt-3 {muted}" data-janice>
			Contracts with a Janice link in the title: {formatNumber(data.janice.linked)}, appraisal read for {formatNumber(
				data.janice.appraised
			)}.
		</p>
	</section>

	<section class={card} id="facilities" data-facilities>
		<h2 class="mb-3 {heading}">Facilities</h2>
		{#if data.facilities.list.length}
			{#if data.facilities.needsInput > 0}
				<p class="mb-3 font-medium text-amber-800 dark:text-amber-300" data-needs-count>
					{data.facilities.needsInput === 1
						? '1 facility needs your input.'
						: `${formatNumber(data.facilities.needsInput)} facilities need your input.`}
				</p>
			{/if}
			<p class="mb-3 {muted}">
				The materials of each reaction and manufacturing job depend on the structure it ran in and on the
				installed rigs that affect its product. The structure is looked up in EVE when one of your characters
				can dock there, and the rigs are read from the corporation assets of structures owned by a corporation
				you connected. Pick what EVE could not tell. A reaction facility in the system of your reactor
				settings takes its unknown structure and rigs from those settings; elsewhere, reaction jobs whose
				structure or rigs are not known use the ME rig of your reactor settings.
			</p>
			{#if !data.facilities.industryAvailable}
				<p class="mb-3 {muted}" data-no-industry>
					Rig data is not available yet, so rigs cannot be picked and no structure or rig bonus is applied for
					now. The structures you pick are kept for when it is.
				</p>
			{/if}
			<form method="POST" action="?/facilities" data-form="facilities" use:enhance={submit('facilities')}>
				<ul class="space-y-3">
					{#each data.facilities.list as f (f.facilityId)}
						<FacilityEditor
							facility={f}
							rigs={data.facilities.rigs}
							industryAvailable={data.facilities.industryAvailable}
						/>
					{/each}
				</ul>
				<div class="mt-3 flex flex-wrap items-center gap-3">
					<button type="submit" class={button} disabled={saving === 'facilities'}>Save</button>
					{@render message('facilities')}
				</div>
			</form>
		{:else}
			<p class={muted} data-no-facilities>
				No tracked jobs yet. Facilities appear here after the first jobs sync.
			</p>
		{/if}
	</section>

	<section class={card}>
		<h2 class="mb-3 {heading}">Manufacturing</h2>
		<p class="mb-3 {muted}">
			When one of your manufacturing jobs uses what your reactions made, those units count as used on the day
			the job started.
		</p>
		<form
			method="POST"
			action="?/manufacturing"
			class="space-y-4"
			data-form="manufacturing"
			use:enhance={submit('manufacturing')}
		>
			<fieldset class="space-y-2" data-manufacturing-use>
				<legend class="mb-1 font-semibold text-gray-900 dark:text-gray-100">How used output counts</legend>
				{#each USES as [value, title, text] (value)}
					<label class="flex items-start gap-2">
						<input
							type="radio"
							name="manufacturingUse"
							{value}
							checked={data.settings.manufacturingUse === value}
							class="mt-0.5 h-4 w-4 shrink-0 border-gray-300 bg-gray-50 text-primary-600 focus:ring-primary-500 dark:border-gray-500 dark:bg-gray-800"
						/>
						<span>
							<span class="font-medium text-gray-900 dark:text-gray-100">{title}</span>
							<span class="block text-xs {muted}">{text}</span>
						</span>
					</label>
				{/each}
			</fieldset>

			<div>
				<h3 class="mb-1 font-semibold text-gray-900 dark:text-gray-100">Blueprint ME</h3>
				<p class="mb-2 {muted}">
					The material efficiency (ME) of a blueprint is read from EVE when the blueprint can be seen, which
					needs the blueprint permissions included in Profit tracking. Enter the ME of the blueprints that
					could not be read.
				</p>
				{#if data.blueprints.length}
					<ul class="divide-y divide-gray-200 dark:divide-gray-600">
						{#each data.blueprints as b (b.blueprintTypeId)}
							<li class="flex flex-wrap items-end gap-3 py-2" data-blueprint={b.blueprintTypeId}>
								<div class="flex min-w-48 flex-1 items-center gap-2">
									<img
										src={blueprintIconUrl(Number(b.blueprintTypeId))}
										alt=""
										width="32"
										height="32"
										loading="lazy"
										class="h-8 w-8 shrink-0 rounded"
									/>
									<div>
										<div class="font-semibold text-gray-900 dark:text-gray-100">{b.name}</div>
										<div class="text-xs {muted}">
											{b.jobs === 1 ? '1 job' : `${formatNumber(b.jobs)} jobs`} without a readable ME
										</div>
									</div>
								</div>
								<label class={label}>
									ME
									<input
										type="number"
										name="me-{b.blueprintTypeId}"
										min="0"
										max="10"
										step="1"
										required
										value={data.settings.blueprintMe[b.blueprintTypeId] ?? DEFAULT_BLUEPRINT_ME}
										class="{field} w-20"
									/>
								</label>
							</li>
						{/each}
					</ul>
				{:else if hasManufacturing}
					<p class={muted} data-no-blueprints>Every blueprint of your manufacturing jobs was read.</p>
				{:else}
					<p class={muted} data-no-manufacturing>No manufacturing jobs are tracked yet.</p>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-3">
				<button type="submit" class={button} disabled={saving === 'manufacturing'}>Save</button>
				{@render message('manufacturing')}
			</div>
		</form>
	</section>

	<section class={card}>
		<h2 class="mb-3 {heading}">Profits pages</h2>
		<form
			method="POST"
			action="?/period"
			class="flex flex-wrap items-end gap-3"
			data-form="period"
			use:enhance={submit('period')}
		>
			<label class={label}>
				Default period
				<select name="defaultPeriod" class="{field} pr-8">
					{#each PERIODS as [value, text] (value)}
						<option {value} selected={value === data.settings.defaultPeriod}>{text}</option>
					{/each}
				</select>
			</label>
			<button type="submit" class={button} disabled={saving === 'period'}>Save</button>
			{@render message('period')}
		</form>
		<p class="mt-2 {muted}">The period the Overview and Jobs tabs open on.</p>
	</section>
</div>
