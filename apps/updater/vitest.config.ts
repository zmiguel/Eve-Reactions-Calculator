import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

const repoPath = (path: string) => resolve(import.meta.dirname, '../..', path);

export default defineProject({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					EVE_SSO_CLIENT_SECRET: 'test-client-secret',
					EVE_SSO_EXTRA_CLIENT_ID: 'extra-client',
					EVE_SSO_EXTRA_CLIENT_SECRET: 'extra-secret',
					TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
					USER_AGENT_URL: 'https://example.test/',
					USER_AGENT_CONTACT: 'mail:ops@example.test',
					CORE_MIGRATIONS: await readD1Migrations(repoPath('packages/db/migrations/core')),
					HISTORY_MIGRATIONS: await readD1Migrations(repoPath('packages/db/migrations/history')),
					// Workers cannot read host files: the SDE fixture travels as a base64 binding.
					SDE_FIXTURE_B64: readFileSync(repoPath('packages/sde/test/fixtures/sde-mini.zip')).toString(
						'base64'
					)
				}
			}
		}))
	],
	test: {
		name: 'updater',
		include: ['test/**/*.test.ts'],
		setupFiles: ['./test/setup.ts']
	}
});
