import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { ErrorResponse, SystemResponse, SystemsResponse } from '$lib/server/api/schemas';
import { fakeEnv, type FakeEnv } from '../../../../test/fakes';
import { insertSystems } from '../../../../test/fixtures';
import { GET as getById } from './[id]/+server';
import { GET as search } from './+server';

function seeded(overrides: Partial<FakeEnv> = {}) {
	const env = fakeEnv(overrides);
	insertSystems(env.DB);
	env.DB.sqlite.exec(`
		INSERT INTO regions VALUES (10000032, 'Sinq Laison'), (10000002, 'The Forge');
		INSERT INTO systems VALUES (30000144, 'Perimeter', 10000002, 0.95, 'highsec');
		INSERT INTO systems VALUES (30001000, 'IGNORE-ME', 10000002, -0.5, 'nullsec');
	`);
	return env;
}

function event(env: FakeEnv, path: string, params: Record<string, string> = {}, ip = '203.0.113.7') {
	const url = new URL(`https://reactions.coalition.space${path}`);
	return {
		url,
		params,
		platform: { env },
		request: new Request(url, { headers: { 'cf-connecting-ip': ip } })
	} as unknown as Parameters<typeof search>[0] & RequestEvent;
}

async function call(handler: typeof search | typeof getById, e: ReturnType<typeof event>) {
	const response = await handler(e as never);
	return { response, body: await response.json() };
}

describe('GET /api/v2/systems', () => {
	it('prefix-matches case-insensitively, sorted by name, with region and cost index', async () => {
		const env = seeded();
		const { response, body } = await call(search, event(env, '/api/v2/systems?q=iGn'));
		expect(response.status).toBe(200);
		expect(SystemsResponse.parse(body)).toEqual([
			{
				id: 30001000,
				name: 'IGNORE-ME',
				regionName: 'The Forge',
				securityBand: 'nullsec',
				securityStatus: -0.5,
				reactionCostIndex: null
			},
			{
				id: 30002647,
				name: 'Ignoitton',
				regionName: 'Sinq Laison',
				securityBand: 'lowsec',
				securityStatus: 0.4388,
				reactionCostIndex: 0.0412
			}
		]);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('matches only prefixes and searches through the lower(name) index', async () => {
		const env = seeded();
		expect((await call(search, event(env, '/api/v2/systems?q=gnoit'))).body).toEqual([]);
		const sql = env.DB.log.findLast((s) => s.includes('"systems"'))!;
		const params = (sql.match(/\?/g) ?? []).map(() => 'ig');
		const plan = env.DB.rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params);
		expect(plan.map((r) => r.detail).join(' ')).toContain('systems_name_lower_idx');
	});

	it('filters highsec by default and includes it with reactionsOnly=false', async () => {
		const env = seeded();
		const names = async (q: string) =>
			SystemsResponse.parse((await call(search, event(env, `/api/v2/systems?${q}`))).body).map((s) => s.name);
		expect(await names('q=ji')).toEqual([]);
		expect(await names('q=pe&reactionsOnly=true')).toEqual([]);
		expect(await names('q=ji&reactionsOnly=false')).toEqual(['Jita']);
		expect(await names('q=PER&reactionsOnly=0')).toEqual(['Perimeter']);
	});

	it('defaults the limit to 10 and caps it at 50', async () => {
		const env = seeded();
		const insert = env.DB.sqlite.prepare("INSERT INTO systems VALUES (?, ?, 10000002, -0.3, 'nullsec')");
		for (let i = 0; i < 60; i++) insert.run(31100000 + i, `ZZ-${String(i).padStart(2, '0')}`);
		const list = async (q: string) =>
			SystemsResponse.parse((await call(search, event(env, `/api/v2/systems?${q}`))).body);
		const count = async (q: string) => (await list(q)).length;
		expect(await count('q=zz')).toBe(10);
		expect(await count('q=zz&limit=25')).toBe(25);
		expect(await count('q=zz&limit=500')).toBe(50);
		expect((await list('q=zz&limit=3'))[0].name).toBe('ZZ-00');
	});

	it.each([
		['/api/v2/systems?q=i', 'q'],
		['/api/v2/systems', 'q'],
		['/api/v2/systems?q=ig&limit=abc', 'limit'],
		['/api/v2/systems?q=ig&limit=0', 'limit'],
		['/api/v2/systems?q=ig&reactionsOnly=maybe', 'reactionsOnly']
	])('%s → 400 INVALID_PARAM naming %s', async (path, param) => {
		const { response, body } = await call(search, event(seeded(), path));
		expect(response.status).toBe(400);
		const { error } = ErrorResponse.parse(body);
		expect(error.code).toBe('INVALID_PARAM');
		expect((error.details as { param: string }[]).map((d) => d.param)).toContain(param);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('answers 429 RATE_LIMITED with Retry-After when the limiter refuses, keyed by client IP', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });
		const env = seeded({ API_RATE_LIMITER: { limit } });
		const { response, body } = await call(search, event(env, '/api/v2/systems?q=ig', {}, '198.51.100.9'));
		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('60');
		expect(ErrorResponse.parse(body).error.code).toBe('RATE_LIMITED');
		expect(limit).toHaveBeenCalledWith({ key: 'api:198.51.100.9' });
	});

	it('serves the request when the limiter allows it', async () => {
		const env = seeded({ API_RATE_LIMITER: { limit: async () => ({ success: true }) } });
		expect((await call(search, event(env, '/api/v2/systems?q=ig'))).response.status).toBe(200);
	});
});

describe('GET /api/v2/systems/{id}', () => {
	it('returns one system (highsec included)', async () => {
		const env = seeded();
		const { response, body } = await call(
			getById,
			event(env, '/api/v2/systems/30000142', { id: '30000142' })
		);
		expect(response.status).toBe(200);
		expect(SystemResponse.parse(body)).toMatchObject({ id: 30000142, name: 'Jita', securityBand: 'highsec' });
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('unknown id → 404 NOT_FOUND, malformed id → 400 INVALID_PARAM', async () => {
		const env = seeded();
		const missing = await call(getById, event(env, '/api/v2/systems/123', { id: '123' }));
		expect(missing.response.status).toBe(404);
		expect(ErrorResponse.parse(missing.body).error.code).toBe('NOT_FOUND');
		const bad = await call(getById, event(env, '/api/v2/systems/abc', { id: 'abc' }));
		expect(bad.response.status).toBe(400);
		expect(ErrorResponse.parse(bad.body).error.code).toBe('INVALID_PARAM');
	});
});
