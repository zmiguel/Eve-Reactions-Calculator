import type { GrantableFeature } from '@reactions/eve';

/** Badge/button labels of the scope registry features (`ESI_FEATURES` in `@reactions/eve`). */
export const FEATURE_LABELS: Record<GrantableFeature, string> = {
	structures: 'Structure markets',
	wallet: 'Wallet',
	assets: 'Assets',
	industry: 'Industry jobs'
};

/**
 * Features the account page offers to enable per character. Only features with a page that uses them
 * belong here (structure markets: `/account/structures`); wallet, assets and industry jobs wait for
 * profit tracking.
 */
export const OFFERED_FEATURES: readonly GrantableFeature[] = ['structures'];
