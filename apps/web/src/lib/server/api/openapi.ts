import { z } from 'zod';
import { SITE_URL } from '$lib/site';
import * as EX from './openapi-examples.ts';
import type { OpenApiParameter } from './params.ts';
import {
	CostIndicesQuery,
	MAX_PLAN_BODY_BYTES,
	MAX_PLAN_SLOTS,
	MAX_PLAN_TARGETS,
	PlanBody,
	PriceHistoryQuery,
	PricesQuery,
	ProfitDetailQuery,
	ProfitsQuery,
	ReactionsQuery,
	responseRegistry
} from './schemas.ts';

/**
 * Handwritten OpenAPI 3.1 description of API v2 (`GET /api/v2/openapi.json`, rendered by Scalar on
 * `/api`). Query parameters come from the same definitions that validate requests; component schemas
 * are the zod response schemas the contract tests parse responses with; examples live in
 * `openapi-examples.ts`.
 */

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const list = (id: string) => ({ type: 'array', items: ref(id) });

/** Drops the ±(2^53 − 1) bounds zod adds to every `.int()` (noise in the reference). */
const override = ({ jsonSchema: s }: { jsonSchema: Record<string, unknown> }) => {
	if (s.maximum === Number.MAX_SAFE_INTEGER) delete s.maximum;
	if (s.minimum === Number.MIN_SAFE_INTEGER) delete s.minimum;
};

/** `components.schemas` from the response registry, without per-schema `$schema`/`$id`. */
function componentSchemas(): Record<string, unknown> {
	const { schemas } = z.toJSONSchema(responseRegistry, {
		target: 'draft-2020-12',
		uri: (id) => `#/components/schemas/${id}`,
		unrepresentable: 'any',
		override
	});
	const plan = z.toJSONSchema(PlanBody, {
		target: 'draft-2020-12',
		io: 'input',
		unrepresentable: 'any',
		override
	});
	const clean = ({ $schema: _s, $id: _i, ...rest }: Record<string, unknown>) => rest;
	return {
		...Object.fromEntries(Object.entries(schemas).map(([id, s]) => [id, clean(s)])),
		PlanRequest: clean(plan)
	};
}

type Cache = 'short' | 'long' | 'none';
const CACHE_VALUE: Record<Cache, string> = {
	short: 'public, max-age=60',
	long: 'public, max-age=3600',
	none: 'no-store'
};

/** 200 response with its JSON example and, for `format=csv` endpoints, the `text/csv` variant. */
function ok(
	description: string,
	schema: unknown,
	cache: Cache,
	examples: { json?: unknown; csv?: string } = {}
) {
	return {
		description,
		headers: {
			'Cache-Control': { schema: { type: 'string', const: CACHE_VALUE[cache] } },
			'Access-Control-Allow-Origin': { schema: { type: 'string', const: '*' } }
		},
		content: {
			'application/json': { schema, ...(examples.json === undefined ? {} : { example: examples.json }) },
			...(examples.csv === undefined
				? {}
				: {
						'text/csv': {
							schema: { type: 'string', description: 'RFC 4180, header row first (format=csv).' },
							example: examples.csv
						}
					})
		}
	};
}

/** Parameter object as published: an example that is sent, or one that is only shown. */
type DocParameter = Omit<OpenApiParameter, 'example'> & {
	example?: unknown;
	examples?: Record<string, { value: unknown; 'x-disabled': true }>;
};

/**
 * Parameters with request examples for the reference's code samples and "Test request": required
 * parameters and those in `send` carry the value that is sent; every other optional parameter shows
 * its example (or default / first enum value) as an `x-disabled` example (Scalar extension: listed,
 * not sent), so samples stay as short as a real call instead of spelling out every setting.
 */
function params(list: OpenApiParameter[], send: Record<string, string> = {}): DocParameter[] {
	return list.map(({ example, ...p }) => {
		if (p.required || p.name in send) {
			const value = send[p.name] ?? example;
			return value === undefined ? p : { ...p, example: value };
		}
		const schema = p.schema as { default?: unknown; enum?: unknown[] };
		const shown = example ?? schema.default ?? schema.enum?.[0];
		return shown === undefined ? p : { ...p, examples: { default: { value: shown, 'x-disabled': true } } };
	});
}

const errors = (...statuses: (400 | 404 | 413)[]) => ({
	...Object.fromEntries(
		statuses.map((s) => [
			String(s),
			{ $ref: `#/components/responses/${{ 400: 'InvalidParam', 404: 'NotFound', 413: 'TooLarge' }[s]}` }
		])
	),
	'429': { $ref: '#/components/responses/RateLimited' },
	'500': { $ref: '#/components/responses/Internal' },
	'503': { $ref: '#/components/responses/Unavailable' }
});

const slugParam: OpenApiParameter = {
	name: 'slug',
	in: 'path',
	required: true,
	description: 'Reaction slug (see /api/v2/reactions), e.g. titanium-carbide.',
	schema: { type: 'string' },
	example: 'titanium-carbide'
};

const SYSTEMS_PARAMETERS: OpenApiParameter[] = [
	{
		name: 'q',
		in: 'query',
		required: true,
		description: 'Name prefix, case-insensitive.',
		schema: { type: 'string', minLength: 2 },
		example: 'ign'
	},
	{
		name: 'limit',
		in: 'query',
		required: false,
		description: 'Most results; larger values are capped at 50.',
		schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
	},
	{
		name: 'reactionsOnly',
		in: 'query',
		required: false,
		description: 'Leave out highsec systems (where reactions are impossible). Accepts true/false/1/0.',
		schema: { type: 'boolean', default: true }
	}
];

const errorBody = (description: string, example: unknown) => ({
	description,
	headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
	content: { 'application/json': { schema: ref('Error'), example } }
});

const INFO_DESCRIPTION = `Live reaction profits, recipes and market prices of the [EVE Reactions Calculator](${SITE_URL}).

- **Anonymous and free**: no key, no cookies. Only public market hubs exist here (\`GET /api/v2/hubs\`); private structure markets answer like unknown hubs (404).
- **Rate limit**: 120 requests per minute per IP; over it \`429 RATE_LIMITED\` with \`Retry-After: 60\`.
- **Formats**: JSON; prices, price history, cost indices and profits also answer CSV with \`format=csv\` (Google Sheets: \`=IMPORTDATA("${SITE_URL}/api/v2/profits?reactor=composite&format=csv")\`).
- **Settings**: the profit endpoints start from the site's default settings and take any setting as a query parameter (system, structure, rigs, fees, hubs, shipping…); \`POST /api/v2/plan\` takes them as a JSON object or a share-link string.
- **CORS** is open (\`Access-Control-Allow-Origin: *\`); \`POST\` answers preflight.
- **Caching**: \`public, max-age=60\` for market data, profits and meta (prices refresh every 30 minutes); \`public, max-age=3600\` for reference data; \`no-store\` for \`POST /api/v2/plan\` and every error.
- **Errors** are JSON \`{ "error": { "code", "message", "details"? } }\`: \`INVALID_PARAM\` (400, 413), \`NOT_FOUND\` (404), \`RATE_LIMITED\` (429), \`INTERNAL\` (500, 503); \`details\` lists invalid parameters.
- API v1 was removed: every \`/api/v1/*\` URL answers 410.`;

export const openapi = {
	openapi: '3.1.0',
	info: {
		title: 'EVE Reactions Calculator API',
		version: '2.0.0',
		description: INFO_DESCRIPTION
	},
	servers: [{ url: SITE_URL, description: 'Production' }],
	tags: [
		{
			name: 'Reference',
			description: 'Data status, public market hubs, solar systems and reaction recipes. Cached for an hour.'
		},
		{
			name: 'Market',
			description:
				'Hub prices (latest refresh, every 30 minutes, or the daily averages of a past day), price history and reaction cost indices. JSON or CSV.'
		},
		{
			name: 'Profits',
			description:
				"Profit of every reaction (JSON or CSV) or the full calculation of one, with the site's default settings overridden by any settings query parameter."
		},
		{
			name: 'Planner',
			description: 'Slot plan for production targets: build-up phases, purchases, outputs and profit.'
		}
	],
	paths: {
		'/api/v2/meta': {
			get: {
				operationId: 'getMeta',
				tags: ['Reference'],
				summary: 'Data status',
				description: 'SDE build, last price/cost index/adjusted price refresh and the public hubs.',
				responses: { '200': ok('Status', ref('Meta'), 'short', { json: EX.META_EXAMPLE }), ...errors() }
			}
		},
		'/api/v2/hubs': {
			get: {
				operationId: 'listHubs',
				tags: ['Reference'],
				summary: 'Public market hubs',
				description: 'Hub ids accepted by hub, inputHub, inputFallbackHub and outputHub.',
				responses: {
					'200': ok('Hubs by sort order', list('Hub'), 'long', { json: EX.HUBS_EXAMPLE }),
					...errors()
				}
			}
		},
		'/api/v2/systems': {
			get: {
				operationId: 'searchSystems',
				tags: ['Reference'],
				summary: 'Search solar systems',
				description: 'Prefix search by name with region, security and reaction cost index.',
				parameters: params(SYSTEMS_PARAMETERS),
				responses: {
					'200': ok('Systems sorted by name', list('System'), 'long', { json: EX.SYSTEMS_EXAMPLE }),
					...errors(400)
				}
			}
		},
		'/api/v2/systems/{id}': {
			get: {
				operationId: 'getSystem',
				tags: ['Reference'],
				summary: 'One solar system',
				description: 'Any system, highsec included.',
				parameters: [
					{
						name: 'id',
						in: 'path',
						required: true,
						description: 'Solar system id.',
						schema: { type: 'integer', minimum: 1 },
						example: '30002647'
					}
				],
				responses: {
					'200': ok('System', ref('System'), 'long', { json: EX.SYSTEM_EXAMPLE }),
					...errors(400, 404)
				}
			}
		},
		'/api/v2/reactions': {
			get: {
				operationId: 'listReactions',
				tags: ['Reference'],
				summary: 'Reaction recipes',
				description: 'Every published reaction with material names, volumes and the max runs per job.',
				parameters: params(ReactionsQuery.parameters, { reactor: 'hybrid' }),
				responses: {
					'200': ok('Recipes', list('Reaction'), 'long', { json: EX.REACTIONS_EXAMPLE }),
					...errors(400)
				}
			}
		},
		'/api/v2/reactions/{slug}': {
			get: {
				operationId: 'getReaction',
				tags: ['Reference'],
				summary: 'One reaction recipe',
				description: 'Recipe of one reaction.',
				parameters: [slugParam],
				responses: {
					'200': ok('Recipe', ref('Reaction'), 'long', { json: EX.REACTION_EXAMPLE }),
					...errors(404)
				}
			}
		},
		'/api/v2/prices': {
			get: {
				operationId: 'getPrices',
				tags: ['Market'],
				summary: 'Prices at a hub',
				description:
					'Best buy/sell order prices and order volumes of the latest refresh (every 30 minutes), or the daily averages of a past day with date= (no volumes; approximate=true when regional ESI averages filled gaps).',
				parameters: params(PricesQuery.parameters, { hub: 'jita', types: '16663,16671' }),
				responses: {
					'200': ok('Prices', ref('Prices'), 'short', {
						json: EX.PRICES_EXAMPLE,
						csv: EX.PRICES_CSV_EXAMPLE
					}),
					...errors(400, 404)
				}
			}
		},
		'/api/v2/prices/history': {
			get: {
				operationId: 'getPriceHistory',
				tags: ['Market'],
				summary: 'Price history of one type',
				description:
					'Daily averages (bounded to 400 days per request) or every refresh snapshot of the last 90 days.',
				parameters: params(PriceHistoryQuery.parameters, {
					hub: 'jita',
					from: '2026-10-01',
					to: '2026-10-03'
				}),
				responses: {
					'200': ok('Series', ref('PriceHistory'), 'short', {
						json: EX.PRICE_HISTORY_EXAMPLE,
						csv: EX.PRICE_HISTORY_CSV_EXAMPLE
					}),
					...errors(400, 404)
				}
			}
		},
		'/api/v2/cost-indices': {
			get: {
				operationId: 'getCostIndices',
				tags: ['Market'],
				summary: 'Reaction cost indices',
				description: 'Current reaction cost index of up to 100 systems (systems without one are left out).',
				parameters: params(CostIndicesQuery.parameters),
				responses: {
					'200': ok('Cost indices', list('CostIndex'), 'short', {
						json: EX.COST_INDICES_EXAMPLE,
						csv: EX.COST_INDICES_CSV_EXAMPLE
					}),
					...errors(400)
				}
			}
		},
		'/api/v2/profits': {
			get: {
				operationId: 'listProfits',
				tags: ['Profits'],
				summary: 'Profit of every reaction',
				description:
					'One row per reaction, highest profit per slot-day first, computed with the default settings plus any settings parameters. CSV columns: slug,name,reactor,tier,view,runs,inputCost,outputValue,jobCost,fees,shipping,profit,marginPct,profitPerSlotDay (+ slotsUsed,lines with slots=optimal).',
				parameters: params(ProfitsQuery.parameters, { reactor: 'composite', tier: 'composite' }),
				responses: {
					'200': ok('Profit rows', ref('Profits'), 'short', {
						json: EX.PROFITS_EXAMPLE,
						csv: EX.PROFITS_CSV_EXAMPLE
					}),
					...errors(400, 404)
				}
			}
		},
		'/api/v2/profits/{slug}': {
			get: {
				operationId: 'getProfit',
				tags: ['Profits'],
				summary: 'Full calculation of one reaction',
				description:
					'Inputs, outputs, job cost, chain tree and totals; with view=chain&slots=optimal also the slot allocation.',
				parameters: params([slugParam, ...ProfitDetailQuery.parameters]),
				responses: {
					'200': ok('Reaction result', ref('ReactionResult'), 'short', { json: EX.PROFIT_EXAMPLE }),
					...errors(400, 404)
				}
			}
		},
		'/api/v2/plan': {
			post: {
				operationId: 'plan',
				tags: ['Planner'],
				summary: 'Plan reaction slots',
				description: `Slot plan for targets given as lines or units per cycle, with build-up phases, purchases, outputs and profit. At most ${MAX_PLAN_TARGETS} targets, ${MAX_PLAN_SLOTS} slots and ${MAX_PLAN_BODY_BYTES / 1024} KB of JSON. dailyVolumes for the volume share come from the output hub's region.`,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: ref('PlanRequest'),
							examples: {
								lines: { summary: 'Lines of a product', value: EX.PLAN_LINES_EXAMPLE },
								quantity: {
									summary: 'Units per cycle with own settings and stock',
									value: EX.PLAN_QUANTITY_EXAMPLE
								}
							}
						}
					}
				},
				responses: {
					'200': ok('Plan (for the "Lines of a product" example)', ref('PlanResult'), 'none', {
						json: EX.PLAN_EXAMPLE
					}),
					...errors(400, 404, 413)
				}
			}
		},
		'/api/v2/openapi.json': {
			get: {
				operationId: 'getOpenApi',
				tags: ['Reference'],
				summary: 'This document',
				description: 'OpenAPI 3.1 description of API v2.',
				responses: { '200': ok('OpenAPI document', { type: 'object' }, 'long'), ...errors() }
			}
		}
	},
	components: {
		schemas: componentSchemas(),
		responses: {
			InvalidParam: errorBody('Invalid parameter', {
				error: {
					code: 'INVALID_PARAM',
					message: 'Invalid request parameters.',
					details: [{ param: 'reactor', message: 'Must be one of: biochemical, composite, hybrid' }]
				}
			}),
			NotFound: errorBody('Unknown slug, type, system or hub (private hubs look the same as unknown ones)', {
				error: { code: 'NOT_FOUND', message: 'Unknown hub "x".' }
			}),
			TooLarge: errorBody('Request body too large', {
				error: { code: 'INVALID_PARAM', message: 'Request body must not exceed 65536 bytes.' }
			}),
			RateLimited: {
				...errorBody('More than 120 requests in a minute from this IP', {
					error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again in a minute.' }
				}),
				headers: {
					'Retry-After': { schema: { type: 'integer', const: 60 } },
					'Cache-Control': { schema: { type: 'string', const: 'no-store' } }
				}
			},
			Internal: errorBody('Unexpected error', { error: { code: 'INTERNAL', message: 'Internal error.' } }),
			Unavailable: errorBody('Reference or market data not published yet', {
				error: { code: 'INTERNAL', message: 'Market data is not available yet.' }
			})
		}
	}
};
