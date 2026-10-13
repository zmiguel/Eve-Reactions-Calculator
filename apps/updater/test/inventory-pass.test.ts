import { createExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { ERROR_INTERNAL } from '@reactions/eve';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startInventoryPass } from '../src/cron/inventory.ts';
import { SYNC_ALREADY_RAN, startInventorySync } from '../src/inventory.ts';
import { UpdaterRpc } from '../src/rpc.ts';
import { completedInstanceCount, mockedInventoryWorkflow, resetState } from './helpers.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOON = Date.UTC(2026, 9, 12, 12, 0);
const AT = NOON + 10 * MINUTE;
const NOW = AT + 5_000;
const DATE = '2026-10-12';

async function seedUser(userId: string, lastSeenAt: number) {
	await env.DB.prepare('INSERT INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, ?)')
		.bind(userId, lastSeenAt)
		.run();
}

/** Personal source `sourceId` of `userId`, read by character `1000 + sourceId`. */
async function seedSource(
	sourceId: number,
	userId: string,
	values: {
		status?: string;
		lastAttemptAt?: number;
		syncStartedAt?: number;
		runId?: string;
		dataExpiresAt?: number;
	} = {}
) {
	const characterId = 1000 + sourceId;
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (?, ?, 'Pilot', 'h', 1)"
		).bind(characterId, userId),
		env.DB.prepare(
			`INSERT INTO inventory_sources (source_id, user_id, character_id, kind, owner_id, owner_name, status,
				run_id, sync_started_at, last_attempt_at, data_expires_at, created_at)
			VALUES (?, ?, ?, 'character', ?, 'Pilot', ?, ?, ?, ?, ?, 1)`
		).bind(
			sourceId,
			userId,
			characterId,
			characterId,
			values.status ?? 'ok',
			values.runId ?? null,
			values.syncStartedAt ?? null,
			values.lastAttemptAt ?? null,
			values.dataExpiresAt ?? null
		)
	]);
}

async function source(sourceId: number) {
	return env.DB.prepare(
		'SELECT status, run_id, sync_started_at, last_attempt_at, last_error FROM inventory_sources WHERE source_id = ?'
	)
		.bind(sourceId)
		.first<{
			status: string;
			run_id: string | null;
			sync_started_at: number | null;
			last_attempt_at: number | null;
			last_error: string | null;
		}>();
}

async function jobRuns() {
	const { results } = await env.DB.prepare(
		"SELECT run_id, status, detail_json FROM job_runs WHERE kind = 'inventory' ORDER BY started_at, run_id"
	).all<{ run_id: string; status: string; detail_json: string }>();
	return results.map((r) => ({ ...r, detail: JSON.parse(r.detail_json) as unknown }));
}

/**
 * A stand-in `INVENTORY_SYNC` binding: records created ids and rejects a reused id the way Workflows do
 * (or every create, with `failWith`).
 */
function fakeWorkflow(failWith?: string) {
	const created: string[] = [];
	const binding = {
		async create({ id }: { id: string }) {
			if (failWith) throw new Error(failWith);
			if (created.includes(id)) throw new Error(`instance.already_exists: ${id}`);
			created.push(id);
			return { id };
		}
	} as unknown as Workflow;
	// Prototype lookup keeps every other binding of the real env.
	const testEnv = Object.create(env, { INVENTORY_SYNC: { value: binding } }) as Env;
	return { testEnv, created };
}

/**
 * Active user `u1` (seen yesterday) with sources 1 (never attempted), 2 (attempted yesterday), 3
 * (attempted today after 12:00), 4 (running), 5 (denied), 7 (error, attempted today before 12:00);
 * inactive user `u2` (seen 31 days ago) with source 6.
 */
async function seedMixedSources() {
	await seedUser('u1', NOW - DAY);
	await seedUser('u2', NOW - 31 * DAY);
	await seedSource(1, 'u1', { status: 'pending' });
	await seedSource(2, 'u1', { lastAttemptAt: NOON - DAY });
	await seedSource(3, 'u1', { lastAttemptAt: NOON + 5 * MINUTE });
	await seedSource(4, 'u1', {
		status: 'running',
		runId: 'inventory-4-manual-1',
		syncStartedAt: NOW - MINUTE,
		lastAttemptAt: NOW - MINUTE
	});
	await seedSource(5, 'u1', { status: 'denied', lastAttemptAt: NOON - DAY });
	await seedSource(6, 'u2', { lastAttemptAt: NOON - DAY });
	await seedSource(7, 'u1', { status: 'error', lastAttemptAt: NOON - 60 * MINUTE });
}

describe('cron step 7: inventory', () => {
	beforeEach(resetState);

	it('starts nothing before 12:00 UTC', async () => {
		await seedMixedSources();
		const { testEnv, created } = fakeWorkflow();

		expect(await startInventoryPass(testEnv, NOON - 10 * MINUTE, NOON - 5 * MINUTE)).toBe(
			'skipped (daily from 12:00 UTC)'
		);
		expect(created).toEqual([]);
		expect(await jobRuns()).toEqual([]);
	});

	it('starts sources of active users not attempted since 12:00 UTC, skipping running and denied ones', async () => {
		await seedMixedSources();
		const { testEnv, created } = fakeWorkflow();

		expect(await startInventoryPass(testEnv, AT, NOW)).toBe('started 3 of 3 due sources (0 skipped, 0 busy)');

		expect(created).toEqual([`inventory-1-${DATE}`, `inventory-2-${DATE}`, `inventory-7-${DATE}`]);
		for (const id of [1, 2, 7])
			expect(await source(id)).toMatchObject({
				status: 'running',
				run_id: `inventory-${id}-${DATE}`,
				sync_started_at: NOW,
				last_attempt_at: NOW
			});
		expect(await source(4)).toMatchObject({ status: 'running', run_id: 'inventory-4-manual-1' });
		expect(await source(5)).toMatchObject({ status: 'denied' });
		expect(await jobRuns()).toEqual([
			{
				run_id: `inventory-${NOW}`,
				status: 'ok',
				detail_json: expect.any(String),
				detail: { started: 3, skipped: 0, busy: 0 }
			}
		]);
	});

	it('does not create a day’s instance id twice', async () => {
		await seedMixedSources();
		const { testEnv, created } = fakeWorkflow();
		await startInventoryPass(testEnv, AT, NOW);
		// The started syncs (and source 4's) finish.
		await env.DB.prepare("UPDATE inventory_sources SET status = 'ok' WHERE source_id IN (1, 2, 4, 7)").run();

		expect(await startInventoryPass(testEnv, AT + 10 * MINUTE, NOW + 10 * MINUTE)).toBe('no sources due');
		// Even when a source looks due again (its attempt cleared), the day's instance is not created twice.
		await env.DB.prepare('UPDATE inventory_sources SET last_attempt_at = NULL WHERE source_id = 1').run();
		expect(await startInventoryPass(testEnv, AT + 20 * MINUTE, NOW + 20 * MINUTE)).toBe(
			'started 0 of 1 due sources (1 skipped, 0 busy)'
		);

		expect(created).toEqual([`inventory-1-${DATE}`, `inventory-2-${DATE}`, `inventory-7-${DATE}`]);
		expect(await source(1)).toMatchObject({
			status: 'error',
			last_error: SYNC_ALREADY_RAN
		});
		// Only the tick that started syncs is a job run.
		expect((await jobRuns()).map((r) => r.run_id)).toEqual([`inventory-${NOW}`]);
	});

	it('starts at most 20 syncs per tick', async () => {
		await seedUser('u1', NOW);
		for (let id = 1; id <= 25; id++) await seedSource(id, 'u1');
		const { testEnv, created } = fakeWorkflow();

		expect(await startInventoryPass(testEnv, AT, NOW)).toBe(
			'started 20 of 20 due sources (0 skipped, 0 busy)'
		);
		expect(await startInventoryPass(testEnv, AT + 10 * MINUTE, NOW + 10 * MINUTE)).toBe(
			'started 5 of 5 due sources (0 skipped, 0 busy)'
		);
		expect(new Set(created).size).toBe(25);
	});

	it('marks a sync running for more than 15 minutes as error on any tick; a due source starts again', async () => {
		await seedUser('u1', NOW);
		const startedAt = NOON - 30 * MINUTE;
		await seedSource(1, 'u1', {
			status: 'running',
			runId: 'inventory-1-manual-1',
			syncStartedAt: startedAt,
			lastAttemptAt: startedAt
		});
		const { testEnv, created } = fakeWorkflow();

		expect(await startInventoryPass(testEnv, NOON - 10 * MINUTE, NOON - 10 * MINUTE)).toBe(
			'skipped (daily from 12:00 UTC); stale syncs marked error: 1'
		);
		expect(await source(1)).toMatchObject({ status: 'error', last_error: 'sync did not finish' });

		expect(await startInventoryPass(testEnv, AT, NOW)).toBe('started 1 of 1 due sources (0 skipped, 0 busy)');
		expect(created).toEqual([`inventory-1-${DATE}`]);
		expect(await source(1)).toMatchObject({ status: 'running', run_id: `inventory-1-${DATE}` });
	});

	it('skips a due source whose ESI data has not expired yet, counting it as skipped', async () => {
		await seedUser('u1', NOW);
		await seedSource(1, 'u1', { lastAttemptAt: NOON - DAY, dataExpiresAt: NOW + 5 * MINUTE });
		await seedSource(2, 'u1', { lastAttemptAt: NOON - DAY, dataExpiresAt: NOW });
		const { testEnv, created } = fakeWorkflow();

		expect(await startInventoryPass(testEnv, AT, NOW)).toBe('started 1 of 2 due sources (1 skipped, 0 busy)');

		expect(created).toEqual([`inventory-2-${DATE}`]);
		expect(await source(1)).toMatchObject({ status: 'ok', run_id: null, last_attempt_at: NOON - DAY });
		expect(await jobRuns()).toMatchObject([{ detail: { started: 1, skipped: 1, busy: 0 } }]);
	});

	it('a manual pass ignores the 12:00 UTC gate and today’s attempts, still skipping running, denied and inactive', async () => {
		await seedMixedSources();
		const { testEnv, created } = fakeWorkflow();
		const morning = Date.UTC(2026, 9, 12, 8, 0);

		expect(await startInventoryPass(testEnv, morning, NOW, true)).toBe(
			'started 4 of 4 due sources (0 skipped, 0 busy)'
		);

		expect(created).toEqual([1, 2, 7, 3].map((id) => `inventory-${id}-manual-${NOW}`));
		expect(await jobRuns()).toEqual([
			{
				run_id: `inventory-manual-${NOW}`,
				status: 'ok',
				detail_json: expect.any(String),
				detail: { started: 4, skipped: 0, busy: 0 }
			}
		]);
	});

	it('a manual pass is recorded even when nothing is due', async () => {
		const { testEnv } = fakeWorkflow();
		expect(await startInventoryPass(testEnv, NOW, NOW, true)).toBe('no sources due');
		expect(await jobRuns()).toMatchObject([
			{ run_id: `inventory-manual-${NOW}`, status: 'ok', detail: { started: 0, skipped: 0, busy: 0 } }
		]);
	});
});

describe('inventory sync claim', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('triggerInventorySync starts inventory-<id>-manual-<ms> and answers busy while it runs', async () => {
		await seedUser('u1', Date.now());
		await seedSource(1, 'u1');
		await using introspector = await mockedInventoryWorkflow();
		const before = Date.now();

		const first = await exports.UpdaterRpc.triggerInventorySync(1);
		const second = await exports.UpdaterRpc.triggerInventorySync(1);

		expect(first).toEqual({ instanceId: expect.stringMatching(/^inventory-1-manual-\d+$/) });
		expect(second).toEqual({ busy: true });
		expect(await completedInstanceCount(introspector)).toBe(1);
		const row = await source(1);
		expect(row).toMatchObject({ status: 'running', run_id: 'instanceId' in first ? first.instanceId : null });
		expect(row!.sync_started_at).toBeGreaterThanOrEqual(before);
		expect(row!.last_attempt_at).toBe(row!.sync_started_at);
	});

	it('marks a sync running for more than 15 minutes as error and starts a new one', async () => {
		await seedUser('u1', Date.now());
		await seedSource(1, 'u1', {
			status: 'running',
			runId: 'inventory-1-manual-1',
			syncStartedAt: Date.now() - 16 * MINUTE
		});
		await seedSource(2, 'u1', {
			status: 'running',
			runId: 'inventory-2-manual-1',
			syncStartedAt: Date.now() - 14 * MINUTE
		});
		await using introspector = await mockedInventoryWorkflow();

		const stale = await exports.UpdaterRpc.triggerInventorySync(1);
		const fresh = await exports.UpdaterRpc.triggerInventorySync(2);

		expect(stale).toEqual({ instanceId: expect.stringMatching(/^inventory-1-manual-\d+$/) });
		expect(fresh).toEqual({ busy: true });
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect(await source(1)).toMatchObject({
			status: 'running',
			run_id: 'instanceId' in stale ? stale.instanceId : null,
			last_error: 'sync did not finish'
		});
		expect(await source(2)).toMatchObject({ status: 'running', run_id: 'inventory-2-manual-1' });
	});

	it('releases the claim as error when the instance cannot be created', async () => {
		await seedUser('u1', NOW);
		await seedSource(1, 'u1');
		const { testEnv } = fakeWorkflow('workflows unavailable');

		await expect(startInventorySync(testEnv, 1, 'inventory-1-manual-5', 'manual', NOW)).rejects.toThrow(
			'workflows unavailable'
		);
		expect(await source(1)).toMatchObject({
			status: 'error',
			run_id: 'inventory-1-manual-5',
			last_error: ERROR_INTERNAL
		});
	});

	it('triggerInventorySync answers notBefore without starting a sync while the ESI data has not expired', async () => {
		await seedUser('u1', Date.now());
		const expiresAt = Date.now() + 10 * MINUTE;
		await seedSource(1, 'u1', { lastAttemptAt: NOON, dataExpiresAt: expiresAt });
		await seedSource(2, 'u1', { lastAttemptAt: NOON, dataExpiresAt: Date.now() - MINUTE });
		await using introspector = await mockedInventoryWorkflow();

		const early = await exports.UpdaterRpc.triggerInventorySync(1);
		const expired = await exports.UpdaterRpc.triggerInventorySync(2);

		expect(early).toEqual({ notBefore: expiresAt });
		expect(expired).toEqual({ instanceId: expect.stringMatching(/^inventory-2-manual-\d+$/) });
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect(await source(1)).toMatchObject({ status: 'ok', run_id: null, last_attempt_at: NOON });
	});

	it('triggerInventorySync rejects an unknown source', async () => {
		// Called in-isolate: a rejected cross-isolate RPC call is also logged by workerd as uncaught.
		const rpc = new UpdaterRpc(createExecutionContext(), env);
		await expect(rpc.triggerInventorySync(404)).rejects.toThrow(RangeError);
	});

	it('triggerInventoryPass runs the pass now and records the run', async () => {
		await seedUser('u1', Date.now());
		await seedSource(1, 'u1', { lastAttemptAt: Date.now() - MINUTE });
		await using introspector = await mockedInventoryWorkflow();

		const result = await exports.UpdaterRpc.triggerInventoryPass();

		expect(result).toEqual({
			runId: expect.stringMatching(/^inventory-manual-\d+$/),
			status: 'ok',
			summary: 'started 1 of 1 due sources (0 skipped, 0 busy)'
		});
		expect(await completedInstanceCount(introspector)).toBe(1);
		expect(await jobRuns()).toMatchObject([
			{ run_id: result.runId, status: 'ok', detail: { started: 1, skipped: 0, busy: 0 } }
		]);
		expect((await source(1))?.run_id).toMatch(/^inventory-1-manual-\d+$/);
	});
});
