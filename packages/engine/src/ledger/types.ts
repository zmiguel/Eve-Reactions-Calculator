import { z } from 'zod';

/**
 * Profit tracking ledger: shared types of the pure pricing (`pricing.ts`) and FIFO (`build.ts`) code.
 * Every money value is ISK as a number; every time is unix ms. Refs are strings so ids of different
 * kinds never collide: `transaction:<id>`, `contract:<id>`, `job:<id>`.
 */

/** User settings of profit tracking (`users.tracking_json`). */
export const TrackingSettings = z
	.object({
		/** How multi-item contracts are checked and split (`contractPrices`, step 3). */
		contractRule: z
			.object({
				/** Hub id of the reference prices (`jita`, …, or a structure hub the user can read). */
				hubId: z.string().default('jita'),
				basis: z.enum(['buy', 'sell', 'split']).default('buy'),
				/** Usual contract total as a % of the reference total. */
				expectedPct: z.number().min(1).max(200).default(100),
				/** Allowed distance (percentage points) from `expectedPct` before a contract needs review. */
				tolerancePct: z.number().min(0).max(50).default(5)
			})
			.prefault({}),
		/**
		 * Per facility (`facility_id` as a string key), for reaction and manufacturing jobs, what EVE could
		 * not tell: `structureTypeId` (an `IndustryStructure`, or 0 = NPC station or other, no bonus) when
		 * the structure could not be looked up; `rigs` (installed rig type ids, at most the structure's rig
		 * slots; `[]` = none) when they could not be read from corporation assets. What EVE tells wins.
		 */
		facilities: z
			.record(
				z.string().regex(/^\d+$/),
				z.object({
					structureTypeId: z.number().int().min(0).optional(),
					rigs: z.array(z.number().int().positive()).max(8).optional()
				})
			)
			.default({}),
		/**
		 * ME assumed for a manufacturing blueprint (blueprint type id as a string key) when the job's
		 * blueprint could not be read from EVE; absent = `DEFAULT_BLUEPRINT_ME`.
		 */
		blueprintMe: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(10)).default({}),
		/**
		 * Reaction output taken by a manufacturing job is used (realized) at once: `buy_value` = it counts at
		 * the buy price on the day the job started (profit = buy value − cost); `zero` = at its cost (no
		 * profit, no loss).
		 */
		manufacturingUse: z.enum(['buy_value', 'zero']).default('buy_value'),
		/** Period the Overview and Jobs tabs open on. */
		defaultPeriod: z.enum(['7', '30', '90', '365', 'all']).default('30')
	})
	.prefault({});
export type TrackingSettings = z.infer<typeof TrackingSettings>;

/** ME assumed for a manufacturing blueprint that could not be read (researched originals are usually ME 10). */
export const DEFAULT_BLUEPRINT_ME = 10;

/** Where a price came from; `text` is shown to the user verbatim. */
export type PriceSourceKind =
	/** A market transaction (fees and tax per `FeeSource`). */
	| 'market'
	/** A contract with one item type: exact. */
	| 'contract_single'
	/** Split by a Janice appraisal linked in the contract title. */
	| 'janice'
	/** Split by the contract rule's reference prices; the implied % is within tolerance. */
	| 'rule_match'
	/** Split by the contract rule's reference prices; the implied % is outside tolerance. */
	| 'rule_outside'
	/**
	 * A tracked item of a contract that also holds untracked items, valued at its reference price × the
	 * rule's expected % (capped at the contract amount).
	 */
	| 'contract_mixed'
	/**
	 * An item the ledger does not track (outside `trackedTypeIds`: no reaction or fuel block job uses
	 * it): recorded and shown, but it makes no lot or sale and never needs review.
	 */
	| 'untracked'
	/** Could not be priced reliably (no reference price, or items went both ways). */
	| 'review'
	/** The user's correction. */
	| 'correction'
	/** Made by one of the user's jobs: inputs plus job cost. */
	| 'production'
	/** No purchase record: buy value at job start. */
	| 'market_fallback'
	/** A purchase the user entered. */
	| 'manual';

export interface PriceSource {
	kind: PriceSourceKind;
	/** Shown verbatim, e.g. "Janice appraisal abc123 (Jita 4-4, buy, 2026-10-10 12:00 UTC)". */
	text: string;
	/** The contract or input is listed under "Needs review". */
	needsReview: boolean;
}

/** Where a fee or tax amount came from. */
export type FeeSource = 'journal' | 'estimated' | 'none';

/** A reference unit price for `typeId` at a time (contract rule hub; basis per lookup). */
export interface ReferencePrice {
	unitPrice: number;
	/** E.g. "Jita 4-4 buy on 2026-10-10"; used in price source texts. */
	label: string;
}
/** Sync lookup the caller prepares from price history (null: no price known). */
export type ReferencePriceFn = (typeId: number, at: number) => ReferencePrice | null;

/** The user's own characters and the corporations of their connections. */
export interface OwnParties {
	characterIds: ReadonlySet<number>;
	corporationIds: ReadonlySet<number>;
}

// ---- Raw inputs (from the tracked_* tables) ----

export interface LedgerTransaction {
	transactionId: number;
	/** Wallet the row was read from: connection id and corporation division (null = personal). */
	sourceId: number;
	division: number | null;
	date: number;
	typeId: number;
	quantity: number;
	unitPrice: number;
	isBuy: boolean;
	clientId: number;
	locationId: number;
}

export interface LedgerJournalRow {
	refId: number;
	sourceId: number;
	division: number | null;
	date: number;
	refType: string;
	/** Signed as in ESI (negative = paid). */
	amount: number | null;
	contextId: number | null;
	contextIdType: string | null;
}

export interface LedgerOrder {
	orderId: number;
	sourceId: number;
	division: number | null;
	typeId: number;
	isBuy: boolean;
	price: number;
	volumeTotal: number;
	volumeRemain: number;
	issued: number;
	locationId: number;
	state: 'open' | 'closed' | 'expired' | 'cancelled';
}

export interface LedgerContractItem {
	recordId: number;
	typeId: number;
	quantity: number;
	/** true: the issuer gives it; false: the issuer asks for it. */
	isIncluded: boolean;
}

/** Minimal Janice appraisal (prices per unit, `pricePercentage` not applied). */
export interface LedgerJaniceAppraisal {
	code: string;
	marketName: string;
	pricing: string;
	datasetTime: number;
	items: { typeId: number; buyPrice: number; splitPrice: number; sellPrice: number }[];
}

export interface LedgerContract {
	contractId: number;
	issuerId: number;
	issuerCorporationId: number;
	acceptorId: number;
	assigneeId: number;
	forCorporation: boolean;
	price: number | null;
	reward: number | null;
	title: string | null;
	dateIssued: number;
	/** When the items changed hands (`date_completed`, else `date_accepted`, else `date_issued`). */
	completedAt: number;
	items: LedgerContractItem[];
	janice: LedgerJaniceAppraisal | null;
}

export type LedgerJobStatus = 'active' | 'paused' | 'ready' | 'delivered' | 'cancelled' | 'reverted';

/** ESI `activity_id` of a tracked job: reactions (9, or the SDE's 11) and manufacturing (1). */
export type LedgerJobActivity = 'reaction' | 'manufacturing';

export interface LedgerJob {
	jobId: number;
	/**
	 * `manufacturing` jobs of a blueprint making a reaction material (`makes: 'material'`, fuel blocks)
	 * produce like reaction jobs: inputs at `startDate`, output and a job result at the end. Other
	 * `manufacturing` jobs only take reaction output (their blueprint's reaction-product materials from
	 * `Dataset.manufacturing`) at `startDate`; they have no job result, output or cost in the ledger.
	 * Absent = `reaction`.
	 */
	activity?: LedgerJobActivity;
	blueprintTypeId: number;
	runs: number;
	status: LedgerJobStatus;
	/** ESI `cost` (equals its journal rows, B22 probe); null counts as 0 and flags the job. */
	cost: number | null;
	startDate: number;
	endDate: number;
	facilityId: number;
	/**
	 * Material multiplier of the job (`facility.ts`): reactions `jobMaterialModifier(...)`; manufacturing
	 * `manufacturingMaterialModifier(...)` (blueprint ME × the facility's structure and rig bonuses).
	 */
	materialModifier: number;
}

/** A purchase the user entered (`manual_entries`): a batch acquired at `at`. */
export interface LedgerManualEntry {
	entryId: number;
	at: number;
	typeId: number;
	quantity: number;
	unitPrice: number;
}

export type CorrectionTarget = 'transaction' | 'contract_item' | 'job_input';

/**
 * A user correction. `targetRef`: `transaction:<transactionId>`, `contract:<contractId>:<typeId>`,
 * `job:<jobId>:<typeId>` (a job input's unit cost).
 */
export interface LedgerCorrection {
	targetKind: CorrectionTarget;
	targetRef: string;
	unitPrice: number;
}

// ---- Priced events (output of pricing.ts, input of build.ts) ----

/** A market transaction with its net unit value: buys include fees, sales are net of tax and fees. */
export interface PricedTrade {
	ref: string;
	at: number;
	typeId: number;
	quantity: number;
	isBuy: boolean;
	/** Gross `unit_price`. */
	unitPrice: number;
	/** Whole-transaction amounts (≥ 0). */
	tax: number;
	taxSource: FeeSource;
	brokerFee: number;
	brokerFeeSource: FeeSource;
	/** Buy: (gross + fees) ÷ quantity; sale: (gross − tax − fees) ÷ quantity; a correction replaces it. */
	netUnitPrice: number;
	source: PriceSource;
	/** The other party is an own party: no purchase or sale. */
	transfer: boolean;
}

export type ContractDirection = 'buy' | 'sell' | 'swap' | 'transfer';

export interface PricedContractItem {
	typeId: number;
	quantity: number;
	/** true: items came to the user; false: the user gave them. */
	incoming: boolean;
	unitPrice: number;
	source: PriceSource;
}

export interface PricedContract {
	ref: string;
	contractId: number;
	at: number;
	direction: ContractDirection;
	/** ISK to the user (negative = paid). */
	iskIn: number;
	/** Contract total ÷ reference total (step 3), else null. */
	impliedPct: number | null;
	/** One row per type and direction (records of one type merged). */
	items: PricedContractItem[];
	needsReview: boolean;
}

/** Unmatched `brokers_fee` / `market_provider_tax` rows, reported per period, not allocated. */
export interface UnallocatedFee {
	refId: number;
	date: number;
	amount: number;
}

// ---- Ledger output (build.ts) ----

export type LotOrigin = 'transaction' | 'contract' | 'job' | 'market' | 'correction' | 'manual';
export type UseKind = 'job' | 'sale' | 'manufacturing';

export interface LedgerLot {
	/** 1-based, in creation order (deterministic). */
	lotId: number;
	typeId: number;
	acquiredAt: number;
	quantity: number;
	remaining: number;
	unitCost: number;
	origin: LotOrigin;
	/**
	 * `transaction:<id>`, `contract:<id>`, `job:<id>` (output of that job, or the market fallback for that
	 * job's input), `manual:<entryId>` (a purchase the user entered).
	 */
	originRef: string;
	source: PriceSource;
}

export interface LedgerUse {
	lotId: number;
	useKind: UseKind;
	/** `job:<id>` (a reaction or manufacturing job) or the sale's `transaction:<id>` / `contract:<id>`. */
	useRef: string;
	quantity: number;
	unitCost: number;
	/**
	 * `manufacturing` uses only: what one unit counted for (buy value at the manufacturing job's start, or
	 * `unitCost` with `manufacturingUse: 'zero'` or without a buy price).
	 */
	unitValue?: number;
}

export type JobFlag =
	/** Still running: inputs consumed, no output yet. */
	| 'running'
	/** Cancelled or reverted: inputs and cost lost, no output. */
	| 'cancelled'
	/** Some input had no purchase record and was valued at the buy value at job start. */
	| 'market_fallback'
	/** Some input had no purchase record and no buy price either (valued 0). */
	| 'unpriced_input'
	/** ESI gave no `cost`. */
	| 'no_cost'
	/** Formula not in the dataset (no inputs or output known). */
	| 'unknown_formula';

export interface JobResult {
	jobId: number;
	inputCost: number;
	jobCost: number;
	outputTypeId: number | null;
	outputQty: number;
	/** Units of the output sold (market or contract), from this job's lot. */
	soldQty: number;
	/** Net proceeds of those units. */
	salesNet: number;
	/** Units consumed by later own reaction or fuel block jobs. */
	usedQty: number;
	/** Units taken by the user's manufacturing jobs (realized at once, see `manufacturingUse`). */
	manufacturedQty: number;
	/** What those units counted for: buy value at the manufacturing job's start, or their unit cost. */
	manufacturedValue: number;
	/** Output units still held (not sold, used or manufactured). */
	unsoldQty: number;
	/** (inputCost + jobCost) ÷ outputQty; null without output. */
	unitCost: number | null;
	/**
	 * salesNet + manufacturedValue − (soldQty + manufacturedQty) × unitCost; for a cancelled job
	 * −(inputCost + jobCost).
	 */
	realizedProfit: number;
	flags: JobFlag[];
}

export interface LedgerResult {
	lots: LedgerLot[];
	uses: LedgerUse[];
	jobs: JobResult[];
	trades: PricedTrade[];
	contracts: PricedContract[];
	unallocatedFees: UnallocatedFee[];
}
