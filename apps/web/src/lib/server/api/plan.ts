import type { CalcContext, Dataset, PlanInput, PlanTarget } from '@reactions/engine';
import type { z } from 'zod';
import { dailyVolumes, hubDailyVolumes, productVolumes, volumeTypes } from '$lib/planner/plan';
import type { HubInfo } from '../hubs.ts';
import { getRegionVolumes } from '../planner.ts';
import { ApiError } from './http.ts';
import type { PlanBody } from './schemas.ts';

type Body = z.output<typeof PlanBody>;

/** Body targets by slug or blueprint id → engine targets (unknown reaction → 404, default 1 line). */
export function resolveTargets(dataset: Dataset, targets: Body['targets']): PlanTarget[] {
	return targets.map((t) => {
		const reaction = dataset.reactions.find((r) =>
			t.slug === undefined ? r.blueprintTypeId === t.blueprintTypeId : r.slug === t.slug
		);
		if (!reaction) throw new ApiError(404, 'NOT_FOUND', `Unknown reaction "${t.slug ?? t.blueprintTypeId}".`);
		return t.quantity === undefined
			? { blueprintTypeId: reaction.blueprintTypeId, lines: t.lines ?? 1 }
			: { blueprintTypeId: reaction.blueprintTypeId, lines: 1, quantity: t.quantity };
	});
}

/**
 * Planner input of a `POST /plan` body: `dailyVolumes` are the 30-day average daily volumes from
 * `market_stats` in the region of each product's output hub and `inputDailyVolumes` those of each input
 * hub's region (as on `/planner`).
 */
export async function buildPlanInput(
	env: Pick<Env, 'DB'>,
	ctx: CalcContext,
	hubs: HubInfo[],
	body: Body
): Promise<PlanInput> {
	const targets = resolveTargets(ctx.dataset, body.targets);
	const regionOf = new Map(hubs.map((h) => [h.hubId, h.regionId]));
	const regionIds = Object.values(ctx.profiles).flatMap((p) =>
		[p.market.outputHub, p.market.inputHub].flatMap((hubId) => regionOf.get(hubId) ?? [])
	);
	const volumes = await getRegionVolumes(env, regionIds, volumeTypes(ctx.dataset));
	const regionHubs = hubs.map((h) => ({ hubId: h.hubId, regionId: h.regionId, regionName: null }));
	return {
		ctx,
		totalSlots: body.totalSlots,
		targets,
		buyInsteadOfBuild: body.buyInsteadOfBuild,
		stock: body.stock,
		ownedFormulas: body.ownedFormulas,
		dailyVolumes: dailyVolumes(
			productVolumes({ dataset: ctx.dataset, profiles: ctx.profiles, volumes, hubs: regionHubs })
		),
		inputDailyVolumes: hubDailyVolumes({ volumes, hubs: regionHubs })
	};
}
