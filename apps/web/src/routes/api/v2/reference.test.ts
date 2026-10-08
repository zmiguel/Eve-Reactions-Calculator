import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openapi } from '$lib/server/api/openapi';
import {
	ErrorResponse,
	HubsResponse,
	MetaResponse,
	OpenApiResponse,
	ReactionResponse,
	ReactionsResponse
} from '$lib/server/api/schemas';
import { clearDataMemo } from '$lib/server/data';
import { apiEvent, callApi, invalidParams, seededEnv, type Handler } from '../../../test/api';
import { fakeEnv } from '../../../test/fakes';
import { NOW, insertStructureHub } from '../../../test/fixtures';
import { GET as costIndices } from './cost-indices/+server';
import { GET as hubs } from './hubs/+server';
import { GET as meta } from './meta/+server';
import { GET as openapiJson } from './openapi.json/+server';
import { OPTIONS as planOptions, POST as plan } from './plan/+server';
import { GET as prices } from './prices/+server';
import { GET as priceHistory } from './prices/history/+server';
import { GET as profitDetail } from './profits/[slug]/+server';
import { GET as profits } from './profits/+server';
import { GET as reactionDetail } from './reactions/[slug]/+server';
import { GET as reactions } from './reactions/+server';
import { GET as systems } from './systems/+server';
import { GET as systemById } from './systems/[id]/+server';

beforeEach(() => {
	clearDataMemo();
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('GET /api/v2/meta', () => {
	it('reports the SDE build, refresh times and public hubs', async () => {
		const { env, sde } = await seededEnv();
		const { response, body } = await callApi(meta, apiEvent(env, '/api/v2/meta'));
		expect(response.status).toBe(200);
		const parsed = MetaResponse.parse(body);
		expect(parsed.sdeBuild).toBe(sde.dataset.sdeBuild);
		expect(parsed.pricesUpdatedAt).toBe(new Date(NOW).toISOString());
		expect(parsed.hubs.map((h) => h.id)).toContain('jita');
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
	});

	it('answers with nulls before the first publish', async () => {
		const { body } = await callApi(meta, apiEvent(fakeEnv(), '/api/v2/meta'));
		expect(MetaResponse.parse(body)).toMatchObject({ sdeBuild: null, pricesUpdatedAt: null });
	});
});

describe('GET /api/v2/hubs', () => {
	it('lists enabled public hubs only (no private or pending structure markets)', async () => {
		const { env } = await seededEnv();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		insertStructureHub(env.DB, {
			structureId: 1000000000001,
			name: 'Pending Market',
			shareStatus: 'pending'
		});
		insertStructureHub(env.DB, {
			structureId: 1042508032148,
			name: 'Shared Market',
			visibility: 'public',
			shareStatus: 'approved'
		});
		env.DB.sqlite.exec("UPDATE market_hubs SET enabled = 0 WHERE hub_id = 'hek'");
		const { response, body } = await callApi(hubs, apiEvent(env, '/api/v2/hubs'));
		const ids = HubsResponse.parse(body).map((h) => h.id);
		expect(ids[0]).toBe('jita');
		expect(ids).toContain('structure-1042508032148');
		expect(ids).not.toContain('structure-1044752365771');
		expect(ids).not.toContain('structure-1000000000001');
		expect(ids).not.toContain('hek');
		expect(body[0]).toEqual({
			id: 'jita',
			name: 'Jita 4-4',
			kind: 'station',
			regionId: 10000002,
			systemId: 30000142
		});
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
	});
});

describe('GET /api/v2/reactions', () => {
	it('lists recipes with material names, volumes and max runs', async () => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(reactions, apiEvent(env, '/api/v2/reactions'));
		const list = ReactionsResponse.parse(body);
		expect(list).toHaveLength(119);
		const cadmide = list.find((r) => r.slug === 'caesarium-cadmide')!;
		expect(cadmide).toMatchObject({ blueprintTypeId: 46166, maxRuns: 1000, chainable: false });
		expect(cadmide.product).toMatchObject({ typeId: 16663, quantity: 200, name: 'Caesarium Cadmide' });
		expect(cadmide.materials.every((m) => typeof m.name === 'string' && typeof m.volume === 'number')).toBe(
			true
		);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
	});

	it('filters by reactor and tier', async () => {
		const { env } = await seededEnv();
		const hybrid = await callApi(reactions, apiEvent(env, '/api/v2/reactions?reactor=hybrid'));
		expect(hybrid.body).toHaveLength(9);
		const composite = await callApi(
			reactions,
			apiEvent(env, '/api/v2/reactions?reactor=composite&tier=composite')
		);
		expect(composite.body.length).toBeGreaterThan(0);
		expect(composite.body.every((r: { tier: string }) => r.tier === 'composite')).toBe(true);
	});

	it('rejects unknown reactors and tiers', async () => {
		const { env } = await seededEnv();
		const { response, body } = await callApi(reactions, apiEvent(env, '/api/v2/reactions?reactor=x&tier=y'));
		expect(response.status).toBe(400);
		expect(ErrorResponse.parse(body).error.code).toBe('INVALID_PARAM');
		expect(invalidParams(body)).toEqual(['reactor', 'tier']);
	});

	it('returns one recipe by slug and 404 for an unknown slug', async () => {
		const { env } = await seededEnv();
		const one = await callApi(
			reactionDetail,
			apiEvent(env, '/api/v2/reactions/titanium-carbide', { params: { slug: 'titanium-carbide' } })
		);
		expect(ReactionResponse.parse(one.body)).toMatchObject({ slug: 'titanium-carbide', chainable: true });
		const missing = await callApi(
			reactionDetail,
			apiEvent(env, '/api/v2/reactions/nope', { params: { slug: 'nope' } })
		);
		expect(missing.response.status).toBe(404);
		expect(ErrorResponse.parse(missing.body).error.code).toBe('NOT_FOUND');
	});
});

describe('GET /api/v2/openapi.json', () => {
	it('serves the OpenAPI 3.1 document', async () => {
		const { response, body } = await callApi(openapiJson, apiEvent(fakeEnv(), '/api/v2/openapi.json'));
		expect(OpenApiResponse.parse(body).openapi).toBe('3.1.0');
		expect(body).toEqual(JSON.parse(JSON.stringify(openapi)));
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
	});

	it('documents every v2 route file and nothing else', () => {
		const files = Object.keys(import.meta.glob('./**/+server.ts'));
		const routes = files.map(
			(f) =>
				'/api/v2/' +
				f
					.replace(/^\.\//, '')
					.replace(/\/\+server\.ts$/, '')
					.replace(/\[(\w+)\]/g, '{$1}')
		);
		expect(routes.length).toBeGreaterThanOrEqual(13);
		expect(new Set(Object.keys(openapi.paths))).toEqual(new Set(routes));
	});
});

describe('API v2 cross-cutting behaviour', () => {
	const cases: [string, Handler, string, Record<string, string>?][] = [
		['meta', meta, '/api/v2/meta'],
		['hubs', hubs, '/api/v2/hubs'],
		['systems', systems, '/api/v2/systems?q=ig'],
		['systems/{id}', systemById, '/api/v2/systems/30002647', { id: '30002647' }],
		['reactions', reactions, '/api/v2/reactions'],
		['reactions/{slug}', reactionDetail, '/api/v2/reactions/fullerides', { slug: 'fullerides' }],
		['prices', prices, '/api/v2/prices?types=34'],
		['prices/history', priceHistory, '/api/v2/prices/history?type=16663'],
		['cost-indices', costIndices, '/api/v2/cost-indices?systems=30002647'],
		['profits', profits, '/api/v2/profits?reactor=hybrid'],
		['profits/{slug}', profitDetail, '/api/v2/profits/fullerides', { slug: 'fullerides' }],
		['openapi.json', openapiJson, '/api/v2/openapi.json']
	];
	const expectedCache: Record<string, string> = {
		meta: 'public, max-age=60',
		hubs: 'public, max-age=3600',
		systems: 'public, max-age=3600',
		'systems/{id}': 'public, max-age=3600',
		reactions: 'public, max-age=3600',
		'reactions/{slug}': 'public, max-age=3600',
		prices: 'public, max-age=60',
		'prices/history': 'public, max-age=60',
		'cost-indices': 'public, max-age=60',
		profits: 'public, max-age=60',
		'profits/{slug}': 'public, max-age=60',
		'openapi.json': 'public, max-age=3600'
	};

	it.each(cases)('%s: 200 with CORS and its Cache-Control', async (name, handler, path, params) => {
		const { env } = await seededEnv();
		const { response } = await callApi(handler, apiEvent(env, path, { params }));
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Cache-Control')).toBe(expectedCache[name]);
	});

	it.each(cases)(
		'%s: 429 RATE_LIMITED with Retry-After when the limiter refuses',
		async (_n, handler, path, params) => {
			const limit = vi.fn().mockResolvedValue({ success: false });
			const { env } = await seededEnv({ API_RATE_LIMITER: { limit } });
			const { response, body } = await callApi(handler, apiEvent(env, path, { params, ip: '198.51.100.9' }));
			expect(response.status).toBe(429);
			expect(response.headers.get('Retry-After')).toBe('60');
			expect(response.headers.get('Cache-Control')).toBe('no-store');
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
			expect(ErrorResponse.parse(body).error.code).toBe('RATE_LIMITED');
			expect(limit).toHaveBeenCalledWith({ key: 'api:198.51.100.9' });
		}
	);

	it('rate-limits POST /plan too', async () => {
		const { env } = await seededEnv({ API_RATE_LIMITER: { limit: async () => ({ success: false }) } });
		const init = {
			method: 'POST',
			body: JSON.stringify({ totalSlots: 1, targets: [{ slug: 'fullerides' }] })
		};
		const { response } = await callApi(plan, apiEvent(env, '/api/v2/plan', { init }));
		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('60');
	});

	it('answers the POST preflight with CORS headers', async () => {
		const response = await planOptions(
			apiEvent(fakeEnv(), '/api/v2/plan', { init: { method: 'OPTIONS' } }) as never
		);
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
		expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
	});

	it('errors carry CORS and no-store', async () => {
		const { env } = await seededEnv();
		const { response } = await callApi(reactions, apiEvent(env, '/api/v2/reactions?reactor=x'));
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('answers 503 INTERNAL before reference data exists', async () => {
		const { response, body } = await callApi(reactions, apiEvent(fakeEnv(), '/api/v2/reactions'));
		expect(response.status).toBe(503);
		expect(ErrorResponse.parse(body).error.code).toBe('INTERNAL');
	});
});
