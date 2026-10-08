<script lang="ts">
	import { SITE_NAME, SITE_URL } from '$lib/site';

	interface Props {
		/** The page's own title; the document title is `<title> | EVE Reactions Calculator`. */
		title: string;
		description: string;
		/** Path of the canonical URL (query strings are dropped). */
		path: string;
		/** `true` → `noindex`; a string is used verbatim (e.g. `noindex, follow`). */
		noindex?: boolean | string;
		jsonLd?: Record<string, unknown> | Record<string, unknown>[];
	}

	let { title, description, path, noindex = false, jsonLd }: Props = $props();

	const fullTitle = $derived(`${title} | ${SITE_NAME}`);
	const canonical = $derived(SITE_URL + (path.split(/[?#]/)[0] || '/'));
	const image = `${SITE_URL}/og-default.png`;
	// `<` is escaped so the JSON can never close the script element; the closing tag is split for the same reason.
	const ldScript = $derived(
		jsonLd
			? '<script type="application/ld+json">' +
					JSON.stringify(jsonLd).replace(/</g, '\\u003c') +
					'<' +
					'/script>'
			: null
	);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	{#if noindex}
		<meta name="robots" content={noindex === true ? 'noindex' : noindex} />
	{/if}
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={image} />
	{#if ldScript}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html ldScript}
	{/if}
</svelte:head>
