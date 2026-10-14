import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEEDED_PERSIST, SEEDED_UPDATER, seededConfig } from '../dev-seeded.ts';

const webConfig = readFileSync(
	fileURLToPath(new URL('../../apps/web/wrangler.jsonc', import.meta.url)),
	'utf8'
);

describe('dev:seeded', () => {
	it('points every UPDATER binding of the web config at the seeded updater, never the dev one', () => {
		const config = seededConfig(webConfig);
		expect(config).not.toContain('"service": "reactions-updater"');
		expect(config.split(`"service": "${SEEDED_UPDATER}"`).length - 1).toBe(
			webConfig.split('"service": "reactions-updater"').length - 1
		);
	});

	it('serves the seeded state, not .wrangler/state', () => {
		expect(SEEDED_PERSIST).toBe('../../.wrangler/seeded/v3');
	});
});
