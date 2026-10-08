import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/engine/vitest.config.ts',
			'packages/sde/vitest.config.ts',
			'packages/db/vitest.config.ts',
			'packages/eve/vitest.config.ts',
			'apps/updater/vitest.config.ts',
			'apps/web/vitest.unit.config.ts',
			'apps/web/vitest.components.config.ts',
			'scripts/vitest.config.ts'
		]
	}
});
