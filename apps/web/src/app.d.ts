// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Settings } from '@reactions/engine';
import type { AccountFacts, SessionUser } from '$lib/server/session';

declare global {
	/** Secrets and optional vars not present in wrangler.jsonc `vars` (see `.dev.vars.example`). */
	interface Env {
		EVE_SSO_CLIENT_SECRET?: string;
		/** Optional second SSO app whose stored refresh tokens this deployment also refreshes. */
		EVE_SSO_EXTRA_CLIENT_ID?: string;
		EVE_SSO_EXTRA_CLIENT_SECRET?: string;
		SESSION_SECRET?: string;
		TOKEN_ENCRYPTION_KEY?: string;
		DEV_LOGIN?: string;
	}

	namespace App {
		interface Locals {
			settings: Settings;
			theme: 'dark' | 'light';
			user: SessionUser | null;
			/** Analytics facts of the session's account (null when anonymous). */
			account: AccountFacts | null;
		}
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
		}
	}
}

export {};
