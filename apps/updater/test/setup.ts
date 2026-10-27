import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { vi } from 'vitest';
import type * as EsiDowntime from '../src/esi-downtime.ts';

// The suite runs at any wall-clock time: without this the downtime gate would close ESI or probe
// `/status` depending on when it runs, and staleness limits would discount an unconfirmed downtime.
// Tests of the gate and of the pause math restore the real functions.
vi.mock('../src/esi-downtime.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof EsiDowntime>();
	return {
		...actual,
		esiAvailable: vi.fn(async () => true),
		esiPausedMs: vi.fn(async () => 0),
		esiActiveCutoff: vi.fn(async (_env: Env, now: number, limitMs: number) => now - limitMs)
	};
});

await applyD1Migrations(env.DB, env.CORE_MIGRATIONS);
await applyD1Migrations(env.HISTORY_DB, env.HISTORY_MIGRATIONS);
