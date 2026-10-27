import { env, exports } from 'cloudflare:workers';
import { DATASET_KV_KEY } from '@reactions/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTrackingPass } from '../src/cron/tracking.ts';
import { esiActiveCutoff } from '../src/esi-downtime.ts';
import type * as EsiDowntime from '../src/esi-downtime.ts';
import { claimTrackingSource, settleStaleTrackingSyncs, startTrackingSync } from '../src/tracking.ts';
import { completedInstanceCount, mockedTrackingWorkflow, resetState } from './helpers.ts';

/** The real pause math (the setup file turns it off for every other test). */
const actual = await vi.importActual<typeof EsiDowntime>('../src/esi-downtime.ts');

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 12, 14, 0);

/** The ledger rebuild reads the published dataset; an empty one is enough for a user without rows. */
const publishDataset = () =>
	env.CACHE.put(DATASET_KV_KEY, JSON.stringify({ sdeBuild: 1, reactions: [], types: {}, reprocess: {} }));

async function seedUser(userId: string, lastSeenAt: number) {
	await env.DB.prepare('INSERT INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, ?)')
		.bind(userId, lastSeenAt)
		.run();
}

/** Personal connection `sourceId` of `userId` with tracking on (unless `enabled: false`) and `streams`. */
async function seedConnection(
	sourceId: number,
	userId: string,
	values: {
		enabled?: boolean;
		status?: string;
		runId?: string;
		startedAt?: number;
		lastAttemptAt?: number;
		/** expires_at per personal stream; omitted = no stream rows yet. */
		expiresAt?: number | null;
	} = {}
) {
	const characterId = 1000 + sourceId;
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (?, ?, 'Pilot', 'h', 1)"
		).bind(characterId, userId),
		env.DB.prepare(
			`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, status,
				tracking_enabled, tracking_status, tracking_run_id, tracking_started_at, tracking_last_attempt_at, created_at)
			VALUES (?, ?, ?, 'character', ?, 'Pilot', 'ok', ?, ?, ?, ?, ?, 1)`
		).bind(
			sourceId,
			userId,
			characterId,
			characterId,
			values.enabled === false ? 0 : 1,
			values.status ?? null,
			values.runId ?? null,
			values.startedAt ?? null,
			values.lastAttemptAt ?? null
		)
	]);
	if (values.expiresAt === undefined) return;
	await env.DB.batch(
		['jobs', 'transactions', 'journal', 'orders', 'contracts'].map((stream) =>
			env.DB.prepare(
				"INSERT INTO tracking_streams (source_id, stream, user_id, status, expires_at) VALUES (?, ?, ?, 'ok', ?)"
			).bind(sourceId, stream, userId, values.expiresAt)
		)
	);
}

async function connection(sourceId: number) {
	return env.DB.prepare(
		`SELECT tracking_status, tracking_run_id, tracking_started_at, tracking_last_attempt_at, tracking_last_error
		FROM inventory_sources WHERE source_id = ?`
	)
		.bind(sourceId)
		.first<{
			tracking_status: string | null;
			tracking_run_id: string | null;
			tracking_started_at: number | null;
			tracking_last_attempt_at: number | null;
			tracking_last_error: string | null;
		}>();
}

async function jobRuns() {
	const { results } = await env.DB.prepare(
		"SELECT run_id, status, detail_json FROM job_runs WHERE kind = 'tracking' ORDER BY started_at, run_id"
	).all<{ run_id: string; status: string; detail_json: string }>();
	return results.map((r) => ({
		run_id: r.run_id,
		status: r.status,
		detail: JSON.parse(r.detail_json) as unknown
	}));
}

/** A stand-in `TRACKING_SYNC` binding recording created ids (prototype keeps every other binding). */
function fakeWorkflow() {
	const created: string[] = [];
	const binding = {
		async create({ id }: { id: string }) {
			if (created.includes(id)) throw new Error(`instance.already_exists: ${id}`);
			created.push(id);
			return { id };
		}
	} as unknown as Workflow;
	const testEnv = Object.create(env, { TRACKING_SYNC: { value: binding } }) as Env;
	return { testEnv, created };
}

describe('tracking claim', () => {
	beforeEach(resetState);

	it('claims once; a second claim is busy; a run older than 15 minutes is settled as error', async () => {
		await seedUser('u1', NOW);
		await seedConnection(1, 'u1');
		await seedConnection(2, 'u1', { status: 'running', runId: 'old', startedAt: NOW - 16 * MINUTE });

		expect(await claimTrackingSource(env, 1, 'run-a', NOW, true)).toBe('claimed');
		expect(await claimTrackingSource(env, 1, 'run-b', NOW, true)).toBe('busy');
		expect(await connection(1)).toMatchObject({
			tracking_status: 'running',
			tracking_run_id: 'run-a',
			tracking_started_at: NOW,
			tracking_last_attempt_at: NOW
		});

		expect(await claimTrackingSource(env, 2, 'run-c', NOW, true)).toBe('claimed');
		expect(await connection(2)).toMatchObject({
			tracking_run_id: 'run-c',
			tracking_last_error: 'sync did not finish'
		});
	});

	it('does not count the daily downtime a sync waited out towards its 15 minutes', async () => {
		vi.mocked(esiActiveCutoff).mockImplementation(actual.esiActiveCutoff);
		actual.resetEsiDowntimeMemo();
		const at = (hour: number, minute: number) => Date.UTC(2026, 9, 12, hour, minute);
		await env.CACHE.put(actual.ESI_ONLINE_KV_KEY('2026-10-12'), String(at(11, 8)));
		await seedUser('u1', NOW);
		await seedConnection(1, 'u1', { status: 'running', runId: 'tracking-1-wait', startedAt: at(10, 50) });

		try {
			expect(await settleStaleTrackingSyncs(env, at(11, 12))).toBe(0);
			expect(await claimTrackingSource(env, 1, 'run-b', at(11, 12), false)).toBe('busy');
			expect(await connection(1)).toMatchObject({
				tracking_status: 'running',
				tracking_run_id: 'tracking-1-wait'
			});

			expect(await settleStaleTrackingSyncs(env, at(11, 25))).toBe(1);
			expect(await connection(1)).toMatchObject({
				tracking_status: 'error',
				tracking_last_error: 'sync did not finish'
			});
		} finally {
			vi.mocked(esiActiveCutoff).mockReset();
		}
	});

	it('refuses with the earliest expiry while every stream is fresh, and connections with tracking off', async () => {
		await seedUser('u1', NOW);
		await seedConnection(1, 'u1', { expiresAt: NOW + 10 * MINUTE });
		await env.DB.prepare("UPDATE tracking_streams SET expires_at = ? WHERE stream = 'orders'")
			.bind(NOW + 5 * MINUTE)
			.run();
		await seedConnection(2, 'u1', { enabled: false });

		expect(await claimTrackingSource(env, 1, 'run-a', NOW, true)).toEqual({ notBefore: NOW + 5 * MINUTE });
		expect(await claimTrackingSource(env, 1, 'run-a', NOW, false)).toBe('claimed');
		expect(await claimTrackingSource(env, 2, 'run-b', NOW, true)).toBe('missing');
	});

	it('a corporation stream missing for a newly selected wallet division makes the connection due', async () => {
		await seedUser('u1', NOW);
		await seedConnection(1, 'u1', { expiresAt: NOW + 10 * MINUTE });
		await env.DB.prepare(
			"UPDATE inventory_sources SET kind = 'corporation', owner_id = 98000001, wallet_divisions_json = '[1]' WHERE source_id = 1"
		).run();
		await env.DB.prepare(
			"UPDATE tracking_streams SET stream = stream || ':1' WHERE stream IN ('transactions', 'journal')"
		).run();
		expect(await claimTrackingSource(env, 1, 'run-a', NOW, true)).toEqual({ notBefore: NOW + 10 * MINUTE });

		await env.DB.prepare(
			"UPDATE inventory_sources SET wallet_divisions_json = '[1,2]' WHERE source_id = 1"
		).run();
		expect(await claimTrackingSource(env, 1, 'run-a', NOW, true)).toBe('claimed');
	});
});

describe('cron step 8: tracking', () => {
	beforeEach(resetState);

	/**
	 * `u1` (seen yesterday): 1 never synced, 2 attempted 61 min ago with expired streams, 3 attempted 30
	 * min ago, 4 streams fresh, 5 running, 6 denied, 7 tracking off; `u2` (seen 31 days ago): 8.
	 */
	async function seedMixed() {
		await seedUser('u1', NOW - DAY);
		await seedUser('u2', NOW - 31 * DAY);
		await seedConnection(1, 'u1');
		await seedConnection(2, 'u1', { lastAttemptAt: NOW - 61 * MINUTE, expiresAt: NOW - MINUTE });
		await seedConnection(3, 'u1', { lastAttemptAt: NOW - 30 * MINUTE, expiresAt: NOW - MINUTE });
		await seedConnection(4, 'u1', { lastAttemptAt: NOW - 2 * 60 * MINUTE, expiresAt: NOW + MINUTE });
		await seedConnection(5, 'u1', { status: 'running', runId: 'r', startedAt: NOW - MINUTE });
		await seedConnection(6, 'u1', { status: 'denied' });
		await seedConnection(7, 'u1', { enabled: false });
		await seedConnection(8, 'u2');
	}

	it('starts only eligible connections (activity, interval, expiry) and records the tick', async () => {
		await seedMixed();
		const { testEnv, created } = fakeWorkflow();

		expect(await startTrackingPass(testEnv, NOW)).toBe(
			'started 2 of 2 due connections (0 skipped, 0 busy); ledgers rebuilt: 0'
		);

		expect(created.sort()).toEqual([`tracking-1-${NOW}`, `tracking-2-${NOW}`]);
		expect(await jobRuns()).toEqual([
			{
				run_id: `tracking-${NOW}`,
				status: 'ok',
				detail: { started: 2, skipped: 0, busy: 0, ledgersRebuilt: 0, ledgersFailed: 0 }
			}
		]);
	});

	it('records nothing on an idle tick', async () => {
		await seedUser('u1', NOW);
		await seedConnection(4, 'u1', { expiresAt: NOW + MINUTE });
		const { testEnv, created } = fakeWorkflow();

		expect(await startTrackingPass(testEnv, NOW)).toBe('no connections due; ledgers rebuilt: 0');
		expect(created).toEqual([]);
		expect(await jobRuns()).toEqual([]);
	});

	it('streams of wallet divisions no longer counted and lookup expiries never make a connection due', async () => {
		await seedUser('u1', NOW - DAY);
		// 20 corporation connections (as many as a tick starts) counting division 1 only, never attempted:
		// their counted streams are fresh, the rows of division 2 and the lookup expiries are expired.
		const quiet = Array.from({ length: 20 }, (_, i) => 101 + i);
		for (const sourceId of quiet) {
			await seedConnection(sourceId, 'u1', { expiresAt: NOW + 10 * MINUTE });
			await env.DB.batch([
				env.DB.prepare(
					"UPDATE inventory_sources SET kind = 'corporation', owner_id = 98000000 + source_id, wallet_divisions_json = '[1]' WHERE source_id = ?"
				).bind(sourceId),
				env.DB.prepare(
					"UPDATE tracking_streams SET stream = stream || ':1' WHERE source_id = ? AND stream IN ('transactions', 'journal')"
				).bind(sourceId),
				...['transactions:2', 'journal:2', 'divisions', 'affiliations', 'blueprints'].map((stream) =>
					env.DB.prepare(
						"INSERT INTO tracking_streams (source_id, stream, user_id, status, expires_at) VALUES (?, ?, 'u1', 'ok', ?)"
					).bind(sourceId, stream, NOW - MINUTE)
				)
			]);
		}
		await seedConnection(2, 'u1', { lastAttemptAt: NOW - 2 * 60 * MINUTE, expiresAt: NOW - MINUTE });
		const { testEnv, created } = fakeWorkflow();

		expect(await startTrackingPass(testEnv, NOW)).toBe(
			'started 1 of 1 due connections (0 skipped, 0 busy); ledgers rebuilt: 0'
		);
		expect(created).toEqual([`tracking-2-${NOW}`]);
		// Ticked again (division 2 counted): the expired division 2 streams make it due.
		await env.DB.prepare(
			"UPDATE inventory_sources SET wallet_divisions_json = '[1,2]' WHERE source_id = 101"
		).run();
		expect(await startTrackingPass(testEnv, NOW + 1)).toContain('started 1 of 1 due connections');
		expect(created).toContain(`tracking-101-${NOW + 1}`);
	});

	it('rebuilds dirty ledgers', async () => {
		await seedUser('u1', NOW);
		await env.DB.prepare('INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES (?, NULL, 1)')
			.bind('u1')
			.run();
		await publishDataset();
		const { testEnv } = fakeWorkflow();
		const started = Date.now();

		expect(await startTrackingPass(testEnv, NOW)).toBe('no connections due; ledgers rebuilt: 1');

		const state = await env.DB.prepare('SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?')
			.bind('u1')
			.first<{ rebuilt_at: number; dirty: number }>();
		expect(state?.dirty).toBe(0);
		expect(state?.rebuilt_at).toBeGreaterThanOrEqual(started);
		expect(await jobRuns()).toMatchObject([{ status: 'ok', detail: { ledgersRebuilt: 1 } }]);
	});

	it('does not reuse an instance id', async () => {
		await seedUser('u1', NOW);
		await seedConnection(1, 'u1');
		const { testEnv } = fakeWorkflow();

		expect(await startTrackingSync(testEnv, 1, 'tracking-1-1', 'hourly', NOW)).toBe('started');
		await env.DB.prepare("UPDATE inventory_sources SET tracking_status = 'ok'").run();
		expect(await startTrackingSync(testEnv, 1, 'tracking-1-1', 'hourly', NOW)).toBe('exists');
		expect(await connection(1)).toMatchObject({ tracking_status: 'error' });
	});
});

describe('UpdaterRpc tracking', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('triggerTrackingSync starts tracking-<id>-<ms>, then answers busy', async () => {
		await seedUser('u1', Date.now());
		await seedConnection(1, 'u1');
		await using introspector = await mockedTrackingWorkflow();

		const first = await exports.UpdaterRpc.triggerTrackingSync(1);
		const second = await exports.UpdaterRpc.triggerTrackingSync(1);

		expect(first).toEqual({ instanceId: expect.stringMatching(/^tracking-1-\d+$/) });
		expect(second).toEqual({ busy: true });
		expect(await completedInstanceCount(introspector)).toBe(1);
	});

	it('triggerTrackingSync answers notBefore while every stream is fresh', async () => {
		const expiresAt = Date.now() + 30 * MINUTE;
		await seedUser('u1', Date.now());
		await seedConnection(1, 'u1', { expiresAt });

		expect(await exports.UpdaterRpc.triggerTrackingSync(1)).toEqual({ notBefore: expiresAt });
		expect(await connection(1)).toMatchObject({ tracking_status: null });
	});

	it('triggerTrackingPass records a manual run', async () => {
		const result = await exports.UpdaterRpc.triggerTrackingPass();

		expect(result).toMatchObject({ status: 'ok', summary: 'no connections due; ledgers rebuilt: 0' });
		expect(await jobRuns()).toEqual([
			{
				run_id: result.runId,
				status: 'ok',
				detail: { started: 0, skipped: 0, busy: 0, ledgersRebuilt: 0, ledgersFailed: 0 }
			}
		]);
	});

	it('rebuildLedger answers the summary and sets rebuilt_at', async () => {
		await seedUser('u1', Date.now());
		await publishDataset();

		const result = await exports.UpdaterRpc.rebuildLedger('u1');

		expect(result).toMatchObject({ lots: 0, jobs: 0, needsReview: 0 });
		const state = await env.DB.prepare('SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?')
			.bind('u1')
			.first<{ rebuilt_at: number; dirty: number }>();
		expect(state?.dirty).toBe(0);
		expect(state?.rebuilt_at).toBeTypeOf('number');
	});

	it('rebuildLedger answers unavailable and marks the ledger dirty when the rebuild fails', async () => {
		await seedUser('u1', Date.now());

		expect(await exports.UpdaterRpc.rebuildLedger('u1')).toEqual({ error: 'unavailable' });
		const state = await env.DB.prepare('SELECT dirty FROM ledger_state WHERE user_id = ?')
			.bind('u1')
			.first<{ dirty: number }>();
		expect(state?.dirty).toBe(1);
	});
});
