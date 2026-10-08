import { describe, expect, it } from 'vitest';
import { listReactions, rankRows } from '../src/listing.ts';
import { makeCtx } from './fixtures/context.ts';
import { jitaPrices, priceBook } from './fixtures/dataset.ts';

describe('listReactions', () => {
	it('filters by reactor and tier', () => {
		const ctx = makeCtx();
		expect(listReactions(ctx, { reactor: 'hybrid' }).map((r) => r.reaction.blueprintTypeId)).toEqual([46157]);
		expect(listReactions(ctx, { tier: 'composite' }).map((r) => r.reaction.blueprintTypeId)).toEqual([
			46204, 46205, 46209
		]);
	});

	it('computes chain only for chainable and reprocessed only for reprocessable reactions', () => {
		const rows = listReactions(makeCtx());
		const get = (id: number) => rows.find((r) => r.reaction.blueprintTypeId === id)!;
		expect(get(46204).chain?.view).toBe('chain');
		expect(get(46204).reprocessed).toBeNull();
		expect(get(46166).chain).toBeNull();
		expect(get(46191).reprocessed?.outputMode).toBe('reprocessed');
	});

	it('picks the variant with the highest profit per slot-day as best', () => {
		for (const row of listReactions(makeCtx())) {
			const values = [row.single, row.chain, row.reprocessed]
				.map((r) => r?.totals.profitPerSlotDay)
				.filter((v): v is number => v != null);
			if (values.length === 0) expect(row.best).toBe(row.single);
			else expect(row.best.totals.profitPerSlotDay).toBe(Math.max(...values));
		}
	});
});

describe('rankRows', () => {
	it('sorts descending with null values last', () => {
		const prices = { ...jitaPrices, 16663: { buy: null, sell: null } };
		const rows = listReactions(makeCtx({ inputPrices: priceBook({ jita: prices }) }), {
			tier: 'intermediate'
		});
		const ranked = rankRows(rows);
		const values = ranked.map((r) => r.best.totals.profitPerSlotDay);
		expect(values.at(-1)).toBeNull();
		const numbers = values.filter((v): v is number => v !== null);
		expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
		expect(rows).not.toBe(ranked);
	});
});
