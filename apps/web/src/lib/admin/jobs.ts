import type { JobKind } from '@reactions/db';

/**
 * Every job the updater can run (`job_runs.kind`, `JOB_KINDS` in `@reactions/db`) with the admin actions
 * that start it. The registry is keyed by `JobKind`, so a kind without an admin row does not compile.
 * The admin page lists one row per entry, in this order, whether or not the job has run yet;
 * `?/<action>` form actions and `triggerUpdater` dispatch on `UpdaterAction`.
 */

export type UpdaterAction =
	| 'prices'
	| 'adjusted_prices'
	| 'cost_indices'
	| 'sde_check'
	| 'sde_force'
	| 'daily'
	| 'history'
	| 'market_snapshot'
	| 'affiliations'
	| 'inventory'
	| 'tracking';

export interface JobAction {
	action: UpdaterAction;
	/** Button text. */
	label: string;
	/** Name of the job in the notice after the trigger. */
	notice: string;
}

export interface JobDefinition {
	/** `job_runs.kind`. */
	kind: JobKind;
	label: string;
	description: string;
	/** Runs as a Cloudflare Workflows instance (live status available); otherwise inline in the RPC call. */
	workflow: boolean;
	actions: JobAction[];
}

const DEFINITIONS = {
	prices: {
		label: 'Prices',
		description:
			'Buy and sell prices of tracked types at every enabled hub (ESI, Fuzzwork as fallback), then publishes the market snapshot.',
		workflow: true,
		actions: [{ action: 'prices', label: 'Refresh now', notice: 'Price refresh' }]
	},
	adjusted_prices: {
		label: 'Adjusted prices',
		description: 'ESI adjusted and average prices of tracked types, then publishes the market snapshot.',
		workflow: false,
		actions: [{ action: 'adjusted_prices', label: 'Fetch now', notice: 'Adjusted prices' }]
	},
	cost_indices: {
		label: 'Cost indices',
		description:
			'ESI reaction and manufacturing cost indices of every system, then publishes the market snapshot.',
		workflow: false,
		actions: [{ action: 'cost_indices', label: 'Fetch now', notice: 'Cost indices' }]
	},
	sde: {
		label: 'SDE sync',
		description:
			'Imports types, systems, reactions and the structure and rig bonus data from the static data export and the game client data when a new build is out.',
		workflow: true,
		actions: [
			{ action: 'sde_check', label: 'Check for new build', notice: 'SDE sync' },
			{ action: 'sde_force', label: 'Re-import (force)', notice: 'SDE re-import' }
		]
	},
	daily: {
		label: 'Daily (history)',
		description:
			'ESI market history and stats of the hub regions, daily price and index rollups, archive check and snapshot retention. Runs for today (UTC).',
		workflow: true,
		actions: [{ action: 'daily', label: 'Run for today', notice: 'Daily job' }]
	},
	history: {
		label: 'Market history import',
		description: 'Replaces stored market history of tracked types with the market.coalition.space mirror.',
		workflow: true,
		actions: [{ action: 'history', label: 'Import now', notice: 'Market history import' }]
	},
	market_snapshot: {
		label: 'Market snapshot',
		description:
			'Rewrites the public market snapshot from enabled public hubs and stored prices. Also runs after every hub change.',
		workflow: false,
		actions: [{ action: 'market_snapshot', label: 'Publish now', notice: 'Market snapshot' }]
	},
	affiliations: {
		label: 'Affiliations',
		description:
			'Corporation and alliance of the characters of accounts seen in the last 30 days (ESI bulk lookups, 100 per request), used for the analytics traits; changes are sent to Rybbit. Daily from 12:20 UTC (a later tick catches up when that one was missed or failed). "Fetch now" also sends the traits of every covered account to Rybbit (back-fill).',
		workflow: false,
		actions: [{ action: 'affiliations', label: 'Fetch now', notice: 'Affiliations' }]
	},
	inventory: {
		label: 'Inventory sync',
		description:
			'Syncs the asset sources (personal and corporation assets) of accounts seen in the last 30 days, up to 20 per tick, once a day from 12:00 UTC. Each source runs as its own workflow; this row records the passes. "Sync now" starts a pass at once, ignoring the daily schedule.',
		workflow: false,
		actions: [{ action: 'inventory', label: 'Sync now', notice: 'Inventory sync' }]
	},
	tracking: {
		label: 'Profit tracking',
		description:
			'Syncs the profit tracking connections (industry jobs, wallet, orders, contracts, blueprints and job facilities) of accounts seen in the last 30 days whose ESI data expired, up to 20 per tick, each at most once an hour, then rebuilds up to 10 ledgers marked dirty. Each connection runs as its own workflow; this row records the passes. "Run now" starts a pass at once.',
		workflow: false,
		actions: [{ action: 'tracking', label: 'Run now', notice: 'Profit tracking' }]
	}
} satisfies Record<JobKind, Omit<JobDefinition, 'kind'>>;

export const JOBS: JobDefinition[] = (Object.keys(DEFINITIONS) as JobKind[]).map((kind) => ({
	kind,
	...DEFINITIONS[kind]
}));
