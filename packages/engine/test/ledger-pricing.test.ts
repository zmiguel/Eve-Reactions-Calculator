import { describe, expect, it } from 'vitest';
import { allocateTotal, isOwnParty, priceContract, priceTrades } from '../src/ledger/pricing.ts';
import {
	TrackingSettings,
	type LedgerContract,
	type LedgerContractItem,
	type LedgerCorrection,
	type LedgerJaniceAppraisal,
	type LedgerJournalRow,
	type LedgerOrder,
	type LedgerTransaction,
	type OwnParties,
	type PricedTrade,
	type ReferencePriceFn
} from '../src/ledger/types.ts';

// Own parties: characters 1001 and 1002, corporation 2001. Strangers: 9001, 9003 (characters), 9002 (corp).
const own: OwnParties = { characterIds: new Set([1001, 1002]), corporationIds: new Set([2001]) };
const settings = TrackingSettings.parse({}); // rule: expected 100%, tolerance 5 points

const TRITANIUM = 34; // reference 5
const PYERITE = 35; // reference 50
const MEXALLON = 36; // no reference price
const ISOGEN = 37; // reference 100

const ISSUED = Date.UTC(2026, 9, 1, 8, 0, 0);
const COMPLETED = Date.UTC(2026, 9, 2, 9, 30, 0);

const REFERENCES: Record<number, number> = { [TRITANIUM]: 5, [PYERITE]: 50, [ISOGEN]: 100 };
const referencePrice: ReferencePriceFn = (typeId, at) => {
	expect(at).toBe(ISSUED); // the rule prices at date_issued
	const unitPrice = REFERENCES[typeId];
	return unitPrice === undefined ? null : { unitPrice, label: 'Jita 4-4 buy on 2026-10-01' };
};

let recordId = 1;
function item(typeId: number, quantity: number, isIncluded: boolean): LedgerContractItem {
	return { recordId: recordId++, typeId, quantity, isIncluded };
}

function contract(overrides: Partial<LedgerContract>): LedgerContract {
	return {
		contractId: 500,
		issuerId: 9001,
		issuerCorporationId: 9002,
		acceptorId: 1001,
		assigneeId: 1001,
		forCorporation: false,
		price: 0,
		reward: 0,
		title: null,
		dateIssued: ISSUED,
		completedAt: COMPLETED,
		items: [],
		janice: null,
		...overrides
	};
}

function price(c: LedgerContract, corrections: readonly LedgerCorrection[] = []) {
	return priceContract(c, own, settings, referencePrice, corrections);
}

/** Σ quantity × unit price, rounded to cents. */
function lineSum(units: number[], quantities: number[]): number {
	return Math.round(units.reduce((sum, unit, i) => sum + unit * quantities[i] * 100, 0)) / 100;
}

describe('allocateTotal', () => {
	it('splits 1,000,000 over three equal lines exactly, the extra cent to the first line', () => {
		// 100,000,000 cents / 3 = 33,333,333.33 each; floors sum to 99,999,999, the 1 cent left goes
		// to the first line (equal remainders, earlier line first).
		const units = allocateTotal(1_000_000, [
			{ quantity: 1, weight: 1 },
			{ quantity: 1, weight: 1 },
			{ quantity: 1, weight: 1 }
		]);
		expect(units).toEqual([333_333.34, 333_333.33, 333_333.33]);
		expect(lineSum(units, [1, 1, 1])).toBe(1_000_000);
	});

	it('hands out awkward cent remainders by largest remainder', () => {
		// 5 cents over 3 equal lines: 1.67 each, floors 1+1+1, 2 cents left → first two lines.
		expect(
			allocateTotal(
				0.05,
				[1, 1, 1].map(() => ({ quantity: 1, weight: 1 }))
			)
		).toEqual([0.02, 0.02, 0.01]);
		// 1.00 over shares 1 : 2 : 7 (qty × weight) → 10, 20, 70 cents.
		const units = allocateTotal(1, [
			{ quantity: 1, weight: 1 },
			{ quantity: 2, weight: 1 },
			{ quantity: 1, weight: 7 }
		]);
		expect(units).toEqual([0.1, 0.1, 0.7]);
	});

	it('weights each line by quantity × weight', () => {
		// shares 2×3 = 6 and 1×4 = 4 → 6.00 and 4.00 of 10 → unit prices 3 and 4.
		expect(
			allocateTotal(10, [
				{ quantity: 2, weight: 3 },
				{ quantity: 1, weight: 4 }
			])
		).toEqual([3, 4]);
	});

	it('sums exactly to the cent over many lines', () => {
		const lines = Array.from({ length: 97 }, (_, i) => ({ quantity: i + 1, weight: (i % 7) + 0.13 }));
		const units = allocateTotal(123_456.789, lines);
		// total rounded to the cent: 123,456.79
		expect(
			lineSum(
				units,
				lines.map((line) => line.quantity)
			)
		).toBe(123_456.79);
		const shareSum = lines.reduce((sum, line) => sum + line.quantity * line.weight, 0);
		lines.forEach((line, i) => {
			const exact = (123_456.79 * line.quantity * line.weight) / shareSum;
			expect(Math.abs(units[i] * line.quantity - exact)).toBeLessThan(0.0100001);
		});
	});

	it('splits by quantity when every weight is 0', () => {
		// 10 over quantities 1 and 3 → 2.50 and 7.50 → unit 2.5 each.
		expect(
			allocateTotal(10, [
				{ quantity: 1, weight: 0 },
				{ quantity: 3, weight: 0 }
			])
		).toEqual([2.5, 2.5]);
	});

	it('gives a single line the whole total and returns [] without lines', () => {
		// 12.346 rounds to 1,235 cents; 12.35 / 4 = 3.0875.
		expect(allocateTotal(12.346, [{ quantity: 4, weight: 9 }])).toEqual([3.0875]);
		expect(allocateTotal(500, [])).toEqual([]);
	});
});

describe('isOwnParty', () => {
	it('accepts own characters and corporations only', () => {
		expect(isOwnParty(1001, own)).toBe(true);
		expect(isOwnParty(2001, own)).toBe(true);
		expect(isOwnParty(9001, own)).toBe(false);
	});
});

describe('priceContract direction', () => {
	it('issuer own, included items: a sale earning the price', () => {
		const c = price(
			contract({ issuerId: 1001, acceptorId: 9001, price: 500, items: [item(TRITANIUM, 10, true)] })
		);
		expect(c?.direction).toBe('sell');
		expect(c?.iskIn).toBe(500);
		expect(c?.ref).toBe('contract:500');
		expect(c?.at).toBe(COMPLETED);
		// one type: exact, 500 / 10
		expect(c?.items).toMatchObject([
			{ typeId: TRITANIUM, quantity: 10, incoming: false, unitPrice: 50, source: { kind: 'contract_single' } }
		]);
		expect(c?.needsReview).toBe(false);
	});

	it('issuer own, asked-for items: a purchase paid with the reward', () => {
		// price 0 − reward 300 → iskIn −300; items come in at 300 / 10.
		const c = price(
			contract({ issuerId: 1001, acceptorId: 9001, reward: 300, items: [item(TRITANIUM, 10, false)] })
		);
		expect(c?.direction).toBe('buy');
		expect(c?.iskIn).toBe(-300);
		expect(c?.items).toMatchObject([{ incoming: true, unitPrice: 30 }]);
	});

	it('acceptor own, included items: a purchase paying the price', () => {
		const c = price(contract({ price: 400, items: [item(TRITANIUM, 10, true)] }));
		expect(c?.direction).toBe('buy');
		expect(c?.iskIn).toBe(-400);
		expect(c?.items).toMatchObject([{ incoming: true, unitPrice: 40 }]);
	});

	it('acceptor own, asked-for items: a sale earning the reward', () => {
		const c = price(contract({ reward: 250, items: [item(TRITANIUM, 10, false)] }));
		expect(c?.direction).toBe('sell');
		expect(c?.iskIn).toBe(250);
		expect(c?.items).toMatchObject([{ incoming: false, unitPrice: 25 }]);
	});

	it('acceptor own, free items: still a purchase costing 0', () => {
		const c = price(contract({ price: null, reward: null, items: [item(TRITANIUM, 10, true)] }));
		expect(c?.direction).toBe('buy');
		expect(c?.iskIn).toBe(0);
		expect(c?.items).toMatchObject([{ incoming: true, unitPrice: 0, source: { kind: 'contract_single' } }]);
	});

	it('a corporation contract counts for the own issuer corporation only', () => {
		const forCorp = contract({
			issuerId: 9001,
			issuerCorporationId: 2001,
			forCorporation: true,
			acceptorId: 9003,
			price: 600,
			items: [item(TRITANIUM, 10, true)]
		});
		expect(price(forCorp)?.direction).toBe('sell');
		expect(price(forCorp)?.iskIn).toBe(600);
		expect(price({ ...forCorp, forCorporation: false })).toBeNull();
	});

	it('assigned to an own corporation and accepted by a member who is not own: the corporation receives', () => {
		const toCorp = contract({
			assigneeId: 2001,
			acceptorId: 9003,
			price: 400,
			items: [item(TRITANIUM, 10, true)]
		});
		const c = price(toCorp);
		expect(c?.direction).toBe('buy');
		expect(c?.iskIn).toBe(-400);
		expect(c?.items).toMatchObject([
			{ typeId: TRITANIUM, quantity: 10, incoming: true, unitPrice: 40, source: { kind: 'contract_single' } }
		]);
		// Priced like the same contract accepted by an own character.
		expect(c).toEqual(price({ ...toCorp, acceptorId: 1001, assigneeId: 1001 }));
		// Assigned to a stranger corporation: not the user's.
		expect(price({ ...toCorp, assigneeId: 9002 })).toBeNull();
	});

	it('issued by an own character to an own corporation and accepted by an outside member: a transfer', () => {
		const c = price(
			contract({
				issuerId: 1001,
				assigneeId: 2001,
				acceptorId: 9003,
				price: 1000,
				items: [item(TRITANIUM, 10, true)]
			})
		);
		expect(c?.direction).toBe('transfer');
		expect(c?.items).toEqual([]);
	});

	it('both sides own: a transfer with no ISK', () => {
		const c = price(
			contract({ issuerId: 1001, acceptorId: 1002, price: 1000, items: [item(TRITANIUM, 10, true)] })
		);
		expect(c?.direction).toBe('transfer');
		expect(c?.iskIn).toBe(0);
		expect(c?.items).toEqual([]);
		expect(c?.needsReview).toBe(false);
	});

	it('no own party on either side: null', () => {
		expect(price(contract({ acceptorId: 9003, items: [item(TRITANIUM, 10, true)] }))).toBeNull();
	});
});

describe('priceContract splits', () => {
	// Tritanium 1,000 (records 600 + 400 merged) × 5 + Pyerite 100 × 50 = 10,000 reference total.
	const ruleItems = () => [item(TRITANIUM, 600, true), item(PYERITE, 100, true), item(TRITANIUM, 400, true)];

	it('rule inside tolerance: split by reference prices with the implied %', () => {
		// 9,600 / 10,000 = 96.0%, within 100 ± 5; shares 5,000 : 5,000 → 4,800 each.
		const c = price(contract({ price: 9_600, items: ruleItems() }));
		expect(c?.direction).toBe('buy');
		expect(c?.impliedPct).toBeCloseTo(96, 9);
		expect(c?.items).toMatchObject([
			{ typeId: TRITANIUM, quantity: 1000, incoming: true, unitPrice: 4.8, source: { kind: 'rule_match' } },
			{ typeId: PYERITE, quantity: 100, incoming: true, unitPrice: 48, source: { kind: 'rule_match' } }
		]);
		expect(c?.items[0].source.text).toContain('96.0%');
		expect(c?.needsReview).toBe(false);
	});

	it('rule outside tolerance: same split, needs review', () => {
		// 9,400 / 10,000 = 94.0%, outside 100 ± 5; 4,700 each.
		const c = price(contract({ price: 9_400, items: ruleItems() }));
		expect(c?.impliedPct).toBeCloseTo(94, 9);
		expect(c?.items).toMatchObject([
			{ unitPrice: 4.7, source: { kind: 'rule_outside', needsReview: true } },
			{ unitPrice: 47, source: { kind: 'rule_outside', needsReview: true } }
		]);
		expect(c?.items[0].source.text).toContain('94.0%');
		expect(c?.needsReview).toBe(true);
	});

	const janice = (types: number[]): LedgerJaniceAppraisal => ({
		code: 'Ab12Cd',
		marketName: 'Jita 4-4',
		pricing: 'sell',
		datasetTime: Date.UTC(2026, 8, 30, 12, 0),
		items: types.map((typeId) =>
			typeId === TRITANIUM
				? { typeId, buyPrice: 1, splitPrice: 2, sellPrice: 6 }
				: { typeId, buyPrice: 1, splitPrice: 2, sellPrice: 36 }
		)
	});

	it('Janice appraisal with every type: weights are its sell prices', () => {
		// pricing sell: shares 1,000 × 6 = 6,000 and 100 × 36 = 3,600 → exactly 9,600 → units 6 and 36
		// (buy prices would give 1,000 : 100 instead).
		const c = price(contract({ price: 9_600, items: ruleItems(), janice: janice([TRITANIUM, PYERITE]) }));
		expect(c?.items).toMatchObject([
			{ unitPrice: 6, source: { kind: 'janice', needsReview: false } },
			{ unitPrice: 36, source: { kind: 'janice' } }
		]);
		expect(c?.items[0].source.text).toContain('Ab12Cd');
		expect(c?.impliedPct).toBeNull();
	});

	it('Janice appraisal missing a type: falls back to the rule', () => {
		const c = price(contract({ price: 9_600, items: ruleItems(), janice: janice([TRITANIUM]) }));
		expect(c?.items).toMatchObject([
			{ unitPrice: 4.8, source: { kind: 'rule_match' } },
			{ unitPrice: 48, source: { kind: 'rule_match' } }
		]);
	});

	it('a type without reference price gets weight 0 and needs review', () => {
		// reference total 1,000 × 5 = 5,000; 4,800 → 96.0%; Mexallon weight 0 → Tritanium takes 4,800.
		const c = price(
			contract({ price: 4_800, items: [item(TRITANIUM, 1000, true), item(MEXALLON, 10, true)] })
		);
		expect(c?.impliedPct).toBeCloseTo(96, 9);
		expect(c?.items).toMatchObject([
			{ typeId: TRITANIUM, unitPrice: 4.8, source: { kind: 'rule_match', needsReview: false } },
			{ typeId: MEXALLON, unitPrice: 0, source: { kind: 'review', needsReview: true } }
		]);
		expect(c?.needsReview).toBe(true);
	});

	it('items both ways: a swap valued at reference prices, needs review', () => {
		const c = price(
			contract({
				issuerId: 1001,
				acceptorId: 9001,
				price: 0,
				items: [item(TRITANIUM, 1000, true), item(PYERITE, 100, false)]
			})
		);
		expect(c?.direction).toBe('swap');
		expect(c?.iskIn).toBe(0);
		expect(c?.items).toMatchObject([
			{ typeId: TRITANIUM, incoming: false, unitPrice: 5, source: { kind: 'review', needsReview: true } },
			{ typeId: PYERITE, incoming: true, unitPrice: 50, source: { kind: 'review', needsReview: true } }
		]);
		expect(c?.needsReview).toBe(true);
	});

	it('a corrected item keeps its price and the rest is re-split with the same weights', () => {
		// Reference total 5,000 + 5,000 + Isogen 50 × 100 = 15,000; 14,400 → 96.0%.
		// Isogen corrected to 120 → 6,000; the remaining 8,400 is split 5,000 : 5,000 → 4,200 each.
		const c = price(
			contract({
				price: 14_400,
				items: [item(TRITANIUM, 1000, true), item(PYERITE, 100, true), item(ISOGEN, 50, true)]
			}),
			[
				{ targetKind: 'contract_item', targetRef: 'contract:500:37', unitPrice: 120 },
				{ targetKind: 'contract_item', targetRef: 'contract:501:34', unitPrice: 1 } // another contract
			]
		);
		expect(c?.items).toMatchObject([
			{ typeId: TRITANIUM, unitPrice: 4.2, source: { kind: 'rule_match' } },
			{ typeId: PYERITE, unitPrice: 42, source: { kind: 'rule_match' } },
			{ typeId: ISOGEN, unitPrice: 120, source: { kind: 'correction', needsReview: false } }
		]);
		expect(c?.impliedPct).toBeCloseTo(96, 9);
	});

	it('does not depend on record or appraisal order', () => {
		const items = [item(TRITANIUM, 300, true), item(PYERITE, 100, true), item(TRITANIUM, 700, true)];
		const a = janice([TRITANIUM, PYERITE]);
		const base = price(contract({ price: 9_999.99, items, janice: a }));
		const shuffled = price(
			contract({
				price: 9_999.99,
				items: [...items].reverse(),
				janice: { ...a, items: [...a.items].reverse() }
			})
		);
		expect(shuffled).toEqual(base);
	});
});

describe('priceTrades', () => {
	const T = Date.UTC(2026, 9, 10, 12, 0, 0); // a whole second
	const JITA = 60003760;
	const AMARR = 60008494;

	const tx = (overrides: Partial<LedgerTransaction> & { transactionId: number }): LedgerTransaction => ({
		sourceId: 1,
		division: null,
		date: T,
		typeId: TRITANIUM,
		quantity: 1,
		unitPrice: 1,
		isBuy: true,
		clientId: 9001,
		locationId: JITA,
		...overrides
	});
	const row = (
		refId: number,
		refType: string,
		date: number,
		amount: number,
		sourceId = 1,
		division: number | null = null
	) =>
		({
			refId,
			sourceId,
			division,
			date,
			refType,
			amount,
			contextId: null,
			contextIdType: null
		}) satisfies LedgerJournalRow;
	const order = (overrides: Partial<LedgerOrder> & { orderId: number }): LedgerOrder => ({
		sourceId: 1,
		division: null,
		typeId: TRITANIUM,
		isBuy: true,
		price: 5,
		volumeTotal: 10_000,
		volumeRemain: 2_000,
		issued: T - 86_400_000,
		locationId: JITA,
		state: 'open',
		...overrides
	});

	const ISSUED_O1 = T - 86_400_000; // order 1, filled 8,000 of 10,000
	const ISSUED_O0 = T - 3 * 86_400_000; // older order at the same price, not picked

	const transactions: LedgerTransaction[] = [
		// Corporation wallet (source 2, division 2, orders not readable): two sales in one second.
		tx({ transactionId: 1, sourceId: 2, division: 2, date: T, isBuy: false, quantity: 10, unitPrice: 1000 }),
		tx({
			transactionId: 2,
			sourceId: 2,
			division: 2,
			date: T + 400,
			isBuy: false,
			quantity: 5,
			unitPrice: 3000
		}),
		// Personal wallet (source 1, orders readable): a sale with no tax row and no order.
		tx({ transactionId: 3, date: T + 60_000, isBuy: false, quantity: 4, unitPrice: 250, typeId: PYERITE }),
		// Two buys filling order 1.
		tx({ transactionId: 10, date: T + 3_600_000, quantity: 3000, unitPrice: 5 }),
		tx({ transactionId: 11, date: T + 7_200_000, quantity: 1000, unitPrice: 5 }),
		// A buy with no order: instant trade.
		tx({ transactionId: 12, date: T + 7_200_000, quantity: 10, unitPrice: 50, typeId: PYERITE }),
		// Trades with own parties.
		tx({ transactionId: 13, date: T + 9_000_000, quantity: 7, unitPrice: 9, clientId: 1002 }),
		tx({ transactionId: 14, date: T + 9_000_000, quantity: 7, unitPrice: 9, isBuy: false, clientId: 2001 })
	];
	const journal: LedgerJournalRow[] = [
		// Sales tax of the two corporation sales: 900 + 100 = 1,000 in that second.
		row(100, 'transaction_tax', T + 200, -900, 2, 2),
		row(101, 'transaction_tax', T + 900, -100, 2, 2),
		row(102, 'transaction_tax', T + 300, -5000, 2, 1), // another division: ignored
		row(103, 'transaction_tax', T + 1500, -77, 2, 2), // next second: ignored
		// Order 1 fees within 1 s of its issued: 1,200 + 400 = 1,600.
		row(200, 'brokers_fee', ISSUED_O1 + 300, -1200),
		row(201, 'market_provider_tax', ISSUED_O1 + 800, -400),
		// Order 0 (not matched) and a stray fee: unallocated.
		row(202, 'brokers_fee', ISSUED_O0, -999),
		row(203, 'brokers_fee', T + 5_000_000, -50)
	];
	const orders: LedgerOrder[] = [
		order({ orderId: 1, issued: ISSUED_O1 }),
		order({ orderId: 0, issued: ISSUED_O0 }),
		order({ orderId: 2, issued: T + 10_000_000 }), // issued after the trades
		order({ orderId: 3, issued: ISSUED_O1, price: 5.01 }), // another price
		order({ orderId: 4, issued: ISSUED_O1, locationId: AMARR }) // another place
	];
	const input = {
		transactions,
		journal,
		orders,
		own,
		brokerFeePct: 1.5,
		salesTaxPct: 3.37,
		ordersAvailable: new Set([1]),
		corrections: [] as LedgerCorrection[]
	};
	const byRef = (trades: PricedTrade[], ref: string) => {
		const trade = trades.find((t) => t.ref === ref);
		if (!trade) throw new Error(`missing ${ref}`);
		return trade;
	};

	it('splits one second of sales tax rows by value and estimates unreadable broker fees', () => {
		const { trades } = priceTrades(input);
		// tax 1,000 over gross 10,000 : 15,000 → 400 and 600; broker fee 1.5% → 150 and 225.
		expect(byRef(trades, 'transaction:1')).toMatchObject({
			tax: 400,
			taxSource: 'journal',
			brokerFee: 150,
			brokerFeeSource: 'estimated',
			transfer: false
		});
		expect(byRef(trades, 'transaction:2')).toMatchObject({
			tax: 600,
			taxSource: 'journal',
			brokerFee: 225,
			brokerFeeSource: 'estimated'
		});
		// net (10,000 − 400 − 150) / 10 = 945; (15,000 − 600 − 225) / 5 = 2,835
		expect(byRef(trades, 'transaction:1').netUnitPrice).toBeCloseTo(945, 9);
		expect(byRef(trades, 'transaction:2').netUnitPrice).toBeCloseTo(2835, 9);
		expect(byRef(trades, 'transaction:1').source).toMatchObject({ kind: 'market', needsReview: false });
	});

	it('estimates sales tax without a journal row; no broker fee for an instant trade', () => {
		const sale = byRef(priceTrades(input).trades, 'transaction:3');
		// 3.37% of 1,000 = 33.70; net (1,000 − 33.70) / 4 = 241.575
		expect(sale).toMatchObject({ tax: 33.7, taxSource: 'estimated', brokerFee: 0, brokerFeeSource: 'none' });
		expect(sale.netUnitPrice).toBeCloseTo(241.575, 9);
		const buy = byRef(priceTrades(input).trades, 'transaction:12');
		expect(buy).toMatchObject({
			tax: 0,
			taxSource: 'none',
			brokerFee: 0,
			brokerFeeSource: 'none',
			netUnitPrice: 50
		});
	});

	it('spreads the matched order fees over its filled units', () => {
		const { trades } = priceTrades(input);
		// order 1 (latest issued at the same wallet/type/side/place/price): fees 1,600 over 8,000 filled.
		// 3,000 units → 600, net (15,000 + 600) / 3,000 = 5.2; 1,000 units → 200, net 5.2.
		expect(byRef(trades, 'transaction:10')).toMatchObject({
			tax: 0,
			taxSource: 'none',
			brokerFeeSource: 'journal'
		});
		expect(byRef(trades, 'transaction:10').brokerFee).toBeCloseTo(600, 9);
		expect(byRef(trades, 'transaction:10').netUnitPrice).toBeCloseTo(5.2, 9);
		expect(byRef(trades, 'transaction:11').brokerFee).toBeCloseTo(200, 9);
	});

	it('counts at least the matched units as filled', () => {
		// Snapshot says nothing filled; the 400 matched units carry the whole 300 fee.
		const { trades } = priceTrades({
			...input,
			transactions: [tx({ transactionId: 20, quantity: 400, unitPrice: 5 })],
			journal: [row(300, 'brokers_fee', ISSUED_O1, -300)],
			orders: [order({ orderId: 1, issued: ISSUED_O1, volumeTotal: 1000, volumeRemain: 1000 })]
		});
		expect(trades[0]).toMatchObject({ brokerFee: 300, brokerFeeSource: 'journal' });
	});

	it('reports fee rows no matched order uses', () => {
		const { unallocatedFees } = priceTrades(input);
		expect(unallocatedFees).toEqual([
			{ refId: 202, date: ISSUED_O0, amount: 999 },
			{ refId: 203, date: T + 5_000_000, amount: 50 }
		]);
	});

	it('marks trades with own parties as transfers without fees', () => {
		const { trades } = priceTrades(input);
		for (const ref of ['transaction:13', 'transaction:14']) {
			expect(byRef(trades, ref)).toMatchObject({
				transfer: true,
				tax: 0,
				taxSource: 'none',
				brokerFee: 0,
				brokerFeeSource: 'none',
				netUnitPrice: 9
			});
		}
	});

	it('applies a transaction correction', () => {
		const { trades } = priceTrades({
			...input,
			corrections: [{ targetKind: 'transaction', targetRef: 'transaction:10', unitPrice: 4.9 }]
		});
		expect(byRef(trades, 'transaction:10')).toMatchObject({
			netUnitPrice: 4.9,
			brokerFeeSource: 'journal',
			source: { kind: 'correction', needsReview: false }
		});
	});

	it('sorts by time and ref and does not depend on input order', () => {
		const base = priceTrades(input);
		expect(base.trades.map((t) => t.ref)).toEqual([
			'transaction:1',
			'transaction:2',
			'transaction:3',
			'transaction:10',
			'transaction:11',
			'transaction:12',
			'transaction:13',
			'transaction:14'
		]);
		const rotate = <T>(list: readonly T[]) => [...list.slice(3), ...list.slice(0, 3)].reverse();
		expect(
			priceTrades({
				...input,
				transactions: rotate(transactions),
				journal: rotate(journal),
				orders: rotate(orders)
			})
		).toEqual(base);
	});
});
