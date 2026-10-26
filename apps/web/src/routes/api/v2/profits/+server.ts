import { apiCsv } from '#lib/server/api/csv.js';
import { CACHE_SHORT, apiHandler, apiJson, parseQuery } from '#lib/server/api/http.js';
import { profitResults, profitRow, sortRows } from '#lib/server/api/profits.js';
import { ALLOCATION_COLUMNS, PROFIT_COLUMNS, ProfitsQuery } from '#lib/server/api/schemas.js';
import { checkLines, loadApiCalc, settingsFromQuery } from '#lib/server/api/settings.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const q = parseQuery(ProfitsQuery.schema, event.url);
	checkLines(q, q.view !== 'single');
	const env = event.locals.env;
	const settings = await settingsFromQuery(env, q);
	const { ctx } = await loadApiCalc(env, settings, { date: q.date });
	const optimal = settings.slotAllocation === 'optimal';
	const rows = sortRows(
		profitResults(ctx, { reactor: q.reactor, tier: q.tier }, q.view, { lines: q.lines }).map((r) =>
			profitRow(r, optimal)
		)
	);
	if (q.format === 'csv') {
		const columns = optimal ? [...PROFIT_COLUMNS, ...ALLOCATION_COLUMNS] : PROFIT_COLUMNS;
		return apiCsv(columns, rows, CACHE_SHORT);
	}
	return apiJson(
		{ asOf: ctx.outputPrices.asOf, approximate: ctx.outputPrices.approximate, settings, rows },
		CACHE_SHORT
	);
});
