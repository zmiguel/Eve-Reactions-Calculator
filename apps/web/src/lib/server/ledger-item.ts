import { manufacturingNames, stockUnitValue, type Dataset } from '@reactions/engine';
import {
	getCoreDb,
	inventorySources,
	ledgerLots,
	ledgerPrices,
	ledgerUses,
	trackedContractItems,
	trackedContracts,
	trackedJobs
} from '@reactions/db';
import { and, asc, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type {
	LedgerItemLot,
	LedgerItemLotUse,
	LedgerItemPageData,
	LedgerItemTrade,
	LedgerItemType
} from '$lib/ledger/types';
import { paginate, type Paged } from '$lib/paging';
import { loadCalc } from './context.ts';
import { getDataset } from './data.ts';
import { correctionRef } from './price-corrections.ts';

/** Whether `id` is a positive integer type id (route param). */
export const isTypeId = (id: number) => Number.isSafeInteger(id) && id > 0;

export const refId = (ref: string, prefix: string): number | null => {
	if (!ref.startsWith(prefix)) return null;
	const id = Number(ref.slice(prefix.length));
	return Number.isSafeInteger(id) ? id : null;
};

/**
 * True when `ref` (`transaction:<id>`, `contract:<id>` or `job:<id>`) is a raw row of one of the
 * user's connections with Profit tracking on, or (`manual:<entryId>`) a purchase the user entered. The
 * rebuild only reads those connections; this keeps rows of a connection switched off (or a purchase
 * deleted) since the last rebuild out of the page.
 */
export function trackedRef(userId: string, ref: SQLWrapper): SQL {
	const on = (table: SQL, alias: string, idColumn: string, prefixLength: number) => sql`EXISTS (
		SELECT 1 FROM ${table} ${sql.raw(alias)}
		JOIN ${inventorySources} s ON s.source_id = ${sql.raw(alias)}.source_id
		WHERE ${sql.raw(alias)}.user_id = ${userId} AND s.tracking_enabled = 1
			AND ${sql.raw(`${alias}.${idColumn}`)} = CAST(substr(${ref}, ${prefixLength + 1}) AS INTEGER))`;
	return sql`(
		(${ref} LIKE 'transaction:%' AND ${on(sql`tracked_transactions`, 't', 'transaction_id', 12)})
		OR (${ref} LIKE 'contract:%' AND ${on(sql`tracked_contracts`, 'c', 'contract_id', 9)})
		OR (${ref} LIKE 'job:%' AND ${on(sql`tracked_jobs`, 'j', 'job_id', 4)})
		OR (${ref} LIKE 'manual:%' AND EXISTS (SELECT 1 FROM manual_entries m WHERE m.user_id = ${userId}
			AND m.entry_id = CAST(substr(${ref}, 8) AS INTEGER))))`;
}

/** The dataset and the item `typeId` names, or null when the type is not in the dataset. */
async function itemOf(
	env: Pick<Env, 'CACHE'>,
	typeId: number
): Promise<{ dataset: Dataset; item: LedgerItemType } | null> {
	const dataset = await getDataset(env);
	const type = isTypeId(typeId) ? dataset?.types[typeId] : undefined;
	if (!dataset || !type) return null;
	const formula = dataset.reactions.some((r) => r.blueprintTypeId === typeId);
	return { dataset, item: { typeId, name: type.name, formula } };
}

/**
 * The user's batches (FIFO lots) of `typeId` from tracking-on connections and purchases the user
 * entered, oldest first, each with what took from it (jobs, manufacturing jobs and sales).
 */
async function itemLots(
	env: Pick<Env, 'DB'>,
	dataset: Dataset,
	userId: string,
	typeId: number
): Promise<LedgerItemLot[]> {
	const db = getCoreDb(env.DB);
	const [lotRows, useRows] = await Promise.all([
		db
			.select({
				lotId: ledgerLots.lotId,
				acquiredAt: ledgerLots.acquiredAt,
				quantity: ledgerLots.quantity,
				remaining: ledgerLots.remaining,
				unitCost: ledgerLots.unitCost,
				origin: ledgerLots.origin,
				originRef: ledgerLots.originRef,
				priceSource: ledgerLots.priceSource,
				blueprintTypeId: trackedJobs.blueprintTypeId
			})
			.from(ledgerLots)
			// The job that made the batch, or whose input it priced.
			.leftJoin(
				trackedJobs,
				and(
					eq(trackedJobs.userId, ledgerLots.userId),
					sql`${ledgerLots.originRef} GLOB 'job:*'`,
					sql`${trackedJobs.jobId} = CAST(substr(${ledgerLots.originRef}, 5) AS INTEGER)`
				)
			)
			.where(
				and(
					eq(ledgerLots.userId, userId),
					eq(ledgerLots.typeId, typeId),
					trackedRef(userId, ledgerLots.originRef)
				)
			)
			.orderBy(asc(ledgerLots.acquiredAt), asc(ledgerLots.lotId)),
		db
			.select({
				lotId: ledgerUses.lotId,
				kind: ledgerUses.useKind,
				ref: ledgerUses.useRef,
				quantity: ledgerUses.quantity,
				unitCost: ledgerUses.unitCost,
				unitValue: ledgerUses.unitValue,
				blueprintTypeId: trackedJobs.blueprintTypeId,
				productTypeId: trackedJobs.productTypeId,
				startDate: trackedJobs.startDate,
				saleAt: ledgerPrices.at,
				saleUnitPrice: ledgerPrices.unitPrice
			})
			.from(ledgerUses)
			.innerJoin(
				ledgerLots,
				and(eq(ledgerLots.userId, ledgerUses.userId), eq(ledgerLots.lotId, ledgerUses.lotId))
			)
			.leftJoin(
				trackedJobs,
				and(
					inArray(ledgerUses.useKind, ['job', 'manufacturing']),
					eq(trackedJobs.userId, ledgerUses.userId),
					sql`${trackedJobs.jobId} = CAST(substr(${ledgerUses.useRef}, 5) AS INTEGER)`
				)
			)
			.leftJoin(
				ledgerPrices,
				and(
					eq(ledgerUses.useKind, 'sale'),
					eq(ledgerPrices.userId, ledgerUses.userId),
					eq(ledgerPrices.ref, ledgerUses.useRef),
					eq(ledgerPrices.typeId, ledgerLots.typeId),
					eq(ledgerPrices.incoming, false)
				)
			)
			.where(
				and(
					eq(ledgerUses.userId, userId),
					eq(ledgerLots.typeId, typeId),
					inArray(ledgerUses.useKind, ['job', 'sale', 'manufacturing']),
					trackedRef(userId, ledgerLots.originRef),
					trackedRef(userId, ledgerUses.useRef)
				)
			)
			.orderBy(asc(ledgerUses.lotId), asc(ledgerUses.useRef))
	]);

	const formulas = new Map(dataset.reactions.map((r) => [r.blueprintTypeId, r.formulaName]));
	const usesByLot = new Map<number, LedgerItemLotUse[]>();
	for (const u of useRows) {
		const kind = u.kind === 'job' || u.kind === 'manufacturing' ? u.kind : 'sale';
		const job = kind !== 'sale';
		const name = kind === 'job' && u.blueprintTypeId !== null ? formulas.get(u.blueprintTypeId) : undefined;
		const productName =
			kind !== 'manufacturing'
				? undefined
				: u.blueprintTypeId !== null
					? (manufacturingNames(dataset, u.blueprintTypeId).product ??
						(u.productTypeId !== null ? dataset.types[u.productTypeId]?.name : undefined))
					: u.productTypeId !== null
						? dataset.types[u.productTypeId]?.name
						: undefined;
		const use: LedgerItemLotUse = {
			kind,
			ref: u.ref,
			jobId: job ? refId(u.ref, 'job:') : null,
			formula: u.blueprintTypeId !== null && name ? { blueprintTypeId: u.blueprintTypeId, name } : null,
			product:
				u.productTypeId !== null && productName ? { typeId: u.productTypeId, name: productName } : null,
			at: job ? u.startDate : u.saleAt,
			saleUnitPrice: job ? null : u.saleUnitPrice,
			unitValue: kind === 'manufacturing' ? (u.unitValue ?? u.unitCost) : null,
			quantity: u.quantity,
			unitCost: u.unitCost
		};
		const lotUses = usesByLot.get(u.lotId);
		if (lotUses) lotUses.push(use);
		else usesByLot.set(u.lotId, [use]);
	}

	return lotRows.map((l): LedgerItemLot => {
		const jobId = refId(l.originRef, 'job:');
		const jobInput = jobId !== null && (l.origin === 'market' || l.origin === 'correction');
		return {
			lotId: l.lotId,
			acquiredAt: l.acquiredAt,
			origin: l.origin,
			jobId,
			jobFormula: l.blueprintTypeId === null ? null : (formulas.get(l.blueprintTypeId) ?? null),
			priceSource: l.priceSource,
			quantity: l.quantity,
			remaining: l.remaining,
			unitCost: l.unitCost,
			correctionRef: jobInput ? correctionRef({ kind: 'job_input', jobId, typeId }) : null,
			corrected: jobInput && l.origin === 'correction',
			uses: usesByLot.get(l.lotId) ?? []
		};
	});
}

/** The user's purchases, sales and transfers of `typeId` (tracking-on connections), newest first. */
async function itemTrades(env: Pick<Env, 'DB'>, userId: string, typeId: number): Promise<LedgerItemTrade[]> {
	const db = getCoreDb(env.DB);
	const [priceRows, transferRows] = await Promise.all([
		db
			.select({
				ref: ledgerPrices.ref,
				incoming: ledgerPrices.incoming,
				at: ledgerPrices.at,
				quantity: ledgerPrices.quantity,
				unitPrice: ledgerPrices.unitPrice,
				sourceKind: ledgerPrices.sourceKind,
				sourceText: ledgerPrices.sourceText,
				needsReview: ledgerPrices.needsReview,
				taxSource: ledgerPrices.taxSource,
				brokerFeeSource: ledgerPrices.brokerFeeSource,
				transfer: ledgerPrices.transfer
			})
			.from(ledgerPrices)
			.where(
				and(
					eq(ledgerPrices.userId, userId),
					eq(ledgerPrices.typeId, typeId),
					trackedRef(userId, ledgerPrices.ref)
				)
			),
		// Transfer contracts (both sides own) have no `ledger_prices` rows.
		db
			.select({
				contractId: trackedContracts.contractId,
				at: sql<number>`coalesce(${trackedContracts.dateCompleted}, ${trackedContracts.dateIssued})`,
				quantity: sql<number>`sum(${trackedContractItems.quantity})`
			})
			.from(trackedContracts)
			.innerJoin(inventorySources, eq(inventorySources.sourceId, trackedContracts.sourceId))
			.innerJoin(
				trackedContractItems,
				and(
					eq(trackedContractItems.userId, trackedContracts.userId),
					eq(trackedContractItems.contractId, trackedContracts.contractId)
				)
			)
			.where(
				and(
					eq(trackedContracts.userId, userId),
					eq(inventorySources.userId, userId),
					eq(inventorySources.trackingEnabled, true),
					eq(trackedContractItems.typeId, typeId),
					sql`NOT EXISTS (SELECT 1 FROM ${ledgerPrices} p WHERE p.user_id = ${userId}
						AND p.ref = 'contract:' || ${trackedContracts.contractId})`
				)
			)
			.groupBy(trackedContracts.contractId)
	]);

	return [
		...priceRows.map((p): LedgerItemTrade => ({
			ref: p.ref,
			kind: p.ref.startsWith('contract:') ? 'contract' : 'market',
			direction: p.transfer ? 'transfer' : p.incoming ? 'in' : 'out',
			at: p.at,
			quantity: p.quantity,
			unitPrice: p.unitPrice,
			sourceKind: p.sourceKind,
			sourceText: p.sourceText,
			needsReview: p.needsReview,
			estimatedFees: !p.transfer && (p.taxSource === 'estimated' || p.brokerFeeSource === 'estimated')
		})),
		...transferRows.map((c): LedgerItemTrade => ({
			ref: `contract:${c.contractId}`,
			kind: 'contract',
			direction: 'transfer',
			at: c.at,
			quantity: c.quantity,
			unitPrice: null,
			sourceKind: null,
			sourceText: null,
			needsReview: false,
			estimatedFees: false
		}))
	].sort((a, b) => b.at - a.at || a.ref.localeCompare(b.ref));
}

/** One page of the item's batches (the item page table and `/profits/data/item-batches`); null for an unknown type. */
export async function ledgerItemBatches(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	typeId: number,
	page: number
): Promise<Paged<LedgerItemLot> | null> {
	const found = await itemOf(env, typeId);
	return found && paginate(await itemLots(env, found.dataset, userId, typeId), page);
}

/** One page of the item's trades (the item page table and `/profits/data/item-trades`); null for an unknown type. */
export async function ledgerItemTrades(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	typeId: number,
	page: number
): Promise<Paged<LedgerItemTrade> | null> {
	if (!(await itemOf(env, typeId))) return null;
	return paginate(await itemTrades(env, userId, typeId), page);
}

/**
 * The `/profits/ledger/[typeId]` page: what the user holds of `typeId` (remaining batches of tracking-on
 * connections) at what average cost, its value today with the visitor's settings (`stockUnitValue`), the
 * batches and the trades, one page each. Null when the type is not in the dataset.
 */
export async function ledgerItemPage(
	env: Env,
	locals: Pick<App.Locals, 'settings' | 'user'>,
	userId: string,
	typeId: number,
	pages: { batches: number; trades: number }
): Promise<LedgerItemPageData | null> {
	const found = await itemOf(env, typeId);
	if (!found) return null;
	const [lots, trades, calc] = await Promise.all([
		itemLots(env, found.dataset, userId, typeId),
		itemTrades(env, userId, typeId),
		loadCalc(env, locals)
	]);

	let heldQuantity = 0;
	let heldCost = 0;
	for (const l of lots) {
		heldQuantity += l.remaining;
		heldCost += l.remaining * l.unitCost;
	}
	const unitValue = calc ? stockUnitValue(calc.ctx, typeId) : null;
	return {
		item: found.item,
		heldQuantity,
		averagePaid: heldQuantity > 0 ? heldCost / heldQuantity : null,
		unitValue,
		gain: heldQuantity > 0 && unitValue !== null ? heldQuantity * unitValue - heldCost : null,
		points: lots.map((l) => ({
			at: l.acquiredAt,
			unitCost: l.unitCost,
			quantity: l.quantity,
			origin: l.origin
		})),
		batches: paginate(lots, pages.batches),
		trades: paginate(trades, pages.trades)
	};
}

/** Page data while the profits layout shows its login / enable message instead of the page. */
export function emptyItemPage(typeId: number): LedgerItemPageData {
	const none = paginate([], 1);
	return {
		item: { typeId, name: '', formula: false },
		heldQuantity: 0,
		averagePaid: null,
		unitValue: null,
		gain: null,
		points: [],
		batches: none,
		trades: none
	};
}
