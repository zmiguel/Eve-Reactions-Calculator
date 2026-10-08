import type { D1Migration } from 'cloudflare:test';

declare global {
	namespace Cloudflare {
		interface Env {
			CORE_MIGRATIONS: D1Migration[];
			HISTORY_MIGRATIONS: D1Migration[];
			/** `packages/sde/test/fixtures/sde-mini.zip`, base64. */
			SDE_FIXTURE_B64: string;
		}
	}
}
