import type { D1Migration } from 'cloudflare:test';

declare global {
	namespace Cloudflare {
		interface Env {
			DB: D1Database;
			HISTORY_DB: D1Database;
			CORE_MIGRATIONS: D1Migration[];
			HISTORY_MIGRATIONS: D1Migration[];
		}
	}
}
