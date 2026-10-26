import { calculateAllocated, chainable, reprocessable, unrefinable } from '@reactions/engine';
import { requireReaction } from '#lib/server/api/data.js';
import { CACHE_SHORT, apiHandler, apiJson, invalidParam, parseQuery } from '#lib/server/api/http.js';
import { ProfitDetailQuery } from '#lib/server/api/schemas.js';
import { checkLines, loadApiCalc, settingsFromQuery } from '#lib/server/api/settings.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const q = parseQuery(ProfitDetailQuery.schema, event.url);
	checkLines(q, q.view !== 'single');
	const env = event.locals.env;
	const settings = await settingsFromQuery(env, q);
	const { ctx, dataset } = await loadApiCalc(env, settings, { date: q.date });
	const reaction = requireReaction(dataset, event.params.slug);
	if (q.view !== 'single' && !chainable(reaction, dataset))
		throw invalidParam('view', `${reaction.name} has no full chain`);
	if (q.view === 'unrefined' && !unrefinable(reaction, dataset))
		throw invalidParam('view', `${reaction.name} has no unrefined route in its chain`);
	if (q.output === 'reprocessed' && !reprocessable(reaction, dataset))
		throw invalidParam('output', `${reaction.name} cannot be reprocessed`);
	return apiJson(
		calculateAllocated(reaction, ctx, { view: q.view, outputMode: q.output, lines: q.lines }),
		CACHE_SHORT
	);
});
