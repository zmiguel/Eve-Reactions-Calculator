import { fetchServerStatus } from '@reactions/eve';
import {
	ESI_DOWNTIME_MINUTE_UTC,
	ESI_DOWNTIME_START_MINUTE_UTC,
	ESI_ONLINE_MIN_PLAYERS,
	ESI_RESTART_WAIVED_MINUTE_UTC,
	ESI_STATUS_RECHECK_MS
} from './config.ts';
import { DAY_MS, dayStart, utcDate } from './dates.ts';
import { httpFetch, userAgent } from './http.ts';

/** KV key set once `/status` showed the server back after the downtime of `date` (`YYYY-MM-DD`). */
export const ESI_ONLINE_KV_KEY = (date: string): string => `esi:online:${date}`;

/** Answer of a manual run that needed ESI during the downtime. */
export const ESI_DOWNTIME_MESSAGE =
	'ESI is in its daily downtime (from 10:55 UTC until the server is back); try again later.';

// Per-isolate memo: the gate runs before every ESI request, so a confirmed day must cost nothing and
// a failed check must not turn every blocked request into another `/status` call.
let online: { date: string; at: number } | null = null;
let failedAt: number | null = null;
let pending: Promise<boolean> | null = null;

/** Test hook: forgets what this isolate learned about the downtime. */
export function resetEsiDowntimeMemo(): void {
	online = null;
	failedAt = null;
	pending = null;
}

/**
 * Whether the updater may send ESI requests at `now`: always before 10:55 UTC, never from 10:55 to
 * 11:00, and after 11:00 only once `/status` reported more than `ESI_ONLINE_MIN_PLAYERS` players on
 * the live server, started after 10:55 that day (until `ESI_RESTART_WAIVED_MINUTE_UTC`). The
 * confirmation time is kept per UTC day (memo, then KV for other isolates).
 */
export async function esiAvailable(env: Env, now: number): Promise<boolean> {
	const minute = minuteOfDay(now);
	if (minute < ESI_DOWNTIME_START_MINUTE_UTC) return true;
	if (minute < ESI_DOWNTIME_MINUTE_UTC) return false;
	const date = utcDate(now);
	if (online?.date === date) return true;
	pending ??= checkOnline(env, date, now).finally(() => {
		pending = null;
	});
	return pending;
}

const minuteOfDay = (ms: number) => Math.floor((ms % DAY_MS) / 60_000);

/** When ESI was confirmed back after the downtime of `date` (memo or KV); `null` while not (yet). */
async function onlineAt(env: Env, date: string): Promise<number | null> {
	if (online?.date === date) return online.at;
	const stored = await env.CACHE.get(ESI_ONLINE_KV_KEY(date));
	if (stored === null) return null;
	// A value that is no timestamp (written before the time was stored) still means "back".
	const at = Number(stored);
	return Number.isFinite(at) ? at : 0;
}

async function checkOnline(env: Env, date: string, now: number): Promise<boolean> {
	const at = await onlineAt(env, date);
	if (at !== null) {
		online = { date, at };
		return true;
	}
	if (failedAt !== null && now - failedAt < ESI_STATUS_RECHECK_MS) return false;
	const status = await fetchServerStatus(httpFetch, userAgent(env));
	const restarted =
		status?.startTime != null && status.startTime >= dayStart(date) + ESI_DOWNTIME_START_MINUTE_UTC * 60_000;
	const restartNeeded = minuteOfDay(now) < ESI_RESTART_WAIVED_MINUTE_UTC;
	if (
		status !== null &&
		status.players > ESI_ONLINE_MIN_PLAYERS &&
		!status.vip &&
		(restarted || !restartNeeded)
	) {
		await env.CACHE.put(ESI_ONLINE_KV_KEY(date), String(now), { expirationTtl: 2 * 86_400 });
		online = { date, at: now };
		failedAt = null;
		console.log(`[esi] online again: ${status.players} players`);
		return true;
	}
	failedAt = now;
	const seen =
		status === null
			? 'no status'
			: status.vip
				? 'VIP mode'
				: restartNeeded && !restarted
					? 'server not restarted yet'
					: `${status.players} players`;
	console.log(`[esi] still down (${seen})`);
	return false;
}

/** A stretch of time without ESI: `[start, end)`, unix ms. */
export interface PauseWindow {
	start: number;
	end: number;
}

/**
 * The downtime window of UTC day `date` as seen at `now`: from 10:55 UTC until `backAt` (when
 * `/status` showed ESI back), or while unconfirmed until `now` (at most the end of that day). A window
 * that has not started yet is empty (`end <= start`).
 */
export function downtimeWindow(date: string, backAt: number | null, now: number): PauseWindow {
	const start = dayStart(date) + ESI_DOWNTIME_START_MINUTE_UTC * 60_000;
	return { start, end: backAt ?? Math.min(now, dayStart(date) + DAY_MS) };
}

/** How much of `[from, now]` falls inside `windows`. */
export function pausedWithin(from: number, now: number, windows: readonly PauseWindow[]): number {
	let paused = 0;
	for (const { start, end } of windows) paused += Math.max(0, Math.min(end, now) - Math.max(start, from));
	return paused;
}

/**
 * The latest start time whose active (not paused) time until `now` is at least `limitMs`: a run that
 * started at or before it has really been working for `limitMs`. Walks back from `now`, counting only
 * the time outside `windows` (latest window first): e.g. `now` 11:12 with the window 10:55–11:08 and a
 * 15-minute limit gives 4 active minutes after the window and 11 before it, so 10:44.
 */
export function activeCutoff(now: number, limitMs: number, windows: readonly PauseWindow[]): number {
	let cursor = now;
	let remaining = limitMs;
	for (const { start, end: windowEnd } of windows) {
		const end = Math.min(windowEnd, cursor);
		if (end <= start) continue;
		if (cursor - end >= remaining) return cursor - remaining;
		remaining -= cursor - end;
		cursor = start;
	}
	return cursor - remaining;
}

/** Today's and yesterday's downtime windows at `now`, latest first (memo/KV only, no `/status` request). */
async function pauseWindows(env: Env, now: number): Promise<PauseWindow[]> {
	return Promise.all(
		[utcDate(now), utcDate(now - DAY_MS)].map(async (date) =>
			downtimeWindow(date, await onlineAt(env, date), now)
		)
	);
}

/** The part of `[from, now]` ESI was paused by the daily downtime (today's and yesterday's window). */
export async function esiPausedMs(env: Env, from: number, now: number): Promise<number> {
	return pausedWithin(from, now, await pauseWindows(env, now));
}

/**
 * `started_at` cutoff of a staleness limit that does not count the downtime: a `running` row is stale
 * when it started at or before this, i.e. its active time without ESI's pause reaches `limitMs`.
 */
export async function esiActiveCutoff(env: Env, now: number, limitMs: number): Promise<number> {
	return activeCutoff(now, limitMs, await pauseWindows(env, now));
}
