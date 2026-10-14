/** Short labels and colors of the ledger pages' badges (prices, directions, batch origins). */
import type { PillTone } from '$lib/components/profits/Pill.svelte';
import type { LedgerLotOrigin } from './types';

export interface Badge {
	label: string;
	tone: PillTone;
}

const NEEDS_REVIEW: Badge = { label: 'Needs review', tone: 'amber' };

const BY_KIND: Record<string, Badge> = {
	market: { label: 'Market', tone: 'gray' },
	contract_single: { label: 'Contract', tone: 'gray' },
	janice: { label: 'Janice', tone: 'blue' },
	rule_match: { label: 'Price rule', tone: 'blue' },
	rule_outside: { label: 'Price rule: check', tone: 'amber' },
	review: NEEDS_REVIEW,
	correction: { label: 'Your correction', tone: 'purple' },
	production: { label: 'Made by a job', tone: 'gray' },
	market_fallback: { label: 'Market estimate', tone: 'amber' },
	manual: { label: 'Entered by you', tone: 'purple' }
};

/**
 * The badge of a price from its engine `PriceSourceKind`: the user's correction and "Price rule: check"
 * win, then "Needs review"; a market trade with an estimated broker fee or sales tax says so.
 */
export function sourceBadge(kind: string, needsReview: boolean, estimatedFees = false): Badge {
	if (kind === 'correction' || kind === 'rule_outside') return BY_KIND[kind];
	if (needsReview) return NEEDS_REVIEW;
	if (kind === 'market' && estimatedFees) return { label: 'Estimated fees', tone: 'gray' };
	return Object.hasOwn(BY_KIND, kind) ? BY_KIND[kind] : { label: 'Other', tone: 'gray' };
}

/** Direction pills: rows of the ledger (`bought`/`buy`/`in` …) and of the item page. */
export const DIRECTION_BADGE: Record<string, Badge> = {
	bought: { label: 'Bought', tone: 'purple' },
	buy: { label: 'Bought', tone: 'purple' },
	in: { label: 'Bought', tone: 'purple' },
	sold: { label: 'Sold', tone: 'green' },
	sell: { label: 'Sold', tone: 'green' },
	out: { label: 'Sold', tone: 'green' },
	swap: { label: 'Swap', tone: 'blue' },
	transfer: { label: 'Transfer', tone: 'gray' }
};

/** Where a batch came from, in words (the job's formula follows "Made by job" and "Market estimate"). */
export const ORIGIN_TEXT: Record<LedgerLotOrigin, string> = {
	transaction: 'Bought on the market',
	contract: 'Bought by contract',
	job: 'Made by job',
	market: 'Market estimate',
	correction: 'Your correction',
	manual: 'Entered by you'
};
