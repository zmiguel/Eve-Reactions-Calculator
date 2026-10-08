<script lang="ts">
	import { onMount } from 'svelte';
	import Seo from '$lib/seo/Seo.svelte';
	import { SITE_URL } from '$lib/site';
	import { OPENAPI_URL, mountScalar } from '$lib/scalar';

	const api = (path: string) => `${SITE_URL}/api/v2/${path}`;
	const SHEETS = [
		{ label: 'Composite profits', path: 'profits?reactor=composite&format=csv' },
		{
			label: 'Jita prices of Caesarium Cadmide and Titanium Carbide',
			path: 'prices?hub=jita&types=16663,16671&format=csv'
		},
		{
			label: 'Composite full chains with optimal slots, your system and broker fee',
			path: 'profits?reactor=composite&view=chain&slots=optimal&system=671-ST&broker=1.5&format=csv'
		},
		{
			label: 'Daily Jita price history of Caesarium Cadmide',
			path: 'prices/history?hub=jita&type=16663&format=csv'
		}
	].map((s) => ({ label: s.label, formula: `=IMPORTDATA("${api(s.path)}")` }));

	/** Scalar section anchor of the profits endpoint (lists every settings parameter). */
	const PROFITS_ANCHOR = '#tag/profits/GET/api/v2/profits';

	let copy = $state<{ index: number; ok: boolean } | null>(null);
	const codes: HTMLElement[] = $state([]);

	async function copyFormula(index: number) {
		try {
			await navigator.clipboard.writeText(SHEETS[index].formula);
			copy = { index, ok: true };
		} catch {
			// No clipboard permission (or no secure context): select the formula for manual copying.
			copy = { index, ok: false };
			const range = document.createRange();
			range.selectNodeContents(codes[index]);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
		}
	}

	$effect(() => {
		if (!copy?.ok) return;
		const timer = setTimeout(() => (copy = null), 2000);
		return () => clearTimeout(timer);
	});

	let reference: HTMLDivElement;
	let status = $state<'loading' | 'ready' | 'failed'>('loading');

	onMount(() => {
		let cleanup: (() => void) | undefined;
		let destroyed = false;
		mountScalar(reference).then(
			(dispose) => {
				if (destroyed) return dispose();
				cleanup = dispose;
				status = 'ready';
			},
			() => (status = 'failed')
		);
		return () => {
			destroyed = true;
			cleanup?.();
		};
	});

	const card = 'rounded-lg bg-white p-4 text-sm dark:bg-gray-700';
	const h2 = 'mb-2 text-lg font-semibold text-gray-800 dark:text-gray-200';
	const code =
		'rounded bg-gray-100 px-1 font-mono text-xs text-primary-700 dark:bg-gray-800 dark:text-primary-400';
</script>

<Seo
	title="API"
	description="Free JSON and CSV API for EVE Online reaction profits, recipes, market prices, price history, cost indices and slot planning. Works with Google Sheets IMPORTDATA."
	path="/api"
/>

<article class="space-y-4 [&_a]:text-primary-700 [&_a]:hover:underline dark:[&_a]:text-primary-400">
	<div
		class="flex flex-wrap items-end justify-between gap-2 border-b-2 border-gray-300 pb-2 dark:border-gray-600"
	>
		<h1 class="text-xl font-bold text-gray-800 sm:text-2xl dark:text-gray-200">API v2</h1>
		<p class="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
			Base URL <code class={code}>{SITE_URL}</code> · OpenAPI 3.1:
			<a href={OPENAPI_URL}>{OPENAPI_URL}</a>
		</p>
	</div>

	<div class="grid gap-4 lg:grid-cols-5">
		<section class="{card} lg:col-span-2">
			<h2 class={h2}>Overview</h2>
			<ul class="list-disc space-y-1.5 pl-4">
				<li>
					Anonymous and free: no key, no login. JSON by default; tabular endpoints also answer CSV with
					<code class={code}>format=csv</code>.
				</li>
				<li>
					Rate limit <strong>120 requests per minute per IP</strong> (429
					<code class={code}>RATE_LIMITED</code>,
					<code class={code}>Retry-After: 60</code>).
				</li>
				<li>
					Only <strong>public market hubs</strong> (<a href="/api/v2/hubs">/api/v2/hubs</a>); private
					structure markets answer like unknown hubs (404).
				</li>
				<li>CORS is open (<code class={code}>Access-Control-Allow-Origin: *</code>).</li>
				<li>API v1 was removed: every <code class={code}>/api/v1/…</code> URL answers 410.</li>
			</ul>
		</section>

		<section class="{card} lg:col-span-3" id="google-sheets">
			<h2 class={h2}>Google Sheets</h2>
			<p class="mb-2">
				Paste a formula into a cell: the CSV header lands in that row, one row per item below. Sheets caches
				IMPORTDATA results for about an hour, and every sheet counts towards the 120 requests per minute.
				Settings (system, structure, rigs, fees, hubs, shipping…) are URL parameters; see
				<a href={PROFITS_ANCHOR}>GET /api/v2/profits</a> below for the full list.
			</p>
			<ul class="space-y-2">
				{#each SHEETS as s, i (s.formula)}
					<li>
						<div class="mb-0.5 text-xs text-gray-600 dark:text-gray-400">{s.label}</div>
						<div class="flex items-start gap-2">
							<code
								bind:this={codes[i]}
								class="min-w-0 flex-1 rounded bg-gray-100 px-2 py-1 font-mono text-xs break-all select-all dark:bg-gray-800"
								>{s.formula}</code
							>
							<button
								type="button"
								class="shrink-0 cursor-pointer rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-600"
								aria-label="Copy formula: {s.label}"
								onclick={() => copyFormula(i)}
							>
								{copy?.index === i && copy.ok ? 'Copied' : 'Copy'}
							</button>
						</div>
					</li>
				{/each}
			</ul>
			<p role="status" class="mt-1 h-4 text-xs text-gray-500 dark:text-gray-400">
				{#if copy?.ok}
					Formula copied to the clipboard
				{:else if copy}
					Clipboard unavailable: the formula is selected, press Ctrl+C
				{/if}
			</p>
		</section>
	</div>

	<section aria-label="API reference">
		{#if status !== 'ready'}
			<p class="{card} text-gray-600 dark:text-gray-400">
				{#if status === 'failed'}
					The interactive reference could not be loaded. The full description is the
					<a href={OPENAPI_URL}>OpenAPI document</a>.
				{:else}
					Loading the API reference…
					<noscript>It needs JavaScript; the full description is the OpenAPI document linked above.</noscript>
				{/if}
			</p>
		{/if}
		<div bind:this={reference}></div>
	</section>
</article>
