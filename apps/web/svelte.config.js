import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// WRANGLER_CONFIG: the e2e server builds with its own config (scripts/e2e-server.ts); WRANGLER_PERSIST
		// points `vite dev` at another local state (e.g. a copy of .wrangler/state).
		adapter: adapter({
			config: process.env.WRANGLER_CONFIG,
			platformProxy: {
				configPath: process.env.WRANGLER_CONFIG ?? 'wrangler.jsonc',
				persist: { path: process.env.WRANGLER_PERSIST ?? '../../.wrangler/state/v3' }
			}
		}),
		// Only pages that opt in (`export const prerender = true`) are prerendered; links to SSR pages are not crawled.
		prerender: { crawl: false }
	}
};

export default config;
