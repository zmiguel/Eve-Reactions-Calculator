<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import SettingsForm from '$lib/components/settings/SettingsForm.svelte';
	import ShareLink from '$lib/components/settings/ShareLink.svelte';
	import Seo from '$lib/seo/Seo.svelte';

	let { data, form } = $props();

	const NOTICE_TEXT = {
		saved: 'Settings saved. Every page now uses them.',
		reset: 'Settings reset to the defaults.',
		imported: 'Imported settings applied.'
	} as const;

	const failure = $derived(form && 'errors' in form ? form : null);
	const importError = $derived(form && 'importError' in form ? form.importError : data.importInvalid);
	const shareUrl = $derived(`${page.url.origin}/settings?import=${data.shareCode}`);
	const updatedAt = $derived(
		data.account?.updatedAt
			? new Date(data.account.updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
			: null
	);

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const heading = 'mb-3 text-sm font-semibold tracking-wide text-gray-800 uppercase dark:text-gray-200';
</script>

<Seo
	title="Settings"
	description="Configure structure, rigs, system, taxes, market hubs, shipping and reprocessing for every reaction profit on the EVE Online Reactions Calculator."
	path="/settings"
	noindex="noindex, follow"
/>

<div class="space-y-4 pb-4">
	<header
		class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b-2 border-gray-300 pb-3 dark:border-gray-600"
	>
		<div>
			<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">Settings</h1>
			<p class="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">
				Your facility, market and shipping settings drive every profit on the site.
			</p>
		</div>
		<p class="text-xs text-gray-600 sm:text-sm dark:text-gray-400" data-sync-status>
			{#if data.account}
				<span class="font-semibold text-gray-800 dark:text-gray-200">Synced to your account</span
				>{#if updatedAt}
					· last saved {updatedAt}{/if}
			{:else}
				<span class="font-semibold text-gray-800 dark:text-gray-200">Saved in this browser (cookie)</span>
				·
				<a
					href="/auth/login?purpose=login&returnTo=%2Fsettings"
					data-sveltekit-reload
					class="text-primary-700 hover:underline dark:text-primary-400">log in with EVE Online</a
				> to sync them across devices
			{/if}
		</p>
	</header>

	{#if data.notice}
		<p
			role="status"
			class="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
		>
			{NOTICE_TEXT[data.notice]}
		</p>
	{/if}
	{#if importError}
		<p
			role="alert"
			class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
		>
			{importError}
		</p>
	{/if}

	{#if data.importPreview}
		{@const preview = data.importPreview}
		<section
			class="{card} border-2 border-primary-500 dark:border-primary-400"
			aria-labelledby="import-heading"
			data-import-preview
		>
			<h2 id="import-heading" class={heading}>Import shared settings</h2>
			{#if preview.changes.length === 0}
				<p class="text-gray-700 dark:text-gray-300">These settings are identical to yours.</p>
			{:else}
				<p class="mb-2 text-gray-700 dark:text-gray-300">
					{preview.changes.length === 1 ? '1 setting differs' : `${preview.changes.length} settings differ`} from
					yours; everything else is identical.
				</p>
				<div class="overflow-x-auto">
					<table
						class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm dark:border-gray-700 dark:bg-gray-800"
					>
						<thead class="bg-gray-100 text-xs text-gray-700 uppercase dark:bg-gray-900 dark:text-gray-400">
							<tr>
								<th scope="col" class="px-3 py-2">Setting</th>
								<th scope="col" class="px-3 py-2">Yours</th>
								<th scope="col" class="px-3 py-2">Imported</th>
							</tr>
						</thead>
						<tbody>
							{#each preview.changes as change (change.path)}
								<tr class="border-t border-gray-200 dark:border-gray-700" data-change={change.path}>
									<td class="px-3 py-2 text-gray-900 dark:text-gray-200">
										<span class="text-xs text-gray-500 dark:text-gray-400">{change.scope} ·</span>
										{change.label}
									</td>
									<td class="px-3 py-2 text-gray-600 tabular-nums dark:text-gray-400">{change.from}</td>
									<td
										class="bg-primary-50 px-3 py-2 font-semibold text-primary-800 tabular-nums dark:bg-primary-900/40 dark:text-primary-300"
										>{change.to}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if preview.problems.length > 0}
				<div
					role="alert"
					class="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
				>
					<p class="font-semibold">These settings cannot be applied:</p>
					<ul class="list-inside list-disc">
						{#each preview.problems as problem (problem)}<li>{problem}</li>{/each}
					</ul>
				</div>
			{/if}
			<form method="POST" action="?/import" use:enhance class="mt-3 flex flex-wrap items-center gap-3">
				<input type="hidden" name="code" value={preview.code} />
				{#if preview.problems.length === 0}
					<Button type="submit" color="primary" size="sm" class="cursor-pointer">Apply these settings</Button>
				{/if}
				<a href="/settings" class="text-sm font-medium text-primary-700 hover:underline dark:text-primary-400"
					>Keep my settings</a
				>
			</form>
		</section>
	{/if}

	{#key form}
		{#key data}
			<SettingsForm
				settings={failure?.values ?? data.settings}
				hubs={data.hubs}
				systems={data.systems}
				errors={failure?.errors}
				systemText={failure?.systemText}
				constants={data.constants}
			/>
		{/key}
	{/key}

	<section class={card} aria-labelledby="share-heading">
		<h2 id="share-heading" class={heading}>Share settings</h2>
		<p class="mb-2 text-gray-600 dark:text-gray-400">
			Send this link to a corp mate (or open it on another device). It shows your settings next to theirs and
			changes nothing until they choose to apply them.
		</p>
		<ShareLink url={shareUrl} />
		<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
			Settings are kept in a single functional cookie, set only when you save, that stores just the values you
			changed from the defaults. Resetting to the defaults removes it.
		</p>
	</section>
</div>
