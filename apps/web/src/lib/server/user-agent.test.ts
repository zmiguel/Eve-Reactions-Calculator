import { describe, expect, it } from 'vitest';
import pkg from '../../../package.json' with { type: 'json' };
import { userAgent } from './user-agent.ts';

describe('userAgent', () => {
	it('builds the User-Agent from the app version and the USER_AGENT_* vars', () => {
		expect(
			userAgent({ USER_AGENT_URL: 'https://example.test/', USER_AGENT_CONTACT: 'mail:ops@example.test' })
		).toBe(`EVE-Reactions-Calculator/${pkg.version} (+https://example.test/; mail:ops@example.test)`);
	});

	it('sends only name and version while the vars are empty', () => {
		expect(userAgent({ USER_AGENT_URL: '', USER_AGENT_CONTACT: '' })).toBe(
			`EVE-Reactions-Calculator/${pkg.version}`
		);
	});
});
