import type { GrantableFeature } from '@reactions/eve';

/** Badge/button labels of the scope registry features (`ESI_FEATURES` in `@reactions/eve`). */
export const FEATURE_LABELS: Record<GrantableFeature, string> = {
	structures: 'Structure markets',
	assets: 'Personal assets',
	corp_assets: 'Corporation assets',
	tracking: 'Profit tracking',
	corp_tracking: 'Corporation profit tracking'
};

/** One line on what granting a feature enables (the permissions dialog). */
export const FEATURE_DESCRIPTIONS: Record<GrantableFeature, string> = {
	structures: 'Use the markets of player structures this character can access as price hubs.',
	assets: "Reads this character's assets and industry jobs for your inventory.",
	corp_assets: "Reads the corporation's assets and industry jobs for your inventory.",
	tracking:
		"Reads this character's industry jobs, blueprints, wallet, market orders and contracts for profit tracking.",
	corp_tracking:
		"Reads the corporation's industry jobs, blueprints, wallets, market orders and contracts for profit tracking."
};

/** In-game corporation roles a corporation feature needs (EVE checks them on every read). */
export const FEATURE_ROLES: Partial<Record<GrantableFeature, string>> = {
	corp_assets: 'Needs the Director role in game.',
	corp_tracking:
		'Needs Accountant or Junior Accountant (wallets), Factory Manager (jobs), Accountant or Trader (orders) and Director (blueprints) in game.'
};

/**
 * Features the account page offers to enable per character: structure markets (`/account/structures`),
 * personal and corporation assets (inventory, `/account/connections`) and personal and corporation
 * profit tracking.
 */
export const OFFERED_FEATURES: readonly GrantableFeature[] = [
	'structures',
	'assets',
	'corp_assets',
	'tracking',
	'corp_tracking'
];

/**
 * `features` values (each a comma-separated list; a plain form sends one value per checkbox) →
 * the offered features they name, in `OFFERED_FEATURES` order. `null` when one is not offered.
 */
export function parseFeatureList(values: readonly string[]): GrantableFeature[] | null {
	const names = values.flatMap((v) => v.split(',')).filter(Boolean);
	if (names.some((n) => !OFFERED_FEATURES.some((f) => f === n))) return null;
	return OFFERED_FEATURES.filter((f) => names.includes(f));
}

/**
 * The form action (POST, `features` values) that logs `characterId` in again with exactly the posted
 * features (`purpose=features`): the permissions form and "Log in again".
 */
export function permissionsSaveAction(characterId: number): string {
	return `/account/permissions/${characterId}?/save`;
}
