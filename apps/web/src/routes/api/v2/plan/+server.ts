import { planReactions } from '@reactions/engine';
import { publicHubs } from '#lib/server/api/data.js';
import { NO_STORE, apiHandler, apiJson, parseParams, preflight, readJsonBody } from '#lib/server/api/http.js';
import { buildPlanInput } from '#lib/server/api/plan.js';
import { MAX_PLAN_BODY_BYTES, PlanBody } from '#lib/server/api/schemas.js';
import { checkSettingsReferences, loadApiCalc, settingsFromBody } from '#lib/server/api/settings.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = apiHandler(async (event) => {
	const body = parseParams(PlanBody, await readJsonBody(event.request, MAX_PLAN_BODY_BYTES));
	const env = event.locals.env;
	const settings = await settingsFromBody(body.settings);
	const hubs = await publicHubs(env);
	await checkSettingsReferences(env, settings, hubs);
	const { ctx } = await loadApiCalc(env, settings, { hubs });
	// The N-cycle shopping list is a planner page feature, not part of the API's plan.
	const { horizon: _horizon, ...plan } = planReactions(await buildPlanInput(env, ctx, hubs, body));
	return apiJson(plan, NO_STORE);
});

export const OPTIONS: RequestHandler = () => preflight(['POST']);
