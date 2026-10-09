/**
 * Links Rybbit visitors to accounts (https://rybbit.com/docs/identify-users). Logged-in visitors are
 * identified with the account id and traits (main character name as `username`, affiliation, a summary
 * of the account and settings); Rybbit then attributes this device's earlier anonymous visits to the
 * account too. Logged-out visitors have the stored id cleared so later visits are anonymous again.
 */

/**
 * Rybbit user traits (`$lib/server/analytics.ts` builds them). Every key is always sent and never `null`:
 * Rybbit drops the whole trait update when any value is `null` (it still answers `success`), so absent
 * values are sent as words instead, which also overwrite what Rybbit stored earlier.
 */
export interface AnalyticsTraits {
	/** Main character's name (the account's first character): Rybbit's display name. */
	username: string;
	name: string;
	main_character_id: number;
	/** `unknown` until the updater's daily affiliation lookup has run for the character. */
	corporation: string;
	/** `none` without an alliance, `unknown` while the corporation is unknown. */
	alliance: string;
	is_admin: boolean;
	characters: number;
	/** `YYYY-MM-DD` (UTC). */
	account_created: string;
	/** Granted features, comma-separated (`structures`), or `none`. */
	features: string;
	/** Values shared by every reactor profile in use, `mixed` when per-reactor profiles differ. */
	structure: string;
	security: string;
	/** NPC hub id (`jita`), `structure` for a structure market, or `mixed`. */
	input_hub: string;
	output_hub: string;
	per_reactor: boolean;
	slots: string;
	unrefined: string;
	custom_settings: boolean;
}

/** What a logged-in visitor is identified as. */
export interface AnalyticsIdentity {
	/** `users.user_id`: random, stable per account, not usable to log in. */
	userId: string;
	traits: AnalyticsTraits;
}

/** The parts of `window.rybbit` this module uses. */
export interface RybbitApi {
	identify(userId: string, traits?: Record<string, unknown>): void;
	clearUserId(): void;
	getUserId(): string | null;
	/** Present since the queueing stub: calls back with the live tracker once its config loaded. */
	onReady?(callback: (rybbit: RybbitApi) => void): void;
}

declare global {
	interface Window {
		/** Set by the Rybbit tracking script in `app.html` (absent until it ran, or when blocked). */
		rybbit?: RybbitApi;
	}
}

/** Last identity sent from this browser, so page loads do not repeat the identify request. */
export const IDENTITY_STORAGE_KEY = 'rc_analytics_identity';

/**
 * Applies `identity` to a ready tracker: identify when the tracker holds another id or a trait
 * changed since the last identify from this browser, clear when logged out and an id is stored.
 */
export function applyIdentity(
	rybbit: RybbitApi,
	identity: AnalyticsIdentity | null,
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
	if (identity) {
		const sent = JSON.stringify(identity);
		if (rybbit.getUserId() === identity.userId && storage?.getItem(IDENTITY_STORAGE_KEY) === sent) return;
		rybbit.identify(identity.userId, { ...identity.traits });
		storage?.setItem(IDENTITY_STORAGE_KEY, sent);
		return;
	}
	storage?.removeItem(IDENTITY_STORAGE_KEY);
	if (rybbit.getUserId()) rybbit.clearUserId();
}

/**
 * Browser entry point (root layout effect). The tracking script is `async`, so it may run after
 * hydration: wait for its `load` event when `window.rybbit` does not exist yet. Blocked or missing
 * script: nothing happens.
 */
export function syncAnalyticsIdentity(identity: AnalyticsIdentity | null): void {
	const run = () => {
		window.rybbit?.onReady?.((ready) => {
			let storage: Storage | null = null;
			try {
				storage = window.localStorage;
			} catch {
				// storage disabled: identify on every page load instead
			}
			applyIdentity(ready, identity, storage);
		});
	};
	if (window.rybbit) run();
	else
		document
			.querySelector('script[data-site-id][src$="/api/script.js"]')
			?.addEventListener('load', run, { once: true });
}
