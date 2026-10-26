import { costIndices, getCoreDb, systems } from '@reactions/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { apiCsv } from '#lib/server/api/csv.js';
import { CACHE_SHORT, apiHandler, apiJson, parseQuery } from '#lib/server/api/http.js';
import { COST_INDEX_COLUMNS, CostIndicesQuery } from '#lib/server/api/schemas.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const q = parseQuery(CostIndicesQuery.schema, event.url);
	const rows = await getCoreDb(event.locals.env.DB)
		.select({
			systemId: costIndices.systemId,
			name: systems.name,
			reaction: costIndices.reaction,
			updatedAt: costIndices.updatedAt
		})
		.from(costIndices)
		.leftJoin(systems, eq(systems.systemId, costIndices.systemId))
		.where(inArray(costIndices.systemId, q.systems))
		.orderBy(asc(costIndices.systemId));
	const indices = rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() }));
	if (q.format === 'csv') return apiCsv(COST_INDEX_COLUMNS, indices, CACHE_SHORT);
	return apiJson(indices, CACHE_SHORT);
});
