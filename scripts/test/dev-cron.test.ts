import { describe, expect, it } from 'vitest';
import { msUntilNextBoundary, scheduledUrl, tick, type TickDeps } from '../dev-cron.ts';

const T = Date.UTC(2026, 9, 7, 8, 41, 30);

function deps(response: Response | Error): TickDeps & { lines: string[]; urls: string[] } {
	const lines: string[] = [];
	const urls: string[] = [];
	return {
		lines,
		urls,
		log: (l) => lines.push(l),
		now: () => T,
		fetch: (async (url: string) => {
			urls.push(url);
			if (response instanceof Error) throw response;
			return response;
		}) as typeof fetch
	};
}

describe('msUntilNextBoundary', () => {
	it('waits until the next 10-minute mark', () => {
		expect(msUntilNextBoundary(T)).toBe(8 * 60_000 + 30_000);
		expect(msUntilNextBoundary(Date.UTC(2026, 9, 7, 8, 40))).toBe(10 * 60_000);
		expect(msUntilNextBoundary(Date.UTC(2026, 9, 7, 8, 49, 59, 999))).toBe(1);
	});
});

describe('scheduledUrl', () => {
	it('targets the wrangler test-scheduled route with the encoded cron', () => {
		expect(scheduledUrl('http://localhost:8787/')).toBe(
			'http://localhost:8787/cdn-cgi/local/scheduled?cron=*%2F10%20*%20*%20*%20*'
		);
	});
});

describe('tick', () => {
	it('fires the scheduled route and logs success', async () => {
		const d = deps(new Response('ok'));
		expect(await tick('http://localhost:8787', d)).toBe(true);
		expect(d.urls).toEqual([scheduledUrl('http://localhost:8787')]);
		expect(d.lines[0]).toContain('scheduled event fired');
	});

	it('reports HTTP errors and an unreachable server without throwing', async () => {
		const failed = deps(new Response('Error: no --test-scheduled', { status: 404 }));
		expect(await tick('http://localhost:8787', failed)).toBe(false);
		expect(failed.lines[0]).toContain('HTTP 404');
		const down = deps(new TypeError('fetch failed'));
		expect(await tick('http://localhost:8787', down)).toBe(false);
		expect(down.lines[0]).toContain('not reachable');
	});
});
