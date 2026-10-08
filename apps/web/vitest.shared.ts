import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The SvelteKit Vite plugin resolves its project from `process.cwd()`, which is the repo root when the
 * root vitest config runs every project. Web tests therefore use the plain Svelte plugin with the
 * `$lib`/`$app` aliases SvelteKit would provide; `$app/*` modules map to test shims.
 */
export const webAliases = [
	{ find: /^\$lib\/(.*)$/, replacement: `${src}/lib/$1` },
	{ find: /^\$lib$/, replacement: `${src}/lib` },
	{ find: /^\$app\/(.*)$/, replacement: `${src}/test/shims/app/$1.ts` }
];

export const sveltePlugin = () => svelte({ configFile: false });
