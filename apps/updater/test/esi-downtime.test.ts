import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EsiDowntime from '../src/esi-downtime.ts';
import { installFetch, json } from './helpers.ts';

/** The real gate (the setup file keeps ESI open for every other test). */
const {
	ESI_ONLINE_KV_KEY,
	activeCutoff,
	downtimeWindow,
	esiAvailable,
	esiPausedMs,
	pausedWithin,
	resetEsiDowntimeMemo
} = await vi.importActual<typeof EsiDowntime>('../src/esi-downtime.ts');

const MINUTE = 60_000;

const at = (day: number, hour: number, minute: number, second = 0) =>
	Date.UTC(2026, 9, day, hour, minute, second);

/** `/status` answers, served in order (the last one repeats). */
function serveStatus(...answers: (() => Response)[]) {
	return installFetch(() => (answers.length > 1 ? answers.shift()! : answers[0]!)());
}

const down = () => json({ error: 'The datasource tranquility is temporarily unavailable' }, {}, 503);
/** `/status` of a server started at `startTime` (default: after the downtime of the 27th). */
const players =
	(n: number, vip = false, startTime = '2026-10-27T11:02:11Z') =>
	() =>
		json({
			players: n,
			server_version: '3000000',
			start_time: startTime,
			...(vip ? { vip } : {})
		});
/** The server from before the downtime of the 27th, still up or still reported. */
const yesterdays = (n: number) => players(n, false, '2026-10-26T11:04:00Z');

describe('esiAvailable', () => {
	beforeEach(async () => {
		resetEsiDowntimeMemo();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		for (const day of ['2026-10-27', '2026-10-28']) await env.CACHE.delete(ESI_ONLINE_KV_KEY(day));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('closes from 10:55 UTC until /status shows the server back, then stays open for the day', async () => {
		const calls = serveStatus(down, players(40), players(25_000));

		expect(await esiAvailable(env, at(27, 10, 40))).toBe(true);
		expect(await esiAvailable(env, at(27, 10, 57))).toBe(false);
		expect(calls).toHaveLength(0);

		expect(await esiAvailable(env, at(27, 11, 3))).toBe(false);
		expect(await esiAvailable(env, at(27, 11, 5))).toBe(false);
		expect(await esiAvailable(env, at(27, 11, 7))).toBe(true);
		expect(calls.map((c) => c.url)).toEqual(Array(3).fill('https://esi.evetech.net/status'));

		expect(await esiAvailable(env, at(27, 11, 30))).toBe(true);
		expect(await esiAvailable(env, at(28, 10, 50))).toBe(true);
		expect(calls).toHaveLength(3);

		// The time ESI was paused that day ends with the confirmation (another isolate reads it from KV).
		resetEsiDowntimeMemo();
		expect(await esiPausedMs(env, at(27, 10, 50), at(27, 11, 30))).toBe(12 * MINUTE);
		expect(calls).toHaveLength(3);
	});

	it('does not ask again within a minute of a failed check', async () => {
		const calls = serveStatus(down, players(25_000));

		expect(await esiAvailable(env, at(27, 11, 3))).toBe(false);
		expect(await esiAvailable(env, at(27, 11, 3, 59))).toBe(false);
		expect(calls).toHaveLength(1);
		expect(await esiAvailable(env, at(27, 11, 4, 1))).toBe(true);
		expect(calls).toHaveLength(2);
	});

	it('shares one status check between concurrent callers', async () => {
		const calls = serveStatus(players(25_000));

		const open = await Promise.all([1, 2, 3].map(() => esiAvailable(env, at(27, 11, 6))));

		expect(open).toEqual([true, true, true]);
		expect(calls).toHaveLength(1);
	});

	it('counts a server in VIP mode as still down', async () => {
		serveStatus(players(500, true));
		expect(await esiAvailable(env, at(27, 11, 6))).toBe(false);
	});

	it('ignores the players of the server still shutting down and waits for one started after 10:55', async () => {
		const calls = serveStatus(
			yesterdays(25_000),
			players(0, false, '2026-10-27T11:18:35Z'),
			players(800, false, '2026-10-27T11:18:35Z')
		);

		expect(await esiAvailable(env, at(27, 11, 0))).toBe(false);
		expect(await esiAvailable(env, at(27, 11, 20))).toBe(false);
		expect(await esiAvailable(env, at(27, 11, 30))).toBe(true);
		expect(calls).toHaveLength(3);
	});

	it('opens from 12:00 UTC on a day the server did not restart', async () => {
		serveStatus(yesterdays(25_000));

		expect(await esiAvailable(env, at(27, 11, 59))).toBe(false);
		expect(await esiAvailable(env, at(27, 12, 0))).toBe(true);
	});

	it('trusts the confirmation of another isolate without asking', async () => {
		serveStatus(players(25_000));
		expect(await esiAvailable(env, at(27, 11, 6))).toBe(true);
		resetEsiDowntimeMemo();
		const calls = serveStatus(down);

		expect(await esiAvailable(env, at(27, 11, 20))).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it('asks again on the next day', async () => {
		serveStatus(players(25_000));
		expect(await esiAvailable(env, at(27, 11, 6))).toBe(true);
		const calls = serveStatus(down);

		expect(await esiAvailable(env, at(28, 11, 2))).toBe(false);
		expect(calls).toHaveLength(1);
	});
});

describe('downtime pause math', () => {
	const today = downtimeWindow('2026-10-27', at(27, 11, 8), at(27, 11, 30));

	it('counts nothing outside the window', () => {
		expect(pausedWithin(at(27, 12, 0), at(27, 12, 30), [today])).toBe(0);
		expect(pausedWithin(at(27, 9, 0), at(27, 10, 30), [today])).toBe(0);
	});

	it('counts a window that lies inside the span from 10:55 until ESI was back', () => {
		expect(pausedWithin(at(27, 10, 50), at(27, 11, 30), [today])).toBe(13 * MINUTE);
	});

	it('counts an unconfirmed window as paused up to now', () => {
		const now = at(27, 11, 20);
		expect(pausedWithin(at(27, 10, 50), now, [downtimeWindow('2026-10-27', null, now)])).toBe(25 * MINUTE);
		const early = at(27, 10, 40);
		expect(pausedWithin(at(27, 10, 0), early, [downtimeWindow('2026-10-27', null, early)])).toBe(0);
	});

	it('counts the previous day window of a span that started the day before', () => {
		const yesterday = downtimeWindow('2026-10-26', at(26, 11, 5), at(27, 11, 30));
		expect(pausedWithin(at(26, 10, 0), at(27, 11, 30), [today, yesterday])).toBe(23 * MINUTE);
	});

	it('puts the stale cutoff back by the paused time only', () => {
		const window = downtimeWindow('2026-10-27', at(27, 11, 8), at(27, 11, 12));
		expect(activeCutoff(at(27, 11, 12), 15 * MINUTE, [window])).toBe(at(27, 10, 44));
		expect(activeCutoff(at(27, 11, 25), 15 * MINUTE, [window])).toBe(at(27, 11, 10));
		expect(activeCutoff(at(27, 12, 0), 15 * MINUTE, [])).toBe(at(27, 11, 45));
	});
});
