import { defineProject } from 'vitest/config';
import { sveltePlugin, webAliases } from './vitest.shared.ts';

export default defineProject({
	plugins: [sveltePlugin()],
	resolve: { alias: webAliases },
	test: {
		name: 'web-unit',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		exclude: ['src/**/*.svelte.test.ts'],
		passWithNoTests: true
	}
});
