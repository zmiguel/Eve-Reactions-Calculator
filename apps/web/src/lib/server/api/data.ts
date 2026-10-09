import type { MarketSnapshot } from '@reactions/db';
import { chainable, fuelFirst, reprocessable, type Dataset, type Reaction } from '@reactions/engine';
import { getDataset, getMarket } from '../data.ts';
import { getAccessibleHubs, type HubInfo } from '../hubs.ts';
import { ApiError } from './http.ts';

/** API v2 reference data: public hubs, the published dataset and recipe shapes. */

/** Enabled public hubs, the only hubs API v2 knows. */
export const publicHubs = (env: Pick<Env, 'DB'>) => getAccessibleHubs(env, null);

/** A hub as API v2 publishes it (`/hubs`, `/meta`). */
export const hubResponse = (h: HubInfo) => ({
	id: h.hubId,
	name: h.name,
	kind: h.kind,
	regionId: h.regionId,
	systemId: h.systemId
});

/** The hub with this id, or 404 `NOT_FOUND` (private, disabled and unknown hubs look the same). */
export function requireHub(hubs: HubInfo[], hubId: string): HubInfo {
	const hub = hubs.find((h) => h.hubId === hubId);
	if (!hub) throw new ApiError(404, 'NOT_FOUND', `Unknown hub "${hubId}".`);
	return hub;
}

/** The SDE dataset, or 503 `INTERNAL` before the first SDE import. */
export async function requireDataset(env: Pick<Env, 'CACHE'>): Promise<Dataset> {
	const dataset = await getDataset(env);
	if (!dataset) throw new ApiError(503, 'INTERNAL', 'Reference data is not available yet.');
	return dataset;
}

/** The latest market snapshot, or 503 `INTERNAL` before the first price refresh. */
export async function requireMarket(env: Pick<Env, 'CACHE'>): Promise<MarketSnapshot> {
	const market = await getMarket(env);
	if (!market) throw new ApiError(503, 'INTERNAL', 'Market data is not available yet.');
	return market;
}

/** The published reaction with this slug, or 404 `NOT_FOUND`. */
export function requireReaction(dataset: Dataset, slug: string): Reaction {
	const reaction = dataset.reactions.find((r) => r.slug === slug);
	if (!reaction) throw new ApiError(404, 'NOT_FOUND', `Unknown reaction "${slug}".`);
	return reaction;
}

/** A recipe with material names and volumes (`/reactions`). */
export function recipeResponse(reaction: Reaction, dataset: Dataset) {
	const material = (m: { typeId: number; quantity: number }) => ({
		typeId: m.typeId,
		name: dataset.types[m.typeId]?.name ?? null,
		quantity: m.quantity,
		volume: dataset.types[m.typeId]?.volume ?? null
	});
	return {
		blueprintTypeId: reaction.blueprintTypeId,
		slug: reaction.slug,
		name: reaction.name,
		formulaName: reaction.formulaName,
		reactor: reaction.reactor,
		tier: reaction.tier,
		baseTimeSeconds: reaction.baseTimeSeconds,
		maxRuns: reaction.maxRuns,
		requiredSkillLevel: reaction.requiredSkillLevel,
		chainable: chainable(reaction, dataset),
		reprocessable: reprocessable(reaction, dataset),
		product: material(reaction.product),
		materials: fuelFirst(reaction.materials, dataset).map(material)
	};
}
