/**
 * `wrangler dev` never fires Cron Triggers by itself; with `--test-scheduled` it only exposes a route that
 * runs `scheduled()` when requested. This script requests that route on the cron's schedule (every 10
 * minutes, on the boundary, plus once at start) so the updater behaves locally like in production.
 * Usage: `npm run dev:cron -w apps/updater` (with `npm run dev -w apps/updater` running).
 */

export const DEFAULT_BASE_URL = 'http://localhost:8787';
export const CRON = '*/10 * * * *';
export const EVERY_MINUTES = 10;

/** Milliseconds until the next `every`-minute boundary (always > 0). */
export function msUntilNextBoundary(now: number, everyMinutes = EVERY_MINUTES): number {
	const period = everyMinutes * 60_000;
	return period - (now % period);
}

export function scheduledUrl(baseUrl: string, cron = CRON): string {
	return `${baseUrl.replace(/\/+$/, '')}/cdn-cgi/local/scheduled?cron=${encodeURIComponent(cron)}`;
}

export interface TickDeps {
	fetch: typeof fetch;
	log: (line: string) => void;
	now: () => number;
}

/** Fires one scheduled event; never throws (the dev server may not be up yet). */
export async function tick(baseUrl: string, deps: TickDeps): Promise<boolean> {
	const at = new Date(deps.now()).toISOString();
	try {
		const res = await deps.fetch(scheduledUrl(baseUrl));
		if (!res.ok) {
			deps.log(`[dev-cron] ${at} scheduled event failed: HTTP ${res.status} ${await res.text()}`);
			return false;
		}
		deps.log(`[dev-cron] ${at} scheduled event fired (${CRON})`);
		return true;
	} catch (e) {
		deps.log(`[dev-cron] ${at} updater not reachable at ${baseUrl}: ${(e as Error).message}`);
		return false;
	}
}

if (import.meta.main) {
	const baseUrl = process.argv[2] ?? DEFAULT_BASE_URL;
	const deps: TickDeps = { fetch, log: console.log, now: Date.now };
	const loop = async () => {
		await tick(baseUrl, deps);
		setTimeout(loop, msUntilNextBoundary(Date.now()));
	};
	console.log(
		`[dev-cron] firing ${CRON} against ${baseUrl} now and every ${EVERY_MINUTES} minutes (Ctrl+C to stop)`
	);
	await loop();
}
