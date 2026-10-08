// Secrets are not part of wrangler.jsonc, so `wrangler types` cannot generate them.
declare namespace Cloudflare {
	interface Env {
		EVE_SSO_CLIENT_SECRET: string;
		/** Optional second SSO app whose stored refresh tokens the updater also refreshes. */
		EVE_SSO_EXTRA_CLIENT_ID?: string;
		EVE_SSO_EXTRA_CLIENT_SECRET?: string;
		/** base64, 32 bytes (AES-GCM key for stored refresh tokens). */
		TOKEN_ENCRYPTION_KEY: string;
	}
}

interface Env {
	EVE_SSO_CLIENT_SECRET: string;
	EVE_SSO_EXTRA_CLIENT_ID?: string;
	EVE_SSO_EXTRA_CLIENT_SECRET?: string;
	TOKEN_ENCRYPTION_KEY: string;
}
