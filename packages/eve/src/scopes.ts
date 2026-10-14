import { STRUCTURE_SCOPES } from './market.ts';

/**
 * Feature → ESI scopes. Logging in is scope-less; every other feature is granted per character by
 * re-authenticating that character with the feature's scopes added to the ones it already has.
 *
 * `assets` and `corp_assets` feed the inventory features (personal and corporation assets, plus the
 * industry jobs that hold installed reaction formulas). `tracking` and `corp_tracking` feed profit
 * tracking: industry job history, wallet transactions and journal, contracts, market orders and
 * blueprints (material efficiency of manufacturing jobs) of a character or a corporation (the
 * corporation endpoints also need in-game roles: Accountant or Junior Accountant for wallets, Factory
 * Manager for jobs, Accountant or Trader for orders, Director for blueprints).
 */
export const ESI_FEATURES = {
	login: [],
	structures: STRUCTURE_SCOPES,
	assets: [
		'esi-assets.read_assets.v1',
		'esi-industry.read_character_jobs.v1',
		'esi-universe.read_structures.v1'
	],
	corp_assets: [
		'esi-assets.read_corporation_assets.v1',
		'esi-corporations.read_divisions.v1',
		'esi-industry.read_corporation_jobs.v1',
		'esi-universe.read_structures.v1'
	],
	tracking: [
		'esi-characters.read_blueprints.v1',
		'esi-contracts.read_character_contracts.v1',
		'esi-industry.read_character_jobs.v1',
		'esi-markets.read_character_orders.v1',
		'esi-universe.read_structures.v1',
		'esi-wallet.read_character_wallet.v1'
	],
	corp_tracking: [
		'esi-contracts.read_corporation_contracts.v1',
		'esi-corporations.read_blueprints.v1',
		'esi-corporations.read_divisions.v1',
		'esi-industry.read_corporation_jobs.v1',
		'esi-markets.read_corporation_orders.v1',
		'esi-universe.read_structures.v1',
		'esi-wallet.read_corporation_wallets.v1'
	]
} as const satisfies Record<string, readonly string[]>;

export type EsiFeature = keyof typeof ESI_FEATURES;
/** Features that need scopes (everything except `login`). */
export type GrantableFeature = Exclude<EsiFeature, 'login'>;

export const GRANTABLE_FEATURES = (Object.keys(ESI_FEATURES) as EsiFeature[]).filter(
	(f): f is GrantableFeature => f !== 'login'
);

/** Every scope the app may request: the scope list of the registered SSO application. */
export const ALL_ESI_SCOPES: readonly string[] = [...new Set(Object.values(ESI_FEATURES).flat())].sort();

export function isEsiFeature(value: unknown): value is EsiFeature {
	return typeof value === 'string' && Object.hasOwn(ESI_FEATURES, value);
}

export function isGrantableFeature(value: unknown): value is GrantableFeature {
	return isEsiFeature(value) && value !== 'login';
}

/** `characters.scopes` (space-separated) or a scope list → distinct scopes. */
export function parseScopes(scopes: string | readonly string[] | null | undefined): string[] {
	const list = typeof scopes === 'string' ? scopes.split(/\s+/) : (scopes ?? []);
	return [...new Set(list.filter(Boolean))];
}

/** Scope list → the space-separated `characters.scopes` value (sorted, distinct). */
export function formatScopes(scopes: readonly string[]): string {
	return parseScopes(scopes).sort().join(' ');
}

/** True when `scopes` include every scope of `feature` (`login` is always available). */
export function hasFeature(
	scopes: string | readonly string[] | null | undefined,
	feature: EsiFeature
): boolean {
	const granted = new Set(parseScopes(scopes));
	return ESI_FEATURES[feature].every((s) => granted.has(s));
}

/** Grantable features fully covered by `scopes`, in registry order. */
export function grantedFeatures(scopes: string | readonly string[] | null | undefined): GrantableFeature[] {
	return GRANTABLE_FEATURES.filter((f) => hasFeature(scopes, f));
}

/**
 * Scopes to request when re-authenticating a character for `feature`: the feature's scopes plus every
 * scope the character already has, so a new token never drops an earlier grant. Sorted, distinct.
 */
export function scopesForFeature(
	feature: EsiFeature,
	currentScopes: string | readonly string[] | null | undefined = []
): string[] {
	return parseScopes([...parseScopes(currentScopes), ...ESI_FEATURES[feature]]).sort();
}

/** Scopes in `current` that `granted` lacks (what storing a token with `granted` would lose). */
export function missingScopes(
	current: string | readonly string[] | null | undefined,
	granted: string | readonly string[] | null | undefined
): string[] {
	const have = new Set(parseScopes(granted));
	return parseScopes(current).filter((s) => !have.has(s));
}
