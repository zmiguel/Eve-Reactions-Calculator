/** View types of the ledger pages (`/profits/ledger` and `/profits/ledger/[typeId]`). */
import type { Paged } from '$lib/paging';

/** Where a market fee or tax amount came from (engine `FeeSource`). */
export type LedgerFeeSource = 'journal' | 'estimated' | 'none';

/** What a correction form targets: `kind` + `ref` are the form fields of the `correct`/`undo` actions. */
export type LedgerCorrectionKind = 'transaction' | 'contract_item';

/** The user's stored correction of a price (it applies once the ledger is recalculated). */
export interface LedgerCorrectionView {
	unitPrice: number;
	note: string | null;
}

/** A price computed by the ledger rebuild, with where it came from. */
export interface LedgerPriceView {
	/** Correction form fields: `transaction` + `transaction:<id>`, `contract_item` + `contract:<id>:<typeId>`. */
	kind: LedgerCorrectionKind;
	ref: string;
	/** Net unit value: purchases include fees, sales are net of tax and fees. */
	unitPrice: number;
	/** `unitPrice × quantity`. */
	total: number;
	/** Engine `PriceSourceKind` (`correction` once a correction is applied). */
	sourceKind: string;
	/** Shown verbatim. */
	sourceText: string;
	needsReview: boolean;
	/** The stored correction, if any ("Undo correction" removes it). */
	correction: LedgerCorrectionView | null;
}

/** Connection that owns a row: name, plus the wallet division name for corporation trades. */
export interface LedgerOwnerView {
	name: string;
	/** Wallet division name (or "Division n") of a corporation trade; null otherwise. */
	division: string | null;
}

export interface LedgerItemType {
	typeId: number;
	name: string;
	/** A reaction formula (blueprint icon). */
	formula: boolean;
}

export interface LedgerTradeRow extends LedgerItemType {
	kind: 'market';
	transactionId: number;
	at: number;
	owner: LedgerOwnerView;
	direction: 'bought' | 'sold' | 'transfer';
	quantity: number;
	/** ESI `unit_price` (before tax and fees). */
	grossUnitPrice: number;
	/** Whole-transaction amounts with where each came from; null when the ledger has none. */
	tax: number | null;
	taxSource: LedgerFeeSource | null;
	brokerFee: number | null;
	brokerFeeSource: LedgerFeeSource | null;
	price: LedgerPriceView;
}

export interface LedgerContractItemRow extends LedgerItemType {
	quantity: number;
	/** true: came to the user; false: left the user; null: a transfer between own parties. */
	incoming: boolean | null;
	/** Null for transfer contracts (no purchase or sale). */
	price: LedgerPriceView | null;
}

export interface LedgerContractRow {
	kind: 'contract';
	contractId: number;
	at: number;
	owner: LedgerOwnerView;
	direction: 'buy' | 'sell' | 'swap' | 'transfer';
	title: string | null;
	janiceCode: string | null;
	/** `janiceCode` is an appraisal the user gave on the ledger (not the title's link): it can be removed. */
	janiceOwn: boolean;
	/** The title links a Janice appraisal: removing the user's one prices the contract by it again. */
	titleJanice: boolean;
	/** Contract price less reward, as a positive amount of ISK. */
	total: number;
	itemCount: number;
	needsReview: boolean;
	items: LedgerContractItemRow[];
}

/** A purchase the user entered on "Add purchases" (`manual_entries`): always bought, priced as entered. */
export interface LedgerManualRow extends LedgerItemType {
	kind: 'manual';
	entryId: number;
	at: number;
	quantity: number;
	unitPrice: number;
	/** `unitPrice × quantity`. */
	total: number;
	note: string | null;
}

export type LedgerRow = LedgerTradeRow | LedgerContractRow | LedgerManualRow;

/** Days back from now (`period` query parameter); null = everything. */
export type LedgerPeriod = 7 | 30 | 90 | 365 | null;
export const LEDGER_PERIODS = [7, 30, 90, 365] as const;

export interface LedgerFilters {
	period: LedgerPeriod;
	typeId: number | null;
	/** `in`: purchases (and swaps); `out`: sales (and swaps); `transfer`: between own parties. */
	direction: 'in' | 'out' | 'transfer' | null;
	/** `manual`: purchases the user entered. */
	kind: 'market' | 'contract' | 'manual' | null;
	/** Connection (`inventory_sources.source_id`). */
	connection: number | null;
	review: boolean;
}

export interface LedgerConnectionOption {
	sourceId: number;
	name: string;
	kind: 'character' | 'corporation';
}

/** Fees and taxes of the listed rows, ISK paid (positive). */
export interface LedgerFees {
	/** Broker fees and SCC surcharges of market trades. */
	brokerFees: number;
	/** Sales tax of market sales. */
	salesTax: number;
	/** Contract broker fees and sales tax from the wallet journal. */
	contractFees: number;
	/**
	 * Market fees no tracked trade could be matched to (shown only without item, direction or review
	 * filters, for all kinds or the market kind).
	 */
	otherMarketFees: number;
	total: number;
	/** Some broker fee or sales tax was estimated from the account settings (no journal row). */
	estimated: boolean;
}

/** Totals of the rows matching the filters (every page). */
export interface LedgerSummary {
	/** Net ISK paid for purchases (fees included). */
	bought: number;
	/** Net ISK received for sales (tax and fees deducted). */
	sold: number;
	fees: LedgerFees;
	/** Rows matching the filters that need review. */
	reviewCount: number;
}

export interface LedgerPageData {
	filters: LedgerFilters;
	/** The ledger has at least one row, whatever the filters. */
	tracked: boolean;
	summary: LedgerSummary;
	/** Rows matching the filters, newest first (`page` query parameter, JSON at `/profits/data/ledger`). */
	rows: Paged<LedgerRow>;
	rebuiltAt: number | null;
	/** A recalculation is pending. */
	dirty: boolean;
	/** Prices the ledger estimated or could not set and the user has not saved yet (`/profits/ledger/reconcile`). */
	missingCount: number;
	/** Filter choices: item types present in the ledger, tracked connections. */
	types: LedgerItemType[];
	connections: LedgerConnectionOption[];
}

/**
 * Result of the `correct` and `undo` actions (`ref` = the price the form was for) and of the
 * `contractJanice` and `removeContractJanice` actions (`ref` = `contract:<contractId>`).
 */
export interface LedgerActionResult {
	action: 'correct' | 'undo' | 'contractJanice' | 'removeContractJanice';
	ref: string;
	notice?: string;
	error?: string;
	/** A rejected `correct`: the values typed, shown again in the form. */
	values?: { unitPrice: string; note: string };
	/** A rejected `contractJanice`: the link typed, shown again in the form. */
	link?: string;
}

// ---- Item page ----

export type LedgerLotOrigin = 'transaction' | 'contract' | 'job' | 'market' | 'correction' | 'manual';

/**
 * One quantity a job, a manufacturing job or a sale took from a batch. `consumed`: a manufacturing job
 * used it as a material (a quantity only: no value, no profit).
 */
export interface LedgerItemLotUse {
	kind: 'job' | 'sale' | 'manufacturing' | 'consumed';
	/** `job:<id>`, or the sale's `transaction:<id>` / `contract:<id>`. */
	ref: string;
	/** Job, manufacturing and consumed uses. */
	jobId: number | null;
	/** Formula (or fuel block blueprint) of a job use (name from the dataset; null when unknown). */
	formula: { blueprintTypeId: number; name: string } | null;
	/** Product of a manufacturing or consumed use (null when unknown). */
	product: { typeId: number; name: string } | null;
	/** Job start or sale date; null when unknown. */
	at: number | null;
	/** Sales: net unit value received (after tax and fees). */
	saleUnitPrice: number | null;
	/** Manufacturing uses: what one unit counted for (buy value at the job's start, or its unit cost). */
	unitValue: number | null;
	quantity: number;
	unitCost: number;
}

/** A batch (FIFO lot) of the item. */
export interface LedgerItemLot {
	lotId: number;
	acquiredAt: number;
	origin: LedgerLotOrigin;
	/**
	 * `job`: the job that made it; `market` / `correction`: the job whose input it priced (no purchase
	 * found); null otherwise.
	 */
	jobId: number | null;
	/** Formula name of `jobId`'s job, or its fuel block blueprint's name (from the dataset); null when unknown. */
	jobFormula: string | null;
	/** Made by a fuel block job (the user's manufacturing of fuel blocks), not a reaction job. */
	fuelBlockJob: boolean;
	/** Where the unit cost comes from, shown verbatim. */
	priceSource: string;
	quantity: number;
	remaining: number;
	unitCost: number;
	/**
	 * `job_input` correction ref (`job:<jobId>:<typeId>`) of a batch that covers a job input without a
	 * purchase (market estimate or already corrected); null for every other batch.
	 */
	correctionRef: string | null;
	/** A job input batch priced by the user's correction ("Undo correction"). */
	corrected: boolean;
	uses: LedgerItemLotUse[];
}

/** A purchase, sale or transfer of the item. */
export interface LedgerItemTrade {
	ref: string;
	kind: 'market' | 'contract';
	direction: 'in' | 'out' | 'transfer';
	at: number;
	quantity: number;
	/** Net unit price; null for transfer contracts (no price). */
	unitPrice: number | null;
	/** Engine `PriceSourceKind`; null for transfer contracts. */
	sourceKind: string | null;
	/** Shown verbatim; null for transfer contracts. */
	sourceText: string | null;
	needsReview: boolean;
	/** A market trade whose broker fee or sales tax was estimated. */
	estimatedFees: boolean;
}

/** One point of the "paid per batch" chart. */
export interface LedgerItemBatchPoint {
	at: number;
	unitCost: number;
	quantity: number;
	origin: LedgerLotOrigin;
}

export interface LedgerItemPageData {
	item: LedgerItemType;
	heldQuantity: number;
	/** Σ(remaining × unit cost) ÷ Σ remaining; null when nothing is held. */
	averagePaid: number | null;
	/** Net value of one unit today with the visitor's settings (an estimate); null without a price. */
	unitValue: number | null;
	/** `heldQuantity × unitValue − Σ(remaining × unit cost)`; null when nothing is held or without a value. */
	gain: number | null;
	/** Every batch, oldest first (chart). */
	points: LedgerItemBatchPoint[];
	/** Batches oldest first (`batches` query parameter, JSON at `/profits/data/item-batches/<typeId>`). */
	batches: Paged<LedgerItemLot>;
	/** Trades newest first (`trades` query parameter, JSON at `/profits/data/item-trades/<typeId>`). */
	trades: Paged<LedgerItemTrade>;
}

// ---- Add purchases (`/profits/ledger/add`) ----

/** An item the purchase form offers: reaction materials first, then reaction products, then the rest. */
export interface ManualItemChoice {
	typeId: number;
	name: string;
	group: 'material' | 'product' | 'other';
}

/** A purchase the user entered, as listed under the forms. */
export interface ManualEntryView extends LedgerItemType {
	entryId: number;
	at: number;
	quantity: number;
	unitPrice: number;
	total: number;
	note: string | null;
	/** Units of its batch not used or sold yet; null until the ledger is recalculated. */
	remaining: number | null;
}

/** One line of an import that can be added. */
export interface ManualImportRow {
	/** 1-based line number in the pasted text. */
	line: number;
	at: number;
	typeId: number;
	name: string;
	quantity: number;
	unitPrice: number;
}

export interface ManualImportError {
	line: number;
	message: string;
}

export interface ManualImportPreview {
	rows: ManualImportRow[];
	errors: ManualImportError[];
}

/** Values of the single purchase form, sent back when it is rejected (the form keeps them without JS). */
export interface ManualFormValues {
	item: string;
	typeId: string;
	date: string;
	quantity: string;
	unitPrice: string;
	note: string;
}

/** Result of the `add`, `check`, `import` and `remove` actions of `/profits/ledger/add`. */
export interface ManualActionResult {
	action: 'add' | 'check' | 'import' | 'remove';
	notice?: string;
	error?: string;
	/** `add` rejected: the values to show again. */
	values?: ManualFormValues;
	/** `check` / `import`: the text that was read (the import form posts it again). */
	text?: string;
	/** `check`: what an import of `text` would add, and the lines it cannot read. */
	preview?: ManualImportPreview;
	/** `remove`: the entry it was for. */
	entryId?: number;
}

export interface ManualAddPageData {
	/** Choices of the item search. */
	choices: ManualItemChoice[];
	/** Today (UTC) as `YYYY-MM-DD`: the date field's default. */
	today: string;
	/** The user's entered purchases, newest first (`page`, JSON at `/profits/data/manual-entries`). */
	entries: Paged<ManualEntryView>;
}

// ---- Missing prices (`/profits/ledger/reconcile`) ----

/** A job input without a purchase: the ledger priced it at the buy value at job start, or could not. */
export interface ReconcileInputRow {
	/** `job_input` correction ref `job:<jobId>:<typeId>`. */
	ref: string;
	item: LedgerItemType;
	/** First row of its item on this page: the item heading goes above it. */
	first: boolean;
	/** The item's rows on every page, their quantity, and how many have a buy value to confirm. */
	itemRows: number;
	itemQuantity: number;
	itemConfirmable: number;
	jobId: number;
	formula: { blueprintTypeId: number; name: string } | null;
	startedAt: number;
	quantity: number;
	/** Buy value per unit at job start; null when there was none (no price at all). */
	estimate: number | null;
	/** How the estimate was made, shown verbatim. */
	estimateText: string;
	/** The user's saved price, waiting for the ledger to be recalculated. */
	saved: LedgerCorrectionView | null;
}

/** A contract item whose price needs review. */
export interface ReconcileContractRow {
	/** `contract_item` correction ref `contract:<contractId>:<typeId>`. */
	ref: string;
	item: LedgerItemType;
	contractId: number;
	at: number;
	title: string | null;
	/** true: the user received it; false: the user gave it. */
	incoming: boolean;
	quantity: number;
	unitPrice: number;
	sourceText: string;
	saved: LedgerCorrectionView | null;
}

export interface ReconcileCounts {
	/** Job inputs not saved yet: with an estimate, and without any price. */
	estimated: number;
	unpriced: number;
	/** Items those inputs are of. */
	items: number;
	/** Contract items needing review, not saved yet. */
	contracts: number;
	/** `estimated + unpriced + contracts`. */
	total: number;
}

export interface ReconcilePageData {
	counts: ReconcileCounts;
	/** Job inputs by item then job (`inputs`, JSON at `/profits/data/reconcile-inputs`). */
	inputs: Paged<ReconcileInputRow>;
	/** Contract items (`contracts`, JSON at `/profits/data/reconcile-contracts`). */
	contracts: Paged<ReconcileContractRow>;
	/** A recalculation is pending. */
	dirty: boolean;
}

/** Result of the `correct`, `confirm` and `confirmAll` actions of the reconcile page. */
export interface ReconcileActionResult {
	action: 'correct' | 'confirm' | 'confirmAll';
	/** The price (`correct`, `confirm`) or `type:<typeId>` (`confirmAll`) the form was for. */
	ref: string;
	notice?: string;
	error?: string;
}
