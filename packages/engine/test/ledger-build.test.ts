import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTANTS } from '../src/constants.ts';
import { buildLedger, expectedProfit, runLedger } from '../src/ledger/build.ts';
import { jobMaterialModifier, manufacturingMaterialModifier } from '../src/ledger/facility.ts';
import {
	TrackingSettings,
	type LedgerContract,
	type LedgerCorrection,
	type LedgerJob,
	type LedgerManualEntry,
	type LedgerJobStatus,
	type LedgerTransaction,
	type PricedContract,
	type PricedContractItem,
	type PricedTrade,
	type ReferencePriceFn
} from '../src/ledger/types.ts';
import type { Dataset } from '../src/types.ts';
import { dataset as baseDataset } from './fixtures/dataset.ts';
import {
	AZBEL,
	L_SET_AMMUNITION_ME_II,
	L_SET_REACTOR_EFFICIENCY_II,
	SPIKE_S,
	TATARA,
	industry
} from './fixtures/industry.ts';

const TITANIUM_CHROMIDE_FORMULA = 46182;
const SILICON_DIBORITE_FORMULA = 46179;
const TITANIUM_CARBIDE_FORMULA = 46204;
const OXYGEN_FUEL_BLOCK = 4312;
const TITANIUM_CHROMIDE = 16654;
const SILICON_DIBORITE = 16658;
const TITANIUM_CARBIDE = 16671;
// Titanium Chromide inputs (besides fuel): 100 each per run.
const TITANIUM = 16638;
const CHROMIUM = 16641;
// Silicon Diborite inputs (besides fuel): 100 each per run.
const SILICON = 16635;
const DIBORITE = 16636;
const FERNITE_CARBIDE = 16679;
/** Hand-made blueprint taking 13 Titanium Chromide per run. */
const TEST_COMPONENT_BLUEPRINT = 90_001;
/** Spike S Blueprint (SDE): 75 Fernite Carbide and 150 Titanium Carbide per run. */
const SPIKE_S_BLUEPRINT = 12619;

const dataset: Dataset = {
	...baseDataset,
	manufacturing: [
		{
			blueprintTypeId: SPIKE_S_BLUEPRINT,
			productTypeId: 12618,
			productQuantity: 5000,
			materials: [
				{ typeId: FERNITE_CARBIDE, quantity: 75 },
				{ typeId: TITANIUM_CARBIDE, quantity: 150 }
			]
		},
		{
			blueprintTypeId: TEST_COMPONENT_BLUEPRINT,
			productTypeId: 90_002,
			productQuantity: 1,
			materials: [{ typeId: TITANIUM_CHROMIDE, quantity: 13 }]
		}
	]
};

const MARKET_SOURCE = { kind: 'market', text: 'Market', needsReview: false } as const;

function trade(
	id: number,
	at: number,
	typeId: number,
	quantity: number,
	isBuy: boolean,
	netUnitPrice: number,
	extra: Partial<PricedTrade> = {}
): PricedTrade {
	return {
		ref: `transaction:${id}`,
		at,
		typeId,
		quantity,
		isBuy,
		unitPrice: netUnitPrice,
		tax: 0,
		taxSource: 'none',
		brokerFee: 0,
		brokerFeeSource: 'none',
		netUnitPrice,
		source: MARKET_SOURCE,
		transfer: false,
		...extra
	};
}

function contract(
	id: number,
	at: number,
	direction: PricedContract['direction'],
	items: Omit<PricedContractItem, 'source'>[]
): PricedContract {
	return {
		ref: `contract:${id}`,
		contractId: id,
		at,
		direction,
		iskIn: 0,
		impliedPct: null,
		items: items.map((item) => ({
			...item,
			source: { kind: 'contract_single', text: 'Contract', needsReview: false }
		})),
		needsReview: false
	};
}

function job(
	jobId: number,
	blueprintTypeId: number,
	runs: number,
	startDate: number,
	endDate: number,
	status: LedgerJobStatus = 'delivered',
	cost: number | null = 0,
	materialModifier = 1
): LedgerJob {
	return { jobId, blueprintTypeId, runs, status, cost, startDate, endDate, facilityId: 1, materialModifier };
}

function manufacturingJob(
	jobId: number,
	blueprintTypeId: number,
	runs: number,
	startDate: number,
	status: LedgerJobStatus = 'delivered',
	materialModifier = 1
): LedgerJob {
	return {
		...job(jobId, blueprintTypeId, runs, startDate, startDate + 1000, status, 500, materialModifier),
		activity: 'manufacturing'
	};
}

function manual(entryId: number, at: number, typeId: number, quantity: number, unitPrice: number) {
	return { entryId, at, typeId, quantity, unitPrice } satisfies LedgerManualEntry;
}

const noPrices: ReferencePriceFn = () => null;

function build(input: {
	jobs?: LedgerJob[];
	trades?: PricedTrade[];
	contracts?: PricedContract[];
	corrections?: LedgerCorrection[];
	manualEntries?: LedgerManualEntry[];
	buyPrice?: ReferencePriceFn;
	manufacturingUse?: 'buy_value' | 'zero';
	now?: number;
}) {
	return buildLedger({
		dataset,
		settings: TrackingSettings.parse({ manufacturingUse: input.manufacturingUse }),
		jobs: input.jobs ?? [],
		trades: input.trades ?? [],
		contracts: input.contracts ?? [],
		corrections: input.corrections ?? [],
		manualEntries: input.manualEntries ?? [],
		buyPrice: input.buyPrice ?? noPrices,
		now: input.now ?? 1_000_000
	});
}

/**
 * Inputs of one Titanium Chromide run bought at `at` (ids `firstId`..`firstId + 2`):
 * 5 fuel × 20 + 100 titanium × 10 + 100 chromium × 5 = 100 + 1000 + 500 = 1600 ISK.
 */
function titaniumChromideInputs(firstId: number, at: number): PricedTrade[] {
	return [
		trade(firstId, at, OXYGEN_FUEL_BLOCK, 5, true, 20),
		trade(firstId + 1, at, TITANIUM, 100, true, 10),
		trade(firstId + 2, at, CHROMIUM, 100, true, 5)
	];
}

describe('buildLedger', () => {
	it('consumes three purchases FIFO across two jobs', () => {
		const result = build({
			trades: [
				trade(1, 1000, TITANIUM, 150, true, 10),
				trade(2, 2000, TITANIUM, 100, true, 12),
				trade(3, 3000, TITANIUM, 100, true, 15),
				trade(4, 1000, OXYGEN_FUEL_BLOCK, 1000, true, 20),
				trade(5, 1000, CHROMIUM, 1000, true, 5)
			],
			jobs: [
				job(1, TITANIUM_CHROMIDE_FORMULA, 1, 4000, 5000, 'delivered', 1000),
				job(2, TITANIUM_CHROMIDE_FORMULA, 2, 6000, 7000, 'delivered', 2000)
			]
		});
		const [first, second] = result.jobs;
		// Job 1: 5 fuel × 20 + 100 titanium from the first lot × 10 + 100 chromium × 5 = 1600.
		expect(first.inputCost).toBe(1600);
		// (1600 + 1000) ÷ 200 units.
		expect(first.unitCost).toBe(13);
		// Job 2: 10 fuel × 20 = 200; titanium 50 × 10 + 100 × 12 + 50 × 15 = 2450; chromium 200 × 5 = 1000.
		expect(second.inputCost).toBe(3650);
		// (3650 + 2000) ÷ 400 units.
		expect(second.unitCost).toBe(14.125);
		const titaniumUses = result.uses.filter(
			(u) => u.useRef === 'job:2' && result.lots[u.lotId - 1].typeId === TITANIUM
		);
		expect(titaniumUses.map((u) => [u.lotId, u.quantity, u.unitCost])).toEqual([
			[1, 50, 10],
			// Lots 2 and 3 are the fuel and chromium bought with lot 1 at 1000.
			[4, 100, 12],
			[5, 50, 15]
		]);
		expect(result.lots[4].remaining).toBe(50);
		const outputs = result.lots.filter((l) => l.origin === 'job');
		expect(outputs.map((l) => [l.originRef, l.typeId, l.quantity, l.acquiredAt, l.source.kind])).toEqual([
			['job:1', TITANIUM_CHROMIDE, 200, 5000, 'production'],
			['job:2', TITANIUM_CHROMIDE, 400, 7000, 'production']
		]);
		expect(first.flags).toEqual([]);
		// Lot ids are 1-based in creation order.
		expect(result.lots.map((l) => l.lotId)).toEqual(result.lots.map((_, i) => i + 1));
	});

	it('values a shortfall at the buy value at job start, and a job_input correction replaces it', () => {
		const trades = [
			trade(1, 1000, OXYGEN_FUEL_BLOCK, 5, true, 20),
			trade(2, 1000, TITANIUM, 60, true, 10),
			trade(3, 1000, CHROMIUM, 100, true, 5)
		];
		const jobs = [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 2000, 3000)];
		const asked: [number, number][] = [];
		const buyPrice: ReferencePriceFn = (typeId, at) => {
			asked.push([typeId, at]);
			return typeId === TITANIUM ? { unitPrice: 11, label: 'Jita 4-4 buy on 2026-10-10' } : null;
		};

		const market = build({ trades, jobs, buyPrice });
		// 40 titanium missing: priced at 11 at the job's start.
		expect(asked).toEqual([[TITANIUM, 2000]]);
		const fallback = market.lots.find((l) => l.origin === 'market')!;
		expect(fallback).toMatchObject({
			typeId: TITANIUM,
			acquiredAt: 2000,
			quantity: 40,
			remaining: 0,
			unitCost: 11,
			originRef: 'job:1',
			source: { kind: 'market_fallback', needsReview: false }
		});
		expect(fallback.source.text).toBe(
			'No purchase found: buy value at job start (Jita 4-4 buy on 2026-10-10)'
		);
		expect(market.uses.filter((u) => u.lotId === fallback.lotId)).toEqual([
			{ lotId: fallback.lotId, useKind: 'job', useRef: 'job:1', quantity: 40, unitCost: 11 }
		]);
		// 100 + 60 × 10 + 40 × 11 + 500 = 1640.
		expect(market.jobs[0].inputCost).toBe(1640);
		expect(market.jobs[0].flags).toEqual(['market_fallback']);

		const corrected = build({
			trades,
			jobs,
			buyPrice,
			corrections: [{ targetKind: 'job_input', targetRef: `job:1:${TITANIUM}`, unitPrice: 9 }]
		});
		const correctedLot = corrected.lots.find((l) => l.originRef === 'job:1' && l.typeId === TITANIUM)!;
		expect(correctedLot).toMatchObject({ origin: 'correction', unitCost: 9, quantity: 40 });
		expect(correctedLot.source.kind).toBe('correction');
		// 100 + 600 + 40 × 9 + 500 = 1560.
		expect(corrected.jobs[0].inputCost).toBe(1560);
		// The only missing input now has the user's price: the job is no longer a market estimate.
		expect(corrected.jobs[0].flags).toEqual([]);
	});

	it('flags inputs with no purchase and no buy price as unpriced (valued 0)', () => {
		const result = build({
			trades: [trade(1, 1000, OXYGEN_FUEL_BLOCK, 5, true, 20)],
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 2000, 3000, 'delivered', 400)]
		});
		const fallbacks = result.lots.filter((l) => l.origin === 'market');
		expect(fallbacks.map((l) => [l.typeId, l.quantity, l.unitCost])).toEqual([
			[TITANIUM, 100, 0],
			[CHROMIUM, 100, 0]
		]);
		// Only the fuel was bought: 5 × 20; output (100 + 400) ÷ 200.
		expect(result.jobs[0].inputCost).toBe(100);
		expect(result.jobs[0].unitCost).toBe(2.5);
		expect(result.jobs[0].flags).toEqual(['market_fallback', 'unpriced_input']);
	});

	/**
	 * Raw inputs bought at 0: fuel 15 × 20, titanium 100 × 10, chromium 100 × 5, silicon 100 × 8, diborite 100 × 7.
	 * Job 10 (Titanium Chromide, cost 100): 100 + 1000 + 500 = 1600 → (1600 + 100) ÷ 200 = 8.5 per unit.
	 * Job 11 (Silicon Diborite, cost 200): 100 + 800 + 700 = 1600 → (1600 + 200) ÷ 200 = 9 per unit.
	 * Job 12 (Titanium Carbide, cost 300): 100 + 100 × 8.5 + 100 × 9 = 1850 → (1850 + 300) ÷ 10000 = 0.215.
	 * Sale of 10000 at 0.3 net = 3000 → realized 3000 − 2150 = 850.
	 */
	function chainInputs() {
		return {
			trades: [
				trade(1, 0, OXYGEN_FUEL_BLOCK, 15, true, 20),
				trade(2, 0, TITANIUM, 100, true, 10),
				trade(3, 0, CHROMIUM, 100, true, 5),
				trade(4, 0, SILICON, 100, true, 8),
				trade(5, 0, DIBORITE, 100, true, 7),
				trade(6, 5000, TITANIUM_CARBIDE, 10000, false, 0.3)
			],
			jobs: [
				job(10, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 100),
				job(11, SILICON_DIBORITE_FORMULA, 1, 1000, 2000, 'delivered', 200),
				job(12, TITANIUM_CARBIDE_FORMULA, 1, 3000, 4000, 'delivered', 300)
			]
		};
	}

	it('carries intermediate costs through a chain into the composite sale', () => {
		const result = build(chainInputs());
		const [chromide, diborite, carbide] = result.jobs;
		expect(chromide).toMatchObject({
			unitCost: 8.5,
			outputQty: 200,
			usedQty: 100,
			unsoldQty: 100,
			soldQty: 0
		});
		expect(chromide.realizedProfit).toBe(0);
		expect(diborite).toMatchObject({ unitCost: 9, outputQty: 200, usedQty: 100, unsoldQty: 100, soldQty: 0 });
		expect(diborite.realizedProfit).toBe(0);
		expect(carbide.inputCost).toBe(1850);
		expect(carbide.unitCost).toBeCloseTo(0.215, 12);
		expect(carbide).toMatchObject({
			outputTypeId: TITANIUM_CARBIDE,
			outputQty: 10000,
			soldQty: 10000,
			unsoldQty: 0
		});
		expect(carbide.salesNet).toBeCloseTo(3000, 6);
		expect(carbide.realizedProfit).toBeCloseTo(850, 6);
		const intermediateUses = result.uses.filter(
			(u) =>
				u.useRef === 'job:12' &&
				[TITANIUM_CHROMIDE, SILICON_DIBORITE].includes(result.lots[u.lotId - 1].typeId)
		);
		expect(intermediateUses.map((u) => [u.quantity, u.unitCost])).toEqual([
			[100, 8.5],
			[100, 9]
		]);
	});

	it('gives the same result for shuffled inputs', () => {
		const { trades, jobs } = chainInputs();
		const expected = build({ trades, jobs });
		const shuffled = build({
			trades: [trades[4], trades[1], trades[5], trades[0], trades[3], trades[2]],
			jobs: [jobs[2], jobs[0], jobs[1]]
		});
		expect(shuffled).toEqual(expected);
		const reversed = build({ trades: [...trades].reverse(), jobs: [...jobs].reverse() });
		expect(reversed).toEqual(expected);
	});

	it('realizes profit on the sold part and values the rest with expectedProfit', () => {
		const result = build({
			trades: [...titaniumChromideInputs(1, 0), trade(9, 3000, TITANIUM_CHROMIDE, 50, false, 20)],
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 1000)]
		});
		const [result1] = result.jobs;
		// Unit cost (1600 + 1000) ÷ 200 = 13; 50 sold at 20 → 1000 − 650 = 350.
		expect(result1).toMatchObject({
			soldQty: 50,
			salesNet: 1000,
			unsoldQty: 150,
			unitCost: 13,
			realizedProfit: 350
		});
		// 350 + 150 × (18 − 13) = 1100.
		expect(expectedProfit(result1, 18)).toBe(1100);
		expect(expectedProfit(result1, null)).toBeNull();
	});

	it('ignores sale units beyond the lots held, and expectedProfit equals realized when all sold', () => {
		const result = build({
			trades: [...titaniumChromideInputs(1, 0), trade(9, 3000, TITANIUM_CHROMIDE, 300, false, 20)],
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 1000)]
		});
		const [result1] = result.jobs;
		// Only the 200 made are tracked: 200 × 20 − 200 × 13 = 1400.
		expect(result1).toMatchObject({ soldQty: 200, salesNet: 4000, unsoldQty: 0, realizedProfit: 1400 });
		expect(expectedProfit(result1, null)).toBe(1400);
	});

	it('books a cancelled job as a loss of inputs and cost', () => {
		const result = build({
			trades: titaniumChromideInputs(1, 0),
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'cancelled', 1000)]
		});
		expect(result.lots.some((l) => l.origin === 'job')).toBe(false);
		expect(result.jobs[0]).toMatchObject({ inputCost: 1600, jobCost: 1000, outputQty: 0, unitCost: null });
		// −(1600 + 1000).
		expect(result.jobs[0].realizedProfit).toBe(-2600);
		expect(result.jobs[0].flags).toEqual(['cancelled']);
	});

	it('consumes inputs of a running job without output', () => {
		const result = build({
			trades: titaniumChromideInputs(1, 0),
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 10_000, 'active', 1000)],
			now: 5000
		});
		expect(result.lots.some((l) => l.origin === 'job')).toBe(false);
		expect(result.jobs[0]).toMatchObject({
			inputCost: 1600,
			outputQty: 0,
			unitCost: null,
			realizedProfit: 0
		});
		expect(result.jobs[0].flags).toEqual(['running']);
	});

	it('gives output for an active job past its end date', () => {
		const result = build({
			trades: titaniumChromideInputs(1, 0),
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 5000, 'active', null)],
			now: 6000
		});
		const output = result.lots.find((l) => l.origin === 'job')!;
		// No cost: 1600 ÷ 200 = 8.
		expect(output).toMatchObject({ acquiredAt: 5000, quantity: 200, unitCost: 8 });
		expect(result.jobs[0]).toMatchObject({ outputQty: 200, unsoldQty: 200, jobCost: 0 });
		expect(result.jobs[0].flags).toEqual(['no_cost']);
	});

	it('uses a purchase made in the same ms as the job start', () => {
		// `transaction:*` sorts after `job:*` by ref; acquisitions still come first.
		const result = build({
			trades: titaniumChromideInputs(1, 1000),
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000)]
		});
		expect(result.lots.some((l) => l.origin === 'market')).toBe(false);
		expect(result.jobs[0].inputCost).toBe(1600);
		expect(result.jobs[0].flags).toEqual([]);
	});

	it('ignores transfer trades', () => {
		const result = build({
			trades: [
				trade(1, 0, TITANIUM, 100, true, 1, { transfer: true }),
				trade(2, 0, OXYGEN_FUEL_BLOCK, 100, true, 20),
				trade(3, 500, OXYGEN_FUEL_BLOCK, 50, false, 30, { transfer: true })
			]
		});
		expect(result.lots.map((l) => [l.typeId, l.remaining])).toEqual([[OXYGEN_FUEL_BLOCK, 100]]);
		expect(result.uses).toEqual([]);
	});

	it('consumes FIFO for contract sales and acquires from contract purchases', () => {
		const result = build({
			trades: [trade(1, 1000, TITANIUM, 100, true, 10), trade(2, 2000, TITANIUM, 100, true, 12)],
			contracts: [
				contract(7, 3000, 'sell', [{ typeId: TITANIUM, quantity: 150, incoming: false, unitPrice: 15 }]),
				contract(8, 2500, 'buy', [{ typeId: CHROMIUM, quantity: 40, incoming: true, unitPrice: 6 }]),
				contract(9, 2600, 'transfer', [{ typeId: CHROMIUM, quantity: 40, incoming: true, unitPrice: 0 }])
			]
		});
		expect(result.uses.map((u) => [u.lotId, u.useKind, u.useRef, u.quantity])).toEqual([
			[1, 'sale', 'contract:7', 100],
			[2, 'sale', 'contract:7', 50]
		]);
		expect(result.lots.map((l) => [l.typeId, l.origin, l.originRef, l.remaining, l.unitCost])).toEqual([
			[TITANIUM, 'transaction', 'transaction:1', 0, 10],
			[TITANIUM, 'transaction', 'transaction:2', 50, 12],
			[CHROMIUM, 'contract', 'contract:8', 40, 6]
		]);
	});

	it('counts contract sales of a job output with the item unit price', () => {
		const result = build({
			trades: titaniumChromideInputs(1, 0),
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 1000)],
			contracts: [
				contract(5, 3000, 'swap', [
					{ typeId: TITANIUM_CHROMIDE, quantity: 100, incoming: false, unitPrice: 16 },
					{ typeId: SILICON, quantity: 10, incoming: true, unitPrice: 50 }
				])
			]
		});
		// 100 × 16 − 100 × 13 = 300.
		expect(result.jobs[0]).toMatchObject({
			soldQty: 100,
			salesNet: 1600,
			unsoldQty: 100,
			realizedProfit: 300
		});
		expect(result.lots.find((l) => l.typeId === SILICON)).toMatchObject({ origin: 'contract', quantity: 10 });
	});

	it('flags a formula missing from the dataset', () => {
		const result = build({
			trades: titaniumChromideInputs(1, 0),
			jobs: [job(1, 99_999, 1, 1000, 2000, 'delivered', 500)]
		});
		expect(result.uses).toEqual([]);
		expect(result.jobs[0]).toMatchObject({ inputCost: 0, jobCost: 500, outputTypeId: null, outputQty: 0 });
		expect(result.jobs[0].flags).toEqual(['unknown_formula']);
	});
});

describe('buildLedger with purchases entered by hand', () => {
	const DAY = 86_400_000;
	const START = Date.UTC(2026, 9, 6, 12);
	const purchases = [trade(1, 0, OXYGEN_FUEL_BLOCK, 5, true, 20), trade(2, 0, CHROMIUM, 100, true, 5)];
	const jobs = [job(1, TITANIUM_CHROMIDE_FORMULA, 1, START, START + DAY, 'delivered', 0)];
	const buyPrice: ReferencePriceFn = (typeId) =>
		typeId === TITANIUM ? { unitPrice: 11, label: 'Jita 4-4 buy on 2026-10-06' } : null;

	it('fills a job input with an entry dated before the job start', () => {
		const result = build({
			trades: purchases,
			jobs,
			buyPrice,
			manualEntries: [manual(7, START - DAY, TITANIUM, 100, 9)]
		});
		const lot = result.lots.find((l) => l.origin === 'manual')!;
		expect(lot).toEqual({
			lotId: 3,
			typeId: TITANIUM,
			acquiredAt: START - DAY,
			quantity: 100,
			remaining: 0,
			unitCost: 9,
			origin: 'manual',
			originRef: 'manual:7',
			source: { kind: 'manual', text: 'Entered by you on 2026-10-05', needsReview: false }
		});
		expect(result.lots.some((l) => l.origin === 'market')).toBe(false);
		// 5 × 20 + 100 × 9 + 100 × 5 = 1500.
		expect(result.jobs[0].inputCost).toBe(1500);
		expect(result.jobs[0].flags).toEqual([]);
	});

	it('does not use an entry dated after the job start (the shortfall takes the buy value)', () => {
		const result = build({
			trades: purchases,
			jobs,
			buyPrice,
			manualEntries: [manual(7, START + 1, TITANIUM, 100, 9)]
		});
		expect(result.lots.find((l) => l.origin === 'manual')).toMatchObject({ remaining: 100 });
		expect(result.lots.find((l) => l.origin === 'market')).toMatchObject({ typeId: TITANIUM, unitCost: 11 });
		// 100 + 100 × 11 + 500 = 1700.
		expect(result.jobs[0].inputCost).toBe(1700);
		expect(result.jobs[0].flags).toEqual(['market_fallback']);
	});

	it('ignores entries without units', () => {
		expect(build({ manualEntries: [manual(1, 0, TITANIUM, 0, 9)] }).lots).toEqual([]);
	});
});

describe('buildLedger with manufacturing jobs', () => {
	/** Titanium Chromide buy value. */
	const chromideBuy: ReferencePriceFn = (typeId) =>
		typeId === TITANIUM_CHROMIDE ? { unitPrice: 20, label: 'Jita 4-4 buy' } : null;

	/**
	 * Job 1 makes 200 Titanium Chromide at (1600 + 1000) ÷ 200 = 13 each (lot 4); manufacturing job 2
	 * takes 10 runs × 13 = 130 of them at 3000.
	 */
	function scenario(extra: { trades?: PricedTrade[]; jobs?: LedgerJob[] } = {}) {
		return {
			trades: [...titaniumChromideInputs(1, 0), ...(extra.trades ?? [])],
			jobs: [
				job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 1000),
				...(extra.jobs ?? [manufacturingJob(2, TEST_COMPONENT_BLUEPRINT, 10, 3000)])
			]
		};
	}

	it('realizes used output at the buy value at the manufacturing start (buy_value)', () => {
		const result = build({ ...scenario(), buyPrice: chromideBuy });
		expect(result.uses.filter((u) => u.useKind === 'manufacturing')).toEqual([
			{ lotId: 4, useKind: 'manufacturing', useRef: 'job:2', quantity: 130, unitCost: 13, unitValue: 20 }
		]);
		// Only the reaction job has a result.
		expect(result.jobs.map((j) => j.jobId)).toEqual([1]);
		// 130 × 20 = 2600; 2600 − 130 × 13 = 910.
		expect(result.jobs[0]).toMatchObject({
			manufacturedQty: 130,
			manufacturedValue: 2600,
			soldQty: 0,
			usedQty: 0,
			unsoldQty: 70,
			realizedProfit: 910
		});
		// No output lot, fallback lot or cost for the manufacturing job.
		expect(result.lots.map((l) => l.originRef)).toEqual([
			'transaction:1',
			'transaction:2',
			'transaction:3',
			'job:1'
		]);
	});

	it('counts used output at its cost (zero), also with buy_value when there is no buy price', () => {
		for (const result of [
			build({ ...scenario(), buyPrice: chromideBuy, manufacturingUse: 'zero' }),
			build({ ...scenario(), buyPrice: noPrices, manufacturingUse: 'buy_value' })
		]) {
			expect(result.uses.find((u) => u.useKind === 'manufacturing')).toMatchObject({ unitValue: 13 });
			// 130 × 13 = 1690; no profit, no loss.
			expect(result.jobs[0]).toMatchObject({
				manufacturedQty: 130,
				manufacturedValue: 1690,
				unsoldQty: 70,
				realizedProfit: 0
			});
		}
	});

	it('adds a sale of part of the output to the manufactured part', () => {
		const result = build({
			...scenario({ trades: [trade(9, 4000, TITANIUM_CHROMIDE, 50, false, 18)] }),
			buyPrice: chromideBuy
		});
		// 50 × 18 + 130 × 20 − (50 + 130) × 13 = 900 + 2600 − 2340 = 1160.
		expect(result.jobs[0]).toMatchObject({
			soldQty: 50,
			salesNet: 900,
			manufacturedQty: 130,
			manufacturedValue: 2600,
			unsoldQty: 20,
			realizedProfit: 1160
		});
		// 1160 + 20 × (18 − 13) = 1260.
		expect(expectedProfit(result.jobs[0], 18)).toBe(1260);
	});

	it('consumes materials of a cancelled manufacturing job (taken when installed)', () => {
		const result = build({
			...scenario({ jobs: [manufacturingJob(2, TEST_COMPONENT_BLUEPRINT, 10, 3000, 'cancelled')] }),
			buyPrice: chromideBuy
		});
		expect(result.jobs[0]).toMatchObject({ manufacturedQty: 130, unsoldQty: 70, realizedProfit: 910 });
	});

	it('ignores a shortfall (untracked stock) and output made after the manufacturing start', () => {
		const short = build({
			...scenario({ jobs: [manufacturingJob(2, TEST_COMPONENT_BLUEPRINT, 20, 3000)] }),
			buyPrice: chromideBuy
		});
		// 260 needed, 200 held: no fallback lot.
		expect(short.lots).toHaveLength(4);
		// 200 × 20 − 200 × 13 = 1400.
		expect(short.jobs[0]).toMatchObject({ manufacturedQty: 200, unsoldQty: 0, realizedProfit: 1400 });

		const early = build({
			...scenario({ jobs: [manufacturingJob(2, TEST_COMPONENT_BLUEPRINT, 10, 1500)] }),
			buyPrice: chromideBuy
		});
		expect(early.uses.some((u) => u.useKind === 'manufacturing')).toBe(false);
		expect(early.jobs[0]).toMatchObject({ manufacturedQty: 0, unsoldQty: 200, realizedProfit: 0 });
	});

	it('ignores manufacturing blueprints that take no reaction product', () => {
		const result = build({
			...scenario({ jobs: [manufacturingJob(2, 681, 10, 3000)] }),
			buyPrice: chromideBuy
		});
		expect(result.uses.some((u) => u.useKind === 'manufacturing')).toBe(false);
		expect(result.jobs.map((j) => j.jobId)).toEqual([1]);
	});

	it('takes materials scaled by ME 10 and an Azbel with an L-Set ammunition rig in nullsec', () => {
		const mm = manufacturingMaterialModifier(10, industry, SPIKE_S, {
			structureTypeId: AZBEL,
			rigs: [L_SET_AMMUNITION_ME_II],
			band: 'nullsec'
		});
		// 0.9 × 0.99 × (1 − 0.024 × 2.1) = 0.891 × 0.9496.
		expect(mm).toBeCloseTo(0.8460936, 12);
		const result = build({
			trades: [trade(1, 0, TITANIUM_CARBIDE, 2000, true, 1), trade(2, 0, FERNITE_CARBIDE, 1000, true, 2)],
			jobs: [manufacturingJob(5, SPIKE_S_BLUEPRINT, 10, 1000, 'delivered', mm)]
		});
		// Fernite: 10 × 75 × mm = 634.57 → 635; Titanium Carbide: 10 × 150 × mm = 1269.14 → 1270.
		expect(result.uses.map((u) => [result.lots[u.lotId - 1].typeId, u.quantity, u.unitValue])).toEqual([
			[FERNITE_CARBIDE, 635, 2],
			[TITANIUM_CARBIDE, 1270, 1]
		]);
		expect(result.jobs).toEqual([]);
	});

	/** `chainInputs` without the sale, plus Spike S (150 Titanium Carbide per run) at 5000. */
	function chainIntoManufacturing() {
		const buyPrice: ReferencePriceFn = (typeId) =>
			typeId === TITANIUM_CARBIDE ? { unitPrice: 0.5, label: 'Jita 4-4 buy' } : null;
		return {
			trades: [
				trade(1, 0, OXYGEN_FUEL_BLOCK, 15, true, 20),
				trade(2, 0, TITANIUM, 100, true, 10),
				trade(3, 0, CHROMIUM, 100, true, 5),
				trade(4, 0, SILICON, 100, true, 8),
				trade(5, 0, DIBORITE, 100, true, 7)
			],
			jobs: [
				job(10, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 100),
				job(11, SILICON_DIBORITE_FORMULA, 1, 1000, 2000, 'delivered', 200),
				job(12, TITANIUM_CARBIDE_FORMULA, 1, 3000, 4000, 'delivered', 300),
				manufacturingJob(20, SPIKE_S_BLUEPRINT, 1, 5000)
			],
			manualEntries: [manual(1, 4500, TITANIUM_CARBIDE, 50, 0.4)],
			buyPrice
		};
	}

	it('realizes a chain in the reaction job whose output goes to manufacturing', () => {
		const result = build(chainIntoManufacturing());
		const [chromide, diborite, carbide] = result.jobs;
		expect(result.jobs).toHaveLength(3);
		expect(chromide).toMatchObject({ usedQty: 100, manufacturedQty: 0, realizedProfit: 0 });
		expect(diborite).toMatchObject({ usedQty: 100, manufacturedQty: 0, realizedProfit: 0 });
		// Carbide unit cost 0.215 (see `chainInputs`); 150 used, the Fernite shortfall ignored.
		expect(carbide.manufacturedQty).toBe(150);
		expect(carbide.manufacturedValue).toBeCloseTo(75, 9);
		// 150 × 0.5 − 150 × 0.215 = 42.75.
		expect(carbide.realizedProfit).toBeCloseTo(42.75, 9);
		expect(carbide.unsoldQty).toBe(9850);
		// The job output (acquired at 4000) is taken before the entry (4500), FIFO.
		expect(result.lots.find((l) => l.origin === 'manual')!.remaining).toBe(50);
	});

	it('gives the same result for shuffled inputs', () => {
		const input = chainIntoManufacturing();
		const expected = build(input);
		const shuffled = build({
			...input,
			trades: [input.trades[3], input.trades[0], input.trades[4], input.trades[2], input.trades[1]],
			jobs: [input.jobs[3], input.jobs[1], input.jobs[2], input.jobs[0]]
		});
		expect(shuffled).toEqual(expected);
		const reversed = build({
			...input,
			trades: [...input.trades].reverse(),
			jobs: [...input.jobs].reverse()
		});
		expect(reversed).toEqual(expected);
	});
});

describe('reaction job material modifier', () => {
	it('feeds the job input quantities', () => {
		// Tatara with the L-Set Reactor Efficiency II in lowsec: 1 − 0.024 × 1.
		const mm = jobMaterialModifier(
			industry,
			TITANIUM_CHROMIDE,
			{ structureTypeId: TATARA, rigs: [L_SET_REACTOR_EFFICIENCY_II], band: 'lowsec' },
			{ structure: 'athanor', meRig: 't1', teRig: 'none', reactionsSkill: 5, securityBand: 'lowsec' },
			DEFAULT_CONSTANTS
		);
		const result = build({ jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 10, 1000, 2000, 'delivered', 0, mm)] });
		// 10 runs × 5 fuel × 0.976 = 48.8 → 49; 10 × 100 × 0.976 = 976.
		expect(result.uses.map((u) => u.quantity)).toEqual([49, 976, 976]);
	});
});

describe('runLedger', () => {
	it('prices raw trades and builds the job result', () => {
		const ME = 1;
		const SELLER = 50;
		const tx = (
			transactionId: number,
			date: number,
			typeId: number,
			quantity: number,
			unitPrice: number,
			isBuy: boolean
		): LedgerTransaction => ({
			transactionId,
			sourceId: 1,
			division: null,
			date,
			typeId,
			quantity,
			unitPrice,
			isBuy,
			clientId: SELLER,
			locationId: 60003760
		});
		const strangers: LedgerContract = {
			contractId: 3,
			issuerId: 77,
			issuerCorporationId: 78,
			acceptorId: 79,
			assigneeId: 0,
			forCorporation: false,
			price: 100,
			reward: 0,
			title: null,
			dateIssued: 0,
			completedAt: 0,
			items: [{ recordId: 1, typeId: TITANIUM, quantity: 1, isIncluded: true }],
			janice: null
		};
		const result = runLedger({
			dataset,
			own: { characterIds: new Set([ME]), corporationIds: new Set() },
			settings: TrackingSettings.parse({}),
			brokerFeePct: 1,
			salesTaxPct: 2,
			ordersAvailable: new Set(),
			transactions: [
				tx(1, 0, OXYGEN_FUEL_BLOCK, 5, 20, true),
				tx(2, 0, TITANIUM, 100, 10, true),
				tx(3, 0, CHROMIUM, 100, 5, true),
				tx(4, 5000, TITANIUM_CHROMIDE, 200, 15, false)
			],
			journal: [],
			orders: [],
			contracts: [strangers],
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 384)],
			corrections: [],
			manualEntries: [],
			referencePrice: noPrices,
			buyPrice: noPrices,
			now: 10_000
		});
		expect(result.trades).toHaveLength(4);
		// A contract between strangers is dropped.
		expect(result.contracts).toEqual([]);
		// Buys with the estimated 1% broker fee: 101 + 1010 + 505 = 1616; (1616 + 384) ÷ 200 = 10.
		expect(result.jobs[0].inputCost).toBeCloseTo(1616, 9);
		expect(result.jobs[0].unitCost).toBeCloseTo(10, 9);
		// Sale: 3000 − 2% tax 60 − 1% fee 30 = 2910; realized 2910 − 2000 = 910.
		expect(result.jobs[0].salesNet).toBeCloseTo(2910, 9);
		expect(result.jobs[0].realizedProfit).toBeCloseTo(910, 9);
	});

	it('values input shortfalls with buyPrice (not referencePrice) and passes manual entries through', () => {
		const result = runLedger({
			dataset,
			own: { characterIds: new Set([1]), corporationIds: new Set() },
			settings: TrackingSettings.parse({}),
			brokerFeePct: 1,
			salesTaxPct: 2,
			ordersAvailable: new Set(),
			transactions: [],
			journal: [],
			orders: [],
			contracts: [],
			jobs: [job(1, TITANIUM_CHROMIDE_FORMULA, 1, 1000, 2000, 'delivered', 0)],
			corrections: [],
			manualEntries: [manual(1, 0, OXYGEN_FUEL_BLOCK, 5, 20), manual(2, 0, CHROMIUM, 100, 5)],
			referencePrice: (typeId) => (typeId === TITANIUM ? { unitPrice: 99, label: 'Reference' } : null),
			buyPrice: (typeId) => (typeId === TITANIUM ? { unitPrice: 11, label: 'Jita 4-4 buy' } : null),
			now: 10_000
		});
		expect(result.lots.map((l) => [l.typeId, l.origin, l.originRef, l.unitCost])).toEqual([
			[OXYGEN_FUEL_BLOCK, 'manual', 'manual:1', 20],
			[CHROMIUM, 'manual', 'manual:2', 5],
			[TITANIUM, 'market', 'job:1', 11],
			[TITANIUM_CHROMIDE, 'job', 'job:1', 8.5]
		]);
		// 5 × 20 + 100 × 11 + 100 × 5 = 1700.
		expect(result.jobs[0].inputCost).toBe(1700);
	});
});
