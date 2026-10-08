import { defineConfig, devices } from '@playwright/test';

/**
 * `BASE_URL` set (staging/production smoke runs): no local server. Otherwise `npm run e2e:server`
 * seeds a separate state directory (`.wrangler/e2e`) and serves the production build on port 8790;
 * `E2E_REUSE=1` reuses a server that is already running there.
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:8790';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	// Specs share one seeded database (settings, approvals), so they run one at a time.
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: { baseURL, trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: process.env.BASE_URL
		? undefined
		: {
				command: 'npm run e2e:server --prefix ../..',
				url: baseURL,
				reuseExistingServer: process.env.E2E_REUSE === '1',
				timeout: 300_000,
				stdout: 'pipe'
			}
});
