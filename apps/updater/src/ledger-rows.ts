/**
 * Pure mapping between the profit tracking tables and the engine ledger: `tracked_*` and
 * `manual_entries` rows → `runLedger` input, reference prices from prefetched history, and
 * `LedgerResult` → the rows of `ledger_lots`, `ledger_uses`, `job_results`, `ledger_prices` and
 * `ledger_unallocated_fees`. No Cloudflare imports: `scripts/seed-local.ts` computes the seeded ledger
 * in Node with the same code.
 */
import {
	DEFAULT_BLUEPRINT_ME,
	DEFAULT_CONSTANTS,
	DEFAULT_SETTINGS,
	REACTORS,
	Settings,
	TrackingSettings,
	jobMaterialModifier,
	manufacturingMaterialModifier,
	parseRigIds,
	profileFor,
	resolveFacility,
	type Dataset,
	type EfficiencyProfile,
	type FacilityFromEve,
	type IndustryBand,
	type LedgerContract,
	type LedgerCorrection,
	type LedgerJaniceAppraisal,
	type LedgerJob,
	type LedgerJobStatus,
	type LedgerJournalRow,
	type LedgerManualEntry,
	type LedgerOrder,
	type LedgerResult,
	type LedgerTransaction,
	type ReferencePrice,
	type ReferencePriceFn,
	type RunLedgerInput,
	type SecurityBand
} from '@reactions/engine';
import { MANUFACTURING_ACTIVITY_ID } from '@reactions/eve';
import { addDays, utcDate } from './dates.ts';

// ---- Rows as read from D1 (snake_case columns, booleans as 0/1) ----

export interface TransactionRow {
	transaction_id: number;
	source_id: number;
	division: number | null;
	date: number;
	type_id: number;
	quantity: number;
	unit_price: number;
	is_buy: number;
	client_id: number;
	location_id: number;
}

export interface JournalRow {
	ref_id: number;
	source_id: number;
	division: number | null;
	date: number;
	ref_type: string;
	amount: number | null;
	context_id: number | null;
	context_id_type: string | null;
}

export interface OrderRow {
	order_id: number;
	source_id: number;
	division: number | null;
	type_id: number;
	is_buy: number;
	price: number;
	volume_total: number;
	volume_remain: number;
	issued: number;
	location_id: number;
	state: string;
}

export interface ContractRow {
	contract_id: number;
	issuer_id: number;
	issuer_corporation_id: number;
	acceptor_id: number;
	assignee_id: number;
	for_corporation: number;
	price: number | null;
	reward: number | null;
	title: string | null;
	date_issued: number;
	date_completed: number | null;
	janice_json: string | null;
}

export interface ContractItemRow {
	contract_id: number;
	record_id: number;
	type_id: number;
	quantity: number;
	is_included: number;
}

export interface JobRow {
	job_id: number;
	/** ESI `activity_id`: 1 = manufacturing, else a reaction (9 or 11). */
	activity_id: number;
	blueprint_type_id: number;
	/** ME of a manufacturing job's blueprint as read from EVE; null = not read. */
	blueprint_me: number | null;
	runs: number;
	status: string;
	cost: number | null;
	facility_id: number;
	start_date: number;
	end_date: number;
}

export interface CorrectionRow {
	target_kind: string;
	target_ref: string;
	unit_price: number;
}

export interface ManualEntryRow {
	entry_id: number;
	date: number;
	type_id: number;
	quantity: number;
	unit_price: number;
}

/** One user's raw tracking rows (connections with Profit tracking on only) and manual purchases. */
export interface TrackedRows {
	transactions: readonly TransactionRow[];
	journal: readonly JournalRow[];
	orders: readonly OrderRow[];
	contracts: readonly ContractRow[];
	contractItems: readonly ContractItemRow[];
	jobs: readonly JobRow[];
	corrections: readonly CorrectionRow[];
	manualEntries: readonly ManualEntryRow[];
}

// ---- Settings ----

/** `users.tracking_json` → settings; missing or invalid → defaults. */
export function parseTrackingSettings(json: string | null): TrackingSettings {
	if (json) {
		try {
			const parsed = TrackingSettings.safeParse(JSON.parse(json));
			if (parsed.success) return parsed.data;
		} catch {
			// Invalid JSON: defaults.
		}
	}
	return TrackingSettings.parse({});
}

/**
 * `users.settings_json` (sparse diff from the defaults, as the web stores it) → settings; missing or
 * invalid → the anonymous defaults.
 */
export function parseAccountSettings(json: string | null): Settings {
	if (json) {
		try {
			const parsed = Settings.safeParse(JSON.parse(json));
			if (parsed.success) return parsed.data;
		} catch {
			// Invalid JSON: defaults.
		}
	}
	return DEFAULT_SETTINGS;
}

/** Fees of the account: the output side of the profile used for composite reactions. */
export function accountFees(settings: Settings): { brokerFeePct: number; salesTaxPct: number } {
	const { brokerFeePct, salesTaxPct } = profileFor(settings, 'composite').market;
	return { brokerFeePct, salesTaxPct };
}

/** Systems of the account's reactor profiles (their security band is the jobs' fallback band). */
export function profileSystemIds(settings: Settings): number[] {
	return [...new Set(REACTORS.map((reactor) => profileFor(settings, reactor).systemId))];
}

/** Reactions are impossible in highsec; such a system counts as lowsec (as the web's profiles do). */
function engineBand(band: string | undefined): SecurityBand {
	return band === 'nullsec' || band === 'wormhole' ? band : 'lowsec';
}

// ---- Rows → engine input ----

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * `tracked_contracts.janice_json` (the `JaniceAppraisal` of `@reactions/eve` as JSON) → the engine's
 * appraisal; null when absent or unreadable (the contract is then split by the rule).
 */
export function parseJanice(json: string | null): LedgerJaniceAppraisal | null {
	if (!json) return null;
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof value !== 'object' || value === null) return null;
	const a = value as Record<string, unknown>;
	if (typeof a.code !== 'string' || typeof a.pricing !== 'string' || !Array.isArray(a.items)) return null;
	const items: LedgerJaniceAppraisal['items'] = [];
	for (const raw of a.items as unknown[]) {
		if (typeof raw !== 'object' || raw === null) return null;
		const item = raw as Record<string, unknown>;
		if (!finite(item.typeId) || !finite(item.buyPrice) || !finite(item.splitPrice) || !finite(item.sellPrice))
			return null;
		items.push({
			typeId: item.typeId,
			buyPrice: item.buyPrice,
			splitPrice: item.splitPrice,
			sellPrice: item.sellPrice
		});
	}
	return {
		code: a.code,
		marketName: typeof a.marketName === 'string' ? a.marketName : 'Janice',
		pricing: a.pricing,
		datasetTime: finite(a.datasetTime) ? a.datasetTime : 0,
		items
	};
}

/** Contracts with their items (records in `record_id` order); contracts without items are kept empty. */
export function toLedgerContracts(
	contracts: readonly ContractRow[],
	items: readonly ContractItemRow[]
): LedgerContract[] {
	const byContract = new Map<number, ContractItemRow[]>();
	for (const item of items) {
		let list = byContract.get(item.contract_id);
		if (!list) byContract.set(item.contract_id, (list = []));
		list.push(item);
	}
	return contracts.map((c) => ({
		contractId: c.contract_id,
		issuerId: c.issuer_id,
		issuerCorporationId: c.issuer_corporation_id,
		acceptorId: c.acceptor_id,
		assigneeId: c.assignee_id,
		forCorporation: Boolean(c.for_corporation),
		price: c.price,
		reward: c.reward,
		title: c.title,
		dateIssued: c.date_issued,
		completedAt: c.date_completed ?? c.date_issued,
		items: (byContract.get(c.contract_id) ?? [])
			.sort((a, b) => a.record_id - b.record_id)
			.map((i) => ({
				recordId: i.record_id,
				typeId: i.type_id,
				quantity: i.quantity,
				isIncluded: Boolean(i.is_included)
			})),
		janice: parseJanice(c.janice_json)
	}));
}

export interface JobModifierContext {
	dataset: Dataset;
	settings: Settings;
	tracking: TrackingSettings;
	/** `systems.security_band` by system id (the profile systems; see `profileSystemIds`). */
	systemBands: ReadonlyMap<number, string>;
	/** What EVE tells about each job facility (`facilitiesFromEve`); absent = nothing. */
	facilities: ReadonlyMap<number, FacilityFromEve>;
}

/** `tracked_facilities` columns the ledger reads. */
export interface TrackedFacilityRow {
	facility_id: number;
	/** 'structure' | 'station' | 'unknown' */
	kind: string;
	system_id: number | null;
	type_id: number | null;
	rigs_json: string | null;
}

const INDUSTRY_BANDS: Record<string, IndustryBand> = {
	highsec: 'highsec',
	lowsec: 'lowsec',
	nullsec: 'nullsec',
	wormhole: 'wormhole'
};

/**
 * What EVE tells about the job facilities: the `tracked_facilities` row (an NPC station is type 0: no
 * structure bonus; rigs from corporation assets) with the band of its system, else of the facility's
 * system in the user's `inventory_locations` (`locationSystems`). A facility with neither is absent.
 */
export function facilitiesFromEve(
	rows: readonly TrackedFacilityRow[],
	locationSystems: ReadonlyMap<number, number>,
	systemBands: ReadonlyMap<number, string>
): Map<number, FacilityFromEve> {
	const bandOf = (system: number | null | undefined): IndustryBand | null =>
		system == null ? null : (INDUSTRY_BANDS[systemBands.get(system) ?? ''] ?? null);
	const facilities = new Map<number, FacilityFromEve>();
	for (const [facilityId, system] of locationSystems) {
		const band = bandOf(system);
		if (band) facilities.set(facilityId, { typeId: null, rigs: null, band });
	}
	for (const row of rows)
		facilities.set(row.facility_id, {
			typeId: row.kind === 'station' ? 0 : row.type_id,
			rigs: parseRigIds(row.rigs_json),
			band: bandOf(row.system_id) ?? facilities.get(row.facility_id)?.band ?? null
		});
	return facilities;
}

/**
 * Jobs with their material modifier, from the facility as EVE describes it (`ctx.facilities`) with
 * `tracking.facilities` filling what EVE could not tell (`resolveFacility`), for the job's product.
 * Reactions: `jobMaterialModifier` with the account profile of the job's reactor (composite for a
 * formula not in the dataset) as the fallback. Manufacturing: `manufacturingMaterialModifier` with the
 * blueprint's ME read from EVE, else `tracking.blueprintMe`, else `DEFAULT_BLUEPRINT_ME`.
 */
export function toLedgerJobs(jobs: readonly JobRow[], ctx: JobModifierContext): LedgerJob[] {
	const reactions = new Map(ctx.dataset.reactions.map((r) => [r.blueprintTypeId, r]));
	const manufacturing = new Map((ctx.dataset.manufacturing ?? []).map((b) => [b.blueprintTypeId, b]));
	const { industry } = ctx.dataset;
	return jobs.map((j): LedgerJob => {
		const job = {
			jobId: j.job_id,
			blueprintTypeId: j.blueprint_type_id,
			runs: j.runs,
			status: j.status as LedgerJobStatus,
			cost: j.cost,
			startDate: j.start_date,
			endDate: j.end_date,
			facilityId: j.facility_id
		};
		const facility = resolveFacility(
			ctx.facilities.get(j.facility_id) ?? null,
			ctx.tracking.facilities[String(j.facility_id)]
		);
		if (j.activity_id === MANUFACTURING_ACTIVITY_ID) {
			const me =
				j.blueprint_me ?? ctx.tracking.blueprintMe[String(j.blueprint_type_id)] ?? DEFAULT_BLUEPRINT_ME;
			const product = manufacturing.get(j.blueprint_type_id)?.productTypeId ?? 0;
			return {
				...job,
				activity: 'manufacturing',
				materialModifier: manufacturingMaterialModifier(me, industry, product, facility)
			};
		}
		const reaction = reactions.get(j.blueprint_type_id);
		const profile = profileFor(ctx.settings, reaction?.reactor ?? 'composite');
		const fallback: EfficiencyProfile = {
			structure: profile.structure,
			meRig: profile.meRig,
			teRig: profile.teRig,
			reactionsSkill: profile.reactionsSkill,
			securityBand: engineBand(ctx.systemBands.get(profile.systemId))
		};
		return {
			...job,
			activity: 'reaction',
			materialModifier: jobMaterialModifier(
				industry,
				reaction?.product.typeId ?? 0,
				facility,
				fallback,
				DEFAULT_CONSTANTS
			)
		};
	});
}

export interface LedgerContext extends JobModifierContext {
	characterIds: readonly number[];
	/** Owner ids of the user's corporation connections. */
	corporationIds: readonly number[];
	/** Connections whose `orders` stream is `ok`. */
	ordersAvailable: readonly number[];
	/** The contract rule's hub and basis (contract pricing). */
	referencePrice: ReferencePriceFn;
	/** The contract rule's hub, buy side (job inputs without a purchase, manufacturing use). */
	buyPrice: ReferencePriceFn;
	now: number;
}

/** The `runLedger` input of one user. */
export function toRunLedgerInput(rows: TrackedRows, ctx: LedgerContext): RunLedgerInput {
	return {
		dataset: ctx.dataset,
		own: { characterIds: new Set(ctx.characterIds), corporationIds: new Set(ctx.corporationIds) },
		settings: ctx.tracking,
		...accountFees(ctx.settings),
		ordersAvailable: new Set(ctx.ordersAvailable),
		transactions: rows.transactions.map((r): LedgerTransaction => ({
			transactionId: r.transaction_id,
			sourceId: r.source_id,
			division: r.division,
			date: r.date,
			typeId: r.type_id,
			quantity: r.quantity,
			unitPrice: r.unit_price,
			isBuy: Boolean(r.is_buy),
			clientId: r.client_id,
			locationId: r.location_id
		})),
		journal: rows.journal.map((r): LedgerJournalRow => ({
			refId: r.ref_id,
			sourceId: r.source_id,
			division: r.division,
			date: r.date,
			refType: r.ref_type,
			amount: r.amount,
			contextId: r.context_id,
			contextIdType: r.context_id_type
		})),
		orders: rows.orders.map((r): LedgerOrder => ({
			orderId: r.order_id,
			sourceId: r.source_id,
			division: r.division,
			typeId: r.type_id,
			isBuy: Boolean(r.is_buy),
			price: r.price,
			volumeTotal: r.volume_total,
			volumeRemain: r.volume_remain,
			issued: r.issued,
			locationId: r.location_id,
			state: r.state as LedgerOrder['state']
		})),
		contracts: toLedgerContracts(rows.contracts, rows.contractItems),
		jobs: toLedgerJobs(rows.jobs, ctx),
		corrections: rows.corrections.map((r): LedgerCorrection => ({
			targetKind: r.target_kind as LedgerCorrection['targetKind'],
			targetRef: r.target_ref,
			unitPrice: r.unit_price
		})),
		manualEntries: rows.manualEntries.map((r): LedgerManualEntry => ({
			entryId: r.entry_id,
			at: r.date,
			typeId: r.type_id,
			quantity: r.quantity,
			unitPrice: r.unit_price
		})),
		referencePrice: ctx.referencePrice,
		buyPrice: ctx.buyPrice,
		now: ctx.now
	};
}

// ---- Reference prices ----

/** An earlier day's price is used when the day itself has none, at most this many days back. */
export const REFERENCE_LOOKBACK_DAYS = 7;

/**
 * UTC days per type the ledger can ask a reference or buy price for: every contract item at the
 * contract's `date_issued`, every material of a reaction job's formula and every reaction-product
 * material of a manufacturing job's blueprint at the job's `start_date`.
 */
export function referenceRequests(
	rows: Pick<TrackedRows, 'contracts' | 'contractItems' | 'jobs'>,
	dataset: Dataset
): Map<number, Set<string>> {
	const requests = new Map<number, Set<string>>();
	const add = (typeId: number, at: number) => {
		let days = requests.get(typeId);
		if (!days) requests.set(typeId, (days = new Set()));
		days.add(utcDate(at));
	};
	const issued = new Map(rows.contracts.map((c) => [c.contract_id, c.date_issued]));
	for (const item of rows.contractItems) {
		const at = issued.get(item.contract_id);
		if (at !== undefined) add(item.type_id, at);
	}
	const reactions = new Map(dataset.reactions.map((r) => [r.blueprintTypeId, r.materials]));
	const manufacturing = new Map((dataset.manufacturing ?? []).map((b) => [b.blueprintTypeId, b.materials]));
	for (const job of rows.jobs) {
		const materials =
			job.activity_id === MANUFACTURING_ACTIVITY_ID
				? manufacturing.get(job.blueprint_type_id)
				: reactions.get(job.blueprint_type_id);
		for (const material of materials ?? []) add(material.typeId, job.start_date);
	}
	return requests;
}

/** `day` and the {@link REFERENCE_LOOKBACK_DAYS} days before it, newest first. */
export function referenceDays(day: string): string[] {
	return Array.from({ length: REFERENCE_LOOKBACK_DAYS + 1 }, (_, i) => addDays(day, -i));
}

export type ReferenceBasis = TrackingSettings['contractRule']['basis'];

export interface ReferenceHub {
	/** Shown in price source texts. */
	name: string;
	basis: ReferenceBasis;
}

export interface SidePrices {
	buy: number | null;
	sell: number | null;
}

/** Prefetched prices of the reference hub; keys `${typeId}:${YYYY-MM-DD}`. */
export interface ReferenceSources {
	/** `price_daily` of the hub (`buy_avg`, `sell_avg`). */
	daily: ReadonlyMap<string, SidePrices>;
	/** `esi_market_history.average` of the hub's region. */
	regional: ReadonlyMap<string, number>;
	/** `latest_prices` of the hub (`buy_max`, `sell_min`) by type id. */
	latest: ReadonlyMap<number, SidePrices>;
}

export const referenceKey = (typeId: number, day: string): string => `${typeId}:${day}`;

const positive = (value: number | null | undefined): number | null =>
	value !== null && value !== undefined && value > 0 ? value : null;

/** The basis price of a buy/sell pair: `split` is the mean of both and needs both. */
export function basisPrice(prices: SidePrices | undefined, basis: ReferenceBasis): number | null {
	if (!prices) return null;
	const buy = positive(prices.buy);
	const sell = positive(prices.sell);
	if (basis === 'buy') return buy;
	if (basis === 'sell') return sell;
	return buy !== null && sell !== null ? (buy + sell) / 2 : null;
}

/**
 * Sync reference lookup over prefetched prices: for the UTC day of `at` and then each earlier day
 * (up to {@link REFERENCE_LOOKBACK_DAYS}), the hub's daily average for the basis, else the region's ESI
 * average; else the hub's current price. Labels: "Jita 4-4 buy on 2026-10-10", "Jita 4-4 region average
 * on 2026-10-10", "Jita 4-4 buy (current)". Results are memoized per type and day.
 */
export function referencePriceFn(hub: ReferenceHub, sources: ReferenceSources): ReferencePriceFn {
	const memo = new Map<string, ReferencePrice | null>();
	const resolve = (typeId: number, day: string): ReferencePrice | null => {
		for (const d of referenceDays(day)) {
			const key = referenceKey(typeId, d);
			const daily = basisPrice(sources.daily.get(key), hub.basis);
			if (daily !== null) return { unitPrice: daily, label: `${hub.name} ${hub.basis} on ${d}` };
			const regional = positive(sources.regional.get(key));
			if (regional !== null) return { unitPrice: regional, label: `${hub.name} region average on ${d}` };
		}
		const latest = basisPrice(sources.latest.get(typeId), hub.basis);
		return latest === null ? null : { unitPrice: latest, label: `${hub.name} ${hub.basis} (current)` };
	};
	return (typeId, at) => {
		const day = utcDate(at);
		const key = referenceKey(typeId, day);
		if (!memo.has(key)) memo.set(key, resolve(typeId, day));
		return memo.get(key)!;
	};
}

// ---- Engine result → rows ----

export type SqlValue = string | number | null;

export const LEDGER_LOT_COLUMNS = [
	'lot_id',
	'type_id',
	'acquired_at',
	'quantity',
	'remaining',
	'unit_cost',
	'origin',
	'origin_ref',
	'price_source'
] as const;
/** `unit_value`: what one unit counted for in a `manufacturing` use; null for job and sale uses. */
export const LEDGER_USE_COLUMNS = [
	'lot_id',
	'use_kind',
	'use_ref',
	'quantity',
	'unit_cost',
	'unit_value'
] as const;
export const JOB_RESULT_COLUMNS = [
	'job_id',
	'input_cost',
	'job_cost',
	'output_type_id',
	'output_qty',
	'sold_qty',
	'sales_net',
	'used_qty',
	'manufactured_qty',
	'manufactured_value',
	'unsold_qty',
	'unit_cost',
	'realized_profit',
	'flags_json'
] as const;
export const LEDGER_PRICE_COLUMNS = [
	'ref',
	'type_id',
	'incoming',
	'at',
	'quantity',
	'unit_price',
	'source_kind',
	'source_text',
	'needs_review',
	'tax',
	'tax_source',
	'broker_fee',
	'broker_fee_source',
	'transfer'
] as const;
export const UNALLOCATED_FEE_COLUMNS = ['ref_id', 'date', 'amount'] as const;

/** Result rows in the column order of the `*_COLUMNS` lists (without `user_id`, which writers add). */
export interface LedgerResultRows {
	lots: SqlValue[][];
	uses: SqlValue[][];
	jobs: SqlValue[][];
	prices: SqlValue[][];
	unallocatedFees: SqlValue[][];
	/** Priced trades and contract items that need review, plus job inputs with no price at all. */
	needsReview: number;
}

const bit = (value: boolean): number => (value ? 1 : 0);

export function ledgerResultRows(result: LedgerResult): LedgerResultRows {
	const prices: SqlValue[][] = [];
	let needsReview = 0;
	for (const t of result.trades) {
		prices.push([
			t.ref,
			t.typeId,
			bit(t.isBuy),
			t.at,
			t.quantity,
			t.netUnitPrice,
			t.source.kind,
			t.source.text,
			bit(t.source.needsReview),
			t.tax,
			t.taxSource,
			t.brokerFee,
			t.brokerFeeSource,
			bit(t.transfer)
		]);
		if (t.source.needsReview) needsReview++;
	}
	for (const c of result.contracts) {
		for (const item of c.items) {
			prices.push([
				c.ref,
				item.typeId,
				bit(item.incoming),
				c.at,
				item.quantity,
				item.unitPrice,
				item.source.kind,
				item.source.text,
				bit(item.source.needsReview),
				null,
				null,
				null,
				null,
				bit(c.direction === 'transfer')
			]);
			if (item.source.needsReview) needsReview++;
		}
	}
	for (const lot of result.lots) {
		if (lot.origin === 'market' && lot.source.needsReview) needsReview++;
	}
	return {
		lots: result.lots.map((l) => [
			l.lotId,
			l.typeId,
			l.acquiredAt,
			l.quantity,
			l.remaining,
			l.unitCost,
			l.origin,
			l.originRef,
			l.source.text
		]),
		uses: result.uses.map((u) => [u.lotId, u.useKind, u.useRef, u.quantity, u.unitCost, u.unitValue ?? null]),
		jobs: result.jobs.map((j) => [
			j.jobId,
			j.inputCost,
			j.jobCost,
			j.outputTypeId,
			j.outputQty,
			j.soldQty,
			j.salesNet,
			j.usedQty,
			j.manufacturedQty,
			j.manufacturedValue,
			j.unsoldQty,
			j.unitCost,
			j.realizedProfit,
			JSON.stringify(j.flags)
		]),
		prices,
		unallocatedFees: result.unallocatedFees.map((f) => [f.refId, f.date, f.amount]),
		needsReview
	};
}
