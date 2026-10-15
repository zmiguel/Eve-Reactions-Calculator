import type {
	FeeSource,
	LedgerContract,
	LedgerCorrection,
	LedgerJournalRow,
	LedgerOrder,
	LedgerTransaction,
	OwnParties,
	PriceSource,
	PricedContract,
	PricedContractItem,
	PricedTrade,
	ReferencePrice,
	ReferencePriceFn,
	TrackingSettings,
	UnallocatedFee
} from './types.ts';

/**
 * Prices of what was paid and received (PLAN "Prices of what was paid and received"): market
 * transactions with their tax and broker fees, and contracts split across their items.
 */

const SECOND_MS = 1000;
const FEE_REF_TYPES: Record<string, true> = { brokers_fee: true, market_provider_tax: true };

/** `YYYY-MM-DD HH:MM UTC`. */
function formatTime(ms: number): string {
	const iso = new Date(ms).toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** One decimal, e.g. `92.4%`. */
function formatPct(pct: number): string {
	return `${pct.toFixed(1)}%`;
}

function roundCents(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Splits `total` over lines in proportion to `quantity × weight` and returns each line's unit price.
 * Line totals are whole cents (largest remainder, ties to the earlier line) and sum exactly to
 * `total` rounded to 0.01. All weights 0 → split by quantity. A line with quantity 0 gets 0.
 */
export function allocateTotal(
	total: number,
	lines: readonly { quantity: number; weight: number }[]
): number[] {
	if (lines.length === 0) return [];
	const totalCents = Math.round(total * 100);
	const allZero = lines.every((line) => !(line.weight > 0));
	const shares = lines.map((line) => {
		const quantity = Math.max(0, line.quantity);
		return allZero ? quantity : quantity * Math.max(0, line.weight);
	});
	const shareSum = shares.reduce((sum, share) => sum + share, 0);
	if (shareSum <= 0) return lines.map(() => 0);

	const exact = shares.map((share) => (totalCents * share) / shareSum);
	const cents = exact.map((value) => Math.floor(value + 1e-9));
	let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
	const order = exact
		.map((value, index) => ({ index, fraction: value - cents[index] }))
		.sort((a, b) => (Math.abs(a.fraction - b.fraction) > 1e-9 ? b.fraction - a.fraction : a.index - b.index));
	for (let i = 0; remainder > 0 && order.length > 0; i = (i + 1) % order.length, remainder--) {
		cents[order[i].index]++;
	}
	return lines.map((line, index) => (line.quantity > 0 ? cents[index] / 100 / line.quantity : 0));
}

/** The id is one of the user's characters or one of their connections' corporations. */
export function isOwnParty(id: number, own: OwnParties): boolean {
	return own.characterIds.has(id) || own.corporationIds.has(id);
}

// ---- Contracts ----

interface ContractLine {
	typeId: number;
	quantity: number;
	incoming: boolean;
}

function janiceUnitPrice(
	item: { buyPrice: number; splitPrice: number; sellPrice: number },
	pricing: string
): number {
	if (pricing === 'sell') return item.sellPrice;
	if (pricing === 'split') return item.splitPrice;
	return item.buyPrice;
}

function contractCorrections(
	contractId: number,
	corrections: readonly LedgerCorrection[]
): Map<number, number> {
	const prefix = `contract:${contractId}:`;
	const byType = new Map<number, number>();
	for (const correction of corrections) {
		if (correction.targetKind !== 'contract_item' || !correction.targetRef.startsWith(prefix)) continue;
		const typeId = Number(correction.targetRef.slice(prefix.length));
		if (!Number.isInteger(typeId)) continue;
		// One correction per target is expected; keep the lowest price if several exist (order independent).
		const previous = byType.get(typeId);
		byType.set(
			typeId,
			previous === undefined ? correction.unitPrice : Math.min(previous, correction.unitPrice)
		);
	}
	return byType;
}

const CORRECTION_SOURCE: PriceSource = { kind: 'correction', text: 'Your correction', needsReview: false };
const UNTRACKED_SOURCE: PriceSource = {
	kind: 'untracked',
	text: 'Not tracked: not used by any reaction',
	needsReview: false
};
const NO_REFERENCE_SOURCE: PriceSource = {
	kind: 'review',
	text: 'No reference price for this item: check',
	needsReview: true
};

/**
 * Unit prices of `lines` sharing `amount`: corrected lines keep their price, the rest of the amount is
 * split over the others in proportion to `quantity × weight` (see {@link allocateTotal}).
 */
function splitAmount(
	amount: number,
	lines: readonly ContractLine[],
	weights: readonly number[],
	corrected: ReadonlyMap<number, number>
): number[] {
	const unitPrices: number[] = lines.map(() => 0);
	const free: number[] = [];
	let correctedTotal = 0;
	lines.forEach((line, index) => {
		const correction = corrected.get(line.typeId);
		if (correction === undefined) {
			free.push(index);
		} else {
			unitPrices[index] = correction;
			correctedTotal += roundCents(correction * line.quantity);
		}
	});
	const freePrices = allocateTotal(
		Math.max(0, amount - correctedTotal),
		free.map((index) => ({ quantity: lines[index].quantity, weight: weights[index] }))
	);
	free.forEach((lineIndex, i) => {
		unitPrices[lineIndex] = freePrices[i];
	});
	return unitPrices;
}

/**
 * Weights of untracked lines sharing an amount: their reference prices when every line has one, else
 * 0 each (split by quantity).
 */
function untrackedWeights(references: readonly (ReferencePrice | null)[]): number[] {
	return references.every((reference) => reference !== null)
		? references.map((reference) => reference!.unitPrice)
		: references.map(() => 0);
}

/**
 * A buy or sell contract with tracked and untracked lines and no Janice appraisal of every line: each
 * tracked line is worth its reference price × the rule's expected % (all of them scaled down together
 * when that exceeds the amount left after corrected lines); a tracked line without a reference price
 * gets 0 and needs review; the untracked lines share what is left.
 */
function priceMixed(
	lines: readonly ContractLine[],
	isTracked: readonly boolean[],
	amount: number,
	expectedPct: number,
	references: readonly (ReferencePrice | null)[],
	corrected: ReadonlyMap<number, number>
): { unitPrices: number[]; sources: PriceSource[] } {
	const unitPrices: number[] = lines.map(() => 0);
	const sources: PriceSource[] = lines.map(() => UNTRACKED_SOURCE);
	const valued: number[] = [];
	let correctedTotal = 0;
	let valuedTotal = 0;
	lines.forEach((line, index) => {
		if (!isTracked[index]) return;
		const correction = corrected.get(line.typeId);
		const reference = references[index];
		if (correction !== undefined) {
			unitPrices[index] = correction;
			sources[index] = CORRECTION_SOURCE;
			correctedTotal += roundCents(correction * line.quantity);
		} else if (reference) {
			unitPrices[index] = (reference.unitPrice * expectedPct) / 100;
			valuedTotal += unitPrices[index] * line.quantity;
			valued.push(index);
		} else {
			sources[index] = NO_REFERENCE_SOURCE;
		}
	});
	const rest = Math.max(0, amount - correctedTotal);
	const capped = valuedTotal > rest + 0.005;
	if (capped) {
		const scaled = allocateTotal(
			rest,
			valued.map((index) => ({ quantity: lines[index].quantity, weight: references[index]!.unitPrice }))
		);
		valued.forEach((lineIndex, i) => {
			unitPrices[lineIndex] = scaled[i];
		});
	}
	for (const index of valued) {
		sources[index] = {
			kind: 'contract_mixed',
			text: `Contract with untracked items: valued at ${references[index]!.label} × ${formatPct(expectedPct)}${capped ? ', scaled down to the contract price' : ''}`,
			needsReview: false
		};
	}
	const untracked = lines.flatMap((_, index) => (isTracked[index] ? [] : [index]));
	const weights = untrackedWeights(untracked.map((index) => references[index]));
	const shares = allocateTotal(
		capped ? 0 : Math.max(0, rest - valuedTotal),
		untracked.map((index, i) => ({ quantity: lines[index].quantity, weight: weights[i] }))
	);
	untracked.forEach((lineIndex, i) => {
		unitPrices[lineIndex] = shares[i];
	});
	return { unitPrices, sources };
}

/**
 * Prices a contract from the user's side. Null when no own party is on either side, or when no item
 * changed hands between the user and someone else. The issuing side is own when the issuer is, or
 * when it was issued for an own corporation; the receiving side when the acceptor is, or when the
 * contract was assigned to an own corporation (a member who is none of the user's characters accepted
 * it for the corporation). Items outside `tracked` (`inventoryTypeIds` of the dataset) are priced with
 * kind `untracked`: they never need review and corrections on them are ignored; with tracked items
 * beside them, the tracked ones are valued first (see `priceMixed`) unless a Janice appraisal covers
 * every item.
 */
export function priceContract(
	contract: LedgerContract,
	own: OwnParties,
	settings: TrackingSettings,
	referencePrice: ReferencePriceFn,
	corrections: readonly LedgerCorrection[],
	tracked: ReadonlySet<number>
): PricedContract | null {
	const issuerOwn =
		isOwnParty(contract.issuerId, own) ||
		(contract.forCorporation && isOwnParty(contract.issuerCorporationId, own));
	const acceptorOwn =
		isOwnParty(contract.acceptorId, own) ||
		(contract.acceptorId !== 0 && own.corporationIds.has(contract.assigneeId));
	if (!issuerOwn && !acceptorOwn) return null;

	const ref = `contract:${contract.contractId}`;
	if (issuerOwn && acceptorOwn) {
		return {
			ref,
			contractId: contract.contractId,
			at: contract.completedAt,
			direction: 'transfer',
			iskIn: 0,
			impliedPct: null,
			items: [],
			needsReview: false
		};
	}

	const price = contract.price ?? 0;
	const reward = contract.reward ?? 0;
	const iskIn = issuerOwn ? price - reward : reward - price;

	// Merge records of one type and direction.
	const merged = new Map<string, ContractLine>();
	for (const item of contract.items) {
		const incoming = issuerOwn ? !item.isIncluded : item.isIncluded;
		const key = `${item.typeId}:${incoming}`;
		const line = merged.get(key);
		if (line) line.quantity += item.quantity;
		else merged.set(key, { typeId: item.typeId, quantity: item.quantity, incoming });
	}
	const lines = [...merged.values()].sort(
		(a, b) => a.typeId - b.typeId || Number(b.incoming) - Number(a.incoming)
	);
	if (lines.length === 0) return null;

	const isTracked = lines.map((line) => tracked.has(line.typeId));
	const anyTracked = isTracked.some(Boolean);
	const allTracked = isTracked.every(Boolean);
	const corrected = contractCorrections(contract.contractId, corrections);
	for (const typeId of corrected.keys()) if (!tracked.has(typeId)) corrected.delete(typeId);
	const hasIn = lines.some((line) => line.incoming);
	const hasOut = lines.some((line) => !line.incoming);

	if (hasIn && hasOut) {
		const items = lines.map((line, index): PricedContractItem => {
			const correction = corrected.get(line.typeId);
			if (correction !== undefined) return { ...line, unitPrice: correction, source: CORRECTION_SOURCE };
			const reference = referencePrice(line.typeId, contract.dateIssued);
			if (!isTracked[index]) {
				return { ...line, unitPrice: reference?.unitPrice ?? 0, source: UNTRACKED_SOURCE };
			}
			return {
				...line,
				unitPrice: reference?.unitPrice ?? 0,
				source: {
					kind: 'review',
					text: reference
						? `Items went both ways: valued at ${reference.label}, check`
						: 'Items went both ways and no reference price is known: check',
					needsReview: true
				}
			};
		});
		return {
			ref,
			contractId: contract.contractId,
			at: contract.completedAt,
			direction: 'swap',
			iskIn,
			impliedPct: null,
			items,
			needsReview: items.some((item) => item.source.needsReview)
		};
	}

	const direction = hasIn ? 'buy' : 'sell';
	const amount = Math.max(0, hasIn ? -iskIn : iskIn);

	// Unit prices and per-line sources, first step that applies.
	let unitPrices: number[];
	let sources: PriceSource[];
	let impliedPct: number | null = null;
	const janice = contract.janice;
	const janiceByType = new Map<number, number>();
	if (janice) {
		for (const item of janice.items) {
			const unit = janiceUnitPrice(item, janice.pricing);
			const previous = janiceByType.get(item.typeId);
			janiceByType.set(item.typeId, previous === undefined ? unit : Math.max(previous, unit));
		}
	}

	if (!anyTracked) {
		const references = lines.map((line) => referencePrice(line.typeId, contract.dateIssued));
		unitPrices = splitAmount(amount, lines, untrackedWeights(references), corrected);
		sources = lines.map(() => UNTRACKED_SOURCE);
	} else if (lines.length === 1) {
		unitPrices = splitAmount(amount, lines, [1], corrected);
		sources = [
			{ kind: 'contract_single', text: 'Only item type in the contract: exact price', needsReview: false }
		];
	} else if (janice && lines.every((line) => janiceByType.has(line.typeId))) {
		const weights = lines.map((line) => janiceByType.get(line.typeId) ?? 0);
		unitPrices = splitAmount(amount, lines, weights, corrected);
		const source: PriceSource = {
			kind: 'janice',
			text: `Janice appraisal ${janice.code} (${janice.marketName}, ${janice.pricing}, ${formatTime(janice.datasetTime)})`,
			needsReview: false
		};
		sources = isTracked.map((isLineTracked) => (isLineTracked ? source : UNTRACKED_SOURCE));
	} else if (!allTracked) {
		const references = lines.map((line) => referencePrice(line.typeId, contract.dateIssued));
		({ unitPrices, sources } = priceMixed(
			lines,
			isTracked,
			amount,
			settings.contractRule.expectedPct,
			references,
			corrected
		));
	} else {
		const references = lines.map((line) => referencePrice(line.typeId, contract.dateIssued));
		const referenceTotal = lines.reduce(
			(sum, line, index) => sum + line.quantity * (references[index]?.unitPrice ?? 0),
			0
		);
		impliedPct = referenceTotal > 0 ? (amount / referenceTotal) * 100 : null;
		const { expectedPct, tolerancePct } = settings.contractRule;
		const inside = impliedPct !== null && Math.abs(impliedPct - expectedPct) <= tolerancePct + 1e-9;
		const pctText = impliedPct === null ? 'unknown %' : formatPct(impliedPct);
		unitPrices = splitAmount(
			amount,
			lines,
			references.map((reference) => reference?.unitPrice ?? 0),
			corrected
		);
		sources = references.map((reference): PriceSource => {
			if (!reference) return NO_REFERENCE_SOURCE;
			return inside
				? { kind: 'rule_match', text: `Matches ${reference.label} × ${pctText}`, needsReview: false }
				: {
						kind: 'rule_outside',
						text: `Outside your rule (${pctText} of ${reference.label}): check`,
						needsReview: true
					};
		});
	}

	const items = lines.map((line, index): PricedContractItem => ({
		...line,
		unitPrice: unitPrices[index],
		source: corrected.has(line.typeId) ? CORRECTION_SOURCE : sources[index]
	}));
	return {
		ref,
		contractId: contract.contractId,
		at: contract.completedAt,
		direction,
		iskIn,
		impliedPct,
		items,
		needsReview: items.some((item) => item.source.needsReview)
	};
}

// ---- Market transactions ----

function walletKey(sourceId: number, division: number | null): string {
	return `${sourceId}:${division ?? ''}`;
}

interface PriceTradesInput {
	transactions: readonly LedgerTransaction[];
	journal: readonly LedgerJournalRow[];
	orders: readonly LedgerOrder[];
	own: OwnParties;
	/** Account broker fee % (estimate when no order can be read). */
	brokerFeePct: number;
	/** Account sales tax % (estimate when no `transaction_tax` row matches). */
	salesTaxPct: number;
	/** `sourceId`s whose order stream is readable. */
	ordersAvailable: ReadonlySet<number>;
	corrections: readonly LedgerCorrection[];
	/** Types the ledger tracks (`inventoryTypeIds` of the dataset); other trades are `untracked`. */
	tracked: ReadonlySet<number>;
}

/**
 * Market transactions with sales tax (journal `transaction_tax` rows at the same second) and broker
 * fees (the matched order's fee rows at its `issued` second, spread over its filled units). Fee rows
 * no matched order uses are returned as `unallocatedFees`. Trades of untracked types keep their fees
 * but get kind `untracked` (no review, corrections ignored).
 */
export function priceTrades(input: PriceTradesInput): {
	trades: PricedTrade[];
	unallocatedFees: UnallocatedFee[];
} {
	const transactions = [...input.transactions].sort(
		(a, b) => a.date - b.date || a.transactionId - b.transactionId
	);
	const journal = [...input.journal].sort((a, b) => a.date - b.date || a.refId - b.refId);

	// Sales tax: per wallet and second, the tax rows' total split over that second's sales by value.
	const taxRows = new Map<string, number>();
	for (const row of journal) {
		if (row.refType !== 'transaction_tax') continue;
		const key = `${walletKey(row.sourceId, row.division)}@${Math.floor(row.date / SECOND_MS)}`;
		taxRows.set(key, (taxRows.get(key) ?? 0) + Math.abs(row.amount ?? 0));
	}
	const salesBySecond = new Map<string, LedgerTransaction[]>();
	for (const tx of transactions) {
		if (tx.isBuy) continue;
		const key = `${walletKey(tx.sourceId, tx.division)}@${Math.floor(tx.date / SECOND_MS)}`;
		const group = salesBySecond.get(key);
		if (group) group.push(tx);
		else salesBySecond.set(key, [tx]);
	}
	const journalTax = new Map<number, number>();
	for (const [key, sales] of salesBySecond) {
		const total = taxRows.get(key);
		if (total === undefined) continue;
		const units = allocateTotal(
			total,
			sales.map((tx) => ({ quantity: tx.quantity, weight: tx.unitPrice }))
		);
		sales.forEach((tx, index) => journalTax.set(tx.transactionId, roundCents(units[index] * tx.quantity)));
	}

	// Broker fees: match each transaction to the latest order issued at or before it.
	const ordersByKey = new Map<string, LedgerOrder[]>();
	for (const order of input.orders) {
		const key = `${walletKey(order.sourceId, order.division)}|${order.typeId}|${order.isBuy}|${order.locationId}`;
		const group = ordersByKey.get(key);
		if (group) group.push(order);
		else ordersByKey.set(key, [order]);
	}
	const matchedOrder = new Map<number, LedgerOrder>();
	const matchedQuantity = new Map<number, number>();
	const matchedOrders = new Map<number, LedgerOrder>();
	for (const tx of transactions) {
		const key = `${walletKey(tx.sourceId, tx.division)}|${tx.typeId}|${tx.isBuy}|${tx.locationId}`;
		let best: LedgerOrder | null = null;
		for (const order of ordersByKey.get(key) ?? []) {
			if (order.price !== tx.unitPrice || order.issued > tx.date) continue;
			if (
				!best ||
				order.issued > best.issued ||
				(order.issued === best.issued && order.orderId > best.orderId)
			) {
				best = order;
			}
		}
		if (!best) continue;
		matchedOrder.set(tx.transactionId, best);
		matchedOrders.set(best.orderId, best);
		matchedQuantity.set(best.orderId, (matchedQuantity.get(best.orderId) ?? 0) + tx.quantity);
	}

	// Fee rows go to the matched orders of their wallet issued within 1 s; a row near several orders
	// is split by order value.
	const ordersByWallet = new Map<string, LedgerOrder[]>();
	for (const order of [...matchedOrders.values()].sort((a, b) => a.orderId - b.orderId)) {
		const key = walletKey(order.sourceId, order.division);
		const group = ordersByWallet.get(key);
		if (group) group.push(order);
		else ordersByWallet.set(key, [order]);
	}
	const orderFees = new Map<number, number>();
	const unallocatedFees: UnallocatedFee[] = [];
	for (const row of journal) {
		if (FEE_REF_TYPES[row.refType] !== true) continue;
		const amount = Math.abs(row.amount ?? 0);
		const near = (ordersByWallet.get(walletKey(row.sourceId, row.division)) ?? []).filter(
			(order) => Math.abs(row.date - order.issued) <= SECOND_MS
		);
		if (near.length === 0) {
			unallocatedFees.push({ refId: row.refId, date: row.date, amount });
			continue;
		}
		const units = allocateTotal(
			amount,
			near.map((order) => ({ quantity: 1, weight: order.price * order.volumeTotal }))
		);
		near.forEach((order, index) =>
			orderFees.set(order.orderId, (orderFees.get(order.orderId) ?? 0) + units[index])
		);
	}

	const transactionCorrections = new Map<string, number>();
	for (const correction of input.corrections) {
		if (correction.targetKind !== 'transaction') continue;
		const previous = transactionCorrections.get(correction.targetRef);
		transactionCorrections.set(
			correction.targetRef,
			previous === undefined ? correction.unitPrice : Math.min(previous, correction.unitPrice)
		);
	}

	const trades = transactions.map((tx): PricedTrade => {
		const ref = `transaction:${tx.transactionId}`;
		const gross = tx.quantity * tx.unitPrice;
		const transfer = isOwnParty(tx.clientId, input.own);
		const isTracked = input.tracked.has(tx.typeId);
		if (transfer) {
			return {
				ref,
				at: tx.date,
				typeId: tx.typeId,
				quantity: tx.quantity,
				isBuy: tx.isBuy,
				unitPrice: tx.unitPrice,
				tax: 0,
				taxSource: 'none',
				brokerFee: 0,
				brokerFeeSource: 'none',
				netUnitPrice: tx.unitPrice,
				source: isTracked
					? {
							kind: 'market',
							text: 'Market trade with one of your own characters or corporations: transfer',
							needsReview: false
						}
					: UNTRACKED_SOURCE,
				transfer: true
			};
		}

		let tax = 0;
		let taxSource: FeeSource = 'none';
		if (!tx.isBuy) {
			const fromJournal = journalTax.get(tx.transactionId);
			if (fromJournal !== undefined) {
				tax = fromJournal;
				taxSource = 'journal';
			} else {
				tax = roundCents((gross * input.salesTaxPct) / 100);
				taxSource = 'estimated';
			}
		}

		let brokerFee: number;
		let brokerFeeSource: FeeSource;
		const order = matchedOrder.get(tx.transactionId);
		const fees = order ? orderFees.get(order.orderId) : undefined;
		if (order && fees !== undefined) {
			const filled = Math.max(
				order.volumeTotal - order.volumeRemain,
				matchedQuantity.get(order.orderId) ?? 0
			);
			brokerFee = filled > 0 ? (fees * tx.quantity) / filled : 0;
			brokerFeeSource = 'journal';
		} else if (!order && input.ordersAvailable.has(tx.sourceId)) {
			brokerFee = 0;
			brokerFeeSource = 'none';
		} else {
			brokerFee = roundCents((gross * input.brokerFeePct) / 100);
			brokerFeeSource = 'estimated';
		}

		const netUnitPrice = tx.isBuy
			? (gross + brokerFee) / tx.quantity
			: (gross - tax - brokerFee) / tx.quantity;
		const correction = isTracked ? transactionCorrections.get(ref) : undefined;
		const feeText =
			brokerFeeSource === 'journal'
				? 'broker fee from the order'
				: brokerFeeSource === 'none'
					? 'no broker fee (instant trade)'
					: `broker fee estimated at ${formatPct(input.brokerFeePct)}`;
		const taxText = tx.isBuy
			? ''
			: taxSource === 'journal'
				? ', sales tax from the journal'
				: `, sales tax estimated at ${formatPct(input.salesTaxPct)}`;
		return {
			ref,
			at: tx.date,
			typeId: tx.typeId,
			quantity: tx.quantity,
			isBuy: tx.isBuy,
			unitPrice: tx.unitPrice,
			tax,
			taxSource,
			brokerFee,
			brokerFeeSource,
			netUnitPrice: correction ?? netUnitPrice,
			source: !isTracked
				? UNTRACKED_SOURCE
				: correction !== undefined
					? CORRECTION_SOURCE
					: {
							kind: 'market',
							text: `Market ${tx.isBuy ? 'purchase' : 'sale'} on ${formatTime(tx.date)}: ${feeText}${taxText}`,
							needsReview: false
						},
			transfer: false
		};
	});
	trades.sort((a, b) => a.at - b.at || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
	unallocatedFees.sort((a, b) => a.date - b.date || a.refId - b.refId);
	return { trades, unallocatedFees };
}
