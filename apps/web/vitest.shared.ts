import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The SvelteKit Vite plugin resolves its project from `process.cwd()`, which is the repo root when the
 * root vitest config runs every project. Web tests therefore use the plain Svelte plugin; `#lib/*` resolves
 * through the `imports` field of `package.json`, `$app/*` modules map to test shims and so does the
 * Workers runtime module `cloudflare:workers`.
 */
export const webAliases = [
	{ find: /^\$app\/(.*)$/, replacement: `${src}/test/shims/app/$1.ts` },
	{ find: /^cloudflare:workers$/, replacement: `${src}/test/shims/cloudflare-workers.ts` }
];

/**
 * Svelte component libraries ship `.svelte` sources and directory imports Node cannot load, so Vite must
 * transform them. Vitest 5 no longer infers this from vite-plugin-svelte's `ssr.noExternal`.
 */
export const inlineDeps = [
	/[\\/]node_modules[\\/](flowbite-svelte|flowbite-svelte-icons|@flowbite-svelte-plugins)[\\/]/
];

export const sveltePlugin = () => svelte({ configFile: false });
