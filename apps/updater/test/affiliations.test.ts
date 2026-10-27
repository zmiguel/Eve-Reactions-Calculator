import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshAffiliations } from '../src/cron/affiliations.ts';
import { installFetch, json, resetState } from './helpers.ts';

const AT = Date.UTC(2026, 9, 9, 12, 20);
const NOW = AT + 5_000;

const DAY = 86_400_000;

async function seedCharacters(ids: number[], userId = 'u1', lastSeenAt = NOW - DAY) {
	await env.DB.batch([
		env.DB.prepare('INSERT INTO users (user_id, created_at, last_seen_at) VALUES (?, 1, ?)').bind(
			userId,
			lastSeenAt
		),
		...ids.map((id) =>
			env.DB.prepare(
				"INSERT INTO characters (character_id, user_id, name, owner_hash, created_at) VALUES (?, ?, ?, 'h', 1)"
			).bind(id, userId, `Pilot ${id}`)
		)
	]);
}

async function affiliationRows() {
	const { results } = await env.DB.prepare(
		`SELECT character_id, corporation_id, corporation_name, alliance_id, alliance_name, affiliation_updated_at
		FROM characters ORDER BY character_id`
	).all();
	return results;
}

const CORPS: Record<number, number> = { 1: 98000001, 2: 98000001, 3: 98000002 };
const NAMES: Record<number, string> = {
	98000001: 'Reaction Corp',
	98000002: 'Solo Corp',
	99000001: 'Moon Alliance'
};

/** ESI double: characters 1 and 2 are in alliance 99000001, 3 in no alliance. Rybbit answers `rybbit()`. */
function esi(
	options: {
		refuse?: (path: string, ids: number[]) => boolean;
		rybbit?: () => Response | Promise<Response>;
	} = {}
) {
	return installFetch((url, call) => {
		if (url.origin === 'https://ry.zm.gl') return options.rybbit?.() ?? json({ success: true });
		const ids = JSON.parse(call.body!) as number[];
		if (options.refuse?.(url.pathname, ids)) return json({ error: 'Invalid ID' }, {}, 404);
		if (url.pathname === '/characters/affiliation')
			return json(
				ids.map((id) => ({
					character_id: id,
					corporation_id: CORPS[id] ?? 98000002,
					...(CORPS[id] === 98000001 ? { alliance_id: 99000001 } : {})
				}))
			);
		if (url.pathname === '/universe/names')
			return json(
				ids.map((id) => ({ id, name: NAMES[id], category: id >= 99000000 ? 'alliance' : 'corporation' }))
			);
		return json({ error: 'unexpected' }, {}, 500);
	});
}

describe('refreshAffiliations', () => {
	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	it('stores the corporation and alliance of every character from two bulk requests', async () => {
		await seedCharacters([1, 2, 3]);
		const calls = esi();

		const line = await refreshAffiliations(env, AT, NOW);

		expect(calls.map((c) => [new URL(c.url).pathname, JSON.parse(c.body!)])).toEqual([
			['/characters/affiliation', [1, 2, 3]],
			['/universe/names', [98000001, 99000001, 98000002]]
		]);
		expect(line).toBe('3 of 3 characters updated (2 corporations, 1 alliances)');
		expect(await affiliationRows()).toEqual([
			{
				character_id: 1,
				corporation_id: 98000001,
				corporation_name: 'Reaction Corp',
				alliance_id: 99000001,
				alliance_name: 'Moon Alliance',
				affiliation_updated_at: NOW
			},
			{
				character_id: 2,
				corporation_id: 98000001,
				corporation_name: 'Reaction Corp',
				alliance_id: 99000001,
				alliance_name: 'Moon Alliance',
				affiliation_updated_at: NOW
			},
			{
				character_id: 3,
				corporation_id: 98000002,
				corporation_name: 'Solo Corp',
				alliance_id: null,
				alliance_name: null,
				affiliation_updated_at: NOW
			}
		]);
		const job = await env.DB.prepare('SELECT run_id, kind, status, detail_json FROM job_runs').first<{
			run_id: string;
			kind: string;
			status: string;
			detail_json: string;
		}>();
		expect(job).toMatchObject({ run_id: `affiliations-${NOW}`, kind: 'affiliations', status: 'ok' });
		expect(JSON.parse(job!.detail_json)).toEqual({
			characters: 3,
			updated: 3,
			corporations: 2,
			alliances: 1
		});
	});

	it('runs outside the schedule when started manually and records the run as manual', async () => {
		await seedCharacters([3]);
		esi();
		await refreshAffiliations(env, Date.UTC(2026, 9, 9, 8, 0), NOW, true);
		const job = await env.DB.prepare('SELECT run_id, status FROM job_runs').first();
		expect(job).toEqual({ run_id: `affiliations-manual-${NOW}`, status: 'ok' });
	});

	it('clears the alliance of a character that left it', async () => {
		await seedCharacters([3]);
		await env.DB.prepare(
			"UPDATE characters SET corporation_id = 98000002, corporation_name = 'Solo Corp', alliance_id = 99000001, alliance_name = 'Moon Alliance'"
		).run();
		esi();
		await refreshAffiliations(env, AT, NOW);
		expect(await affiliationRows()).toMatchObject([{ alliance_id: null, alliance_name: null }]);
	});

	it('asks for at most 100 ids per request and leaves the characters of a refused chunk unchanged', async () => {
		const ids = Array.from({ length: 150 }, (_, i) => 1000 + i);
		await seedCharacters(ids);
		const calls = esi({ refuse: (path, chunk) => path === '/characters/affiliation' && chunk[0] === 1000 });

		const line = await refreshAffiliations(env, AT, NOW);

		const affiliationCalls = calls.filter((c) => c.url.endsWith('/characters/affiliation'));
		expect(affiliationCalls.map((c) => (JSON.parse(c.body!) as number[]).length)).toEqual([100, 50]);
		expect(line).toBe(
			'50 of 150 characters updated (1 corporations, 0 alliances); refused chunks: 100 ids HTTP 404'
		);
		const updated = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM characters WHERE affiliation_updated_at IS NOT NULL'
		).first<{ n: number }>();
		expect(updated?.n).toBe(50);
		expect(await env.DB.prepare('SELECT status FROM job_runs').first()).toEqual({ status: 'partial' });
	});

	it('keeps a stored name when only the name lookup fails', async () => {
		await seedCharacters([3]);
		await env.DB.prepare(
			"UPDATE characters SET corporation_id = 98000002, corporation_name = 'Solo Corp'"
		).run();
		esi({ refuse: (path) => path === '/universe/names' });
		await refreshAffiliations(env, AT, NOW);
		expect(await affiliationRows()).toMatchObject([
			{ corporation_id: 98000002, corporation_name: 'Solo Corp', affiliation_updated_at: NOW }
		]);
	});

	const day = (h: number, m: number, d = 9) => Date.UTC(2026, 9, d, h, m);
	const insertRun = (runId: string, status: string, startedAt: number) =>
		env.DB.prepare("INSERT INTO job_runs (run_id, kind, started_at, status) VALUES (?, 'affiliations', ?, ?)")
			.bind(runId, startedAt, status)
			.run();

	it('does not run before 12:20 UTC', async () => {
		await seedCharacters([1]);
		const calls = esi();
		expect(await refreshAffiliations(env, day(12, 10), day(12, 10))).toBe('skipped (daily from 12:20 UTC)');
		expect(calls).toEqual([]);
		expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM job_runs').first()).toEqual({ n: 0 });
	});

	it('runs once a day: later ticks of a day that already ran are skipped', async () => {
		await seedCharacters([1]);
		const calls = esi();
		await refreshAffiliations(env, day(12, 20), day(12, 20));
		expect(calls).toHaveLength(2);
		for (const at of [day(12, 30), day(18, 0)])
			expect(await refreshAffiliations(env, at, at)).toBe(`skipped (affiliations-${day(12, 20)} ok)`);
		expect(calls).toHaveLength(2);
	});

	it('catches up on a later tick when the 12:20 tick did not run (long ESI downtime)', async () => {
		await seedCharacters([1]);
		const calls = esi();
		await insertRun('affiliations-yesterday', 'ok', day(12, 20, 8));
		expect(await refreshAffiliations(env, day(13, 40), day(13, 40))).toBe(
			'1 of 1 characters updated (1 corporations, 1 alliances)'
		);
		expect(calls.length).toBeGreaterThan(0);
	});

	it('retries after a failed or abandoned run, but not while a run is in progress', async () => {
		await seedCharacters([1]);
		const calls = esi();
		await insertRun('failed-run', 'failed', day(12, 20));
		await insertRun('crashed-run', 'running', day(12, 30));
		expect(await refreshAffiliations(env, day(12, 50), day(12, 50))).toContain('characters updated');

		await env.DB.prepare('DELETE FROM job_runs').run();
		await insertRun('live-run', 'running', day(13, 0));
		calls.length = 0;
		expect(await refreshAffiliations(env, day(13, 10), day(13, 10))).toBe('skipped (live-run running)');
		expect(calls).toEqual([]);
	});

	it("counts a manual run from 12:20 on as the day's run, but not one from before", async () => {
		await seedCharacters([1]);
		const calls = esi();
		await insertRun('affiliations-manual-early', 'ok', day(9, 0));
		expect(await refreshAffiliations(env, day(12, 20), day(12, 20))).toContain('characters updated');

		await env.DB.prepare('DELETE FROM job_runs').run();
		await insertRun('affiliations-manual-late', 'ok', day(12, 25));
		calls.length = 0;
		expect(await refreshAffiliations(env, day(12, 30), day(12, 30))).toBe(
			'skipped (affiliations-manual-late ok)'
		);
		expect(calls).toEqual([]);
	});

	it('looks up only the characters of accounts seen in the last 30 days', async () => {
		await seedCharacters([1], 'active');
		await seedCharacters([2], 'gone', NOW - 31 * DAY);
		const calls = esi();
		expect(await refreshAffiliations(env, AT, NOW)).toBe(
			'1 of 1 characters updated (1 corporations, 1 alliances)'
		);
		expect(JSON.parse(calls[0]!.body!)).toEqual([1]);
		expect(await affiliationRows()).toMatchObject([
			{ character_id: 1, affiliation_updated_at: NOW },
			{ character_id: 2, affiliation_updated_at: null }
		]);
	});
});

describe('refreshAffiliations Rybbit traits', () => {
	const rybbitEnv = { ...env, RYBBIT_SITE_ID: '1' };

	beforeEach(resetState);
	afterEach(() => vi.unstubAllGlobals());

	async function store(id: number, corporation: [number, string] | null, alliance: [number, string] | null) {
		await env.DB.prepare(
			'UPDATE characters SET corporation_id = ?, corporation_name = ?, alliance_id = ?, alliance_name = ? WHERE character_id = ?'
		)
			.bind(
				corporation?.[0] ?? null,
				corporation?.[1] ?? null,
				alliance?.[0] ?? null,
				alliance?.[1] ?? null,
				id
			)
			.run();
	}

	const identifies = (calls: { url: string; body: string | null }[]) =>
		calls.filter((c) => c.url === 'https://ry.zm.gl/api/identify').map((c) => JSON.parse(c.body!) as unknown);

	async function jobDetail() {
		const job = await env.DB.prepare('SELECT status, detail_json FROM job_runs').first<{
			status: string;
			detail_json: string;
		}>();
		return { status: job!.status, detail: JSON.parse(job!.detail_json) as Record<string, unknown> };
	}

	it('sends the new traits of an account whose main character changed corporation, and only that account', async () => {
		await seedCharacters([3], 'moved');
		await seedCharacters([1], 'stayed');
		await store(3, [98000001, 'Reaction Corp'], [99000001, 'Moon Alliance']);
		await store(1, [98000001, 'Reaction Corp'], [99000001, 'Moon Alliance']);
		const calls = esi();

		const line = await refreshAffiliations(rybbitEnv, AT, NOW);

		expect(identifies(calls)).toEqual([
			{
				site_id: '1',
				user_id: 'moved',
				traits: { corporation: 'Solo Corp', alliance: 'none' },
				is_new_identify: false
			}
		]);
		const request = calls.find((c) => c.url.startsWith('https://ry.zm.gl'))!;
		expect(request.headers.get('Content-Type')).toBe('application/json');
		expect(request.headers.get('User-Agent')).toContain('EVE-Reactions-Calculator/');
		expect(line).toBe('2 of 2 characters updated (2 corporations, 1 alliances); rybbit: 1 sent, 0 failed');
		expect(await jobDetail()).toMatchObject({ status: 'ok', detail: { rybbit: { sent: 1, failed: 0 } } });
	});

	it('sends nothing for an unchanged affiliation or a change of a character that is not the main', async () => {
		await seedCharacters([1, 3]);
		await store(1, [98000001, 'Reaction Corp'], [99000001, 'Moon Alliance']);
		await store(3, [98000001, 'Reaction Corp'], [99000001, 'Moon Alliance']);
		const calls = esi();

		const line = await refreshAffiliations(rybbitEnv, AT, NOW);

		expect(identifies(calls)).toEqual([]);
		expect(line).toBe('2 of 2 characters updated (2 corporations, 1 alliances)');
		expect((await jobDetail()).detail).not.toHaveProperty('rybbit');
		expect(await affiliationRows()).toMatchObject([
			{ character_id: 1 },
			{ character_id: 3, corporation_name: 'Solo Corp' }
		]);
	});

	it('sends the first fill of an account that was unknown', async () => {
		await seedCharacters([1]);
		const calls = esi();
		await refreshAffiliations(rybbitEnv, AT, NOW);
		expect(identifies(calls)).toEqual([
			{
				site_id: '1',
				user_id: 'u1',
				traits: { corporation: 'Reaction Corp', alliance: 'Moon Alliance' },
				is_new_identify: false
			}
		]);
	});

	it('sends nothing when ESI did not resolve the names of an unchanged corporation', async () => {
		await seedCharacters([3]);
		await store(3, [98000002, 'Solo Corp'], null);
		const calls = esi({ refuse: (path) => path === '/universe/names' });
		await refreshAffiliations(rybbitEnv, AT, NOW);
		expect(identifies(calls)).toEqual([]);
	});

	it('an alliance joined but not yet named is "unknown", never "none"', async () => {
		// Stored without an alliance; ESI now reports one, but the name lookup fails.
		await seedCharacters([1]);
		await store(1, [98000001, 'Reaction Corp'], null);
		const calls = esi({ refuse: (path) => path === '/universe/names' });
		await refreshAffiliations(rybbitEnv, AT, NOW);
		expect(await affiliationRows()).toMatchObject([{ alliance_id: 99000001, alliance_name: null }]);
		expect(identifies(calls)).toEqual([
			{
				site_id: '1',
				user_id: 'u1',
				traits: { corporation: 'Reaction Corp', alliance: 'unknown' },
				is_new_identify: false
			}
		]);
	});

	it('sends nothing without RYBBIT_SITE_ID', async () => {
		await seedCharacters([1]);
		const calls = esi();
		await refreshAffiliations(env, AT, NOW);
		await refreshAffiliations({ ...env, RYBBIT_SITE_ID: '' }, AT, NOW + 1);
		expect(identifies(calls)).toEqual([]);
		expect(await affiliationRows()).toMatchObject([{ corporation_name: 'Reaction Corp' }]);
	});

	it('counts a Rybbit failure without failing the job', async () => {
		await seedCharacters([1], 'refused');
		await seedCharacters([3], 'unreachable');
		let call = 0;
		const calls = esi({
			rybbit: () => {
				if (call++ === 0) return json({ error: 'nope' }, {}, 500);
				throw new TypeError('network down');
			}
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const line = await refreshAffiliations(rybbitEnv, AT, NOW);

		expect(identifies(calls)).toHaveLength(2);
		expect(line).toContain('; rybbit: 0 sent, 2 failed');
		expect(await jobDetail()).toMatchObject({ status: 'ok', detail: { rybbit: { sent: 0, failed: 2 } } });
		expect(await affiliationRows()).toMatchObject([
			{ corporation_name: 'Reaction Corp' },
			{ corporation_name: 'Solo Corp' }
		]);
	});

	it('back-fills every covered account on a manual run, but only changes on a scheduled one', async () => {
		await seedCharacters([1, 2], 'a');
		await seedCharacters([3], 'b');
		await seedCharacters([4], 'gone', NOW - 31 * DAY);
		await store(1, [98000001, 'Reaction Corp'], [99000001, 'Moon Alliance']);
		await store(2, [98000001, 'Reaction Corp'], [99000001, 'Moon Alliance']);
		await store(3, [98000002, 'Solo Corp'], null);
		const calls = esi();

		await refreshAffiliations(rybbitEnv, AT, NOW);
		expect(identifies(calls)).toEqual([]);

		const line = await refreshAffiliations(rybbitEnv, AT, NOW + 1, true);
		expect(identifies(calls)).toEqual([
			{
				site_id: '1',
				user_id: 'a',
				traits: { corporation: 'Reaction Corp', alliance: 'Moon Alliance' },
				is_new_identify: false
			},
			{
				site_id: '1',
				user_id: 'b',
				traits: { corporation: 'Solo Corp', alliance: 'none' },
				is_new_identify: false
			}
		]);
		expect(line).toContain('; rybbit: 2 sent, 0 failed');
	});
});
