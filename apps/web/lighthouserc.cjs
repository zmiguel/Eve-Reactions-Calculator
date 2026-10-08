// Lighthouse CI (`npm run lhci`): mobile (Lighthouse default) audits of the home page and a listing,
// served by the isolated e2e server (`.wrangler/e2e`, port 8790) unless BASE_URL points elsewhere.
const { chromium } = require('@playwright/test');

const base = process.env.BASE_URL ?? 'http://localhost:8790';

module.exports = {
	ci: {
		collect: {
			url: [`${base}/`, `${base}/composite`],
			numberOfRuns: 3,
			chromePath: process.env.CHROME_PATH ?? chromium.executablePath(),
			...(process.env.BASE_URL
				? {}
				: {
						startServerCommand: 'npm run e2e:server --prefix ../..',
						startServerReadyPattern: 'Ready on',
						startServerReadyTimeout: 300000
					}),
			// GitHub's Ubuntu runners block the unprivileged user namespaces Chromium's sandbox needs ("No usable
			// sandbox!"); Playwright launches the same browser without the sandbox by default, so CI does too.
			settings: { chromeFlags: process.env.CI ? '--headless=new --no-sandbox' : '--headless=new' }
		},
		assert: {
			assertions: {
				'categories:seo': ['error', { minScore: 0.95 }],
				'categories:performance': ['error', { minScore: 0.9 }],
				'categories:accessibility': ['error', { minScore: 0.9 }]
			}
		},
		upload: { target: 'filesystem', outputDir: '.lighthouseci' }
	}
};
