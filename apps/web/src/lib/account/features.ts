import type { GrantableFeature } from '@reactions/eve';

/** Badge/button labels of the scope registry features (`ESI_FEATURES` in `@reactions/eve`). */
export const FEATURE_LABELS: Record<GrantableFeature, string> = {
	structures: 'Structure markets',
	wallet: 'Wallet',
	assets: 'Personal assets',
	corp_assets: 'Corporation assets',
	industry: 'Industry jobs'
};

/**
 * Features the account page offers to enable per character: structure markets (`/account/structures`)
 * and personal and corporation assets (inventory sync, `/account/inventory`). Wallet and
 * industry jobs wait for profit tracking.
 */
export const OFFERED_FEATURES: readonly GrantableFeature[] = ['structures', 'assets', 'corp_assets'];
