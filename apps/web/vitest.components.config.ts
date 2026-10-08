import { svelteTesting } from '@testing-library/svelte/vite';
import { defineProject } from 'vitest/config';
import { sveltePlugin, webAliases } from './vitest.shared.ts';

export default defineProject({
	plugins: [sveltePlugin(), svelteTesting()],
	resolve: { alias: webAliases, conditions: ['browser'] },
	test: {
		name: 'web-components',
		environment: 'jsdom',
		include: ['src/**/*.svelte.test.ts'],
		setupFiles: ['src/test/setup-components.ts']
	}
});
