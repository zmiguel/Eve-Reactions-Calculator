import type { WorkflowStepConfig } from 'cloudflare:workers';
import { utcDate } from './dates.ts';

/** Minimum age of the latest price refresh before the cron starts another one. */
export const PRICE_REFRESH_MINUTES = 30;

/** A `running` prices job younger than this blocks the cron from starting another refresh. */
export const PRICE_RUN_STALE_MINUTES = 25;

/** Concurrent ESI requests per workflow step (Workers allow 6 simultaneous connections). */
export const ESI_CONCURRENCY = 6;

/** No ESI request is sent from this minute of the UTC day (5 minutes before the daily downtime). */
export const ESI_DOWNTIME_START_MINUTE_UTC = 10 * 60 + 55;
/** The daily downtime starts at 11:00 UTC; from then on `/status` decides when ESI is back. */
export const ESI_DOWNTIME_MINUTE_UTC = 11 * 60;
/**
 * `/status` must report more than this many players on a server started after `ESI_DOWNTIME_START_MINUTE_UTC`
 * before ESI counts as back (a VIP server does not). Right after 11:00 the server that is shutting down
 * still reports its players.
 */
export const ESI_ONLINE_MIN_PLAYERS = 100;
/** From this minute the server's start time no longer matters: a day without a restart opens ESI again. */
export const ESI_RESTART_WAIVED_MINUTE_UTC = 12 * 60;
/** A failed `/status` check is not repeated within this long (per isolate). */
export const ESI_STATUS_RECHECK_MS = 60_000;
/** A workflow step that hit the downtime sleeps this long before it runs again. */
export const ESI_DOWNTIME_WAIT = '2 minutes';
/** Downtime waits per step (≈ 90 minutes in all); after that the step fails as usual. */
export const ESI_DOWNTIME_MAX_WAITS = 45;

/** Private structure hubs are refreshed only while a linked user was seen within this many days. */
export const PRIVATE_HUB_ACTIVE_DAYS = 30;

/** Market history import: types per workflow step (one mirror request and ≤ 2 writes per region each). */
export const BACKFILL_TYPES_PER_STEP = 25;

/** Concurrent requests to the market.coalition.space history mirror (public limit 600 per minute). */
export const MIRROR_CONCURRENCY = 3;

/** The daily job starts at or after 11:20 UTC (ESI market history is updated after downtime). */
export const DAILY_START_MINUTE_UTC = 11 * 60 + 20;
/**
 * Waits before the daily job retries the market history it could not fetch (ESI errors, or the ESI
 * error limit running low, which skips the remaining types): one retry round after each wait. ESI's
 * error window resets every minute; the longer waits ride out ESI's unstable minutes after downtime.
 */
export const HISTORY_RETRY_WAITS = ['2 minutes', '5 minutes', '15 minutes'] as const;

/** `price_snapshots` older than this many days are deleted once archived and rolled up. */
export const SNAPSHOT_RETENTION_DAYS = 90;

/** Finished `job_runs` rows older than this many days are deleted by the daily job. */
export const JOB_RUN_RETENTION_DAYS = 90;

/** R2 prefix of the raw price archives of one UTC day (`YYYY-MM-DD`). */
export const PRICE_ARCHIVE_PREFIX = (date: string): string => `prices/raw/${date.replaceAll('-', '/')}/`;

/** R2 key of the gzipped rows of the price refresh taken at `snapshotAt` (unix ms). */
export const PRICE_ARCHIVE_KEY = (snapshotAt: number): string =>
	`${PRICE_ARCHIVE_PREFIX(utcDate(snapshotAt))}${snapshotAt}.json.gz`;

/** The SDE pointer is checked once per hour, during the first cron tick (minutes 0–9). */
export const SDE_CHECK_MAX_MINUTE = 9;

/**
 * Character affiliations are refreshed once a day, on the first cron tick from 12:20 UTC (after downtime)
 * whose UTC day has no finished run yet: a tick skipped for a long ESI downtime, or a failed run, is made
 * up on a later tick of the same day.
 */
export const AFFILIATION_START_MINUTE_UTC = 12 * 60 + 20;
/** A `running` affiliations row older than this (a crashed run) no longer counts as today's run. */
export const AFFILIATION_RUN_STALE_MINUTES = 15;
/** Only characters of accounts seen within this many days are looked up. */
export const AFFILIATION_ACTIVE_DAYS = 30;
/** Concurrent Rybbit trait updates (`POST /api/identify`) after an affiliation change. */
export const RYBBIT_CONCURRENCY = 4;
/** Each Rybbit request is aborted after this long (counted as failed). */
export const RYBBIT_TIMEOUT_MS = 10_000;

/** The daily inventory pass runs on every tick from 12:00 UTC (after downtime). */
export const INVENTORY_DAILY_MINUTE_UTC = 12 * 60;
/** Daily inventory syncs started per cron tick (the rest wait for the next ticks). */
export const INVENTORY_SYNCS_PER_TICK = 20;
/** ESI asset pages fetched per workflow step. */
export const INVENTORY_PAGES_PER_STEP = 10;
/** Sources with more asset pages (1000 rows each) are not synced (`error`, "too many assets"). */
export const INVENTORY_MAX_PAGES = 500;
/** A `running` sync older than this no longer blocks a new one; it is marked `error` instead. */
export const INVENTORY_RUN_STALE_MINUTES = 15;

/** R2 prefix of the asset pages staged by one inventory sync instance (deleted by its `write` step). */
export const INVENTORY_STAGING_PREFIX = (instanceId: string): string => `inventory-staging/${instanceId}/`;

/** R2 key of asset page `page` staged by inventory sync instance `instanceId`. */
export const INVENTORY_STAGING_KEY = (instanceId: string, page: number): string =>
	`${INVENTORY_STAGING_PREFIX(instanceId)}${page}.json`;

/** R2 key of industry job page `page` staged by inventory sync instance `instanceId`. */
export const INVENTORY_JOBS_KEY = (instanceId: string, page: number): string =>
	`${INVENTORY_STAGING_PREFIX(instanceId)}jobs-${page}.json`;

/** Tracking syncs started per cron tick (the rest wait for the next ticks). */
export const TRACKING_SYNCS_PER_TICK = 20;
/** A connection is synced by the cron at most once per this many minutes. */
export const TRACKING_MIN_INTERVAL_MINUTES = 60;
/** A `running` tracking sync older than this no longer blocks a new one; it is marked `error` instead. */
export const TRACKING_RUN_STALE_MINUTES = 15;
/** Wallet transaction pages (`from_id` walk) fetched per stream step. */
export const TRACKING_TX_MAX_PAGES = 50;
/** Journal and order history pages fetched per stream step at most. */
export const TRACKING_MAX_PAGES = 50;
/** Contract item requests per `contracts` step; the rest wait for the next sync. */
export const TRACKING_CONTRACT_ITEMS_PER_STEP = 50;
/** Janice appraisals fetched per sync at most. */
export const TRACKING_JANICE_PER_STEP = 20;
/** A failed Janice appraisal is tried again after this many hours, doubling per failure in a row. */
export const JANICE_RETRY_MIN_HOURS = 6;
/** ... up to this many days. */
export const JANICE_RETRY_MAX_DAYS = 30;
/** Dirty ledgers rebuilt per cron tick. */
export const TRACKING_LEDGERS_PER_TICK = 10;
/** Job facilities looked up (`/universe/structures/{id}`, `/universe/stations/{id}`) per tracking sync at most. */
export const TRACKING_FACILITY_LOOKUPS_PER_SYNC = 20;
/** A facility looked up successfully is looked up again after this many days (type and system rarely change). */
export const FACILITY_RECHECK_DAYS = 30;
/** A failed lookup waits at least one day (and at least its `Expires`), doubling per failure up to the recheck period. */
export const FACILITY_RETRY_MIN_DAYS = 1;

export const SDE_ZIP_URL = (build: number): string =>
	`https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-${build}-jsonl.zip`;

/**
 * Game client industry data published by Hoboleaks, fetched with every SDE import: which rigs and
 * structures give material bonuses to which products (joined with the SDE dogma into `Dataset.industry`).
 */
export const HOBOLEAKS_MODIFIER_SOURCES_URL = 'https://sde.hoboleaks.space/tq/industrymodifiersources.json';
export const HOBOLEAKS_TARGET_FILTERS_URL = 'https://sde.hoboleaks.space/tq/industrytargetfilters.json';
/** Each Hoboleaks request is aborted after this long (the step then retries). */
export const HOBOLEAKS_TIMEOUT_MS = 60_000;

/** R2 key of a parsed SDE build (`SdeDataset` JSON). */
export const SDE_ARCHIVE_KEY = (build: number): string => `sde/${build}/dataset.json`;

/** SDE import sanity check: fewer reactions means the archive or the parser is broken. */
export const SDE_MIN_REACTIONS = 100;

export const MARKET_PRICES_PATH = '/markets/prices';
export const INDUSTRY_SYSTEMS_PATH = '/industry/systems';

/** Retry/timeout policy shared by every workflow step. */
export const STEP_CONFIG = {
	retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
	timeout: '10 minutes'
} as const satisfies WorkflowStepConfig;
