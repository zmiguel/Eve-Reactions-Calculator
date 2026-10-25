import { requiredQuantity } from '../formulas.ts';
import { trackedTypeIds } from '../inventory.ts';
import type { Dataset, ManufacturingBlueprint, Material } from '../types.ts';
import { priceContract, priceTrades } from './pricing.ts';
import {
	type JobFlag,
	type JobResult,
	type LedgerContract,
	type LedgerCorrection,
	type LedgerJob,
	type LedgerJournalRow,
	type LedgerLot,
	type LedgerManualEntry,
	type LedgerOrder,
	type LedgerResult,
	type LedgerTransaction,
	type LedgerUse,
	type LotOrigin,
	type OwnParties,
	type PriceSource,
	type PricedContract,
	type PricedTrade,
	type ReferencePriceFn,
	type TrackingSettings
} from './types.ts';

export interface BuildLedgerInput {
	dataset: Dataset;
	/** Reads `manufacturingUse`. */
	settings: TrackingSettings;
	/**
	 * Reaction jobs (`activity` absent or `reaction`) and manufacturing jobs: those of a blueprint making
	 * a reaction material (`makes: 'material'`, fuel blocks) produce like reactions; the others only take
	 * reaction output and the tracked materials of `consumingMaterials`.
	 */
	jobs: readonly LedgerJob[];
	/**
	 * Per manufacturing blueprint (not a fuel block blueprint): its tracked materials other than reaction
	 * products, per run at base. Its jobs take them FIFO at their start as a quantity only (`consumed`
	 * uses: no value, no profit; a shortfall is ignored). Absent = none.
	 */
	consumingMaterials?: ReadonlyMap<number, readonly Material[]>;
	trades: readonly PricedTrade[];
	contracts: readonly PricedContract[];
	corrections: readonly LedgerCorrection[];
	manualEntries: readonly LedgerManualEntry[];
	/**
	 * Buy price at the contract rule's hub: values job inputs without a purchase (at job start) and, with
	 * `manufacturingUse: 'buy_value'`, reaction output taken by manufacturing jobs.
	 */
	buyPrice: ReferencePriceFn;
	now: number;
}

export interface BuildLedgerResult {
	lots: LedgerLot[];
	uses: LedgerUse[];
	/** Producing jobs (reactions and fuel block manufacturing), by job id. */
	jobs: JobResult[];
}

/** What a producing job takes per run and makes per run. */
interface Recipe {
	/** Product name, for the output's price source text. */
	name: string;
	product: Material;
	materials: readonly Material[];
}

/** Event phases at one time: acquisitions, then uses, then outputs of jobs that ended when they started. */
const ACQUIRE = 0;
const USE = 1;
const LATE_OUTPUT = 2;

type LedgerEvent =
	| {
			at: number;
			phase: number;
			ref: string;
			order: number;
			kind: 'acquire';
			typeId: number;
			quantity: number;
			unitCost: number;
			origin: LotOrigin;
			source: PriceSource;
	  }
	| {
			at: number;
			phase: number;
			ref: string;
			order: number;
			kind: 'sale';
			typeId: number;
			quantity: number;
			netUnitValue: number;
	  }
	| {
			at: number;
			phase: number;
			ref: string;
			order: number;
			kind: 'jobStart';
			job: LedgerJob;
			recipe: Recipe;
	  }
	| {
			at: number;
			phase: number;
			ref: string;
			order: number;
			kind: 'jobOutput';
			job: LedgerJob;
			recipe: Recipe;
	  }
	| {
			at: number;
			phase: number;
			ref: string;
			order: number;
			kind: 'manufacturingStart';
			job: LedgerJob;
			/** Reaction-product materials (`Dataset.manufacturing`), valued. */
			valued: readonly Material[];
			/** Other tracked materials (`consumingMaterials`), a quantity only. */
			consumed: readonly Material[];
	  };

interface JobState {
	/** Undefined: a reaction formula not in the dataset. */
	recipe: Recipe | undefined;
	inputCost: number;
	marketFallback: boolean;
	unpriced: boolean;
	outputLot: LedgerLot | null;
}

/** Fixed flag order, so results do not depend on the order flags were found in. */
const FLAG_ORDER: readonly JobFlag[] = [
	'running',
	'cancelled',
	'market_fallback',
	'unpriced_input',
	'no_cost',
	'unknown_formula'
];

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD`. */
function formatDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM-DD HH:MM UTC`. */
function formatTime(ms: number): string {
	const d = new Date(ms);
	return `${formatDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function isFinished(job: LedgerJob, now: number): boolean {
	if (job.status === 'delivered' || job.status === 'ready') return true;
	if (job.status === 'active' || job.status === 'paused') return job.endDate <= now;
	return false;
}

/**
 * Rebuilds the FIFO ledger from priced trades and contracts, the user's purchases entered by hand and
 * their jobs. Events run in time order; at one time acquisitions come before uses, then by ref, so any
 * input order gives the same result. Reaction jobs and fuel block manufacturing jobs (blueprints with
 * `makes: 'material'`) take their inputs at their start and add their output when they end; other
 * manufacturing jobs only take materials at their start: reaction output (and any other lot of their
 * blueprint's reaction-product materials), realized at once, and their other tracked materials
 * (`consumingMaterials`) as a quantity only.
 */
export function buildLedger(input: BuildLedgerInput): BuildLedgerResult {
	const { dataset, now, buyPrice } = input;
	const buyValueUse = input.settings.manufacturingUse === 'buy_value';
	const reactionRecipes = new Map(
		dataset.reactions.map((r): [number, Recipe] => [
			r.blueprintTypeId,
			{ name: r.name, product: r.product, materials: r.materials }
		])
	);
	const materialRecipes = new Map<number, Recipe>();
	const consumingBlueprints = new Map<number, ManufacturingBlueprint>();
	for (const bp of dataset.manufacturing ?? []) {
		if (bp.makes !== 'material') {
			consumingBlueprints.set(bp.blueprintTypeId, bp);
			continue;
		}
		materialRecipes.set(bp.blueprintTypeId, {
			name: bp.productName ?? dataset.types[bp.productTypeId]?.name ?? `Type ${bp.productTypeId}`,
			product: { typeId: bp.productTypeId, quantity: bp.productQuantity },
			materials: bp.materials
		});
	}
	const producingJobs = input.jobs.filter(
		(job) => job.activity !== 'manufacturing' || materialRecipes.has(job.blueprintTypeId)
	);
	const inputCorrections = new Map<string, number>();
	for (const c of input.corrections) {
		if (c.targetKind === 'job_input') inputCorrections.set(c.targetRef, c.unitPrice);
	}

	const events: LedgerEvent[] = [];
	for (const entry of input.manualEntries) {
		if (entry.quantity <= 0) continue;
		events.push({
			at: entry.at,
			phase: ACQUIRE,
			ref: `manual:${entry.entryId}`,
			order: 0,
			kind: 'acquire',
			typeId: entry.typeId,
			quantity: entry.quantity,
			unitCost: entry.unitPrice,
			origin: 'manual',
			source: { kind: 'manual', text: `Entered by you on ${formatDate(entry.at)}`, needsReview: false }
		});
	}
	// Untracked types are recorded with their price but are no part of FIFO.
	for (const t of input.trades) {
		if (t.transfer || t.quantity <= 0 || t.source.kind === 'untracked') continue;
		if (t.isBuy) {
			events.push({
				at: t.at,
				phase: ACQUIRE,
				ref: t.ref,
				order: 0,
				kind: 'acquire',
				typeId: t.typeId,
				quantity: t.quantity,
				unitCost: t.netUnitPrice,
				origin: t.source.kind === 'correction' ? 'correction' : 'transaction',
				source: t.source
			});
		} else {
			events.push({
				at: t.at,
				phase: USE,
				ref: t.ref,
				order: 0,
				kind: 'sale',
				typeId: t.typeId,
				quantity: t.quantity,
				netUnitValue: t.netUnitPrice
			});
		}
	}
	for (const c of input.contracts) {
		if (c.direction === 'transfer') continue;
		for (const item of c.items) {
			if (item.quantity <= 0 || item.source.kind === 'untracked') continue;
			// Several rows of one contract: by type, then incoming first (one row per type and direction).
			const order = item.typeId * 2 + (item.incoming ? 0 : 1);
			if (item.incoming && (c.direction === 'buy' || c.direction === 'swap')) {
				events.push({
					at: c.at,
					phase: ACQUIRE,
					ref: c.ref,
					order,
					kind: 'acquire',
					typeId: item.typeId,
					quantity: item.quantity,
					unitCost: item.unitPrice,
					origin: item.source.kind === 'correction' ? 'correction' : 'contract',
					source: item.source
				});
			} else if (!item.incoming && (c.direction === 'sell' || c.direction === 'swap')) {
				events.push({
					at: c.at,
					phase: USE,
					ref: c.ref,
					order,
					kind: 'sale',
					typeId: item.typeId,
					quantity: item.quantity,
					netUnitValue: item.unitPrice
				});
			}
		}
	}

	for (const job of input.jobs) {
		if (job.activity !== 'manufacturing' || materialRecipes.has(job.blueprintTypeId)) continue;
		const valued = consumingBlueprints.get(job.blueprintTypeId)?.materials ?? [];
		const consumed = input.consumingMaterials?.get(job.blueprintTypeId) ?? [];
		// Materials are taken when the job is installed, whatever happened to it later.
		if (valued.length > 0 || consumed.length > 0) {
			events.push({
				at: job.startDate,
				phase: USE,
				ref: `job:${job.jobId}`,
				order: 0,
				kind: 'manufacturingStart',
				job,
				valued,
				consumed
			});
		}
	}

	const states = new Map<number, JobState>();
	for (const job of producingJobs) {
		const recipe = (job.activity === 'manufacturing' ? materialRecipes : reactionRecipes).get(
			job.blueprintTypeId
		);
		states.set(job.jobId, { recipe, inputCost: 0, marketFallback: false, unpriced: false, outputLot: null });
		if (!recipe) continue;
		const ref = `job:${job.jobId}`;
		events.push({ at: job.startDate, phase: USE, ref, order: 0, kind: 'jobStart', job, recipe });
		if (isFinished(job, now)) {
			// An output can only follow its own inputs: a job that ended when it started yields after them.
			const late = job.endDate <= job.startDate;
			events.push({
				at: late ? job.startDate : job.endDate,
				phase: late ? LATE_OUTPUT : ACQUIRE,
				ref,
				order: 0,
				kind: 'jobOutput',
				job,
				recipe
			});
		}
	}
	// Refs compare by code unit (not locale) so the order is the same everywhere.
	events.sort(
		(a, b) =>
			a.at - b.at || a.phase - b.phase || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || a.order - b.order
	);

	const lots: LedgerLot[] = [];
	const uses: LedgerUse[] = [];
	/** Open lots per type in creation order; `head` skips the used-up ones. */
	const openLots = new Map<number, { lots: LedgerLot[]; head: number }>();
	/** Value per unit of each sale (net) and manufacturing use (same index as `uses`; null for job uses). */
	const useValues: (number | null)[] = [];

	const addLot = (lot: Omit<LedgerLot, 'lotId' | 'remaining'>): LedgerLot => {
		const created: LedgerLot = { lotId: lots.length + 1, ...lot, remaining: lot.quantity };
		lots.push(created);
		let open = openLots.get(lot.typeId);
		if (!open) openLots.set(lot.typeId, (open = { lots: [], head: 0 }));
		open.lots.push(created);
		return created;
	};

	const useLot = (
		lot: LedgerLot,
		quantity: number,
		useKind: LedgerUse['useKind'],
		useRef: string,
		value: number | null
	) => {
		lot.remaining -= quantity;
		const use: LedgerUse = { lotId: lot.lotId, useKind, useRef, quantity, unitCost: lot.unitCost };
		if (useKind === 'manufacturing' && value !== null) use.unitValue = value;
		uses.push(use);
		useValues.push(value);
	};

	/** Takes up to `quantity` FIFO; returns the units that were not there. */
	const consume = (
		typeId: number,
		quantity: number,
		useKind: LedgerUse['useKind'],
		useRef: string,
		valueOf: ((lot: LedgerLot) => number) | null,
		onUse: (lot: LedgerLot, quantity: number) => void
	): number => {
		let left = quantity;
		const open = openLots.get(typeId);
		while (open && left > 0 && open.head < open.lots.length) {
			const lot = open.lots[open.head];
			const take = Math.min(lot.remaining, left);
			if (take > 0) {
				useLot(lot, take, useKind, useRef, valueOf ? valueOf(lot) : null);
				onUse(lot, take);
				left -= take;
			}
			if (lot.remaining <= 0) open.head++;
		}
		return left;
	};

	for (const e of events) {
		switch (e.kind) {
			case 'acquire':
				addLot({
					typeId: e.typeId,
					acquiredAt: e.at,
					quantity: e.quantity,
					unitCost: e.unitCost,
					origin: e.origin,
					originRef: e.ref,
					source: e.source
				});
				break;
			case 'sale': {
				// Units beyond the lots held are untracked stock: ignored.
				const value = e.netUnitValue;
				consume(
					e.typeId,
					e.quantity,
					'sale',
					e.ref,
					() => value,
					() => {}
				);
				break;
			}
			case 'manufacturingStart': {
				const { job } = e;
				for (const material of e.valued) {
					const needed = requiredQuantity(job.runs, material.quantity, job.materialModifier);
					const buy = buyValueUse ? buyPrice(material.typeId, job.startDate) : null;
					// A shortfall is untracked stock: ignored, no fallback lot.
					consume(
						material.typeId,
						needed,
						'manufacturing',
						e.ref,
						(lot) => (buy ? buy.unitPrice : lot.unitCost),
						() => {}
					);
				}
				for (const material of e.consumed) {
					const needed = requiredQuantity(job.runs, material.quantity, job.materialModifier);
					// No value; a shortfall is untracked stock: ignored.
					consume(material.typeId, needed, 'consumed', e.ref, null, () => {});
				}
				break;
			}
			case 'jobStart': {
				const { job, recipe } = e;
				const state = states.get(job.jobId)!;
				for (const material of recipe.materials) {
					const needed = requiredQuantity(job.runs, material.quantity, job.materialModifier);
					const shortfall = consume(material.typeId, needed, 'job', e.ref, null, (lot, qty) => {
						state.inputCost += qty * lot.unitCost;
					});
					if (shortfall <= 0) continue;
					const corrected = inputCorrections.get(`${e.ref}:${material.typeId}`);
					const reference = buyPrice(material.typeId, job.startDate);
					let unitCost: number;
					let origin: LotOrigin;
					let source: PriceSource;
					if (corrected !== undefined) {
						// The user's price for the missing units: no longer a market estimate.
						unitCost = corrected;
						origin = 'correction';
						source = { kind: 'correction', text: 'Your correction', needsReview: false };
					} else if (reference) {
						state.marketFallback = true;
						unitCost = reference.unitPrice;
						origin = 'market';
						source = {
							kind: 'market_fallback',
							text: `No purchase found: buy value at job start (${reference.label})`,
							// Common at the start of tracking (inputs bought earlier); the job's flag marks it.
							needsReview: false
						};
					} else {
						state.marketFallback = true;
						state.unpriced = true;
						unitCost = 0;
						origin = 'market';
						source = {
							kind: 'market_fallback',
							text: `No purchase found and no buy value at job start (${formatTime(job.startDate)})`,
							needsReview: true
						};
					}
					const lot = addLot({
						typeId: material.typeId,
						acquiredAt: job.startDate,
						quantity: shortfall,
						unitCost,
						origin,
						originRef: e.ref,
						source
					});
					useLot(lot, shortfall, 'job', e.ref, null);
					state.inputCost += shortfall * unitCost;
					openLots.get(material.typeId)!.head++;
				}
				break;
			}
			case 'jobOutput': {
				const { job, recipe } = e;
				const state = states.get(job.jobId)!;
				const quantity = job.runs * recipe.product.quantity;
				if (quantity <= 0) break;
				state.outputLot = addLot({
					typeId: recipe.product.typeId,
					acquiredAt: e.at,
					quantity,
					unitCost: (state.inputCost + (job.cost ?? 0)) / quantity,
					origin: 'job',
					originRef: e.ref,
					source: {
						kind: 'production',
						text: `${recipe.name} job finished ${formatTime(job.endDate)}: inputs plus job cost`,
						needsReview: false
					}
				});
				break;
			}
		}
	}

	// Sales, later producing jobs and manufacturing per output lot.
	const lotOutcome = new Map<
		number,
		{
			soldQty: number;
			salesNet: number;
			usedQty: number;
			manufacturedQty: number;
			manufacturedValue: number;
			consumedQty: number;
		}
	>();
	uses.forEach((use, i) => {
		let outcome = lotOutcome.get(use.lotId);
		if (!outcome) {
			outcome = {
				soldQty: 0,
				salesNet: 0,
				usedQty: 0,
				manufacturedQty: 0,
				manufacturedValue: 0,
				consumedQty: 0
			};
			lotOutcome.set(use.lotId, outcome);
		}
		if (use.useKind === 'sale') {
			outcome.soldQty += use.quantity;
			outcome.salesNet += use.quantity * useValues[i]!;
		} else if (use.useKind === 'manufacturing') {
			outcome.manufacturedQty += use.quantity;
			outcome.manufacturedValue += use.quantity * useValues[i]!;
		} else if (use.useKind === 'consumed') {
			outcome.consumedQty += use.quantity;
		} else {
			outcome.usedQty += use.quantity;
		}
	});

	const jobs = [...producingJobs]
		.sort((a, b) => a.jobId - b.jobId)
		.map((job): JobResult => {
			const state = states.get(job.jobId)!;
			const { recipe } = state;
			const jobCost = job.cost ?? 0;
			const flags = new Set<JobFlag>();
			if (job.cost === null) flags.add('no_cost');
			if (!recipe) flags.add('unknown_formula');
			if (state.marketFallback) flags.add('market_fallback');
			if (state.unpriced) flags.add('unpriced_input');
			const cancelled = job.status === 'cancelled' || job.status === 'reverted';
			if (cancelled) flags.add('cancelled');
			else if (!isFinished(job, now)) flags.add('running');

			const lot = state.outputLot;
			const outcome = lot ? lotOutcome.get(lot.lotId) : undefined;
			const soldQty = outcome?.soldQty ?? 0;
			const salesNet = outcome?.salesNet ?? 0;
			const manufacturedQty = outcome?.manufacturedQty ?? 0;
			const manufacturedValue = outcome?.manufacturedValue ?? 0;
			const unitCost = lot ? lot.unitCost : null;
			const realizedProfit = cancelled
				? -(state.inputCost + jobCost)
				: unitCost === null
					? 0
					: salesNet + manufacturedValue - (soldQty + manufacturedQty) * unitCost;
			return {
				jobId: job.jobId,
				inputCost: state.inputCost,
				jobCost,
				outputTypeId: recipe ? recipe.product.typeId : null,
				outputQty: lot ? lot.quantity : 0,
				soldQty,
				salesNet,
				usedQty: outcome?.usedQty ?? 0,
				manufacturedQty,
				manufacturedValue,
				unsoldQty: lot ? lot.remaining + (outcome?.consumedQty ?? 0) : 0,
				unitCost,
				realizedProfit,
				flags: FLAG_ORDER.filter((f) => flags.has(f))
			};
		});

	return { lots, uses, jobs };
}

export interface RunLedgerInput {
	dataset: Dataset;
	own: OwnParties;
	settings: TrackingSettings;
	brokerFeePct: number;
	salesTaxPct: number;
	ordersAvailable: ReadonlySet<number>;
	transactions: readonly LedgerTransaction[];
	journal: readonly LedgerJournalRow[];
	orders: readonly LedgerOrder[];
	contracts: readonly LedgerContract[];
	jobs: readonly LedgerJob[];
	/** See `BuildLedgerInput.consumingMaterials`. */
	consumingMaterials?: ReadonlyMap<number, readonly Material[]>;
	corrections: readonly LedgerCorrection[];
	manualEntries: readonly LedgerManualEntry[];
	/** Contract rule reference prices (hub and basis): splits multi-item contracts. */
	referencePrice: ReferencePriceFn;
	/** Buy prices at the contract rule's hub (see `BuildLedgerInput.buyPrice`). */
	buyPrice: ReferencePriceFn;
	now: number;
}

/**
 * Prices the raw trades and contracts, then rebuilds the ledger from them. Only types of
 * `trackedTypeIds(dataset)` (every type a reaction uses, plus the fuel block blueprints and their
 * materials) are tracked; the rest is priced as `untracked` and stays out of the ledger.
 */
export function runLedger(input: RunLedgerInput): LedgerResult {
	const tracked = trackedTypeIds(input.dataset);
	const { trades, unallocatedFees } = priceTrades({
		transactions: input.transactions,
		journal: input.journal,
		orders: input.orders,
		own: input.own,
		brokerFeePct: input.brokerFeePct,
		salesTaxPct: input.salesTaxPct,
		ordersAvailable: input.ordersAvailable,
		corrections: input.corrections,
		tracked
	});
	const contracts: PricedContract[] = [];
	for (const c of input.contracts) {
		const priced = priceContract(
			c,
			input.own,
			input.settings,
			input.referencePrice,
			input.corrections,
			tracked
		);
		if (priced) contracts.push(priced);
	}
	const built = buildLedger({
		dataset: input.dataset,
		settings: input.settings,
		jobs: input.jobs,
		consumingMaterials: input.consumingMaterials,
		trades,
		contracts,
		corrections: input.corrections,
		manualEntries: input.manualEntries,
		buyPrice: input.buyPrice,
		now: input.now
	});
	return { ...built, trades, contracts, unallocatedFees };
}

/**
 * Realized profit plus the unsold units at today's net unit value; null when the unsold units cannot
 * be valued (no unit cost or no current value).
 */
export function expectedProfit(job: JobResult, netUnitValueNow: number | null): number | null {
	if (job.unsoldQty === 0) return job.realizedProfit;
	if (job.unitCost === null || netUnitValueNow === null) return null;
	return job.realizedProfit + job.unsoldQty * (netUnitValueNow - job.unitCost);
}
