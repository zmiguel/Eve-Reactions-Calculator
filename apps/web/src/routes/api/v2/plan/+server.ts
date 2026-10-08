import { planReactions } from '@reactions/engine';
import { publicHubs } from '$lib/server/api/data';
import {
	NO_STORE,
	apiHandler,
	apiJson,
	parseParams,
	preflight,
	readJsonBody,
	requireEnv
} from '$lib/server/api/http';
import { buildPlanInput } from '$lib/server/api/plan';
import { MAX_PLAN_BODY_BYTES, PlanBody } from '$lib/server/api/schemas';
import { checkSettingsReferences, loadApiCalc, settingsFromBody } from '$lib/server/api/settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = apiHandler(async (event) => {
	const body = parseParams(PlanBody, await readJsonBody(event.request, MAX_PLAN_BODY_BYTES));
	const env = requireEnv(event);
	const settings = await settingsFromBody(body.settings);
	const hubs = await publicHubs(env);
	await checkSettingsReferences(env, settings, hubs);
	const { ctx } = await loadApiCalc(env, settings, { hubs });
	return apiJson(planReactions(await buildPlanInput(env, ctx, hubs, body)), NO_STORE);
});

export const OPTIONS: RequestHandler = () => preflight(['POST']);
