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

/** ESI double: characters 1 and 2 are in alliance 99000001, 3 in no alliance. */
function esi(options: { refuse?: (path: string, ids: number[]) => boolean } = {}) {
	return installFetch((url, call) => {
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

	it('runs once a day, on the tick in 12:20 to 12:29 UTC', async () => {
		await seedCharacters([1]);
		const calls = esi();
		for (const at of [
			Date.UTC(2026, 9, 9, 12, 10),
			Date.UTC(2026, 9, 9, 12, 30),
			Date.UTC(2026, 9, 9, 13, 20)
		])
			expect(await refreshAffiliations(env, at, NOW)).toBe('skipped (daily at 12:20 UTC)');
		expect(calls).toEqual([]);
		expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM job_runs').first()).toEqual({ n: 0 });
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
