import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Dataset } from '@reactions/engine';
import type { SdeDataset } from '@reactions/sde';
import { asEnv, fakeEnv } from '../../test/fakes';
import { NOW, insertUser, loadSde, putKv } from '../../test/fixtures';
import { insertLot } from '../../test/ledger-item';
import { insertManualEntry, manualEntries } from '../../test/ledger';
import {
	EARLIEST_DATE,
	MAX_ENTRIES_PER_SUBMIT,
	MAX_ENTRIES_PER_USER,
	MESSAGES,
	addManualEntries,
	deleteManualEntry,
	itemChoices,
	listManualEntries,
	parseAmount,
	parseManualDate,
	parseManualImport,
	readManualForm,
	resolveItem,
	type ManualEntryInput
} from './manual-entries';

const DAY = 86_400_000;
let sde: SdeDataset;
let dataset: Dataset;
/** A reaction material whose name has a space, a reaction product and a formula. */
let SPACED: { typeId: number; name: string };
let PRODUCT: { typeId: number; name: string };
let FORMULA: number;
beforeAll(async () => {
	sde = await loadSde();
	dataset = sde.dataset;
	const material = dataset.reactions
		.flatMap((r) => r.materials)
		.map((m) => dataset.types[m.typeId])
		.find((t) => t.name.includes(' '))!;
	SPACED = { typeId: material.typeId, name: material.name };
	const product = dataset.types[dataset.reactions[0].product.typeId];
	PRODUCT = { typeId: product.typeId, name: product.name };
	FORMULA = dataset.reactions[0].blueprintTypeId;
});

async function setup(rebuildResult: unknown = { rebuiltAt: NOW, lots: 0, jobs: 0, needsReview: 0 }) {
	const rebuildLedger = vi.fn(async (_userId: string) => rebuildResult);
	const env = fakeEnv({ UPDATER: { rebuildLedger } } as never);
	await putKv(env, sde);
	insertUser(env.DB, { userId: 'u1' }, [{ characterId: 90000001, name: 'Alpha' }]);
	insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000002, name: 'Beta' }]);
	return { env, rebuildLedger };
}

describe('parseManualDate', () => {
	it.each([
		['2026-10-01', Date.UTC(2026, 9, 1)],
		['2026-10-01 12:30', Date.UTC(2026, 9, 1, 12, 30)],
		['2026.10.01 12:30', Date.UTC(2026, 9, 1, 12, 30)],
		['2026-10-01T12:30:15Z', Date.UTC(2026, 9, 1, 12, 30, 15)],
		['2026-10-01T12:30:00+02:00', Date.UTC(2026, 9, 1, 10, 30)]
	])('reads %s as UTC', (text, expected) => {
		expect(parseManualDate(text)).toBe(expected);
	});

	it.each(['2026-02-30', '2026-13-01', '01/10/2026', 'yesterday', '2026-10-01 25:00', ''])(
		'rejects %s',
		(text) => {
			expect(parseManualDate(text)).toBeNull();
		}
	);
});

describe('parseAmount', () => {
	it.each([
		['1234', 1234],
		['1,234.5', 1234.5],
		['1 234 567', 1234567],
		['17500 ISK', 17500],
		['0.01', 0.01]
	])('reads %s', (text, expected) => {
		expect(parseAmount(text)).toBe(expected);
	});

	it.each(['1,23', '-5', '1.2.3', 'abc', '12,34,567'])('rejects %s', (text) => {
		expect(parseAmount(text)).toBeNull();
	});
});

describe('parseManualImport', () => {
	it('reads one purchase per line: names with spaces, case-insensitive, separators, times and tabs', () => {
		const text = [
			`2026-10-01 ${SPACED.name} 10,000 1,250.50`,
			'',
			`2026-10-02 14:30 ${SPACED.name.toUpperCase()} 500 17500 ISK`,
			`2026-10-03\t${PRODUCT.name}\t1 000\t99.5`
		].join('\n');
		const { rows, errors } = parseManualImport(text, dataset, NOW);
		expect(errors).toEqual([]);
		expect(rows).toEqual([
			{
				line: 1,
				at: Date.UTC(2026, 9, 1),
				typeId: SPACED.typeId,
				name: SPACED.name,
				quantity: 10000,
				unitPrice: 1250.5
			},
			{
				line: 3,
				at: Date.UTC(2026, 9, 2, 14, 30),
				typeId: SPACED.typeId,
				name: SPACED.name,
				quantity: 500,
				unitPrice: 17500
			},
			{
				line: 4,
				at: Date.UTC(2026, 9, 3),
				typeId: PRODUCT.typeId,
				name: PRODUCT.name,
				quantity: 1000,
				unitPrice: 99.5
			}
		]);
	});

	it('reports each bad line with its number and keeps the good ones', () => {
		const future = new Date(NOW + DAY).toISOString().slice(0, 10);
		const text = [
			`2026-10-01 ${SPACED.name} 10 100`,
			'2026-10-01 Not A Real Item 10 100',
			`${future} ${SPACED.name} 10 100`,
			`2002-12-31 ${SPACED.name} 10 100`,
			`2026-99-01 ${SPACED.name} 10 100`,
			`2026-10-01 ${SPACED.name} 0 100`,
			`2026-10-01 ${SPACED.name} 1.5 100`,
			`2026-10-01 ${SPACED.name} 10 lots`,
			'2026-10-01 10 100',
			`2026-10-01 ${dataset.types[FORMULA].name} 1 100`
		].join('\n');
		const { rows, errors } = parseManualImport(text, dataset, NOW);
		expect(rows.map((r) => r.line)).toEqual([1]);
		expect(errors).toEqual([
			{ line: 2, message: 'Unknown item "Not A Real Item".' },
			{ line: 3, message: MESSAGES.future },
			{ line: 4, message: MESSAGES.early },
			{ line: 5, message: MESSAGES.date },
			{ line: 6, message: MESSAGES.quantity },
			{ line: 7, message: MESSAGES.quantity },
			{ line: 8, message: MESSAGES.price },
			{ line: 9, message: MESSAGES.shape },
			{ line: 10, message: `Unknown item "${dataset.types[FORMULA].name}".` }
		]);
	});

	it(`reads at most ${MAX_ENTRIES_PER_SUBMIT} lines and reports the rest`, () => {
		const line = `2026-10-01 ${SPACED.name} 1 1`;
		const { rows, errors } = parseManualImport(
			Array.from({ length: MAX_ENTRIES_PER_SUBMIT + 3 }, () => line).join('\n'),
			dataset,
			NOW
		);
		expect(rows).toHaveLength(MAX_ENTRIES_PER_SUBMIT);
		expect(errors).toEqual([{ line: MAX_ENTRIES_PER_SUBMIT + 1, message: MESSAGES.tooMany }]);
	});
});

describe('item choices and the purchase form', () => {
	it('offers every type but formulas, reaction materials first, then products', () => {
		const choices = itemChoices(dataset);
		expect(choices.some((c) => c.typeId === FORMULA)).toBe(false);
		const groups = choices.map((c) => c.group);
		expect(groups.indexOf('product')).toBeGreaterThan(groups.lastIndexOf('material'));
		expect(choices.find((c) => c.typeId === SPACED.typeId)?.group).toBe('material');
		expect(choices.find((c) => c.typeId === PRODUCT.typeId)?.group).toBe('product');
	});

	it('takes the picked type while it names the text, else the typed name (no JS)', () => {
		expect(resolveItem(dataset, String(SPACED.typeId), SPACED.name)).toBe(SPACED.typeId);
		expect(resolveItem(dataset, '', `  ${SPACED.name.toLowerCase()} `)).toBe(SPACED.typeId);
		expect(resolveItem(dataset, String(SPACED.typeId), PRODUCT.name)).toBe(PRODUCT.typeId);
		expect(resolveItem(dataset, String(FORMULA), '')).toBeNull();
		expect(resolveItem(dataset, '', 'Nothing like this')).toBeNull();
	});

	it('checks every field', () => {
		const ok = {
			item: SPACED.name,
			typeId: '',
			date: '2026-10-01',
			quantity: '1,000',
			unitPrice: '12.5',
			note: ' n '
		};
		expect(readManualForm(dataset, ok, NOW)).toEqual({
			entry: { at: Date.UTC(2026, 9, 1), typeId: SPACED.typeId, quantity: 1000, unitPrice: 12.5, note: 'n' }
		});
		const bad = (fields: Partial<typeof ok>) => readManualForm(dataset, { ...ok, ...fields }, NOW);
		expect(bad({ item: 'nope' })).toEqual({ error: MESSAGES.item });
		expect(bad({ date: 'soon' })).toEqual({ error: MESSAGES.date });
		expect(bad({ date: '2026-10-07' })).toEqual({ error: MESSAGES.future });
		expect(bad({ quantity: '2000000000000' })).toEqual({ error: MESSAGES.quantity });
		expect(bad({ unitPrice: '-1' })).toEqual({ error: MESSAGES.price });
		expect(bad({ note: 'x'.repeat(201) })).toEqual({ error: MESSAGES.note });
	});
});

describe('addManualEntries / deleteManualEntry', () => {
	const entry = { at: NOW - DAY, typeId: 0, quantity: 5, unitPrice: 10, note: null };

	it('stores the rows for the user only and asks for a rebuild', async () => {
		const { env, rebuildLedger } = await setup();
		const outcome = await addManualEntries(
			asEnv(env),
			'u1',
			[
				{ ...entry, typeId: SPACED.typeId },
				{ ...entry, typeId: PRODUCT.typeId, quantity: 7, note: 'from a friend' }
			],
			NOW
		);
		expect(outcome).toEqual({ ok: true, added: 2, rebuilt: true });
		expect(rebuildLedger).toHaveBeenCalledWith('u1');
		expect(manualEntries(env.DB, 'u1')).toEqual([
			{ entry_id: 1, date: NOW - DAY, type_id: SPACED.typeId, quantity: 5, unit_price: 10, note: null },
			{
				entry_id: 2,
				date: NOW - DAY,
				type_id: PRODUCT.typeId,
				quantity: 7,
				unit_price: 10,
				note: 'from a friend'
			}
		]);
		expect(manualEntries(env.DB, 'u2')).toEqual([]);
	});

	it.each<[string, Partial<ManualEntryInput>, string]>([
		['a formula', { typeId: -1 }, MESSAGES.item],
		['an unknown type', { typeId: 999999999 }, MESSAGES.item],
		['a future date', { at: NOW + 1 }, MESSAGES.future],
		['a date before 2003', { at: EARLIEST_DATE - 1 }, MESSAGES.early],
		['a fractional quantity', { quantity: 1.5 }, MESSAGES.quantity],
		['a negative price', { unitPrice: -1 }, MESSAGES.price],
		['a huge price', { unitPrice: 2e13 }, MESSAGES.price]
	])('rejects %s with 400, stores nothing and requests no rebuild', async (_case, change, message) => {
		const { env, rebuildLedger } = await setup();
		const typeId = change.typeId === -1 ? FORMULA : (change.typeId ?? SPACED.typeId);
		const outcome = await addManualEntries(asEnv(env), 'u1', [{ ...entry, ...change, typeId }], NOW);
		expect(outcome).toEqual({ ok: false, status: 400, message });
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
		expect(rebuildLedger).not.toHaveBeenCalled();
	});

	it('rejects an empty submit and more than 500 rows', async () => {
		const { env } = await setup();
		expect(await addManualEntries(asEnv(env), 'u1', [], NOW)).toMatchObject({
			status: 400,
			message: MESSAGES.none
		});
		const many = Array.from({ length: MAX_ENTRIES_PER_SUBMIT + 1 }, () => ({
			...entry,
			typeId: SPACED.typeId
		}));
		expect(await addManualEntries(asEnv(env), 'u1', many, NOW)).toMatchObject({
			status: 400,
			message: MESSAGES.tooMany
		});
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
	});

	it('keeps each user under the total limit; other users do not count', async () => {
		const { env, rebuildLedger } = await setup();
		env.DB.sqlite
			.prepare(
				`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
				INSERT INTO manual_entries (user_id, date, type_id, quantity, unit_price, created_at)
				SELECT 'u1', ?, ?, 1, 1, ? FROM n`
			)
			.run(MAX_ENTRIES_PER_USER - 1, NOW, SPACED.typeId, NOW);
		insertManualEntry(env.DB, 'u2', { typeId: SPACED.typeId });
		const row = { ...entry, typeId: SPACED.typeId };
		expect(await addManualEntries(asEnv(env), 'u1', [row, row], NOW)).toEqual({
			ok: false,
			status: 400,
			message: MESSAGES.full
		});
		expect(manualEntries(env.DB, 'u1')).toHaveLength(MAX_ENTRIES_PER_USER - 1);
		expect(rebuildLedger).not.toHaveBeenCalled();
		expect(await addManualEntries(asEnv(env), 'u1', [row], NOW)).toMatchObject({ ok: true, added: 1 });
		expect(manualEntries(env.DB, 'u1')).toHaveLength(MAX_ENTRIES_PER_USER);
		expect(await addManualEntries(asEnv(env), 'u2', [row], NOW)).toMatchObject({ ok: true, added: 1 });
	});

	it('marks the ledger dirty when the updater fails', async () => {
		const { env, rebuildLedger } = await setup();
		rebuildLedger.mockRejectedValueOnce(new Error('unreachable'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const outcome = await addManualEntries(asEnv(env), 'u1', [{ ...entry, typeId: SPACED.typeId }], NOW);
		expect(outcome).toEqual({ ok: true, added: 1, rebuilt: false });
		expect(env.DB.rows('SELECT dirty FROM ledger_state WHERE user_id = ?', 'u1')).toEqual([{ dirty: 1 }]);
	});

	it("deletes the user's own entry only, then asks for a rebuild", async () => {
		const { env, rebuildLedger } = await setup();
		const mine = insertManualEntry(env.DB, 'u1', { typeId: SPACED.typeId });
		const theirs = insertManualEntry(env.DB, 'u2', { typeId: SPACED.typeId });
		expect(await deleteManualEntry(asEnv(env), 'u1', theirs)).toEqual({
			ok: false,
			status: 404,
			message: 'That purchase is not in your list.'
		});
		expect(rebuildLedger).not.toHaveBeenCalled();
		expect(await deleteManualEntry(asEnv(env), 'u1', mine)).toEqual({ ok: true, added: 0, rebuilt: true });
		expect(rebuildLedger).toHaveBeenCalledWith('u1');
		expect(manualEntries(env.DB, 'u1')).toEqual([]);
		expect(manualEntries(env.DB, 'u2')).toHaveLength(1);
	});
});

describe('listManualEntries', () => {
	it("pages the user's purchases newest first with what is left of each batch", async () => {
		const { env } = await setup();
		const ids = Array.from({ length: 12 }, (_, i) =>
			insertManualEntry(env.DB, 'u1', {
				typeId: SPACED.typeId,
				date: NOW - (i + 1) * DAY,
				quantity: 10,
				unitPrice: 2
			})
		);
		insertManualEntry(env.DB, 'u2', { typeId: SPACED.typeId, date: NOW });
		insertLot(env.DB, 'u1', {
			lotId: 1,
			typeId: SPACED.typeId,
			acquiredAt: NOW - DAY,
			quantity: 10,
			remaining: 4,
			unitCost: 2,
			origin: 'manual',
			originRef: `manual:${ids[0]}`
		});
		const first = await listManualEntries(asEnv(env), 'u1', 1);
		expect(first).toMatchObject({ page: 1, pageCount: 2, total: 12 });
		expect(first.rows.map((r) => r.entryId)).toEqual(ids.slice(0, 10));
		expect(first.rows[0]).toEqual({
			entryId: ids[0],
			at: NOW - DAY,
			typeId: SPACED.typeId,
			name: SPACED.name,
			formula: false,
			quantity: 10,
			unitPrice: 2,
			total: 20,
			note: null,
			remaining: 4
		});
		expect(first.rows[1].remaining).toBeNull();
		const last = await listManualEntries(asEnv(env), 'u1', 9);
		expect(last.page).toBe(2);
		expect(last.rows.map((r) => r.entryId)).toEqual(ids.slice(10));
	});
});
