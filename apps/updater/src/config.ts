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
