import { z } from 'zod';
import { FALLBACK_HUB } from '../hubs.ts';
import {
	defineQuery,
	enumDefaultParam,
	enumParam,
	idListParam,
	dateParam,
	numberParam,
	required,
	stringParam
} from './params.ts';
import { ALLOCATION_PARAMS, DATE_PARAM, SETTINGS_PARAMS } from './settings.ts';

/**
 * API v2 query, body and response schemas. Responses are asserted against these in contract tests and
 * published as OpenAPI components (see `openapi.ts`).
 */

// ---------------------------------------------------------------------------------------------------
// Query parameters

const booleanParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const SystemsQuery = z.object({
	q: z.string().trim().min(2, 'q must be at least 2 characters'),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.default(10)
		.transform((n) => Math.min(n, 50)),
	reactionsOnly: booleanParam.default(true)
});

export const SystemIdParams = z.object({ id: z.coerce.number().int().positive() });

export const REACTOR_VALUES = ['biochemical', 'composite', 'hybrid'] as const;
export const TIER_VALUES = [
	'intermediate',
	'composite',
	'unrefined',
	'unrefined_mineral',
	'polymer',
	'booster_synth',
	'booster_standard',
	'booster_improved',
	'booster_strong',
	'molecular_forged',
	'other'
] as const;

export const MAX_PRICE_TYPES = 200;
export const MAX_COST_INDEX_SYSTEMS = 100;
/** Longest `from`…`to` span of one price history request. */
export const MAX_HISTORY_SPAN_DAYS = 400;
/** `resolution=snapshot` only reaches this far back (snapshots are kept 90 days). */
export const SNAPSHOT_HISTORY_DAYS = 90;

const reactor = enumParam('Only reactions of this reactor.', REACTOR_VALUES);
const tier = enumParam('Only reactions of this tier.', TIER_VALUES);
const format = enumDefaultParam(
	'Response format; csv returns RFC 4180 rows (header first) for spreadsheets.',
	['json', 'csv'],
	'json'
);
const hub = stringParam('Public market hub id (see /api/v2/hubs).', { default: FALLBACK_HUB });

export const ReactionsQuery = defineQuery({ reactor, tier });

export const PricesQuery = defineQuery({
	hub,
	types: idListParam(
		`Type ids; default: every tracked type (reaction inputs, products and reprocess outputs).`,
		{
			max: MAX_PRICE_TYPES,
			example: '34,16663'
		}
	),
	...DATE_PARAM,
	format
});

export const PriceHistoryQuery = defineQuery({
	hub,
	type: required(numberParam('Type id.', { min: 1, max: 2_147_483_647, integer: true, example: '16663' })),
	from: dateParam('First UTC day (default: 29 days before `to`).', '2026-09-01'),
	to: dateParam('Last UTC day (default: today).', '2026-09-30'),
	resolution: enumDefaultParam(
		`daily = daily averages (any range up to ${MAX_HISTORY_SPAN_DAYS} days; days without hub data use the region's ESI average and are marked approximate); snapshot = every price refresh, only within the last ${SNAPSHOT_HISTORY_DAYS} days.`,
		['daily', 'snapshot'],
		'daily'
	),
	format
});

export const CostIndicesQuery = defineQuery({
	systems: required(
		idListParam('Solar system ids.', { max: MAX_COST_INDEX_SYSTEMS, example: '30002647,30004604' })
	),
	format
});

const profitsView = enumDefaultParam(
	'single = buy every input; chain = build intermediates in a full chain with the regular reactions (reactions without a chain show single); unrefined = the full chain with its best unrefined routes (reactions without one show chain); best = the most profitable per slot-day of single, the full chain and reprocessed output, where the full chain uses its unrefined routes when unrefinedInChains=best.',
	['single', 'chain', 'unrefined', 'best'],
	'best'
);

export const ProfitsQuery = defineQuery({
	reactor,
	tier,
	view: profitsView,
	...ALLOCATION_PARAMS,
	...SETTINGS_PARAMS,
	...DATE_PARAM,
	format
});

export const ProfitDetailQuery = defineQuery({
	view: enumDefaultParam(
		'single = buy every input; chain = full chain with the regular reactions (chainable reactions only); unrefined = full chain with its best unrefined routes (chains with an unrefined route only).',
		['single', 'chain', 'unrefined'],
		'single'
	),
	output: enumDefaultParam(
		'product = sell the product; reprocessed = reprocess it and sell the materials (reprocessable reactions only).',
		['product', 'reprocessed'],
		'product'
	),
	...ALLOCATION_PARAMS,
	...SETTINGS_PARAMS,
	...DATE_PARAM
});

export const SlugParams = z.object({ slug: z.string() });

// ---------------------------------------------------------------------------------------------------
// Request bodies

export const MAX_PLAN_TARGETS = 50;
export const MAX_PLAN_SLOTS = 10_000;
export const MAX_PLAN_BODY_BYTES = 64 * 1024;

const typeIdKey = z.string().regex(/^\d+$/, 'Keys must be type ids');

export const PlanTargetBody = z
	.object({
		blueprintTypeId: z
			.number()
			.int()
			.positive()
			.optional()
			.meta({ description: 'Formula (blueprint) type id.' }),
		slug: z.string().min(1).optional().meta({ description: 'Reaction slug, e.g. crystalline-carbonide.' }),
		lines: z
			.number()
			.int()
			.min(1)
			.max(MAX_PLAN_SLOTS)
			.optional()
			.meta({ description: 'Full-cycle slots of the product (default 1).' }),
		quantity: z
			.number()
			.positive()
			.max(1e12)
			.optional()
			.meta({ description: 'Units of the product per cycle instead of lines.' })
	})
	.refine((t) => (t.blueprintTypeId === undefined) !== (t.slug === undefined), {
		error: 'Give exactly one of blueprintTypeId or slug'
	})
	.refine((t) => t.lines === undefined || t.quantity === undefined, {
		error: 'Give lines or quantity, not both'
	});

export const PlanBody = z.object({
	settings: z
		.union([z.string(), z.record(z.string(), z.unknown())])
		.optional()
		.meta({
			description:
				'Partial settings object (same shape as the site settings; missing fields use the defaults) or an encoded settings string from a share link.'
		}),
	totalSlots: z.number().int().min(1).max(MAX_PLAN_SLOTS).meta({ description: 'Reaction slots available.' }),
	targets: z.array(PlanTargetBody).min(1).max(MAX_PLAN_TARGETS),
	buyInsteadOfBuild: z
		.array(z.number().int().positive())
		.max(1000)
		.default([])
		.meta({ description: 'Intermediate type ids to buy instead of building them.' }),
	stock: z
		.record(typeIdKey, z.number().min(0))
		.default({})
		.meta({ description: 'Materials in stock: type id → quantity.' }),
	ownedFormulas: z
		.record(typeIdKey, z.number().int().min(0))
		.default({})
		.meta({ description: 'Formulas owned: blueprint type id → count.' })
});

// ---------------------------------------------------------------------------------------------------
// Responses

/** Response schemas published under `components.schemas` (id → schema). */
export const responseRegistry = z.registry<{ id: string; description?: string }>();

const isoTime = z.string().meta({ format: 'date-time' });
const reactorEnum = z.enum(REACTOR_VALUES);
const tierEnum = z.enum(TIER_VALUES);

export const ErrorResponse = z
	.object({
		error: z.object({
			code: z.enum(['INVALID_PARAM', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL']),
			message: z.string(),
			details: z
				.unknown()
				.optional()
				.meta({ description: 'INVALID_PARAM: [{ param, message }] per invalid parameter.' })
		})
	})
	.register(responseRegistry, { id: 'Error' });

export const SystemResponse = z
	.object({
		id: z.number().int(),
		name: z.string(),
		regionName: z.string().nullable(),
		securityBand: z.enum(['highsec', 'lowsec', 'nullsec', 'wormhole']),
		securityStatus: z.number(),
		reactionCostIndex: z.number().nullable()
	})
	.register(responseRegistry, { id: 'System' });

export const SystemsResponse = z.array(SystemResponse);

export const HubResponse = z
	.object({
		id: z.string(),
		name: z.string(),
		kind: z.string().meta({ description: 'station, system or structure' }),
		regionId: z.number().int(),
		systemId: z.number().int()
	})
	.register(responseRegistry, { id: 'Hub' });

export const HubsResponse = z.array(HubResponse);

export const MetaResponse = z
	.object({
		sdeBuild: z.number().int().nullable(),
		pricesUpdatedAt: isoTime.nullable(),
		costIndicesUpdatedAt: isoTime.nullable(),
		adjustedUpdatedAt: isoTime.nullable(),
		hubs: HubsResponse
	})
	.register(responseRegistry, { id: 'Meta' });

const RecipeMaterial = z
	.object({
		typeId: z.number().int(),
		name: z.string().nullable(),
		quantity: z.number().int(),
		volume: z.number().nullable().meta({ description: 'm³ per unit' })
	})
	.register(responseRegistry, { id: 'RecipeMaterial' });

export const ReactionResponse = z
	.object({
		blueprintTypeId: z.number().int(),
		slug: z.string(),
		name: z.string(),
		formulaName: z.string(),
		reactor: reactorEnum,
		tier: tierEnum,
		baseTimeSeconds: z.number(),
		maxRuns: z.number().int().meta({ description: 'Most runs one job may have.' }),
		requiredSkillLevel: z.number().int(),
		chainable: z.boolean(),
		reprocessable: z.boolean(),
		product: RecipeMaterial,
		materials: z.array(RecipeMaterial)
	})
	.register(responseRegistry, { id: 'Reaction' });

export const ReactionsResponse = z.array(ReactionResponse);

const PriceRow = z.object({
	typeId: z.number().int(),
	name: z.string().nullable(),
	buy: z.number().nullable(),
	sell: z.number().nullable(),
	buyVolume: z.number().nullable(),
	sellVolume: z.number().nullable()
});
export const PRICE_COLUMNS = ['typeId', 'name', 'buy', 'sell', 'buyVolume', 'sellVolume'] as const;

export const PricesResponse = z
	.object({
		hub: z.string(),
		asOf: z.string().meta({ description: 'Snapshot time (ISO) or the historical day.' }),
		approximate: z
			.boolean()
			.meta({ description: "Historical only: some prices are the region's ESI daily average." }),
		prices: z.array(PriceRow)
	})
	.register(responseRegistry, { id: 'Prices' });

const HistoryPoint = z.object({
	at: z.string().meta({ description: 'YYYY-MM-DD (daily) or ISO time (snapshot).' }),
	buy: z.number().nullable(),
	sell: z.number().nullable(),
	buyVolume: z.number().nullable(),
	sellVolume: z.number().nullable(),
	approximate: z.boolean()
});
export const HISTORY_COLUMNS = ['at', 'buy', 'sell', 'buyVolume', 'sellVolume', 'approximate'] as const;

export const PriceHistoryResponse = z
	.object({
		hub: z.string(),
		typeId: z.number().int(),
		name: z.string(),
		resolution: z.enum(['daily', 'snapshot']),
		from: z.string(),
		to: z.string(),
		points: z.array(HistoryPoint)
	})
	.register(responseRegistry, { id: 'PriceHistory' });

export const CostIndexResponse = z
	.object({
		systemId: z.number().int(),
		name: z.string().nullable(),
		reaction: z.number().meta({ description: 'Fraction, e.g. 0.0412 = 4.12 %.' }),
		updatedAt: isoTime
	})
	.register(responseRegistry, { id: 'CostIndex' });
export const CostIndicesResponse = z.array(CostIndexResponse);
export const COST_INDEX_COLUMNS = ['systemId', 'name', 'reaction', 'updatedAt'] as const;

export const PROFIT_COLUMNS = [
	'slug',
	'name',
	'reactor',
	'tier',
	'view',
	'runs',
	'inputCost',
	'outputValue',
	'jobCost',
	'fees',
	'shipping',
	'profit',
	'marginPct',
	'profitPerSlotDay'
] as const;
/** Appended with `slots=optimal`. */
export const ALLOCATION_COLUMNS = ['slotsUsed', 'lines'] as const;

export const ProfitRow = z
	.object({
		slug: z.string(),
		name: z.string(),
		reactor: reactorEnum,
		tier: tierEnum,
		view: z.enum(['single', 'chain', 'unrefined', 'reprocessed']),
		runs: z.number().int(),
		inputCost: z.number().meta({ description: 'Inputs at market price (fees and shipping excluded).' }),
		outputValue: z.number().meta({ description: 'Outputs at market price (fees and shipping excluded).' }),
		jobCost: z.number(),
		fees: z.number().meta({ description: 'Broker fees and sales tax, inputs + outputs.' }),
		shipping: z.number(),
		profit: z.number().nullable().meta({ description: 'null when a price is missing.' }),
		marginPct: z.number().nullable(),
		profitPerSlotDay: z.number().nullable(),
		slotsUsed: z.number().int().nullable().optional().meta({ description: 'slots=optimal only.' }),
		lines: z.number().int().nullable().optional().meta({ description: 'slots=optimal only.' })
	})
	.register(responseRegistry, { id: 'ProfitRow' });

export const ProfitsResponse = z
	.object({
		asOf: z.string(),
		approximate: z.boolean(),
		settings: z
			.looseObject({ v: z.number(), mode: z.enum(['shared', 'per_reactor']) })
			.meta({ description: 'Effective settings (defaults with the query applied).' }),
		rows: z.array(ProfitRow)
	})
	.register(responseRegistry, { id: 'Profits' });

const InputSource = z
	.object({
		hubId: z.string(),
		quantity: z.number(),
		unitPrice: z.number().nullable(),
		total: z.number(),
		fees: z.number()
	})
	.register(responseRegistry, { id: 'InputSource' });

const LineItem = z
	.object({
		typeId: z.number().int(),
		name: z.string(),
		quantity: z.number(),
		unitPrice: z.number().nullable(),
		total: z.number(),
		fees: z.number(),
		shipping: z.number(),
		volume: z.number(),
		sources: z.array(InputSource).optional().meta({
			description:
				'Bought inputs only, when inputHub lists fewer units than needed: the units bought there and the rest at inputFallbackHub.'
		}),
		availableAtInputHub: z.number().nullable().optional().meta({
			description:
				'Bought inputs (buy_order/instant) only: units listed for sale at inputHub; null when unknown (historical prices).'
		})
	})
	.register(responseRegistry, { id: 'LineItem' });

const JobCost = z
	.object({
		eiv: z.number(),
		systemCost: z.number(),
		facilityTax: z.number(),
		scc: z.number(),
		total: z.number()
	})
	.register(responseRegistry, { id: 'JobCost' });

const StepMaterial = z
	.union([
		LineItem.extend({ source: z.literal('buy') }),
		z.object({
			source: z.enum(['chain', 'byproduct']).meta({
				description:
					"chain: built by a sub-job; byproduct: taken from an unrefined job's reprocessing instead of buying it."
			}),
			typeId: z.number().int(),
			name: z.string(),
			quantity: z.number(),
			volume: z.number(),
			blueprintTypeId: z.number().int().meta({
				description: 'Job producing it (byproduct: the unrefined job whose reprocessing yields it).'
			})
		})
	])
	.register(responseRegistry, { id: 'StepMaterial' });

const ChainReprocess = z
	.object({
		typeId: z.number().int().meta({ description: 'Material the consuming job needs.' }),
		replacesBlueprintTypeId: z.number().int(),
		replacesName: z.string(),
		yieldPct: z.number(),
		outputs: z.array(
			z.object({
				typeId: z.number().int(),
				name: z.string(),
				quantity: z.number(),
				used: z.number().meta({
					description:
						'The replaced material: units its consumer uses; byproducts: units replacing purchases.'
				}),
				sold: z.number().meta({ description: 'Byproduct units sold with the outputs.' })
			})
		),
		surplus: z.number().meta({ description: 'Units of the replaced material beyond the need.' })
	})
	.register(responseRegistry, { id: 'ChainReprocess' });

export const ChainNode = z.object({
	blueprintTypeId: z.number().int(),
	name: z.string(),
	reactor: reactorEnum,
	runs: z.number().int(),
	runTimeSeconds: z.number(),
	quantityProduced: z.number(),
	quantityUsed: z.number(),
	surplus: z.number(),
	jobCost: JobCost,
	get children(): z.ZodArray<typeof ChainNode> {
		return z.array(ChainNode);
	},
	productTypeId: z.number().int(),
	depth: z.number().int(),
	step: z.number().int().meta({
		description:
			'Build step, 1-based: after its sub-jobs and, in a single-slot chain, after the unrefined jobs whose byproducts it uses.'
	}),
	materials: z.array(StepMaterial),
	slotSeconds: z.number(),
	jobRates: z.object({ costIndex: z.number(), facilityTaxPct: z.number(), sccPct: z.number() }),
	subtotal: z.object({
		purchaseCost: z.number(),
		purchaseFees: z.number(),
		purchaseShipping: z.number(),
		jobCost: z.number(),
		total: z.number()
	}),
	runsPerSlot: z.array(z.number().int()).optional(),
	reprocess: ChainReprocess.optional().meta({
		description: 'An unrefined job replacing a regular reaction: its whole product is reprocessed.'
	})
});
ChainNode.register(responseRegistry, { id: 'ChainNode' });

const PlanPhase = z
	.object({
		cycle: z.number().int().meta({ description: '0 = the one-time step 0; 1 = first start-up cycle.' }),
		label: z.enum(['step_0', 'build_up', 'steady']),
		blueprintTypeIds: z.array(z.number().int()),
		slots: z.number().int(),
		purchases: z.array(LineItem).meta({
			description:
				"Purchases of this cycle after the previous cycle's byproducts (and stock in the planner); steady: its first cycle."
		}),
		jobCost: z.number()
	})
	.register(responseRegistry, { id: 'PlanPhase' });

const PlanItem = z.object({ typeId: z.number().int(), name: z.string(), quantity: z.number() });
const StartupOption = z.object({
	initialInvestment: z
		.number()
		.nullable()
		.meta({ description: 'Null when a start-up purchase has no price.' }),
	cycles: z.number().int().meta({ description: 'Cycles up to and including the first steady one.' })
});
const PlanStartup = z
	.object({
		mode: z.enum(['buy', 'step0']).meta({
			description:
				"buy: the start-up cycles buy what later cycles get from the previous cycle's reprocessing; step0: a one-time step 0 runs unrefined jobs whose byproducts other first-cycle jobs use. The cheaper one is used (ties: buy)."
		}),
		reused: z.array(PlanItem).meta({
			description:
				"Materials a steady cycle gets from the previous cycle's reprocessing byproducts instead of buying them; the start-up cycles buy them until the unrefined jobs making them have run once."
		}),
		buy: StartupOption,
		step0: StartupOption.extend({
			blueprintTypeIds: z.array(z.number().int()),
			saves: z.array(PlanItem).meta({ description: "First-cycle purchases step 0's byproducts replace." }),
			stock: z
				.array(PlanItem)
				.meta({ description: "Step 0's reprocessed materials the first cycle does not use." })
		})
			.nullable()
			.meta({ description: 'null when no unrefined job of the first cycle feeds another job of that cycle.' })
	})
	.register(responseRegistry, { id: 'PlanStartup' });

const ChainAllocation = z
	.object({
		mode: z.literal('optimal'),
		lines: z.number().int(),
		slotsUsed: z.number().int(),
		cycleDays: z.number(),
		utilisation: z.number(),
		slotSecondsBusy: z.number(),
		reactions: z.array(
			z.object({
				blueprintTypeId: z.number().int(),
				name: z.string(),
				depth: z.number().int(),
				slots: z.number().int(),
				runsPerSlot: z.array(z.number().int()),
				runTimeSeconds: z.number(),
				slotDurations: z.array(z.number()),
				firstCycle: z.number().int()
			})
		),
		phases: z.array(PlanPhase),
		initialInvestment: z.number().nullable(),
		startup: PlanStartup.meta({ description: 'Option investments exclude formulas, like initialInvestment.' })
	})
	.register(responseRegistry, { id: 'ChainAllocation' });

export const ReactionResultResponse = z
	.object({
		blueprintTypeId: z.number().int(),
		slug: z.string(),
		name: z.string(),
		reactor: reactorEnum,
		tier: tierEnum,
		view: z.enum(['single', 'chain', 'unrefined']),
		outputMode: z.enum(['product', 'reprocessed']),
		runs: z.number().int(),
		runTimeSeconds: z.number(),
		chainDepth: z.number().int(),
		inputs: z.array(LineItem),
		chain: ChainNode.nullable(),
		viaUnrefined: z.array(z.number().int()).meta({
			description:
				'Chain views: product type ids built with their unrefined reaction and reprocessing (view=unrefined).'
		}),
		outputs: z.array(LineItem),
		surplus: z.array(LineItem),
		jobCost: JobCost,
		totals: z.object({
			inputCost: z.number(),
			inputFees: z.number(),
			inputShipping: z.number(),
			outputValue: z.number(),
			outputFees: z.number(),
			outputShipping: z.number(),
			jobCost: z.number(),
			totalCost: z.number(),
			profit: z.number().nullable(),
			marginPct: z.number().nullable(),
			roiPct: z.number().nullable(),
			slotSeconds: z.number(),
			profitPerSlotDay: z.number().nullable(),
			profitPerRun: z.number().nullable()
		}),
		missingPrices: z.array(z.number().int()),
		warnings: z.array(z.string()),
		allocation: ChainAllocation.optional().meta({ description: 'slots=optimal chains only.' })
	})
	.register(responseRegistry, { id: 'ReactionResult' });

export const PlanResultResponse = z
	.object({
		reactions: z.array(
			z.object({
				blueprintTypeId: z.number().int(),
				name: z.string(),
				depth: z.number().int(),
				totalRuns: z.number().int(),
				slots: z.number().int(),
				runsPerSlot: z.array(z.number().int()),
				firstCycle: z.number().int(),
				runTimeSeconds: z.number(),
				jobCost: z.number(),
				product: PlanItem.meta({
					description: 'What one cycle of its jobs makes (an unrefined job: its product before reprocessing).'
				}),
				materials: z
					.array(
						PlanItem.extend({
							producer: z.number().int().nullable().meta({
								description:
									'Blueprint of the plan reaction building it (an unrefined job: by reprocessing); null = bought.'
							})
						})
					)
					.meta({
						description:
							"What one cycle of its jobs consumes. Bought materials are partly covered by the previous cycle's reprocessing byproducts (reprocess.byproducts[].used)."
					}),
				reprocess: z
					.object({
						replaces: z.array(PlanItem.extend({ regularName: z.string() })),
						byproducts: z.array(
							PlanItem.extend({
								used: z.number(),
								sold: z.number(),
								usedBy: z.array(z.object({ blueprintTypeId: z.number().int(), fromCycle: z.number().int() }))
							})
						)
					})
					.optional()
					.meta({
						description:
							'Unrefined job: the materials it is reprocessed into for the plan and where its byproducts go in a steady cycle.'
					})
			})
		),
		slotsUsed: z.number().int(),
		slotsRemaining: z.number().int(),
		maxDepth: z.number().int(),
		slotSecondsBusy: z.number(),
		utilisation: z.number(),
		phases: z.array(PlanPhase),
		startup: PlanStartup,
		purchasesPerCycle: z.array(
			LineItem.extend({
				dailyVolumeSharePct: z.number().nullable().meta({
					description:
						"Bought per day (per cycle ÷ cycleDays) as a percentage of the input hub region's 30-day average daily volume; null for contracts or without volume data."
				})
			})
		),
		initialPurchases: z.array(LineItem),
		formulasToBuy: z.array(
			z.object({
				blueprintTypeId: z.number().int(),
				count: z.number().int(),
				unitPrice: z.number().nullable()
			})
		),
		outputsPerCycle: z.array(LineItem.extend({ dailyVolumeSharePct: z.number().nullable() })),
		surplusPerCycle: z.array(LineItem),
		totals: z.object({
			recurringInvestment: z.number(),
			initialInvestment: z.number(),
			formulaCost: z.number(),
			jobCostPerCycle: z.number(),
			outputNetPerCycle: z.number(),
			profitPerCycle: z.number().nullable(),
			profitPerDay: z.number().nullable(),
			profitPerSlotDay: z.number().nullable(),
			marginPct: z.number().nullable()
		}),
		missingPrices: z.array(z.number().int()),
		warnings: z.array(z.string())
	})
	.register(responseRegistry, { id: 'PlanResult' });

export const OpenApiResponse = z.looseObject({
	openapi: z.string(),
	info: z.looseObject({ title: z.string(), version: z.string() }),
	paths: z.record(z.string(), z.record(z.string(), z.unknown()))
});
