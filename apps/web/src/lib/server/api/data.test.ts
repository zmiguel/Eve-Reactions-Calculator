import { beforeEach, describe, expect, it } from 'vitest';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { insertStructureHub, loadSde, putKv } from '../../../test/fixtures';
import { clearDataMemo } from '../data';
import {
	hubResponse,
	publicHubs,
	recipeResponse,
	requireDataset,
	requireHub,
	requireMarket,
	requireReaction
} from './data';
import { ApiError } from './http';

beforeEach(() => clearDataMemo());

describe('API reference data', () => {
	it('lists enabled public hubs and maps them to the API shape', async () => {
		const env = fakeEnv();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		const hubs = await publicHubs(asEnv(env));
		expect(hubs.map((h) => h.hubId)).toEqual(['jita', 'amarr', 'perimeter', 'dodixie', 'rens', 'hek']);
		expect(hubResponse(hubs[2])).toEqual({
			id: 'perimeter',
			name: 'Perimeter',
			kind: 'system',
			regionId: 10000002,
			systemId: 30000144
		});
		expect(requireHub(hubs, 'amarr').name).toBe('Amarr');
		expect(() => requireHub(hubs, 'structure-1044752365771')).toThrow(ApiError);
	});

	it('requires published data (503) and known slugs (404)', async () => {
		const env = fakeEnv();
		await expect(requireDataset(asEnv(env))).rejects.toMatchObject({ status: 503, code: 'INTERNAL' });
		await expect(requireMarket(asEnv(env))).rejects.toMatchObject({ status: 503, code: 'INTERNAL' });
		await putKv(env, await loadSde());
		const dataset = await requireDataset(asEnv(env));
		expect((await requireMarket(asEnv(env))).hubs[0].hubId).toBe('jita');
		expect(requireReaction(dataset, 'fullerides').name).toBe('Fullerides');
		expect(() => requireReaction(dataset, 'fullerides-2')).toThrow(
			expect.objectContaining({ status: 404, code: 'NOT_FOUND' })
		);
	});

	it('describes recipes with names, volumes, max runs and available views', async () => {
		const { dataset } = await loadSde();
		const tic = recipeResponse(
			dataset.reactions.find((r) => r.slug === 'titanium-carbide')!,
			dataset
		);
		expect(tic).toMatchObject({
			blueprintTypeId: 46204,
			reactor: 'composite',
			tier: 'composite',
			maxRuns: 1000,
			chainable: true,
			reprocessable: false,
			product: { typeId: 16671, quantity: 10000, name: 'Titanium Carbide' }
		});
		expect(tic.materials.map((m) => m.name)).toContain('Titanium Chromide');
		expect(tic.materials.every((m) => m.volume !== null && m.volume > 0)).toBe(true);
	});
});
