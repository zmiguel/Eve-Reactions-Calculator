import type { Reactor, Tier } from '@reactions/engine';

/**
 * Canonical origin of every page, sitemap and OG URL; a constant so preview pages canonicalise to
 * production and components need no runtime env.
 */
export const SITE_URL = 'https://reactions.coalition.space';
export const SITE_NAME = 'EVE Reactions Calculator';

export const REACTOR_LABEL: Record<Reactor, string> = {
	composite: 'Composite',
	biochemical: 'Biochemical',
	hybrid: 'Hybrid'
};

/** Tier sections of each reactor (reactor pages, planner product select), in display order. */
export const REACTOR_TIERS: Record<Reactor, { tier: Tier; title: string }[]> = {
	composite: [
		{ tier: 'intermediate', title: 'Intermediate' },
		{ tier: 'composite', title: 'Composite' },
		{ tier: 'unrefined', title: 'Unrefined' },
		{ tier: 'unrefined_mineral', title: 'Unrefined Minerals' }
	],
	biochemical: [
		{ tier: 'booster_synth', title: 'Synth' },
		{ tier: 'booster_standard', title: 'Standard' },
		{ tier: 'booster_improved', title: 'Improved' },
		{ tier: 'booster_strong', title: 'Strong' },
		{ tier: 'molecular_forged', title: 'Molecular-Forged' }
	],
	hybrid: [{ tier: 'polymer', title: 'Polymers' }]
};

export const typeIconUrl = (typeId: number, size = 32) =>
	`https://images.evetech.net/types/${typeId}/icon?size=${size}`;
