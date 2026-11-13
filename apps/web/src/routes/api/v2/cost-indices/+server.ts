import { costIndices, getCoreDb, systems } from '@reactions/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { apiCsv } from '#lib/server/api/csv.js';
import { CACHE_SHORT, apiHandler, apiJson, parseQuery } from '#lib/server/api/http.js';
import { COST_INDEX_COLUMNS, CostIndicesQuery } from '#lib/server/api/schemas.js';
import { getMarket } from '#lib/server/data.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(async (event) => {
	const q = parseQuery(CostIndicesQuery.schema, event.url);
	const env = event.locals.env;
	const [rows, market] = await Promise.all([
		getCoreDb(env.DB)
			.select({
				systemId: costIndices.systemId,
				name: systems.name,
				reaction: costIndices.reaction,
				updatedAt: costIndices.updatedAt
			})
			.from(costIndices)
			.leftJoin(systems, eq(systems.systemId, costIndices.systemId))
			.where(inArray(costIndices.systemId, q.systems))
			.orderBy(asc(costIndices.systemId)),
		getMarket(env)
	]);
	// An unchanged index keeps its row (and `updated_at`) on a refresh: the latest refresh time of the
	// table (published with the market snapshot, like `/api/v2/meta`) is when every index was last
	// confirmed. Before the first snapshot, each row's own time.
	const refreshedAt = market?.costIndicesUpdatedAt ?? 0;
	const indices = rows.map((r) => ({
		...r,
		updatedAt: new Date(Math.max(r.updatedAt, refreshedAt)).toISOString()
	}));
	if (q.format === 'csv') return apiCsv(COST_INDEX_COLUMNS, indices, CACHE_SHORT);
	return apiJson(indices, CACHE_SHORT);
});
