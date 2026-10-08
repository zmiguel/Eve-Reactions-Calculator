import type { createApiReference } from '@scalar/api-reference';
import { SITE_URL } from '$lib/site';

/** The OpenAPI document the `/api` reference renders. */
export const OPENAPI_URL = '/api/v2/openapi.json';

type ScalarConfiguration = Exclude<Parameters<typeof createApiReference>[1], unknown[]>;

/** Tailwind v4 palette entries the site uses (gray surfaces, sky accent). */
const GRAY = {
	50: 'oklch(98.5% 0.002 247.839)',
	100: 'oklch(96.7% 0.003 264.542)',
	200: 'oklch(92.8% 0.006 264.531)',
	300: 'oklch(87.2% 0.01 258.338)',
	400: 'oklch(70.7% 0.022 261.325)',
	500: 'oklch(55.1% 0.027 264.364)',
	600: 'oklch(44.6% 0.03 256.802)',
	700: 'oklch(37.3% 0.034 259.733)',
	800: 'oklch(27.8% 0.033 256.848)',
	900: 'oklch(21% 0.034 264.665)'
};
const SKY = {
	400: 'oklch(74.6% 0.16 232.661)',
	600: 'oklch(58.8% 0.158 241.966)',
	700: 'oklch(50% 0.134 242.749)'
};

/**
 * Scalar theme (`theme: 'none'`): the site's page/card greys, sky accent and system fonts. Scalar
 * scopes colours to `body.light-mode` / `body.dark-mode`; `--scalar-custom-header-height` keeps its
 * sticky sidebar below the fixed 49 px navbar.
 */
export const SCALAR_CSS = `
.scalar-app {
	--scalar-font: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
	--scalar-font-code: var(--font-mono, ui-monospace, monospace);
	--scalar-custom-header-height: 49px;
	--scalar-radius: 6px;
	--scalar-paragraph: 14px;
	--scalar-page-description: 15px;
	--scalar-heading-1: 22px;
	--scalar-heading-2: 18px;
}
.light-mode {
	--scalar-background-1: ${GRAY[100]};
	--scalar-background-2: #fff;
	--scalar-background-3: ${GRAY[200]};
	--scalar-background-accent: color-mix(in oklch, ${SKY[600]} 12%, transparent);
	--scalar-color-1: ${GRAY[900]};
	--scalar-color-2: ${GRAY[600]};
	--scalar-color-3: ${GRAY[500]};
	--scalar-color-accent: ${SKY[700]};
	--scalar-border-color: ${GRAY[200]};
	--scalar-link-color: ${SKY[700]};
	--scalar-button-1: ${SKY[700]};
	--scalar-button-1-hover: ${SKY[600]};
	--scalar-button-1-color: #fff;
	--scalar-sidebar-background-1: ${GRAY[100]};
	--scalar-sidebar-item-active-background: ${GRAY[200]};
	--scalar-sidebar-color-active: ${SKY[700]};
}
.dark-mode {
	--scalar-background-1: ${GRAY[800]};
	--scalar-background-2: ${GRAY[700]};
	--scalar-background-3: ${GRAY[600]};
	--scalar-background-accent: color-mix(in oklch, ${SKY[400]} 15%, transparent);
	--scalar-color-1: ${GRAY[200]};
	--scalar-color-2: ${GRAY[400]};
	--scalar-color-3: ${GRAY[500]};
	--scalar-color-accent: ${SKY[400]};
	--scalar-border-color: ${GRAY[700]};
	--scalar-link-color: ${SKY[400]};
	--scalar-button-1: ${SKY[600]};
	--scalar-button-1-hover: ${SKY[700]};
	--scalar-button-1-color: #fff;
	--scalar-sidebar-background-1: ${GRAY[800]};
	--scalar-sidebar-item-active-background: ${GRAY[700]};
	--scalar-sidebar-color-active: ${SKY[400]};
}
.light-mode, .dark-mode {
	--scalar-link-color-hover: var(--scalar-link-color);
	--scalar-sidebar-item-hover-background: var(--scalar-background-3);
	--scalar-sidebar-search-background: var(--scalar-background-2);
}
`;

/**
 * Scalar API reference configuration for `/api`: the site theme in the current colour mode, no
 * Scalar dark-mode toggle, and nothing that talks to Scalar's services (telemetry, agent, MCP,
 * developer toolbar, hosted client/proxy, web fonts). Off production the current origin is offered
 * first so "Test request" hits the server the page came from.
 */
export function scalarConfig(dark: boolean, origin: string): ScalarConfiguration {
	return {
		url: OPENAPI_URL,
		layout: 'modern',
		theme: 'none',
		customCss: SCALAR_CSS,
		withDefaultFonts: false,
		forceDarkModeState: dark ? 'dark' : 'light',
		hideDarkModeToggle: true,
		hideClientButton: true,
		documentDownloadType: 'direct',
		defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
		featuredClients: ['shell/curl', 'js/fetch', 'node/fetch', 'python/requests', 'php/guzzle'],
		telemetry: false,
		showDeveloperTools: 'never',
		agent: { disabled: true },
		mcp: { disabled: true },
		...(origin === SITE_URL
			? {}
			: {
					servers: [
						{ url: origin, description: 'This server' },
						{ url: SITE_URL, description: 'Production' }
					]
				})
	};
}

/**
 * Scalar writes `history.pushState({})` / `replaceState({})` (sidebar clicks, scroll-spy hashes). An
 * entry without SvelteKit's `sveltekit:*` keys breaks Back from another page (SvelteKit then only
 * rewrites the URL and keeps the other page on screen), so while Scalar is mounted its writes inherit
 * the current entry's keys. SvelteKit's own writes pass through unchanged.
 */
function keepRouterState(): () => void {
	const { pushState, replaceState } = history;
	const wrap = (write: History['pushState']): History['pushState'] =>
		function (this: History, state, unused, url) {
			const own =
				state !== null &&
				typeof state === 'object' &&
				Object.keys(state).some((key) => key.startsWith('sveltekit:'));
			return write.call(this, own ? state : { ...history.state, ...state }, unused, url);
		};
	history.pushState = wrap(pushState);
	history.replaceState = wrap(replaceState);
	return () => {
		history.pushState = pushState;
		history.replaceState = replaceState;
	};
}

/**
 * Loads Scalar (client only, its own chunk) into `el` and keeps its colour mode on the site theme:
 * Scalar paints through `body.dark-mode` / `body.light-mode`, `ThemeToggle` flips `html.dark`.
 * Resolves to a cleanup function.
 */
export async function mountScalar(el: HTMLElement): Promise<() => void> {
	const [{ createApiReference }] = await Promise.all([
		import('@scalar/api-reference'),
		import('@scalar/api-reference/style.css')
	]);
	const html = document.documentElement;
	const body = document.body;
	const restoreHistory = keepRouterState();
	const reference = createApiReference(el, scalarConfig(html.classList.contains('dark'), location.origin));
	const sync = () => {
		const dark = html.classList.contains('dark');
		body.classList.toggle('dark-mode', dark);
		body.classList.toggle('light-mode', !dark);
	};
	sync();
	// Watching `body` too re-applies the site mode if Scalar resets the class (e.g. on an OS theme change).
	const observer = new MutationObserver(sync);
	observer.observe(html, { attributes: true, attributeFilter: ['class'] });
	observer.observe(body, { attributes: true, attributeFilter: ['class'] });
	return () => {
		observer.disconnect();
		reference.destroy();
		restoreHistory();
		body.classList.remove('dark-mode', 'light-mode');
	};
}
