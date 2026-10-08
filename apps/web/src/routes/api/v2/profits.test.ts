import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorResponse, ProfitsResponse, ReactionResultResponse } from '$lib/server/api/schemas';
import { clearDataMemo } from '$lib/server/data';
import { apiEvent, callApi, invalidParams, seededEnv } from '../../../test/api';
import { NOW, insertStructureHub } from '../../../test/fixtures';
import { GET as detail } from './profits/[slug]/+server';
import { GET as profits } from './profits/+server';

const HEADER =
	'slug,name,reactor,tier,view,runs,inputCost,outputValue,jobCost,fees,shipping,profit,marginPct,profitPerSlotDay';

beforeEach(() => {
	clearDataMemo();
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

const list = async (query: string) => {
	const { env } = await seededEnv();
	return callApi(profits, apiEvent(env, `/api/v2/profits?${query}`));
};

const one = async (slug: string, query = '') => {
	const { env } = await seededEnv();
	return callApi(detail, apiEvent(env, `/api/v2/profits/${slug}?${query}`, { params: { slug } }));
};

describe('GET /api/v2/profits', () => {
	it('returns one best-variant row per reaction, highest profit per slot-day first', async () => {
		const { response, body } = await list('reactor=composite');
		const parsed = ProfitsResponse.parse(body);
		expect(parsed.rows).toHaveLength(66);
		expect(parsed.approximate).toBe(false);
		expect(parsed.asOf).toBe(new Date(NOW).toISOString());
		const values = parsed.rows.map((r) => r.profitPerSlotDay);
		const numbers = values.filter((v): v is number => v !== null);
		expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
		expect(values.slice(numbers.length).every((v) => v === null)).toBe(true);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
		for (const r of parsed.rows) {
			if (r.profit === null) continue;
			expect(r.profit).toBeCloseTo(r.outputValue - r.inputCost - r.jobCost - r.fees - r.shipping, 4);
		}
	});

	it('honours view, tier and settings parameters', async () => {
		const single = ProfitsResponse.parse((await list('tier=composite&view=single')).body);
		expect(single.rows.every((r) => r.view === 'single' && r.tier === 'composite')).toBe(true);
		const chain = ProfitsResponse.parse((await list('tier=composite&view=chain')).body);
		expect(chain.rows.every((r) => r.view === 'chain')).toBe(true);
		const unrefined = ProfitsResponse.parse((await list('tier=composite&view=unrefined')).body);
		// Chains without an unrefined route show their full chain.
		expect(unrefined.rows.every((r) => r.view === 'unrefined' || r.view === 'chain')).toBe(true);
		expect(unrefined.rows.find((r) => r.slug === 'fermionic-condensates')!.view).toBe('unrefined');
		const athanor = ProfitsResponse.parse((await list('tier=composite&view=single&structure=athanor')).body);
		const runs = (rows: typeof single.rows) => rows.find((r) => r.slug === 'titanium-carbide')!.runs;
		expect(runs(athanor.rows)).toBeLessThan(runs(single.rows));
		expect(athanor.settings).toMatchObject({ mode: 'shared', shared: { structure: 'athanor' } });
	});

	it('serves CSV with the exact header and RFC 4180 quoting', async () => {
		const { env, sde } = await seededEnv();
		const dataset = structuredClone(sde.dataset);
		dataset.reactions.find((r) => r.slug === 'caesarium-cadmide')!.name = 'Caesarium, "Cadmide"\nPlus';
		await env.CACHE.put('dataset:v1', JSON.stringify(dataset));
		const { response, text } = await callApi(
			profits,
			apiEvent(env, '/api/v2/profits?reactor=composite&tier=intermediate&view=single&format=csv')
		);
		expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
		expect(text.startsWith(`${HEADER}\r\n`)).toBe(true);
		expect(text).toContain('caesarium-cadmide,"Caesarium, ""Cadmide""\nPlus",composite,intermediate,single,');
		const row = text.split('\r\n').find((l) => l.startsWith('titanium-chromide,'))!;
		expect(row.split(',')).toHaveLength(14);
		expect(row).not.toMatch(/null|undefined|e\+/);
	});

	it('adds slotsUsed and lines with slots=optimal', async () => {
		const json = ProfitsResponse.parse((await list('tier=composite&view=chain&slots=optimal')).body);
		const tic = json.rows.find((r) => r.slug === 'titanium-carbide')!;
		expect(tic.lines).toBeGreaterThanOrEqual(1);
		expect(tic.slotsUsed).toBeGreaterThan(tic.lines!);
		const fixed = ProfitsResponse.parse((await list('tier=composite&view=chain&slots=optimal&lines=3')).body);
		expect(fixed.rows.find((r) => r.slug === 'titanium-carbide')!.lines).toBe(3);
		const { text } = await list('tier=composite&view=chain&slots=optimal&format=csv');
		expect(text.split('\r\n')[0]).toBe(`${HEADER},slotsUsed,lines`);
		const plain = ProfitsResponse.parse((await list('tier=composite&view=chain')).body);
		expect(plain.rows[0]).not.toHaveProperty('slotsUsed');
	});

	it('applies shipping discounts to the shipping column', async () => {
		const base = 'reactor=composite&tier=intermediate&view=single&shipInIskPerM3=1000';
		const full = ProfitsResponse.parse((await list(base)).body).rows;
		const discounted = ProfitsResponse.parse((await list(`${base}&shipInDiscount=25`)).body).rows;
		const off = ProfitsResponse.parse(
			(await list('reactor=composite&tier=intermediate&view=single')).body
		).rows;
		const shipping = (rows: typeof full) => rows.find((r) => r.slug === 'caesarium-cadmide')!.shipping;
		expect(shipping(off)).toBe(0);
		expect(shipping(full)).toBeGreaterThan(0);
		expect(shipping(discounted)).toBeCloseTo(shipping(full) * 0.75, 6);
		const out = ProfitsResponse.parse((await list(`${base}&shipOutCollateral=1&shipOutDiscount=100`)).body);
		expect(shipping(out.rows)).toBeCloseTo(shipping(full), 6);
	});

	it('resolves the system by id or exact name', async () => {
		const byName = ProfitsResponse.parse((await list('reactor=hybrid&system=671-st')).body);
		const byId = ProfitsResponse.parse((await list('reactor=hybrid&system=30004604')).body);
		expect(byName.settings).toMatchObject({ shared: { systemId: 30004604 } });
		expect(byId.rows).toEqual(byName.rows);
	});

	it('prices a past day with date= and flags approximate prices', async () => {
		const { env } = await seededEnv();
		env.HISTORY_DB.sqlite.exec(`
			INSERT INTO esi_market_history (region_id, type_id, date, average, highest, lowest, volume, order_count)
			VALUES (10000002, 16663, '2026-10-01', 500, 500, 500, 1, 1);
		`);
		const { body } = await callApi(profits, apiEvent(env, '/api/v2/profits?reactor=hybrid&date=2026-10-01'));
		expect(ProfitsResponse.parse(body)).toMatchObject({ asOf: '2026-10-01', approximate: true });
	});

	it.each([
		['reactor=x', ['reactor']],
		['view=cheapest', ['view']],
		['broker=20&skill=2.5&cycleDays=0', ['skill', 'broker', 'cycleDays']],
		['structure=raitaru&meRig=t3', ['structure', 'meRig']],
		['shipInDiscount=101&inputPricePct=abc', ['inputPricePct', 'shipInDiscount']],
		['slots=many&lines=11', ['slots', 'lines']],
		['lines=2', ['lines']],
		['slots=optimal&lines=2&view=single', ['lines']],
		['system=Jita', ['system']],
		['system=Nowhere', ['system']],
		['date=yesterday', ['date']]
	])('%s → 400 INVALID_PARAM with details', async (query, params) => {
		const { response, body } = await list(query);
		expect(response.status).toBe(400);
		expect(ErrorResponse.parse(body).error.code).toBe('INVALID_PARAM');
		expect(invalidParams(body).sort()).toEqual([...params].sort());
	});

	it('404s for private and unknown hubs', async () => {
		const { env } = await seededEnv();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		for (const query of [
			'inputHub=structure-1044752365771',
			'inputFallbackHub=structure-1044752365771',
			'outputHub=nowhere'
		]) {
			const { response, body } = await callApi(profits, apiEvent(env, `/api/v2/profits?${query}`));
			expect(response.status).toBe(404);
			expect(ErrorResponse.parse(body).error.code).toBe('NOT_FOUND');
		}
	});
});

describe('GET /api/v2/profits/{slug}', () => {
	it('returns the full ReactionResult', async () => {
		const { response, body } = await one('caesarium-cadmide');
		const result = ReactionResultResponse.parse(body);
		expect(result).toMatchObject({ slug: 'caesarium-cadmide', view: 'single', outputMode: 'product' });
		expect(result.allocation).toBeUndefined();
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
	});

	it('returns the chain tree and, with slots=optimal, the allocation', async () => {
		const chain = ReactionResultResponse.parse((await one('titanium-carbide', 'view=chain')).body);
		expect(chain.chain?.children.length).toBe(2);
		expect(chain.allocation).toBeUndefined();
		const optimal = ReactionResultResponse.parse(
			(await one('titanium-carbide', 'view=chain&slots=optimal')).body
		);
		const a = optimal.allocation!;
		expect(a.slotsUsed).toBe(a.reactions.reduce((n, r) => n + r.slots, 0));
		expect(a.lines).toBe(a.reactions.find((r) => r.depth === 0)!.slots);
		const three = ReactionResultResponse.parse(
			(await one('titanium-carbide', 'view=chain&slots=optimal&lines=3')).body
		);
		expect(three.allocation!.lines).toBe(3);
	});

	it('returns reprocessed outputs for reprocessable reactions', async () => {
		const result = ReactionResultResponse.parse((await one('unrefined-solerium', 'output=reprocessed')).body);
		expect(result.outputMode).toBe('reprocessed');
	});

	it('view=chain is the regular chain and view=unrefined the routes, whatever unrefinedInChains says', async () => {
		for (const extra of ['', '&unrefinedInChains=best']) {
			const unrefined = ReactionResultResponse.parse(
				(await one('fermionic-condensates', `view=unrefined${extra}`)).body
			);
			expect(unrefined.view).toBe('unrefined');
			const regular = ReactionResultResponse.parse(
				(await one('fermionic-condensates', `view=chain${extra}`)).body
			);
			expect([regular.view, regular.viaUnrefined]).toEqual(['chain', []]);
			expect(regular.chain!.children.some((c) => c.reprocess)).toBe(false);
		}
	});

	it.each([
		['caesarium-cadmide', 'view=chain', 'view'],
		['caesarium-cadmide', 'view=unrefined', 'view'],
		['pure-improved-blue-pill-booster', 'view=unrefined', 'view'],
		['caesarium-cadmide', 'output=reprocessed', 'output'],
		['titanium-carbide', 'lines=2&slots=optimal', 'lines'],
		['titanium-carbide', 'view=best', 'view'],
		['titanium-carbide', 'view=chain&unrefinedInChains=always', 'unrefinedInChains']
	])('%s?%s → 400 naming %s', async (slug, query, param) => {
		const { response, body } = await one(slug, query);
		expect(response.status).toBe(400);
		expect(invalidParams(body)).toEqual([param]);
	});

	it('404s for an unknown slug', async () => {
		const { response, body } = await one('no-such-reaction');
		expect(response.status).toBe(404);
		expect(ErrorResponse.parse(body).error.code).toBe('NOT_FOUND');
	});
});
