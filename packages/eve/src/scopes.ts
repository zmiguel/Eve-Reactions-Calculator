import { STRUCTURE_SCOPES } from './market.ts';

/**
 * Feature → ESI scopes. Logging in is scope-less; every other feature is granted per character by
 * re-authenticating that character with the feature's scopes added to the ones it already has.
 *
 * `wallet`, `assets` and `industry` belong to the profit-tracking phase: they are defined so the SSO
 * application can be registered with every scope up front, but no feature uses them yet and the web
 * app does not offer them.
 */
export const ESI_FEATURES = {
	login: [],
	structures: STRUCTURE_SCOPES,
	wallet: ['esi-wallet.read_character_wallet.v1'],
	assets: ['esi-assets.read_assets.v1'],
	industry: ['esi-industry.read_character_jobs.v1']
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
