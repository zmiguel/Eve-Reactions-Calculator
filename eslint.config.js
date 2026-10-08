import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'EVE-Reactions-Calculator/',
			'sde/',
			'**/node_modules/',
			'**/.svelte-kit/',
			'**/.wrangler/',
			'**/worker-configuration.d.ts',
			'packages/db/migrations/',
			'**/test-results/',
			'**/playwright-report/',
			'**/.lighthouseci/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			// The app is served from the domain root (no `paths.base`), so plain hrefs are correct.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] } }
	},
	{
		// Tool configs that must stay CommonJS (Lighthouse CI loads its config with `require`).
		files: ['**/*.cjs'],
		rules: { '@typescript-eslint/no-require-imports': 'off' }
	}
);
