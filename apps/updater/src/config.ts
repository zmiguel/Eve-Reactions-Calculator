import type { WorkflowStepConfig } from 'cloudflare:workers';
import { utcDate } from './dates.ts';

/** Minimum age of the latest price refresh before the cron starts another one. */
export const PRICE_REFRESH_MINUTES = 30;

/** A `running` prices job younger than this blocks the cron from starting another refresh. */
export const PRICE_RUN_STALE_MINUTES = 25;

/** Concurrent ESI requests per workflow step (Workers allow 6 simultaneous connections). */
export const ESI_CONCURRENCY = 6;

/** Private structure hubs are refreshed only while a linked user was seen within this many days. */
export const PRIVATE_HUB_ACTIVE_DAYS = 30;

/** Market history import: types per workflow step (one mirror request and ≤ 2 writes per region each). */
export const BACKFILL_TYPES_PER_STEP = 25;

/** Concurrent requests to the market.coalition.space history mirror (public limit 600 per minute). */
export const MIRROR_CONCURRENCY = 3;

/** The daily job starts at or after 11:20 UTC (ESI market history is updated after downtime). */
export const DAILY_START_MINUTE_UTC = 11 * 60 + 20;

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

/** Character affiliations are refreshed once a day, on the cron tick in 12:20–12:29 UTC (after downtime). */
export const AFFILIATION_START_MINUTE_UTC = 12 * 60 + 20;
export const AFFILIATION_END_MINUTE_UTC = 12 * 60 + 29;
/** Only characters of accounts seen within this many days are looked up. */
export const AFFILIATION_ACTIVE_DAYS = 30;

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

export const SDE_ZIP_URL = (build: number): string =>
	`https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-${build}-jsonl.zip`;

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
