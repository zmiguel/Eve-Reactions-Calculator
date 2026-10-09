/**
 * Every `job_runs.kind` the updater records. The admin page's job registry (`apps/web/src/lib/admin/jobs.ts`)
 * is keyed by this list, so a new kind does not compile until it has an admin row.
 */
export const JOB_KINDS = [
	'prices',
	'adjusted_prices',
	'cost_indices',
	'sde',
	'daily',
	'history',
	'market_snapshot',
	'affiliations'
] as const;

export type JobKind = (typeof JOB_KINDS)[number];
