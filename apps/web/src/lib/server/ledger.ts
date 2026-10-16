import type { Dataset } from '@reactions/engine';
import type {
	LedgerConnectionOption,
	LedgerContractItemRow,
	LedgerContractRow,
	LedgerCorrectionView,
	LedgerFeeSource,
	LedgerFilters,
	LedgerItemType,
	LedgerOwnerView,
	LedgerPageData,
	LedgerPeriod,
	LedgerRow,
	LedgerSummary,
	LedgerTradeRow,
	LedgerManualRow
} from '$lib/ledger/types';
import { LEDGER_PERIODS } from '$lib/ledger/types';
import { pageParam, paginate, type Paged } from '$lib/paging';
import { getDataset } from './data.ts';
import { reconcileCounts } from './ledger-reconcile.ts';

const DAY_MS = 86_400_000;

/**
 * One row per ledger entry of the user (`?1`), from connections with Profit tracking on only:
 * - `market`: a priced trade (`ledger_prices` ref `transaction:<id>`);
 * - `contract` with prices: its `ledger_prices` rows (ref `contract:<id>`) folded into one entry;
 * - `contract` transfer: both sides are own parties (the engine's rule: issuer or, for a corporation
 *   contract, the issuer's corporation; and the acceptor, or anyone accepting a contract assigned to an
 *   own corporation), which the rebuild writes no prices for.
 * - `manual`: a purchase the user entered (`manual_entries`), with no connection.
 * `has_in`/`has_out`: an item came to / left the user outside a transfer; `review`: any price needs review.
 */
const ENTRIES = `WITH src AS (
	SELECT source_id FROM inventory_sources WHERE user_id = ?1 AND tracking_enabled = 1
), own_corp AS (
	SELECT owner_id AS id FROM inventory_sources WHERE user_id = ?1 AND kind = 'corporation'
), own AS (
	SELECT character_id AS id FROM characters WHERE user_id = ?1
	UNION SELECT id FROM own_corp
), entries AS (
	SELECT 'market' AS kind, t.transaction_id AS id, lp.at AS at, t.source_id AS source_id, lp.type_id AS type_id,
		lp.needs_review AS review, lp.incoming = 1 AND lp.transfer = 0 AS has_in,
		lp.incoming = 0 AND lp.transfer = 0 AS has_out, lp.transfer AS transfer
	FROM ledger_prices lp
	JOIN tracked_transactions t
		ON t.user_id = lp.user_id AND t.transaction_id = CAST(substr(lp.ref, 13) AS INTEGER)
	WHERE lp.user_id = ?1 AND lp.ref GLOB 'transaction:*' AND t.source_id IN (SELECT source_id FROM src)
	UNION ALL
	SELECT 'contract', c.contract_id, MAX(lp.at), c.source_id, NULL, MAX(lp.needs_review),
		MAX(lp.incoming = 1 AND lp.transfer = 0), MAX(lp.incoming = 0 AND lp.transfer = 0), MIN(lp.transfer)
	FROM tracked_contracts c
	JOIN ledger_prices lp ON lp.user_id = c.user_id AND lp.ref = 'contract:' || c.contract_id
	WHERE c.user_id = ?1 AND c.source_id IN (SELECT source_id FROM src)
	GROUP BY c.contract_id
	UNION ALL
	SELECT 'contract', c.contract_id, COALESCE(c.date_completed, c.date_issued), c.source_id, NULL, 0, 0, 0, 1
	FROM tracked_contracts c
	WHERE c.user_id = ?1 AND c.source_id IN (SELECT source_id FROM src)
		AND (c.issuer_id IN (SELECT id FROM own)
			OR (c.for_corporation = 1 AND c.issuer_corporation_id IN (SELECT id FROM own)))
		AND (c.acceptor_id IN (SELECT id FROM own)
			OR (c.acceptor_id <> 0 AND c.assignee_id IN (SELECT id FROM own_corp)))
		AND NOT EXISTS (SELECT 1 FROM ledger_prices lp WHERE lp.user_id = ?1 AND lp.ref = 'contract:' || c.contract_id)
	UNION ALL
	SELECT 'manual', m.entry_id, m.date, NULL, m.type_id, 0, 1, 0, 0
	FROM manual_entries m
	WHERE m.user_id = ?1
)`;

/**
 * Filters `?2`–`?7` (null / 0 = not filtered; `?7` = earliest date). A contract matches a type when any
 * of its items has it; a connection filter leaves out the purchases the user entered.
 */
const FILTERED = `FROM entries e
	WHERE (?2 IS NULL OR (e.kind IN ('market', 'manual') AND e.type_id = ?2)
			OR (e.kind = 'contract' AND EXISTS (SELECT 1 FROM tracked_contract_items i
				WHERE i.user_id = ?1 AND i.contract_id = e.id AND i.type_id = ?2)))
		AND (?3 IS NULL OR (?3 = 'in' AND e.has_in = 1) OR (?3 = 'out' AND e.has_out = 1)
			OR (?3 = 'transfer' AND e.transfer = 1))
		AND (?4 IS NULL OR e.kind = ?4)
		AND (?5 IS NULL OR e.source_id = ?5)
		AND (?6 = 0 OR e.review = 1)
		AND (?7 IS NULL OR e.at >= ?7)`;

/** Journal `ref_type`s of contract fees (context: the contract). */
const CONTRACT_FEES = `'contract_brokers_fee', 'contract_brokers_fee_corp', 'contract_sales_tax'`;

const SQL = {
	keys: `${ENTRIES} SELECT e.kind, e.id ${FILTERED} ORDER BY e.at DESC, e.kind DESC, e.id DESC`,
	/**
	 * Totals of the filtered entries' prices (only the filtered item's prices with an item filter) and
	 * the contract fees of the filtered contracts. "Not tracked" prices (items no reaction or fuel block
	 * uses) count nowhere, nor do the fees of a contract of only such items.
	 */
	summary: `${ENTRIES}, f AS (SELECT e.kind, e.id, e.review ${FILTERED}),
	p AS (
		SELECT lp.incoming, lp.transfer, lp.unit_price * lp.quantity AS total, lp.tax, lp.tax_source,
			lp.broker_fee, lp.broker_fee_source
		FROM f JOIN ledger_prices lp ON lp.user_id = ?1
			AND lp.ref = (CASE f.kind WHEN 'market' THEN 'transaction:' ELSE 'contract:' END) || f.id
		WHERE f.kind <> 'manual' AND (?2 IS NULL OR lp.type_id = ?2) AND lp.source_kind <> 'untracked'
		UNION ALL
		SELECT 1, 0, m.unit_price * m.quantity, NULL, NULL, NULL, NULL
		FROM f JOIN manual_entries m ON m.user_id = ?1 AND m.entry_id = f.id
		WHERE f.kind = 'manual'
	)
	SELECT
		(SELECT COUNT(*) FROM f WHERE f.review = 1) AS review,
		COALESCE(SUM(CASE WHEN p.incoming = 1 AND p.transfer = 0 THEN p.total END), 0) AS bought,
		COALESCE(SUM(CASE WHEN p.incoming = 0 AND p.transfer = 0 THEN p.total END), 0) AS sold,
		COALESCE(SUM(CASE WHEN p.transfer = 0 THEN p.broker_fee END), 0) AS broker,
		COALESCE(SUM(CASE WHEN p.transfer = 0 THEN p.tax END), 0) AS tax,
		COALESCE(MAX(p.transfer = 0 AND (p.tax_source = 'estimated' OR p.broker_fee_source = 'estimated')), 0)
			AS estimated,
		(SELECT COALESCE(SUM(ABS(j.amount)), 0) FROM tracked_journal j
			JOIN f ON f.kind = 'contract' AND j.context_id = f.id
			WHERE j.user_id = ?1 AND j.context_id_type = 'contract_id' AND j.ref_type IN (${CONTRACT_FEES})
				AND (SELECT MIN(lp.source_kind = 'untracked') FROM ledger_prices lp
					WHERE lp.user_id = ?1 AND lp.ref = 'contract:' || f.id) IS NOT 1)
			AS contract_fees
	FROM p`,
	/** Market fees no order matched, of tracked connections; `?2` earliest date, `?3` connection. */
	otherFees: `SELECT COALESCE(SUM(u.amount), 0) AS n FROM ledger_unallocated_fees u
		JOIN tracked_journal j ON j.user_id = u.user_id AND j.ref_id = u.ref_id
		JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = u.user_id AND s.tracking_enabled = 1
		WHERE u.user_id = ?1 AND (?2 IS NULL OR u.date >= ?2) AND (?3 IS NULL OR j.source_id = ?3)`,
	review: `${ENTRIES} SELECT COUNT(*) AS n FROM entries WHERE review = 1`,
	tracked: `${ENTRIES} SELECT EXISTS (SELECT 1 FROM entries) AS n`,
	types: `${ENTRIES} SELECT type_id FROM entries WHERE kind IN ('market', 'manual')
		UNION SELECT i.type_id FROM tracked_contract_items i
		JOIN entries e ON e.kind = 'contract' AND e.id = i.contract_id WHERE i.user_id = ?1`,
	sources: `SELECT source_id, kind, owner_name, wallet_names_json FROM inventory_sources
		WHERE user_id = ?1 AND tracking_enabled = 1 ORDER BY owner_name, source_id`,
	state: 'SELECT rebuilt_at, dirty FROM ledger_state WHERE user_id = ?1',
	/** `?2`: JSON array of transaction ids. */
	trades: `SELECT t.transaction_id, t.source_id, t.division, t.unit_price AS gross_unit_price, lp.type_id, lp.at,
			lp.quantity, lp.unit_price, lp.source_kind, lp.source_text, lp.needs_review, lp.tax, lp.tax_source,
			lp.broker_fee, lp.broker_fee_source, lp.incoming, lp.transfer, pc.unit_price AS corrected_price,
			pc.note AS correction_note, pc.target_ref AS correction_ref
		FROM ledger_prices lp
		JOIN tracked_transactions t
			ON t.user_id = lp.user_id AND t.transaction_id = CAST(substr(lp.ref, 13) AS INTEGER)
		LEFT JOIN price_corrections pc
			ON pc.user_id = lp.user_id AND pc.target_kind = 'transaction' AND pc.target_ref = lp.ref
		WHERE lp.user_id = ?1 AND lp.ref IN (SELECT 'transaction:' || value FROM json_each(?2))`,
	/** `?2`: JSON array of contract ids. */
	contracts: `SELECT contract_id, source_id, price, reward, title, janice_code,
			COALESCE(date_completed, date_issued) AS at
		FROM tracked_contracts
		WHERE user_id = ?1 AND contract_id IN (SELECT value FROM json_each(?2))`,
	contractPrices: `SELECT CAST(substr(lp.ref, 10) AS INTEGER) AS contract_id, lp.type_id, lp.incoming, lp.quantity,
			lp.at, lp.unit_price, lp.source_kind, lp.source_text, lp.needs_review, pc.unit_price AS corrected_price,
			pc.note AS correction_note, pc.target_ref AS correction_ref
		FROM ledger_prices lp
		LEFT JOIN price_corrections pc ON pc.user_id = lp.user_id AND pc.target_kind = 'contract_item'
			AND pc.target_ref = lp.ref || ':' || lp.type_id
		WHERE lp.user_id = ?1 AND lp.ref IN (SELECT 'contract:' || value FROM json_each(?2))
		ORDER BY lp.incoming DESC, lp.type_id`,
	transferItems: `SELECT contract_id, type_id, SUM(quantity) AS quantity FROM tracked_contract_items
		WHERE user_id = ?1 AND contract_id IN (SELECT value FROM json_each(?2))
		GROUP BY contract_id, type_id ORDER BY type_id`,
	/** `?2`: JSON array of entry ids. */
	manual: `SELECT entry_id, date, type_id, quantity, unit_price, note FROM manual_entries
		WHERE user_id = ?1 AND entry_id IN (SELECT value FROM json_each(?2))`
} as const;

interface SourceRow {
	source_id: number;
	kind: 'character' | 'corporation';
	owner_name: string;
	wallet_names_json: string | null;
}

interface PriceColumns {
	type_id: number;
	quantity: number;
	at: number;
	unit_price: number;
	source_kind: string;
	source_text: string;
	needs_review: number;
	incoming: number;
	corrected_price: number | null;
	correction_note: string | null;
	correction_ref: string | null;
}

interface TradeRow extends PriceColumns {
	transaction_id: number;
	source_id: number;
	division: number | null;
	gross_unit_price: number;
	tax: number | null;
	tax_source: string | null;
	broker_fee: number | null;
	broker_fee_source: string | null;
	transfer: number;
}

interface ContractRow {
	contract_id: number;
	source_id: number;
	price: number | null;
	reward: number | null;
	title: string | null;
	janice_code: string | null;
	at: number;
}

interface SummaryRow {
	review: number;
	bought: number;
	sold: number;
	broker: number;
	tax: number;
	estimated: number;
	contract_fees: number;
}

type EntryKey = { kind: 'market' | 'contract' | 'manual'; id: number };

const FEE_SOURCES: Record<LedgerFeeSource, true> = { journal: true, estimated: true, none: true };
const feeSource = (value: string | null): LedgerFeeSource | null =>
	value !== null && Object.hasOwn(FEE_SOURCES, value) ? (value as LedgerFeeSource) : null;

/** Reads the filters and the table page from the query string; unknown or malformed values are ignored. */
export function parseLedgerQuery(url: URL): { filters: LedgerFilters; page: number } {
	const params = url.searchParams;
	const id = (name: string) => {
		const n = Number(params.get(name));
		return params.get(name) && Number.isSafeInteger(n) && n > 0 ? n : null;
	};
	const direction = params.get('direction');
	const kind = params.get('kind');
	const period = Number(params.get('period'));
	return {
		filters: {
			period: (LEDGER_PERIODS as readonly number[]).includes(period) ? (period as LedgerPeriod) : null,
			typeId: id('type'),
			direction: direction === 'in' || direction === 'out' || direction === 'transfer' ? direction : null,
			kind: kind === 'market' || kind === 'contract' || kind === 'manual' ? kind : null,
			connection: id('connection'),
			review: params.get('review') === '1'
		},
		page: pageParam(url, 'page')
	};
}

/** Bind values `?1`–`?7` of `FILTERED`. */
function filterParams(userId: string, filters: LedgerFilters, now: number) {
	return [
		userId,
		filters.typeId,
		filters.direction,
		filters.kind,
		filters.connection,
		filters.review ? 1 : 0,
		filters.period === null ? null : now - filters.period * DAY_MS
	];
}

function itemType(dataset: Dataset | null, formulas: ReadonlySet<number>, typeId: number): LedgerItemType {
	return { typeId, name: dataset?.types[typeId]?.name ?? `Type ${typeId}`, formula: formulas.has(typeId) };
}

function ownerOf(source: SourceRow | undefined, division: number | null): LedgerOwnerView {
	if (!source) return { name: 'Unknown', division: null };
	if (source.kind !== 'corporation' || division === null) return { name: source.owner_name, division: null };
	let names: Record<string, unknown> = {};
	try {
		const parsed: unknown = source.wallet_names_json ? JSON.parse(source.wallet_names_json) : {};
		if (parsed && typeof parsed === 'object') names = parsed as Record<string, unknown>;
	} catch {
		// Unreadable names: default division names below.
	}
	const name = names[String(division)];
	return {
		name: source.owner_name,
		division: typeof name === 'string' && name ? name : `Division ${division}`
	};
}

const correctionOf = (row: PriceColumns): LedgerCorrectionView | null =>
	row.correction_ref === null ? null : { unitPrice: row.corrected_price ?? 0, note: row.correction_note };

/** The rows of `entries` (in that order), with prices, sources, corrections and contract items. */
async function hydrate(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	entries: EntryKey[],
	sources: SourceRow[]
): Promise<LedgerRow[]> {
	if (entries.length === 0) return [];
	const db = env.DB;
	const tradeIds = JSON.stringify(entries.filter((e) => e.kind === 'market').map((e) => e.id));
	const contractIds = JSON.stringify(entries.filter((e) => e.kind === 'contract').map((e) => e.id));
	const manualIds = JSON.stringify(entries.filter((e) => e.kind === 'manual').map((e) => e.id));
	const [[tradesRes, contractsRes, pricesRes, itemsRes, manualRes], dataset] = await Promise.all([
		db.batch([
			db.prepare(SQL.trades).bind(userId, tradeIds),
			db.prepare(SQL.contracts).bind(userId, contractIds),
			db.prepare(SQL.contractPrices).bind(userId, contractIds),
			db.prepare(SQL.transferItems).bind(userId, contractIds),
			db.prepare(SQL.manual).bind(userId, manualIds)
		]),
		getDataset(env)
	]);
	const formulas = new Set(dataset?.reactions.map((r) => r.blueprintTypeId) ?? []);
	const type = (typeId: number) => itemType(dataset, formulas, typeId);
	const sourceById = new Map(sources.map((s) => [s.source_id, s]));

	const pricesByContract = new Map<number, (PriceColumns & { contract_id: number })[]>();
	for (const p of pricesRes.results as unknown as (PriceColumns & { contract_id: number })[]) {
		pricesByContract.set(p.contract_id, [...(pricesByContract.get(p.contract_id) ?? []), p]);
	}
	const itemsByContract = new Map<number, { type_id: number; quantity: number }[]>();
	for (const i of itemsRes.results as { contract_id: number; type_id: number; quantity: number }[]) {
		itemsByContract.set(i.contract_id, [...(itemsByContract.get(i.contract_id) ?? []), i]);
	}

	const trades = new Map(
		(tradesRes.results as unknown as TradeRow[]).map((t): [number, LedgerTradeRow] => [
			t.transaction_id,
			{
				kind: 'market',
				transactionId: t.transaction_id,
				at: t.at,
				owner: ownerOf(sourceById.get(t.source_id), t.division),
				direction: t.transfer ? 'transfer' : t.incoming ? 'bought' : 'sold',
				...type(t.type_id),
				quantity: t.quantity,
				grossUnitPrice: t.gross_unit_price,
				tax: t.tax,
				taxSource: feeSource(t.tax_source),
				brokerFee: t.broker_fee,
				brokerFeeSource: feeSource(t.broker_fee_source),
				price: {
					kind: 'transaction',
					ref: `transaction:${t.transaction_id}`,
					unitPrice: t.unit_price,
					total: t.unit_price * t.quantity,
					sourceKind: t.source_kind,
					sourceText: t.source_text,
					needsReview: Boolean(t.needs_review),
					correction: correctionOf(t)
				}
			}
		])
	);

	const contracts = new Map(
		(contractsRes.results as unknown as ContractRow[]).map((c): [number, LedgerContractRow] => {
			const prices = pricesByContract.get(c.contract_id) ?? [];
			const items: LedgerContractItemRow[] = prices.length
				? prices.map((p) => ({
						...type(p.type_id),
						quantity: p.quantity,
						incoming: Boolean(p.incoming),
						price: {
							kind: 'contract_item',
							ref: `contract:${c.contract_id}:${p.type_id}`,
							unitPrice: p.unit_price,
							total: p.unit_price * p.quantity,
							sourceKind: p.source_kind,
							sourceText: p.source_text,
							needsReview: Boolean(p.needs_review),
							correction: correctionOf(p)
						}
					}))
				: (itemsByContract.get(c.contract_id) ?? []).map((i) => ({
						...type(i.type_id),
						quantity: i.quantity,
						incoming: null,
						price: null
					}));
			const hasIn = items.some((i) => i.incoming === true);
			const hasOut = items.some((i) => i.incoming === false);
			return [
				c.contract_id,
				{
					kind: 'contract',
					contractId: c.contract_id,
					// Priced contracts are dated by the rebuild (as in `ENTRIES`), transfers by the contract.
					at: prices.length ? Math.max(...prices.map((p) => p.at)) : c.at,
					owner: ownerOf(sourceById.get(c.source_id), null),
					direction: !prices.length ? 'transfer' : hasIn && hasOut ? 'swap' : hasIn ? 'buy' : 'sell',
					title: c.title || null,
					janiceCode: c.janice_code,
					total: Math.abs((c.price ?? 0) - (c.reward ?? 0)),
					itemCount: items.length,
					needsReview: items.some((i) => i.price?.needsReview),
					items
				}
			];
		})
	);

	const manual = new Map(
		(
			manualRes.results as {
				entry_id: number;
				date: number;
				type_id: number;
				quantity: number;
				unit_price: number;
				note: string | null;
			}[]
		).map((m): [number, LedgerManualRow] => [
			m.entry_id,
			{
				kind: 'manual',
				entryId: m.entry_id,
				at: m.date,
				...type(m.type_id),
				quantity: m.quantity,
				unitPrice: m.unit_price,
				total: m.unit_price * m.quantity,
				note: m.note
			}
		])
	);

	const rowsByKind = { market: trades, contract: contracts, manual };
	return entries.flatMap((e) => rowsByKind[e.kind].get(e.id) ?? []);
}

/**
 * One page (`PAGE_SIZE`, newest first, clamped to the last page) of `userId`'s ledger entries matching
 * `filters`: the ledger table and its JSON endpoint `/profits/data/ledger`.
 */
export async function ledgerRows(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	filters: LedgerFilters,
	page: number,
	now = Date.now()
): Promise<Paged<LedgerRow>> {
	const db = env.DB;
	const [keysRes, sourcesRes] = await db.batch([
		db.prepare(SQL.keys).bind(...filterParams(userId, filters, now)),
		db.prepare(SQL.sources).bind(userId)
	]);
	const paged = paginate(keysRes.results as EntryKey[], page);
	const rows = await hydrate(env, userId, paged.rows, sourcesRes.results as unknown as SourceRow[]);
	return { ...paged, rows };
}

/**
 * The `/profits/ledger` page of `userId`: the totals of the entries matching `filters`, one page of
 * them (`ledgerRows`), the filter choices and the recalculation state.
 */
export async function ledgerPage(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	filters: LedgerFilters,
	page: number,
	now = Date.now()
): Promise<LedgerPageData> {
	const db = env.DB;
	// "Other market fees" belong to no item, contract or entered purchase: only without filters that
	// select those.
	const withOtherFees =
		filters.typeId === null &&
		filters.direction === null &&
		(filters.kind === null || filters.kind === 'market') &&
		!filters.review;
	const since = filters.period === null ? null : now - filters.period * DAY_MS;
	const [summaryRes, otherRes, trackedRes, typesRes, sourcesRes, stateRes] = await db.batch([
		db.prepare(SQL.summary).bind(...filterParams(userId, filters, now)),
		db.prepare(SQL.otherFees).bind(userId, since, filters.connection),
		db.prepare(SQL.tracked).bind(userId),
		db.prepare(SQL.types).bind(userId),
		db.prepare(SQL.sources).bind(userId),
		db.prepare(SQL.state).bind(userId)
	]);
	const [rows, dataset, missing] = await Promise.all([
		ledgerRows(env, userId, filters, page, now),
		getDataset(env),
		reconcileCounts(env, userId)
	]);
	const sums = summaryRes.results[0] as unknown as SummaryRow;
	const otherMarketFees = withOtherFees ? ((otherRes.results[0] as { n: number } | undefined)?.n ?? 0) : 0;
	const summary: LedgerSummary = {
		bought: sums.bought,
		sold: sums.sold,
		fees: {
			brokerFees: sums.broker,
			salesTax: sums.tax,
			contractFees: sums.contract_fees,
			otherMarketFees,
			total: sums.broker + sums.tax + sums.contract_fees + otherMarketFees,
			estimated: Boolean(sums.estimated)
		},
		reviewCount: sums.review
	};
	const formulas = new Set(dataset?.reactions.map((r) => r.blueprintTypeId) ?? []);
	const state = stateRes.results[0] as { rebuilt_at: number | null; dirty: number } | undefined;
	return {
		filters,
		tracked: Boolean((trackedRes.results[0] as { n: number } | undefined)?.n),
		summary,
		rows,
		rebuiltAt: state?.rebuilt_at ?? null,
		dirty: Boolean(state?.dirty),
		missingCount: missing.total,
		types: (typesRes.results as { type_id: number }[])
			.map((t) => itemType(dataset, formulas, t.type_id))
			.sort((a, b) => a.name.localeCompare(b.name) || a.typeId - b.typeId),
		connections: (sourcesRes.results as unknown as SourceRow[]).map((s): LedgerConnectionOption => ({
			sourceId: s.source_id,
			name: s.owner_name,
			kind: s.kind
		}))
	};
}

/** Page data while the profits layout shows its login / enable message instead of the page. */
export function emptyLedgerPage(filters: LedgerFilters): LedgerPageData {
	return {
		filters,
		tracked: false,
		summary: {
			bought: 0,
			sold: 0,
			fees: {
				brokerFees: 0,
				salesTax: 0,
				contractFees: 0,
				otherMarketFees: 0,
				total: 0,
				estimated: false
			},
			reviewCount: 0
		},
		rows: paginate([], 1),
		rebuiltAt: null,
		dirty: false,
		missingCount: 0,
		types: [],
		connections: []
	};
}

/**
 * Ledger entries of `userId` needing review (the count `/profits/ledger?review=1` lists): trades and
 * contracts of connections with Profit tracking on with any price needing review.
 */
export async function ledgerReviewCount(env: Pick<Env, 'DB'>, userId: string): Promise<number> {
	const row = await env.DB.prepare(SQL.review).bind(userId).first<{ n: number }>();
	return row?.n ?? 0;
}
