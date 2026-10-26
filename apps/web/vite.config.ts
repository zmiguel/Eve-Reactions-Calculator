import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// WRANGLER_CONFIG: the e2e server builds with its own config (scripts/e2e-server.ts); WRANGLER_PERSIST
			// points `vite dev` at another local state (e.g. a copy of .wrangler/state).
			adapter: adapter({
				config: process.env.WRANGLER_CONFIG,
				platformProxy: {
					configPath: process.env.WRANGLER_CONFIG ?? 'wrangler.jsonc',
					persist: {
						path: process.env.WRANGLER_PERSIST ?? '../../.wrangler/state/v3'
					}
				}
			}),

			// Only pages that opt in (`export const prerender = true`) are prerendered; links to SSR pages are not crawled.
			prerender: { crawl: false }
		})
	],
	// Compile-time flags of Vue's esm-bundler build (Scalar's API reference on /api is a Vue app).
	define: {
		__VUE_OPTIONS_API__: 'true',
		__VUE_PROD_DEVTOOLS__: 'false',
		__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
	}
});
