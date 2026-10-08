import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

export default defineProject({
	plugins: [
		cloudflareTest(async () => ({
			miniflare: {
				compatibilityDate: '2026-10-06',
				compatibilityFlags: ['nodejs_compat'],
				d1Databases: ['DB', 'HISTORY_DB'],
				bindings: {
					CORE_MIGRATIONS: await readD1Migrations(
						fileURLToPath(new URL('./migrations/core', import.meta.url))
					),
					HISTORY_MIGRATIONS: await readD1Migrations(
						fileURLToPath(new URL('./migrations/history', import.meta.url))
					)
				}
			}
		}))
	],
	test: {
		name: 'db',
		include: ['test/**/*.test.ts'],
		setupFiles: ['./test/setup.ts']
	}
});
