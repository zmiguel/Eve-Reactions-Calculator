import type { ChainAllocation, ChainNode, LineItem, StepMaterial } from '@reactions/engine';

const job = (eiv: number) => ({
	eiv,
	systemCost: eiv * 0.0412,
	facilityTax: eiv * 0.01,
	scc: eiv * 0.04,
	total: eiv * 0.0912
});

export const bought = (
	typeId: number,
	name: string,
	quantity: number,
	unitPrice: number | null
): StepMaterial => {
	const item: LineItem = {
		typeId,
		name,
		quantity,
		unitPrice,
		total: unitPrice === null ? 0 : quantity * unitPrice,
		fees: unitPrice === null ? 0 : quantity * unitPrice * 0.015,
		shipping: 0,
		volume: quantity * 0.2
	};
	return { ...item, source: 'buy' };
};

const fromChain = (
	typeId: number,
	name: string,
	quantity: number,
	blueprintTypeId: number
): StepMaterial => ({
	source: 'chain',
	typeId,
	name,
	quantity,
	volume: quantity * 0.2,
	blueprintTypeId
});

export function node(
	fields: Pick<ChainNode, 'blueprintTypeId' | 'name' | 'productTypeId' | 'runs' | 'depth' | 'materials'> &
		Partial<ChainNode>
): ChainNode {
	const produced = fields.quantityProduced ?? fields.runs * 200;
	const jobCost = fields.jobCost ?? job(fields.runs * 1_000_000);
	const purchases = fields.materials.filter((m) => m.source === 'buy');
	const sum = (k: 'total' | 'fees' | 'shipping') => purchases.reduce((a, m) => a + m[k], 0);
	return {
		reactor: 'composite',
		runTimeSeconds: 4924.8,
		quantityProduced: produced,
		quantityUsed: produced,
		surplus: 0,
		jobCost,
		children: [],
		step: Math.max(0, ...(fields.children ?? []).map((c) => c.step)) + 1,
		slotSeconds: fields.runs * 4924.8,
		jobRates: { costIndex: 0.0412, facilityTaxPct: 1, sccPct: 4 },
		subtotal: {
			purchaseCost: sum('total'),
			purchaseFees: sum('fees'),
			purchaseShipping: sum('shipping'),
			jobCost: jobCost.total,
			total: sum('total') + sum('fees') + sum('shipping') + jobCost.total
		},
		...fields
	};
}

/** Titanium Carbide chain shaped like the seeded defaults (122 top runs, 60-run intermediates). */
export function titaniumCarbide(prices: { titanium?: number | null } = {}): ChainNode {
	const sub = (
		blueprintTypeId: number,
		name: string,
		productTypeId: number,
		a: [number, string],
		b: [number, string],
		titanium: number | null
	) =>
		node({
			blueprintTypeId,
			name,
			productTypeId,
			runs: 60,
			depth: 1,
			quantityUsed: 11908,
			surplus: 92,
			materials: [
				bought(4312, 'Oxygen Fuel Block', 293, 18000),
				bought(a[0], a[1], 5856, titanium),
				bought(b[0], b[1], 5856, 900)
			]
		});
	return node({
		blueprintTypeId: 46204,
		name: 'Titanium Carbide',
		productTypeId: 16671,
		runs: 122,
		depth: 0,
		quantityProduced: 12200,
		materials: [
			bought(4312, 'Oxygen Fuel Block', 596, 18000),
			fromChain(16654, 'Titanium Chromide', 11908, 46182),
			fromChain(16658, 'Silicon Diborite', 11908, 46179)
		],
		children: [
			sub(
				46182,
				'Titanium Chromide',
				16654,
				[16638, 'Titanium'],
				[16641, 'Chromium'],
				prices.titanium === undefined ? 950 : prices.titanium
			),
			sub(46179, 'Silicon Diborite', 16658, [16635, 'Evaporite Deposits'], [16636, 'Silicates'], 950)
		]
	});
}

/** The same chain with optimal slots: 2 lines (2 × 122 runs) fed by one 120-run slot per intermediate. */
export function optimalTitaniumCarbide(): ChainNode {
	const tic = titaniumCarbide();
	return {
		...tic,
		runs: 244,
		runsPerSlot: [122, 122],
		quantityProduced: 24400,
		quantityUsed: 24400,
		children: tic.children.map((child) => ({
			...child,
			runs: 120,
			runsPerSlot: [120],
			quantityProduced: 24000,
			quantityUsed: 23816,
			surplus: 184,
			slotSeconds: 120 * 4924.8
		}))
	};
}

/**
 * A single-line chain building Prometium with Unrefined Prometium: 5 runs reprocessed at 55 % give 200
 * Prometium and 475 Cadmium. The Caesarium Cadmide job runs after it (step 2) so that 100 Cadmium
 * replace its purchase; 375 are sold.
 */
export function unrefinedChain(): ChainNode {
	const cadmide = node({
		blueprintTypeId: 46166,
		name: 'Caesarium Cadmide',
		productTypeId: 16663,
		runs: 1,
		depth: 1,
		step: 2,
		materials: [
			bought(4312, 'Oxygen Fuel Block', 5, 18000),
			{
				source: 'byproduct',
				typeId: 16643,
				name: 'Cadmium',
				quantity: 100,
				volume: 40,
				blueprintTypeId: 46197
			},
			bought(16647, 'Caesium', 100, 900)
		]
	});
	const unrefined = node({
		blueprintTypeId: 46197,
		name: 'Unrefined Prometium',
		productTypeId: 33336,
		runs: 5,
		depth: 1,
		quantityProduced: 5,
		materials: [
			bought(4312, 'Oxygen Fuel Block', 25, 18000),
			bought(16641, 'Chromium', 500, 900),
			bought(16643, 'Cadmium', 500, 900)
		],
		reprocess: {
			typeId: 16681,
			replacesBlueprintTypeId: 46181,
			replacesName: 'Prometium',
			yieldPct: 55,
			outputs: [
				{ typeId: 16643, name: 'Cadmium', quantity: 475, used: 100, sold: 375 },
				{ typeId: 16681, name: 'Prometium', quantity: 200, used: 200, sold: 0 }
			],
			surplus: 0
		}
	});
	return node({
		blueprintTypeId: 46209,
		name: 'Fermionic Condensates',
		productTypeId: 17317,
		runs: 2,
		depth: 0,
		materials: [
			bought(4247, 'Helium Fuel Block', 10, 18000),
			fromChain(16663, 'Caesarium Cadmide', 200, 46166),
			fromChain(16681, 'Prometium', 200, 46197)
		],
		children: [cadmide, unrefined],
		step: 3
	});
}

/** A priced purchase (1.5 % broker fee, 0.2 m³ per unit). */
export function purchase(typeId: number, name: string, quantity: number, unitPrice: number | null): LineItem {
	const total = unitPrice === null ? 0 : quantity * unitPrice;
	return {
		typeId,
		name,
		quantity,
		unitPrice,
		total,
		fees: total * 0.015,
		shipping: 0,
		volume: quantity * 0.2
	};
}
/** Slot plan matching {@link optimalTitaniumCarbide} (seeded defaults: 4924.8 s per run, 7-day cycle). */
export const TIC_ALLOCATION: ChainAllocation = {
	mode: 'optimal',
	lines: 2,
	slotsUsed: 4,
	cycleDays: 7,
	utilisation: ((244 + 240) * 4924.8) / (4 * 7 * 86400),
	slotSecondsBusy: (244 + 240) * 4924.8,
	reactions: [
		{
			blueprintTypeId: 46204,
			name: 'Titanium Carbide',
			depth: 0,
			slots: 2,
			runsPerSlot: [122, 122],
			runTimeSeconds: 4924.8,
			slotDurations: [122 * 4924.8, 122 * 4924.8],
			firstCycle: 2
		},
		{
			blueprintTypeId: 46179,
			name: 'Silicon Diborite',
			depth: 1,
			slots: 1,
			runsPerSlot: [120],
			runTimeSeconds: 4924.8,
			slotDurations: [120 * 4924.8],
			firstCycle: 1
		},
		{
			blueprintTypeId: 46182,
			name: 'Titanium Chromide',
			depth: 1,
			slots: 1,
			runsPerSlot: [120],
			runTimeSeconds: 4924.8,
			slotDurations: [120 * 4924.8],
			firstCycle: 1
		}
	],
	phases: [
		{
			cycle: 1,
			label: 'build_up',
			blueprintTypeIds: [46179, 46182],
			slots: 2,
			purchases: [purchase(4312, 'Oxygen Fuel Block', 586, 18000), purchase(16638, 'Titanium', 11712, 3000)],
			jobCost: 10_940_000
		},
		{
			cycle: 2,
			label: 'steady',
			blueprintTypeIds: [46204, 46179, 46182],
			slots: 4,
			purchases: [purchase(4312, 'Oxygen Fuel Block', 1182, 18000), purchase(16638, 'Titanium', 11712, 3000)],
			jobCost: 32_000_000
		}
	],
	initialInvestment: 1_234_000_000,
	startup: { mode: 'buy', reused: [], buy: { initialInvestment: 1_234_000_000, cycles: 2 }, step0: null }
};
