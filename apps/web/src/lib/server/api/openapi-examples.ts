/**
 * Example payloads of the OpenAPI document (shown by the /api reference), captured from the seeded dev
 * dataset with numbers rounded. `openapi.test.ts` parses every JSON example with its response schema and
 * checks the CSV headers.
 */

/** GET /api/v2/hubs */
export const HUBS_EXAMPLE = [
	{ id: 'jita', name: 'Jita 4-4', kind: 'station', regionId: 10000002, systemId: 30000142 },
	{ id: 'amarr', name: 'Amarr', kind: 'station', regionId: 10000043, systemId: 30002187 },
	{ id: 'perimeter', name: 'Perimeter', kind: 'system', regionId: 10000002, systemId: 30000144 },
	{ id: 'dodixie', name: 'Dodixie', kind: 'station', regionId: 10000032, systemId: 30002659 },
	{ id: 'rens', name: 'Rens', kind: 'station', regionId: 10000030, systemId: 30002510 },
	{ id: 'hek', name: 'Hek', kind: 'station', regionId: 10000042, systemId: 30002053 }
];

/** GET /api/v2/meta */
export const META_EXAMPLE = {
	sdeBuild: 3421648,
	pricesUpdatedAt: '2026-10-07T08:00:00.000Z',
	costIndicesUpdatedAt: '2026-10-07T08:05:57.565Z',
	adjustedUpdatedAt: '2026-10-07T08:05:57.565Z',
	hubs: HUBS_EXAMPLE
};

/** GET /api/v2/systems?q=ign */
export const SYSTEMS_EXAMPLE = [
	{
		id: 30002647,
		name: 'Ignoitton',
		regionName: 'Sinq Laison',
		securityBand: 'lowsec',
		securityStatus: 0.4388,
		reactionCostIndex: 0.0412
	}
];

/** GET /api/v2/systems/30002647 */
export const SYSTEM_EXAMPLE = {
	id: 30002647,
	name: 'Ignoitton',
	regionName: 'Sinq Laison',
	securityBand: 'lowsec',
	securityStatus: 0.4388,
	reactionCostIndex: 0.0412
};

/** GET /api/v2/reactions?reactor=hybrid (first recipe) */
export const REACTIONS_EXAMPLE = [
	{
		blueprintTypeId: 46157,
		slug: 'methanofullerene',
		name: 'Methanofullerene',
		formulaName: 'Methanofullerene Reaction Formula',
		reactor: 'hybrid',
		tier: 'polymer',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 3,
		chainable: false,
		reprocessable: false,
		product: { typeId: 30306, name: 'Methanofullerene', quantity: 160, volume: 0.75 },
		materials: [
			{ typeId: 4246, name: 'Hydrogen Fuel Block', quantity: 5, volume: 5 },
			{ typeId: 30372, name: 'Fullerite-C70', quantity: 100, volume: 1 },
			{ typeId: 30373, name: 'Fullerite-C72', quantity: 100, volume: 2 },
			{ typeId: 37, name: 'Isogen', quantity: 300, volume: 0.01 }
		]
	}
];

/** GET /api/v2/reactions/titanium-carbide */
export const REACTION_EXAMPLE = {
	blueprintTypeId: 46204,
	slug: 'titanium-carbide',
	name: 'Titanium Carbide',
	formulaName: 'Titanium Carbide Reaction Formula',
	reactor: 'composite',
	tier: 'composite',
	baseTimeSeconds: 10800,
	maxRuns: 1000,
	requiredSkillLevel: 3,
	chainable: true,
	reprocessable: false,
	product: { typeId: 16671, name: 'Titanium Carbide', quantity: 10000, volume: 0.01 },
	materials: [
		{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 5, volume: 5 },
		{ typeId: 16654, name: 'Titanium Chromide', quantity: 100, volume: 0.2 },
		{ typeId: 16658, name: 'Silicon Diborite', quantity: 100, volume: 0.2 }
	]
};

/** GET /api/v2/prices?hub=jita&types=16663,16671 */
export const PRICES_EXAMPLE = {
	hub: 'jita',
	asOf: '2026-10-07T08:00:00.000Z',
	approximate: false,
	prices: [
		{
			typeId: 16663,
			name: 'Caesarium Cadmide',
			buy: 4049.88,
			sell: 4295.03,
			buyVolume: 693603,
			sellVolume: 901684
		},
		{
			typeId: 16671,
			name: 'Titanium Carbide',
			buy: 108.38,
			sell: 118.46,
			buyVolume: 964295,
			sellVolume: 1253584
		}
	]
};

/** … &format=csv */
export const PRICES_CSV_EXAMPLE = `typeId,name,buy,sell,buyVolume,sellVolume
16663,Caesarium Cadmide,4049.88,4295.03,693603,901684
16671,Titanium Carbide,108.38,118.46,964295,1253584
`;

/** GET /api/v2/prices/history?hub=jita&type=16663&from=2026-10-01&to=2026-10-03 */
export const PRICE_HISTORY_EXAMPLE = {
	hub: 'jita',
	typeId: 16663,
	name: 'Caesarium Cadmide',
	resolution: 'daily',
	from: '2026-10-01',
	to: '2026-10-03',
	points: [
		{ at: '2026-10-01', buy: 3885.66, sell: 4317.4, buyVolume: null, sellVolume: null, approximate: false },
		{ at: '2026-10-02', buy: 3916.09, sell: 4351.22, buyVolume: null, sellVolume: null, approximate: false },
		{ at: '2026-10-03', buy: 3570.78, sell: 3967.53, buyVolume: null, sellVolume: null, approximate: false }
	]
};

/** … &format=csv */
export const PRICE_HISTORY_CSV_EXAMPLE = `at,buy,sell,buyVolume,sellVolume,approximate
2026-10-01,3885.66,4317.4,,,false
2026-10-02,3916.09,4351.22,,,false
2026-10-03,3570.78,3967.53,,,false
`;

/** GET /api/v2/cost-indices?systems=30002647,30004604 */
export const COST_INDICES_EXAMPLE = [
	{ systemId: 30002647, name: 'Ignoitton', reaction: 0.0412, updatedAt: '2026-10-07T08:05:57.565Z' },
	{ systemId: 30004604, name: '671-ST', reaction: 0.05, updatedAt: '2026-10-07T08:05:57.565Z' }
];

/** … &format=csv */
export const COST_INDICES_CSV_EXAMPLE = `systemId,name,reaction,updatedAt
30002647,Ignoitton,0.0412,2026-10-07T08:05:57.565Z
30004604,671-ST,0.05,2026-10-07T08:05:57.565Z
`;

/** GET /api/v2/profits?reactor=composite&tier=composite (first two rows) */
export const PROFITS_EXAMPLE = {
	asOf: '2026-10-07T08:00:00.000Z',
	approximate: false,
	settings: {
		v: 1,
		mode: 'shared',
		shared: {
			structure: 'tatara',
			meRig: 't2',
			teRig: 't2',
			systemId: 30002647,
			costIndexOverridePct: null,
			facilityTaxPct: 1,
			sccPct: 4,
			reactionsSkill: 5,
			market: {
				inputHub: 'jita',
				inputFallbackHub: 'jita',
				outputHub: 'jita',
				inputMethod: 'buy_order',
				outputMethod: 'sell_order',
				inputContractBasis: 'split',
				outputContractBasis: 'split',
				inputPricePct: 100,
				outputPricePct: 100,
				brokerFeePct: 1.5,
				salesTaxPct: 3.6
			},
			shipping: {
				input: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 },
				output: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 }
			}
		},
		reactors: {
			biochemical: {
				structure: 'tatara',
				meRig: 't2',
				teRig: 't2',
				systemId: 30002647,
				costIndexOverridePct: null,
				facilityTaxPct: 1,
				sccPct: 4,
				reactionsSkill: 5,
				market: {
					inputHub: 'jita',
					inputFallbackHub: 'jita',
					outputHub: 'jita',
					inputMethod: 'buy_order',
					outputMethod: 'sell_order',
					inputContractBasis: 'split',
					outputContractBasis: 'split',
					inputPricePct: 100,
					outputPricePct: 100,
					brokerFeePct: 1.5,
					salesTaxPct: 3.6
				},
				shipping: {
					input: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 },
					output: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 }
				}
			},
			composite: {
				structure: 'tatara',
				meRig: 't2',
				teRig: 't2',
				systemId: 30002647,
				costIndexOverridePct: null,
				facilityTaxPct: 1,
				sccPct: 4,
				reactionsSkill: 5,
				market: {
					inputHub: 'jita',
					inputFallbackHub: 'jita',
					outputHub: 'jita',
					inputMethod: 'buy_order',
					outputMethod: 'sell_order',
					inputContractBasis: 'split',
					outputContractBasis: 'split',
					inputPricePct: 100,
					outputPricePct: 100,
					brokerFeePct: 1.5,
					salesTaxPct: 3.6
				},
				shipping: {
					input: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 },
					output: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 }
				}
			},
			hybrid: {
				structure: 'tatara',
				meRig: 't2',
				teRig: 't2',
				systemId: 30002647,
				costIndexOverridePct: null,
				facilityTaxPct: 1,
				sccPct: 4,
				reactionsSkill: 5,
				market: {
					inputHub: 'jita',
					inputFallbackHub: 'jita',
					outputHub: 'jita',
					inputMethod: 'buy_order',
					outputMethod: 'sell_order',
					inputContractBasis: 'split',
					outputContractBasis: 'split',
					inputPricePct: 100,
					outputPricePct: 100,
					brokerFeePct: 1.5,
					salesTaxPct: 3.6
				},
				shipping: {
					input: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 },
					output: { enabled: false, iskPerM3: 0, collateralPct: 0, discountPct: 0 }
				}
			}
		},
		cycleDays: 7,
		slotAllocation: 'single',
		maxParallelLines: 4,
		reprocessing: { unrefinedYieldPct: 55, prismaticiteYieldPct: 90.63, prismaticiteRollPct: 50 }
	},
	rows: [
		{
			slug: 'reinforced-carbon-fiber',
			name: 'Reinforced Carbon Fiber',
			reactor: 'composite',
			tier: 'composite',
			view: 'single',
			runs: 122,
			inputCost: 265927567.46,
			outputValue: 362107468,
			jobCost: 25003490.53,
			fees: 22456394.38,
			shipping: 0,
			profit: 48720015.63,
			marginPct: 13.4546,
			profitPerSlotDay: 7006041.94
		},
		{
			slug: 'ferrogel',
			name: 'Ferrogel',
			reactor: 'composite',
			tier: 'composite',
			view: 'single',
			runs: 122,
			inputCost: 201799557.72,
			outputValue: 259002584,
			jobCost: 19619381.95,
			fees: 16236125.15,
			shipping: 0,
			profit: 21347519.18,
			marginPct: 8.2422,
			profitPerSlotDay: 3069818.69
		}
	]
};

/** … &format=csv */
export const PROFITS_CSV_EXAMPLE = `slug,name,reactor,tier,view,runs,inputCost,outputValue,jobCost,fees,shipping,profit,marginPct,profitPerSlotDay
reinforced-carbon-fiber,Reinforced Carbon Fiber,composite,composite,single,122,265927567.46,362107468,25003490.53,22456394.38,0,48720015.63,13.4546,7006041.94
ferrogel,Ferrogel,composite,composite,single,122,201799557.72,259002584,19619381.95,16236125.15,0,21347519.18,8.2422,3069818.69
`;

/** GET /api/v2/profits/titanium-carbide */
export const PROFIT_EXAMPLE = {
	blueprintTypeId: 46204,
	slug: 'titanium-carbide',
	name: 'Titanium Carbide',
	reactor: 'composite',
	tier: 'composite',
	view: 'single',
	outputMode: 'product',
	runs: 122,
	runTimeSeconds: 4924.8,
	chainDepth: 1,
	inputs: [
		{
			typeId: 4312,
			name: 'Oxygen Fuel Block',
			quantity: 596,
			unitPrice: 15418.29,
			total: 9189300.84,
			fees: 137839.51,
			shipping: 0,
			volume: 2980
		},
		{
			typeId: 16654,
			name: 'Titanium Chromide',
			quantity: 11908,
			unitPrice: 2920.15,
			total: 34773146.2,
			fees: 521597.19,
			shipping: 0,
			volume: 2381.6
		},
		{
			typeId: 16658,
			name: 'Silicon Diborite',
			quantity: 11908,
			unitPrice: 5217.33,
			total: 62127965.64,
			fees: 931919.48,
			shipping: 0,
			volume: 2381.6
		}
	],
	chain: null,
	viaUnrefined: [],
	outputs: [
		{
			typeId: 16671,
			name: 'Titanium Carbide',
			quantity: 1220000,
			unitPrice: 118.46,
			total: 144521200,
			fees: 7370581.2,
			shipping: 0,
			volume: 12200
		}
	],
	surplus: [],
	jobCost: {
		eiv: 115440261.3,
		systemCost: 4756138.77,
		facilityTax: 1154402.61,
		scc: 4617610.45,
		total: 10528151.83
	},
	totals: {
		inputCost: 106090412.68,
		inputFees: 1591356.19,
		inputShipping: 0,
		outputValue: 144521200,
		outputFees: 7370581.2,
		outputShipping: 0,
		jobCost: 10528151.83,
		totalCost: 118209920.7,
		profit: 18940698.1,
		marginPct: 13.1058,
		roiPct: 16.0229,
		slotSeconds: 600825.6,
		profitPerSlotDay: 2723712.7,
		profitPerRun: 155251.62
	},
	missingPrices: [],
	warnings: []
};

/** POST /api/v2/plan body: lines of a product */
export const PLAN_LINES_EXAMPLE = { totalSlots: 30, targets: [{ slug: 'titanium-carbide', lines: 2 }] };

/** POST /api/v2/plan body: units per cycle, own settings and stock */
export const PLAN_QUANTITY_EXAMPLE = {
	settings: { shared: { systemId: 30004604, market: { brokerFeePct: 1 } } },
	totalSlots: 60,
	targets: [{ slug: 'crystalline-carbonide', quantity: 2440000 }],
	stock: { '16655': 50000 }
};

const planItem = (typeId: number, name: string, quantity: number, unitPrice: number, volume: number) => ({
	typeId,
	name,
	quantity,
	unitPrice,
	total: Math.round(quantity * unitPrice * 100) / 100,
	fees: Math.round(quantity * unitPrice * 1.5) / 100,
	shipping: 0,
	volume
});
const planRaw = [
	planItem(16635, 'Evaporite Deposits', 11712, 2734.46, 585.6),
	planItem(16636, 'Silicates', 11712, 4513.1, 585.6),
	planItem(16638, 'Titanium', 11712, 3255.03, 585.6),
	planItem(16641, 'Chromium', 11712, 648.43, 585.6)
];

/** POST /api/v2/plan response to PLAN_LINES */
export const PLAN_EXAMPLE = {
	reactions: [
		{
			blueprintTypeId: 46204,
			name: 'Titanium Carbide',
			depth: 0,
			totalRuns: 244,
			slots: 2,
			runsPerSlot: [122, 122],
			firstCycle: 2,
			runTimeSeconds: 4924.8,
			jobCost: 21056303.66,
			product: { typeId: 16671, name: 'Titanium Carbide', quantity: 2440000 },
			materials: [
				{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 1192, producer: null },
				{ typeId: 16654, name: 'Titanium Chromide', quantity: 23816, producer: 46182 },
				{ typeId: 16658, name: 'Silicon Diborite', quantity: 23816, producer: 46179 }
			]
		},
		{
			blueprintTypeId: 46179,
			name: 'Silicon Diborite',
			depth: 1,
			totalRuns: 120,
			slots: 1,
			runsPerSlot: [120],
			firstCycle: 1,
			runTimeSeconds: 4924.8,
			jobCost: 9361668.87,
			product: { typeId: 16658, name: 'Silicon Diborite', quantity: 24000 },
			materials: [
				{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 586, producer: null },
				{ typeId: 16635, name: 'Evaporite Deposits', quantity: 11712, producer: null },
				{ typeId: 16636, name: 'Silicates', quantity: 11712, producer: null }
			]
		},
		{
			blueprintTypeId: 46182,
			name: 'Titanium Chromide',
			depth: 1,
			totalRuns: 120,
			slots: 1,
			runsPerSlot: [120],
			firstCycle: 1,
			runTimeSeconds: 4924.8,
			jobCost: 5553857.29,
			product: { typeId: 16654, name: 'Titanium Chromide', quantity: 24000 },
			materials: [
				{ typeId: 4312, name: 'Oxygen Fuel Block', quantity: 586, producer: null },
				{ typeId: 16638, name: 'Titanium', quantity: 11712, producer: null },
				{ typeId: 16641, name: 'Chromium', quantity: 11712, producer: null }
			]
		}
	],
	slotsUsed: 4,
	slotsRemaining: 26,
	maxDepth: 1,
	slotSecondsBusy: 2383603.2,
	utilisation: 0.9853,
	phases: [
		{
			cycle: 1,
			label: 'build_up',
			blueprintTypeIds: [46179, 46182],
			slots: 2,
			purchases: [planItem(4312, 'Oxygen Fuel Block', 1172, 15418.29, 5860), ...planRaw],
			jobCost: 14915526.16
		},
		{
			cycle: 2,
			label: 'steady',
			blueprintTypeIds: [46204, 46179, 46182],
			slots: 4,
			purchases: [planItem(4312, 'Oxygen Fuel Block', 2364, 15418.29, 11820), ...planRaw],
			jobCost: 35971829.82
		}
	],
	startup: { mode: 'buy', reused: [], buy: { initialInvestment: 479332528.63, cycles: 2 }, step0: null },
	purchasesPerCycle: [
		{
			typeId: 4312,
			name: 'Oxygen Fuel Block',
			quantity: 2364,
			unitPrice: 15418.29,
			total: 36448837.56,
			fees: 546732.56,
			shipping: 0,
			volume: 11820,
			availableAtInputHub: 1235880,
			dailyVolumeSharePct: 0.0563
		},
		{
			typeId: 16635,
			name: 'Evaporite Deposits',
			quantity: 11712,
			unitPrice: 2734.46,
			total: 32025995.52,
			fees: 480389.93,
			shipping: 0,
			volume: 585.6,
			availableAtInputHub: 4802211,
			dailyVolumeSharePct: 0.0911
		},
		{
			typeId: 16636,
			name: 'Silicates',
			quantity: 11712,
			unitPrice: 4513.1,
			total: 52857427.2,
			fees: 792861.41,
			shipping: 0,
			volume: 585.6,
			availableAtInputHub: 3961022,
			dailyVolumeSharePct: 0.1045
		},
		{
			typeId: 16638,
			name: 'Titanium',
			quantity: 11712,
			unitPrice: 3255.03,
			total: 38122911.36,
			fees: 571843.67,
			shipping: 0,
			volume: 585.6,
			availableAtInputHub: 2730118,
			dailyVolumeSharePct: 0.0782
		},
		{
			typeId: 16641,
			name: 'Chromium',
			quantity: 11712,
			unitPrice: 648.43,
			total: 7594412.16,
			fees: 113916.18,
			shipping: 0,
			volume: 585.6,
			availableAtInputHub: 6520447,
			dailyVolumeSharePct: 0.0467
		}
	],
	initialPurchases: [
		{
			typeId: 4312,
			name: 'Oxygen Fuel Block',
			quantity: 3536,
			unitPrice: 15418.29,
			total: 54519073.44,
			fees: 817786.1,
			shipping: 0,
			volume: 17680
		},
		{
			typeId: 16635,
			name: 'Evaporite Deposits',
			quantity: 23424,
			unitPrice: 2734.46,
			total: 64051991.04,
			fees: 960779.87,
			shipping: 0,
			volume: 1171.2
		},
		{
			typeId: 16636,
			name: 'Silicates',
			quantity: 23424,
			unitPrice: 4513.1,
			total: 105714854.4,
			fees: 1585722.82,
			shipping: 0,
			volume: 1171.2
		},
		{
			typeId: 16638,
			name: 'Titanium',
			quantity: 23424,
			unitPrice: 3255.03,
			total: 76245822.72,
			fees: 1143687.34,
			shipping: 0,
			volume: 1171.2
		},
		{
			typeId: 16641,
			name: 'Chromium',
			quantity: 23424,
			unitPrice: 648.43,
			total: 15188824.32,
			fees: 227832.36,
			shipping: 0,
			volume: 1171.2
		}
	],
	formulasToBuy: [
		{ blueprintTypeId: 46204, count: 2, unitPrice: 29270153.28 },
		{ blueprintTypeId: 46179, count: 1, unitPrice: 18771817.5 },
		{ blueprintTypeId: 46182, count: 1, unitPrice: 30676674.17 }
	],
	outputsPerCycle: [
		{
			typeId: 16671,
			name: 'Titanium Carbide',
			quantity: 2440000,
			unitPrice: 118.46,
			total: 289042400,
			fees: 14741162.4,
			shipping: 0,
			volume: 24400,
			dailyVolumeSharePct: 12.3242
		}
	],
	surplusPerCycle: [
		{
			typeId: 16658,
			name: 'Silicon Diborite',
			quantity: 184,
			unitPrice: 5644.84,
			total: 1038650.56,
			fees: 0,
			shipping: 0,
			volume: 36.8
		},
		{
			typeId: 16654,
			name: 'Titanium Chromide',
			quantity: 184,
			unitPrice: 3375.95,
			total: 621174.8,
			fees: 0,
			shipping: 0,
			volume: 36.8
		}
	],
	totals: {
		recurringInvestment: 205527157.38,
		initialInvestment: 479332528.63,
		formulaCost: 107988798.23,
		jobCostPerCycle: 35971829.82,
		outputNetPerCycle: 274301237.6,
		profitPerCycle: 68774080.22,
		profitPerDay: 9824868.6,
		profitPerSlotDay: 2456217.15,
		marginPct: 23.7938
	},
	missingPrices: [],
	warnings: []
};
