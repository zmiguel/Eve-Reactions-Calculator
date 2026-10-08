import { introspectWorkflowInstance } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { DATASET_KV_KEY, MARKET_KV_KEY } from '@reactions/db';
import type { Dataset } from '@reactions/engine';
import { DEFAULT_CONSTANTS } from '@reactions/engine';
import type { SdeDataset } from '@reactions/sde';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_PRICES_URL } from '../src/cron/adjusted-prices.ts';
import { FIXTURE_BUILD, fixtureZip, installFetch, resetState } from './helpers.ts';

const zipUrl = (build: number) =>
	`https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-${build}-jsonl.zip`;

/** `_key` and `groupID` of a JSONL line (fixture data written by `scripts/make-sde-fixture.ts`). */
function keyAndGroup(line: string): { key: number; groupId: number | null } {
	const parsed: unknown = JSON.parse(line);
	if (typeof parsed !== 'object' || parsed === null || !('_key' in parsed) || typeof parsed._key !== 'number')
		throw new Error(`unexpected fixture line: ${line.slice(0, 80)}`);
	const groupId = 'groupID' in parsed && typeof parsed.groupID === 'number' ? parsed.groupID : null;
	return { key: parsed._key, groupId };
}

/** `sde-mini.zip` without the blueprints of formula group 1889 (Polymer → hybrid reactor). */
function zipWithoutHybridFormulas(): Uint8Array {
	const files = unzipSync(fixtureZip());
	const lines = (name: string) =>
		strFromU8(files[name]!)
			.split('\n')
			.filter((line) => line.trim() !== '');
	const groupOf = new Map(
		lines('types.jsonl').map((line) => [keyAndGroup(line).key, keyAndGroup(line).groupId])
	);
	const blueprints = lines('blueprints.jsonl').filter((line) => groupOf.get(keyAndGroup(line).key) !== 1889);
	return zipSync({ ...files, 'blueprints.jsonl': strToU8(blueprints.join('\n') + '\n') });
}

function serveZip(bytes: Uint8Array) {
	return installFetch((url) =>
		url.pathname.endsWith('-jsonl.zip') ? new Response(bytes) : new Response('not found', { status: 404 })
	);
}

async function count(table: string): Promise<number> {
	const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
	return row!.n;
}

describe('SdeSyncWorkflow', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('imports the fixture build into D1, R2 and KV', async () => {
		const calls = serveZip(fixtureZip());
		await env.DB.prepare(
			'INSERT INTO http_cache (url, etag, expires_at, updated_at) VALUES (?, \'"x"\', 1, 1)'
		)
			.bind(MARKET_PRICES_URL)
			.run();
		const id = `sde-${FIXTURE_BUILD}`;
		await using instance = await introspectWorkflowInstance(env.SDE_SYNC, id);
		await instance.modify(async (m) => m.disableRetryDelays());

		await env.SDE_SYNC.create({ id, params: { build: FIXTURE_BUILD } });
		await instance.waitForStatus('complete');

		expect(calls.map((c) => c.url)).toEqual([zipUrl(FIXTURE_BUILD)]);
		expect(await instance.getOutput()).toMatchObject({ build: FIXTURE_BUILD, reactions: 119 });
		expect(await count('reactions')).toBe(119);
		const byReactor = await env.DB.prepare(
			'SELECT reactor, COUNT(*) AS n FROM reactions GROUP BY reactor ORDER BY reactor'
		).all();
		expect(byReactor.results).toEqual([
			{ reactor: 'biochemical', n: 44 },
			{ reactor: 'composite', n: 66 },
			{ reactor: 'hybrid', n: 9 }
		]);
		expect(
			await env.DB.prepare(
				'SELECT slug, product_type_id, product_quantity, required_skill_level FROM reactions WHERE blueprint_type_id = 46166'
			).first()
		).toEqual({
			slug: 'caesarium-cadmide',
			product_type_id: 16663,
			product_quantity: 200,
			required_skill_level: 2
		});
		const materials = await env.DB.prepare(
			'SELECT type_id, quantity FROM reaction_materials WHERE blueprint_type_id = 46166 ORDER BY type_id'
		).all();
		expect(materials.results).toEqual([
			{ type_id: 4312, quantity: 5 },
			{ type_id: 16643, quantity: 100 },
			{ type_id: 16647, quantity: 100 }
		]);
		expect(await count('reprocess_materials')).toBeGreaterThan(0);
		expect(await count('types')).toBe(307);
		expect(
			await env.DB.prepare('SELECT name, security_band FROM systems WHERE system_id = 30002647').first()
		).toEqual({ name: 'Ignoitton', security_band: 'lowsec' });
		expect(await count('regions')).toBeGreaterThan(0);

		const dataset = await env.CACHE.get<Dataset>(DATASET_KV_KEY, 'json');
		expect(dataset?.sdeBuild).toBe(FIXTURE_BUILD);
		expect(dataset?.reactions).toHaveLength(119);
		expect(dataset?.constants).toEqual(DEFAULT_CONSTANTS);
		const archived = await env.ARCHIVE.get(`sde/${FIXTURE_BUILD}/dataset.json`);
		expect((await archived!.json<SdeDataset>()).systems.length).toBe(await count('systems'));

		const state = await env.DB.prepare(
			'SELECT build_number, constants_json, warnings_json FROM sde_state WHERE id = 1'
		).first<{ build_number: number; constants_json: string; warnings_json: string }>();
		expect(state?.build_number).toBe(FIXTURE_BUILD);
		expect(JSON.parse(state!.constants_json)).toEqual(DEFAULT_CONSTANTS);
		expect(Array.isArray(JSON.parse(state!.warnings_json))).toBe(true);
		const job = await env.DB.prepare('SELECT kind, status, detail_json FROM job_runs WHERE run_id = ?')
			.bind(id)
			.first<{ kind: string; status: string; detail_json: string }>();
		expect(job?.kind).toBe('sde');
		expect(job?.status).toBe('ok');
		expect(JSON.parse(job!.detail_json)).toMatchObject({ reactions: 119, types: 307 });
		// The tracked set changed: adjusted prices are fetched in full on the next tick.
		expect(await count('http_cache')).toBe(0);
		expect(await env.CACHE.get(MARKET_KV_KEY)).toBeNull();
	});

	it('fails without retrying and leaves existing data untouched when validation fails', async () => {
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO reactions VALUES (1, 'sentinel', 'Sentinel Formula', 'Sentinel', 2, 1, 'composite', 'composite', 1, 1, 1)`
			),
			env.DB.prepare(`INSERT INTO sde_state VALUES (1, 100, '2026-01-01', 5, '{}', '[]')`)
		]);
		await env.CACHE.put(DATASET_KV_KEY, '{"sentinel":true}');
		const calls = serveZip(zipWithoutHybridFormulas());
		const id = `sde-${FIXTURE_BUILD}-invalid`;
		await using instance = await introspectWorkflowInstance(env.SDE_SYNC, id);
		await instance.modify(async (m) => m.disableRetryDelays());

		await env.SDE_SYNC.create({ id, params: { build: FIXTURE_BUILD } });
		await instance.waitForStatus('errored');

		// A NonRetryableError fails the instance at once: the step (limit 3 retries) ran exactly once.
		const error = await instance.getError();
		expect(error.message).toContain('NonRetryableError');
		expect(calls).toHaveLength(1);
		expect(await env.DB.prepare('SELECT blueprint_type_id FROM reactions').all()).toMatchObject({
			results: [{ blueprint_type_id: 1 }]
		});
		expect(await env.DB.prepare('SELECT build_number FROM sde_state').first()).toEqual({ build_number: 100 });
		expect(await env.CACHE.get(DATASET_KV_KEY)).toBe('{"sentinel":true}');
		expect(await count('types')).toBe(0);
		expect(await env.ARCHIVE.get(`sde/${FIXTURE_BUILD}/dataset.json`)).toBeNull();
		const job = await env.DB.prepare('SELECT status, detail_json FROM job_runs WHERE run_id = ?')
			.bind(id)
			.first<{ status: string; detail_json: string }>();
		expect(job?.status).toBe('failed');
		expect(JSON.parse(job!.detail_json).error).toContain('no hybrid reactions');
	});
});
