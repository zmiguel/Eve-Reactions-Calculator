import { env } from 'cloudflare:workers';
import { SDE_LATEST_URL } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSdeUpdate } from '../src/cron/sde-check.ts';
import {
	completedInstanceCount,
	installFetch,
	mockedSdeWorkflow,
	notModified,
	resetState,
	sdeLatest
} from './helpers.ts';

const T0 = Date.UTC(2026, 9, 6, 13, 0);

async function setImportedBuild(build: number) {
	await env.DB.prepare(`INSERT INTO sde_state VALUES (1, ?, '2026-01-01', 1, '{}', '[]')`).bind(build).run();
}

describe('checkSdeUpdate', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('only checks during minutes 0–9 of the hour', async () => {
		const calls = installFetch(() => sdeLatest(5000));

		const line = await checkSdeUpdate(env, T0 + 10 * 60_000, T0);

		expect(line).toContain('skipped');
		expect(calls).toHaveLength(0);
	});

	it('starts sde-<build> when the published build is newer than sde_state', async () => {
		await setImportedBuild(4000);
		await using introspector = await mockedSdeWorkflow();
		const calls = installFetch(() => sdeLatest(5001, { ETag: '"b5001"' }));

		const line = await checkSdeUpdate(env, T0 + 9 * 60_000, T0);

		expect(calls.map((c) => c.url)).toEqual([SDE_LATEST_URL]);
		expect(line).toContain('started sde-5001');
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect((await env.SDE_SYNC.get('sde-5001')).id).toBe('sde-5001');
		const cache = await env.DB.prepare('SELECT etag FROM http_cache WHERE url = ?')
			.bind(SDE_LATEST_URL)
			.first();
		expect(cache).toEqual({ etag: '"b5001"' });
	});

	it('starts a sync when no SDE was imported yet', async () => {
		await using introspector = await mockedSdeWorkflow();
		installFetch(() => sdeLatest(5002));

		const line = await checkSdeUpdate(env, T0, T0);

		expect(line).toContain('started sde-5002');
		expect(await completedInstanceCount(introspector)).toBe(1);
	});

	it('does nothing for an already imported build or a 304', async () => {
		await setImportedBuild(5003);
		await using introspector = await mockedSdeWorkflow();
		let answer = sdeLatest(5003, { ETag: '"b5003"' });
		const calls = installFetch(() => answer);

		expect(await checkSdeUpdate(env, T0, T0)).toContain('already imported');
		answer = notModified({ ETag: '"b5003"' });
		expect(await checkSdeUpdate(env, T0 + 3_600_000, T0 + 3_600_000)).toContain('not modified');

		expect(calls[1]!.headers.get('If-None-Match')).toBe('"b5003"');
		expect(await completedInstanceCount(introspector)).toBe(0);
	});

	it('ignores an instance id that already exists', async () => {
		await using introspector = await mockedSdeWorkflow();
		installFetch(() => sdeLatest(5004));
		await env.SDE_SYNC.create({ id: 'sde-5004', params: { build: 5004 } });

		const line = await checkSdeUpdate(env, T0, T0);

		expect(line).toContain('already exists');
		expect(await completedInstanceCount(introspector)).toBe(1);
	});
});
