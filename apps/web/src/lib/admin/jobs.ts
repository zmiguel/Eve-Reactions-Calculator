/**
 * Every job the updater can run (`job_runs.kind`) with the admin actions that start it. The admin page
 * lists one row per entry, in this order, whether or not the job has run yet; `?/<action>` form actions
 * and `triggerUpdater` dispatch on `UpdaterAction`.
 */

export type UpdaterAction =
	| 'prices'
	| 'adjusted_prices'
	| 'cost_indices'
	| 'sde_check'
	| 'sde_force'
	| 'daily'
	| 'history'
	| 'market_snapshot';

export interface JobAction {
	action: UpdaterAction;
	/** Button text. */
	label: string;
	/** Name of the job in the notice after the trigger. */
	notice: string;
}

export interface JobDefinition {
	/** `job_runs.kind`. */
	kind: string;
	label: string;
	description: string;
	/** Runs as a Cloudflare Workflows instance (live status available); otherwise inline in the RPC call. */
	workflow: boolean;
	actions: JobAction[];
}

export const JOBS: JobDefinition[] = [
	{
		kind: 'prices',
		label: 'Prices',
		description:
			'Buy and sell prices of tracked types at every enabled hub (ESI, Fuzzwork as fallback), then publishes the market snapshot.',
		workflow: true,
		actions: [{ action: 'prices', label: 'Refresh now', notice: 'Price refresh' }]
	},
	{
		kind: 'adjusted_prices',
		label: 'Adjusted prices',
		description: 'ESI adjusted and average prices of tracked types, then publishes the market snapshot.',
		workflow: false,
		actions: [{ action: 'adjusted_prices', label: 'Fetch now', notice: 'Adjusted prices' }]
	},
	{
		kind: 'cost_indices',
		label: 'Cost indices',
		description:
			'ESI reaction and manufacturing cost indices of every system, then publishes the market snapshot.',
		workflow: false,
		actions: [{ action: 'cost_indices', label: 'Fetch now', notice: 'Cost indices' }]
	},
	{
		kind: 'sde',
		label: 'SDE sync',
		description: 'Imports types, systems and reactions from the static data export when a new build is out.',
		workflow: true,
		actions: [
			{ action: 'sde_check', label: 'Check for new build', notice: 'SDE sync' },
			{ action: 'sde_force', label: 'Re-import (force)', notice: 'SDE re-import' }
		]
	},
	{
		kind: 'daily',
		label: 'Daily (history)',
		description:
			'ESI market history and stats of the hub regions, daily price and index rollups, archive check and snapshot retention. Runs for today (UTC).',
		workflow: true,
		actions: [{ action: 'daily', label: 'Run for today', notice: 'Daily job' }]
	},
	{
		kind: 'history',
		label: 'Market history import',
		description: 'Replaces stored market history of tracked types with the market.coalition.space mirror.',
		workflow: true,
		actions: [{ action: 'history', label: 'Import now', notice: 'Market history import' }]
	},
	{
		kind: 'market_snapshot',
		label: 'Market snapshot',
		description:
			'Rewrites the public market snapshot from enabled public hubs and stored prices. Also runs after every hub change.',
		workflow: false,
		actions: [{ action: 'market_snapshot', label: 'Publish now', notice: 'Market snapshot' }]
	}
];
